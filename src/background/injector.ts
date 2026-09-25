/**
 * XOKJ - Script Injection Orchestrator
 * Location: src/background/injector.ts
 *
 * Coordinates userscript injection based on Chromium navigation hooks,
 * match patterns, @run-at timing stages, and early CDP domain sync.
 */

import type { ScriptRecord, RunAtTiming, AppSettings } from '@/shared/types';
import { matchesAny, isRestrictedUrl } from '@/shared/match-pattern';
import { getScriptList, getSettings, onScriptsChanged } from '@/shared/storage';
import type { TabDebuggerManager } from './debugger-mgr';

export interface ScriptInjectorOptions {
  debuggerManager?: TabDebuggerManager;
  autoStart?: boolean;
  channelId?: string;
}

/**
 * Runner function executed in target page's MAIN world via chrome.scripting.executeScript.
 * Exported for isolated test verification and execution.
 */
export function pageSandboxRunner(
  code: string,
  scriptName: string,
  scriptId: string,
  metadata: Record<string, any>,
  channelId?: string
): { success: boolean; error?: string } {
  try {
    const grants: string[] = Array.isArray(metadata?.grants) ? metadata.grants : [];
    const cdpDecls = metadata?.cdpDeclarations || metadata?.cdp || [];
    const hasCdpDirectives = Array.isArray(cdpDecls) && cdpDecls.length > 0;
    const hasCdpDomains = Array.isArray(metadata?.cdpDomains) && metadata.cdpDomains.length > 0;
    const isNoneGrant = grants.includes('none');

    const allowAll = !isNoneGrant && grants.includes('*');

    // CDP capabilities allowed only if not @grant none and explicitly granted or declared
    const allowCdp =
      !isNoneGrant &&
      (allowAll ||
        grants.includes('GM_cdp') ||
        grants.includes('cdp') ||
        hasCdpDirectives ||
        hasCdpDomains);

    // GM_info allowed only if not @grant none and explicitly granted or declared.
    const allowGmInfo =
      !isNoneGrant &&
      (allowAll ||
        grants.includes('GM_info') ||
        (grants.length > 0 && allowCdp) ||
        (allowCdp && hasCdpDirectives));

    const allowGmSetValue = !isNoneGrant && (allowAll || grants.includes('GM_setValue'));
    const allowGmGetValue = !isNoneGrant && (allowAll || grants.includes('GM_getValue'));
    const allowGmDeleteValue = !isNoneGrant && (allowAll || grants.includes('GM_deleteValue'));
    const allowGmListValues = !isNoneGrant && (allowAll || grants.includes('GM_listValues'));
    const allowGmAddStyle = !isNoneGrant && (allowAll || grants.includes('GM_addStyle'));
    const allowGmLog = !isNoneGrant && (allowAll || grants.includes('GM_log'));

    // In-memory isolated storage per script execution (never touches window.localStorage)
    const scriptStore = new Map<string, string>();

    const GM_setValue = allowGmSetValue
      ? (key: string, value: unknown): void => {
          scriptStore.set(key, JSON.stringify(value));
        }
      : undefined;

    const GM_getValue = allowGmGetValue
      ? (key: string, defaultValue?: unknown): unknown => {
          const raw = scriptStore.get(key);
          if (raw === null || raw === undefined) return defaultValue;
          try {
            return JSON.parse(raw);
          } catch {
            return defaultValue;
          }
        }
      : undefined;

    const GM_deleteValue = allowGmDeleteValue
      ? (key: string): void => {
          scriptStore.delete(key);
        }
      : undefined;

    const GM_listValues = allowGmListValues
      ? (): string[] => {
          return Array.from(scriptStore.keys());
        }
      : undefined;

    const GM_addStyle = allowGmAddStyle
      ? (css: string): HTMLStyleElement | null => {
          if (typeof document === 'undefined') return null;
          const style = document.createElement('style');
          style.setAttribute('type', 'text/css');
          style.setAttribute('data-xokj-script', scriptId || 'script');
          style.textContent = css;
          const target = document.head || document.documentElement || document.body;
          if (target) {
            target.appendChild(style);
          }
          return style;
        }
      : undefined;

    const GM_log = allowGmLog
      ? (...args: any[]): void => {
          console.log(`[${scriptName || 'XOKJ'}]`, ...args);
        }
      : undefined;

    let cdp: any = undefined;
    if (allowCdp) {
      // Feature 17: Strictly construct self-contained CDP client inside execution closure.
      // Host page globals (window.cdp, window.__xokj_cdp, window.GM_cdp) are strictly ignored to prevent hijacking.
      cdp = {
        send: (method: string, params?: Record<string, unknown>): Promise<any> => {
          return new Promise((resolve, reject) => {
            const reqId = `xokj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

            const cleanup = () => {
              if (timeoutTimer) {
                clearTimeout(timeoutTimer);
                timeoutTimer = undefined;
              }
              window.removeEventListener('message', listener);
            };

            const listener = (event: MessageEvent) => {
              if (event.source !== window || !event.data || event.data.type !== 'CDP_RPC_RESPONSE') return;
              if (event.data.id === reqId) {
                cleanup();
                if (event.data.success) {
                  resolve(event.data.result);
                } else {
                  reject(new Error(event.data.error?.message || 'CDP command failed'));
                }
              }
            };

            timeoutTimer = setTimeout(() => {
              cleanup();
              reject(new Error(`CDP request timed out after 30000ms: ${method} (${reqId})`));
            }, 30000);

            window.addEventListener('message', listener);

            const effectiveChannelId = channelId || (metadata && metadata.channelId);
            const rpcPayload: Record<string, any> = {
              source: 'xokj-userscript',
              type: 'CDP_RPC_REQUEST',
              id: reqId,
              scriptId,
              method,
              params: params || {}
            };
            if (effectiveChannelId) {
              rpcPayload.channelId = effectiveChannelId;
            }

            window.postMessage(rpcPayload, '*');
          });
        },
        on: (_event: string, _handler: Function) => () => {},
        off: (_event: string, _handler: Function) => {},
        getStatus: () => ({ status: 'ATTACHED', conflict: false }),
        isAttached: () => true
      };
    }

    const GM_cdp = allowCdp && cdp && typeof cdp.send === 'function'
      ? cdp.send.bind(cdp)
      : undefined;

    const GM_info = allowGmInfo
      ? {
          script: {
            name: scriptName,
            version: metadata?.version || '1.0.0',
            description: metadata?.description || '',
            matches: metadata?.matches || []
          },
          scriptHandler: 'XOKJ',
          version: '0.1.0'
        }
      : undefined;

    const wrapped = `(function(cdp, GM_cdp, GM_info, GM_setValue, GM_getValue, GM_deleteValue, GM_listValues, GM_addStyle, GM_log) {\n${code}\n})(__cdp, __GM_cdp, __GM_info, __GM_setValue, __GM_getValue, __GM_deleteValue, __GM_listValues, __GM_addStyle, __GM_log);\n//# sourceURL=xokj://${encodeURIComponent(
      scriptName
    )}.user.js`;

    const runFn = new Function(
      '__cdp',
      '__GM_cdp',
      '__GM_info',
      '__GM_setValue',
      '__GM_getValue',
      '__GM_deleteValue',
      '__GM_listValues',
      '__GM_addStyle',
      '__GM_log',
      wrapped
    );
    runFn(
      cdp,
      GM_cdp,
      GM_info,
      GM_setValue,
      GM_getValue,
      GM_deleteValue,
      GM_listValues,
      GM_addStyle,
      GM_log
    );
    return { success: true };
  } catch (err: any) {
    console.error(`[XOKJ Injector] Error running userscript "${scriptName}" (${scriptId}):`, err);
    return { success: false, error: err?.message || String(err) };
  }
}

export class ScriptInjector {
  private debuggerManager?: TabDebuggerManager;
  private channelId?: string;
  private isListening = false;

  // Feature 11: Two-level nested injection deduplication map:
  // tabId -> frameId -> Set of `${scriptId}:${stage}`
  private injectionHistory = new Map<number, Map<number, Set<string>>>();

  // Navigation tracker: tabId -> current navigation URL
  private tabUrls = new Map<number, string>();

  // Document tracker: tabId -> current documentId (for same-URL & duplicate deduplication)
  private tabDocumentIds = new Map<number, string>();

  // Subframe URL tracker: tabId -> frameId -> current URL
  private frameUrls = new Map<number, Map<number, string>>();

  // Subframe document tracker: tabId -> frameId -> current documentId
  private frameDocumentIds = new Map<number, Map<number, string>>();

  private onCommittedBound = this.handleCommitted.bind(this);
  private onDOMContentLoadedBound = this.handleDOMContentLoaded.bind(this);
  private onCompletedBound = this.handleCompleted.bind(this);
  private onTabsUpdatedBound = this.handleTabsUpdated.bind(this);
  private onTabRemovedBound = this.handleTabRemoved.bind(this);

  // In-memory script and settings caches
  private cachedSettings: AppSettings | null = null;
  private cachedScripts: ScriptRecord[] | null = null;
  private unsubscribeScripts?: () => void;
  private isStorageListening = false;
  private storageOnChangedBound = this.handleStorageChanged.bind(this);

  private handleStorageChanged(
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void {
    if (areaName === 'local') {
      if (changes.settings) {
        this.cachedSettings = changes.settings.newValue ? { ...changes.settings.newValue } : null;
      }
      if (changes.scripts) {
        const scriptsObj = changes.scripts.newValue || {};
        this.cachedScripts = Object.values(scriptsObj);
      }
    }
  }

  constructor(options: ScriptInjectorOptions = {}) {
    this.debuggerManager = options.debuggerManager;
    this.channelId = options.channelId;
    if (options.autoStart) {
      this.init();
    }
  }

  public setChannelId(channelId: string): void {
    this.channelId = channelId;
  }

  public getChannelId(): string | undefined {
    return this.channelId;
  }

  /**
   * Initializes navigation and tab event listeners.
   */
  public init(): void {
    if (this.isListening) return;

    if (typeof chrome !== 'undefined') {
      if (chrome.webNavigation) {
        chrome.webNavigation.onCommitted?.addListener?.(this.onCommittedBound);
        chrome.webNavigation.onDOMContentLoaded?.addListener?.(this.onDOMContentLoadedBound);
        chrome.webNavigation.onCompleted?.addListener?.(this.onCompletedBound);
      }

      if (chrome.tabs) {
        chrome.tabs.onUpdated?.addListener?.(this.onTabsUpdatedBound);
        chrome.tabs.onRemoved?.addListener?.(this.onTabRemovedBound);
      }

      if (!this.isStorageListening && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener(this.storageOnChangedBound);
        this.isStorageListening = true;
      }
    }

    if (!this.unsubscribeScripts) {
      this.unsubscribeScripts = onScriptsChanged((scripts) => {
        this.cachedScripts = Object.values(scripts);
      });
    }

    getSettings().then((s) => {
      if (this.cachedSettings === null) this.cachedSettings = s;
    }).catch(() => {});
    getScriptList().then((list) => {
      if (this.cachedScripts === null) this.cachedScripts = list;
    }).catch(() => {});

    this.isListening = true;
  }

  /**
   * Clears injection history for a specific frame (Feature 11).
   */
  public clearFrameHistory(tabId: number, frameId: number): void {
    const frameMap = this.injectionHistory.get(tabId);
    if (frameMap) {
      const scriptSet = frameMap.get(frameId);
      if (scriptSet) {
        scriptSet.clear();
        frameMap.delete(frameId);
      }
      if (frameMap.size === 0) {
        this.injectionHistory.delete(tabId);
      }
    }
    const frameUrlMap = this.frameUrls.get(tabId);
    if (frameUrlMap) {
      frameUrlMap.delete(frameId);
      if (frameUrlMap.size === 0) {
        this.frameUrls.delete(tabId);
      }
    }
    const frameDocMap = this.frameDocumentIds.get(tabId);
    if (frameDocMap) {
      frameDocMap.delete(frameId);
      if (frameDocMap.size === 0) {
        this.frameDocumentIds.delete(tabId);
      }
    }
  }

  /**
   * Resets injection history for all frames in a tab (e.g. top-level navigation / tab close).
   */
  public resetTabHistory(tabId: number): void {
    const frameMap = this.injectionHistory.get(tabId);
    if (frameMap) {
      for (const scriptSet of frameMap.values()) {
        scriptSet.clear();
      }
      frameMap.clear();
      this.injectionHistory.delete(tabId);
    }
    const frameUrlMap = this.frameUrls.get(tabId);
    if (frameUrlMap) {
      frameUrlMap.clear();
      this.frameUrls.delete(tabId);
    }
    const frameDocMap = this.frameDocumentIds.get(tabId);
    if (frameDocMap) {
      frameDocMap.clear();
      this.frameDocumentIds.delete(tabId);
    }
  }

  /**
   * Teardown event listeners and clear injection cache.
   */
  public destroy(): void {
    if (!this.isListening) return;

    if (typeof chrome !== 'undefined') {
      if (chrome.webNavigation) {
        chrome.webNavigation.onCommitted?.removeListener?.(this.onCommittedBound);
        chrome.webNavigation.onDOMContentLoaded?.removeListener?.(this.onDOMContentLoadedBound);
        chrome.webNavigation.onCompleted?.removeListener?.(this.onCompletedBound);
      }

      if (chrome.tabs) {
        chrome.tabs.onUpdated?.removeListener?.(this.onTabsUpdatedBound);
        chrome.tabs.onRemoved?.removeListener?.(this.onTabRemovedBound);
      }

      if (this.isStorageListening && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(this.storageOnChangedBound);
        this.isStorageListening = false;
      }
    }

    if (this.unsubscribeScripts) {
      this.unsubscribeScripts();
      this.unsubscribeScripts = undefined;
    }

    this.cachedSettings = null;
    this.cachedScripts = null;

    // Cleanly deallocate all nested maps and sets
    for (const frameMap of this.injectionHistory.values()) {
      for (const scriptSet of frameMap.values()) {
        scriptSet.clear();
      }
      frameMap.clear();
    }
    this.injectionHistory.clear();
    for (const frameUrlMap of this.frameUrls.values()) {
      frameUrlMap.clear();
    }
    this.frameUrls.clear();
    for (const frameDocMap of this.frameDocumentIds.values()) {
      frameDocMap.clear();
    }
    this.frameDocumentIds.clear();
    this.tabUrls.clear();
    this.tabDocumentIds.clear();
    this.isListening = false;
  }

  public setDebuggerManager(debuggerManager: TabDebuggerManager): void {
    this.debuggerManager = debuggerManager;
  }

  // -------------------------------------------------------------------------
  // Navigation Lifecycle Handlers
  // -------------------------------------------------------------------------

  /**
   * Triggers @run-at 'document-start' injection.
   * Handles top-level navigation reset and frame-scoped subframe reset.
   */
  public async handleCommitted(
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails | any
  ): Promise<void> {
    const { tabId, frameId = 0, url, transitionType, documentId } = details;

    if (frameId === 0) {
      const currentUrl = this.tabUrls.get(tabId);
      const currentDocId = this.tabDocumentIds.get(tabId);

      // Feature 12: Same-URL Link Navigation Reset with Duplicate Event Protection
      // If documentId is present:
      //   - Different documentId -> new document context -> reset history
      //   - Same documentId -> duplicate event delivery -> preserve history
      // If documentId is absent (legacy tests / mocks):
      //   - URL change or reload -> reset history
      //   - If URL and transitionType are identical without documentId, preserve history (prevents duplicate injection in T4.1 / T4.4)
      const hasDocId = typeof documentId === 'string' && documentId.length > 0;
      const isNewDoc = hasDocId
        ? documentId !== currentDocId
        : currentUrl !== url || transitionType === 'reload';

      if (isNewDoc) {
        this.resetTabHistory(tabId);
        this.tabUrls.set(tabId, url);
        if (hasDocId) {
          this.tabDocumentIds.set(tabId, documentId);
        } else {
          this.tabDocumentIds.delete(tabId);
        }
      }
    } else {
      // Subframe committed navigation: track subframe documentId and URL
      if (!this.tabUrls.has(tabId)) {
        this.tabUrls.set(tabId, url);
      }

      const hasDocId = typeof documentId === 'string' && documentId.length > 0;
      let frameUrlMap = this.frameUrls.get(tabId);
      if (!frameUrlMap) {
        frameUrlMap = new Map<number, string>();
        this.frameUrls.set(tabId, frameUrlMap);
      }
      let frameDocMap = this.frameDocumentIds.get(tabId);
      if (!frameDocMap) {
        frameDocMap = new Map<number, string>();
        this.frameDocumentIds.set(tabId, frameDocMap);
      }

      if (hasDocId) {
        const currentFrameDocId = frameDocMap.get(frameId);
        if (documentId !== currentFrameDocId) {
          this.clearFrameHistory(tabId, frameId);
          let fUrls = this.frameUrls.get(tabId);
          if (!fUrls) {
            fUrls = new Map<number, string>();
            this.frameUrls.set(tabId, fUrls);
          }
          fUrls.set(frameId, url);

          let fDocs = this.frameDocumentIds.get(tabId);
          if (!fDocs) {
            fDocs = new Map<number, string>();
            this.frameDocumentIds.set(tabId, fDocs);
          }
          fDocs.set(frameId, documentId);
        }
      } else {
        const currentFrameUrl = frameUrlMap.get(frameId);
        const isSubframeReload = transitionType === 'reload';
        const isNewSubframeDoc = currentFrameUrl !== url || isSubframeReload;

        if (isNewSubframeDoc) {
          this.clearFrameHistory(tabId, frameId);
          let fUrls = this.frameUrls.get(tabId);
          if (!fUrls) {
            fUrls = new Map<number, string>();
            this.frameUrls.set(tabId, fUrls);
          }
          fUrls.set(frameId, url);
        }
      }
    }

    await this.processStage(tabId, frameId, url, 'document-start');
  }

  /**
   * Triggers @run-at 'document-end' injection.
   */
  public async handleDOMContentLoaded(
    details: chrome.webNavigation.WebNavigationCallbackDetails | any
  ): Promise<void> {
    const { tabId, frameId = 0, url } = details;
    if (!this.tabUrls.has(tabId)) {
      this.tabUrls.set(tabId, url);
    }
    await this.processStage(tabId, frameId, url, 'document-end');
  }

  /**
   * Triggers @run-at 'document-idle' injection.
   */
  public async handleCompleted(
    details: chrome.webNavigation.WebNavigationCallbackDetails | any
  ): Promise<void> {
    const { tabId, frameId = 0, url } = details;
    if (!this.tabUrls.has(tabId)) {
      this.tabUrls.set(tabId, url);
    }
    await this.processStage(tabId, frameId, url, 'document-idle');
  }

  /**
   * Fallback & SPA URL navigation handling via chrome.tabs.onUpdated.
   */
  public async handleTabsUpdated(
    tabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab
  ): Promise<void> {
    const targetUrl = changeInfo.url || tab?.url;
    if (!targetUrl) return;

    if (changeInfo.url && changeInfo.url !== this.tabUrls.get(tabId)) {
      // In-page hash/history navigation: reset history for new URL
      this.resetTabHistory(tabId);
      this.tabUrls.set(tabId, changeInfo.url);
      this.tabDocumentIds.delete(tabId);
    }

    if (changeInfo.status === 'complete') {
      if (!this.tabUrls.has(tabId)) {
        this.tabUrls.set(tabId, targetUrl);
      }
      await this.processStage(tabId, 0, targetUrl, 'document-idle');
    }
  }

  /**
   * Cleans up tracking when a tab is closed.
   */
  public handleTabRemoved(tabId: number): void {
    this.resetTabHistory(tabId);
    this.tabUrls.delete(tabId);
    this.tabDocumentIds.delete(tabId);
    this.frameUrls.delete(tabId);
    this.frameDocumentIds.delete(tabId);
    this.injectionHistory.delete(tabId);
  }

  // -------------------------------------------------------------------------
  // Matching & Injection Engine
  // -------------------------------------------------------------------------

  /**
   * Queries storage for enabled scripts matching target URL, timing tier, and frame.
   * Utilizes in-memory caching to eliminate redundant storage reads and cloning on multi-frame navigations.
   */
  public async getMatchingScripts(
    url: string,
    runAt?: RunAtTiming,
    frameId = 0
  ): Promise<ScriptRecord[]> {
    if (!url || isRestrictedUrl(url)) {
      return [];
    }

    if (!this.isStorageListening && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(this.storageOnChangedBound);
      this.isStorageListening = true;
    }

    if (!this.unsubscribeScripts) {
      this.unsubscribeScripts = onScriptsChanged((scripts) => {
        this.cachedScripts = Object.values(scripts);
      });
    }

    if (!this.cachedSettings) {
      this.cachedSettings = await getSettings();
    }
    if (!this.cachedSettings.globalEnabled) {
      return [];
    }

    if (!this.cachedScripts) {
      this.cachedScripts = await getScriptList();
    }

    const allScripts = this.cachedScripts;

    return allScripts.filter((script) => {
      if (!script.enabled) return false;

      // Check timing tier
      const scriptRunAt = script.metadata?.runAt || 'document-idle';
      if (runAt && scriptRunAt !== runAt) {
        return false;
      }

      // Check iframe restrictions
      if (frameId !== 0 && script.metadata?.noframes === true) {
        return false;
      }

      // Strict precedence: Check exclusions first
      if (matchesAny(script.metadata?.excludes || [], url)) {
        return false;
      }

      // Check match patterns
      const patterns =
        script.metadata?.matches?.length
          ? script.metadata.matches
          : script.metadata?.matchPatterns?.length
          ? script.metadata.matchPatterns
          : script.metadata?.includes || [];

      return matchesAny(patterns, url);
    });
  }

  /**
   * Processes an injection stage for a given tab, frame, and timing.
   */
  public async processStage(
    tabId: number,
    frameId: number,
    url: string,
    stage: RunAtTiming
  ): Promise<void> {
    if (!url || isRestrictedUrl(url)) return;

    if (!this.tabUrls.has(tabId)) {
      this.tabUrls.set(tabId, url);
    }

    const matchingScripts = await this.getMatchingScripts(url, stage, frameId);
    if (matchingScripts.length === 0) return;

    // If tab was removed while awaiting matching scripts, abort immediately
    if (!this.tabUrls.has(tabId)) return;
    // If main frame navigated to a different URL while awaiting, abort stale execution
    if (frameId === 0 && this.tabUrls.get(tabId) !== url) return;

    // Feature 13: Ensure CDP readiness across ALL stages (document-start, document-end, document-idle)
    await this.ensureCdpReadyForScripts(tabId, url, matchingScripts);

    // If tab was removed while awaiting CDP readiness, abort immediately
    if (!this.tabUrls.has(tabId)) return;
    // If main frame navigated to a different URL while awaiting, abort stale execution
    if (frameId === 0 && this.tabUrls.get(tabId) !== url) return;

    let tabMap = this.injectionHistory.get(tabId);
    if (!tabMap) {
      tabMap = new Map<number, Set<string>>();
      this.injectionHistory.set(tabId, tabMap);
    }

    let frameHistory = tabMap.get(frameId);
    if (!frameHistory) {
      frameHistory = new Set<string>();
      tabMap.set(frameId, frameHistory);
    }

    // Synchronously pre-register deduplication keys before any async script execution
    // to eliminate TOCTOU race conditions under concurrent navigation events.
    const scriptsToInject: ScriptRecord[] = [];
    for (const script of matchingScripts) {
      const dedupeKey = `${script.id}:${stage}`;
      if (!frameHistory.has(dedupeKey)) {
        frameHistory.add(dedupeKey);
        scriptsToInject.push(script);
      }
    }

    for (const script of scriptsToInject) {
      const dedupeKey = `${script.id}:${stage}`;
      if (!this.tabUrls.has(tabId)) {
        frameHistory.delete(dedupeKey);
        break;
      }

      let success = false;
      try {
        success = await this.executeScriptInTab(tabId, frameId, script, stage);
      } catch (err) {
        success = false;
      }

      if (!this.tabUrls.has(tabId)) {
        frameHistory.delete(dedupeKey);
        break;
      }

      // Feature 14: Rollback reservation if execution failed
      if (!success) {
        frameHistory.delete(dedupeKey);
      }
    }
  }

  /**
   * Checks whether scripts require CDP capabilities.
   * Includes @grant cdp, @grant *, @grant GM_cdp, and declarative CDP directives.
   */
  private hasCdpNeeds(scripts: ScriptRecord[]): boolean {
    return scripts.some((s) => {
      const grants = Array.isArray(s.metadata?.grants) ? s.metadata.grants : [];
      if (grants.includes('none')) return false;

      const hasCdpDirectives =
        (Array.isArray(s.metadata?.cdpDeclarations) && s.metadata.cdpDeclarations.length > 0) ||
        (Array.isArray(s.metadata?.cdp) && s.metadata.cdp.length > 0) ||
        (Array.isArray(s.metadata?.cdpDomains) && s.metadata.cdpDomains.length > 0);

      const hasCdpGrants =
        grants.includes('GM_cdp') ||
        grants.includes('cdp') ||
        grants.includes('*');

      return hasCdpDirectives || hasCdpGrants;
    });
  }

  /**
   * Ensures declarative CDP domains are enabled before script executes across all stages.
   */
  private async ensureCdpReadyForScripts(
    tabId: number,
    url: string,
    scripts: ScriptRecord[]
  ): Promise<void> {
    if (!this.debuggerManager) return;

    if (!this.hasCdpNeeds(scripts)) return;

    // Check if tab is in conflict; if so, do not block injection
    if (this.debuggerManager.getTabStatus?.(tabId) === 'CONFLICT') {
      return;
    }

    try {
      if (!this.debuggerManager.isAttached(tabId)) {
        await this.debuggerManager.attachTab(tabId);
        if (this.debuggerManager.initializeDeclaredDomains) {
          await this.debuggerManager.initializeDeclaredDomains(tabId, url);
        } else if (this.debuggerManager.executeDeclarativeInit) {
          await this.debuggerManager.executeDeclarativeInit(tabId, url);
        }
      }
    } catch (err) {
      console.warn(`[ScriptInjector] Failed to ensure CDP ready on tab ${tabId}:`, err);
    }
  }

  /**
   * Injects userscript into target tab and frame via chrome.scripting.executeScript.
   * Includes 10-second timeout guard and inspects execution status.
   */
  public async executeScriptInTab(
    tabId: number,
    frameId: number,
    script: ScriptRecord,
    stage: RunAtTiming,
    timeoutMs = 10000
  ): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<boolean>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Injection timed out after ${timeoutMs}ms for script "${script.name}"`));
      }, timeoutMs);
    });

    const executionPromise = (async (): Promise<boolean> => {
      if (typeof chrome !== 'undefined' && chrome.scripting?.executeScript) {
        const scriptChannelId = (script as any).channelId || this.channelId || undefined;
        const results = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          world: 'MAIN',
          injectImmediately: stage === 'document-start',
          func: pageSandboxRunner,
          args: [script.code, script.name, script.id, script.metadata || {}, scriptChannelId]
        });

        if (results && results.length > 0) {
          const first = results[0]?.result;
          if (first && typeof first === 'object' && first.success === false) {
            return false;
          }
        }
        return true;
      }

      // Fallback: Dispatch via content script message if scripting API unavailable
      if (typeof chrome !== 'undefined' && chrome.tabs?.sendMessage) {
        await chrome.tabs.sendMessage(
          tabId,
          {
            type: 'EXECUTE_USERSCRIPT',
            script,
            runAt: stage
          },
          { frameId }
        );
        return true;
      }

      return false;
    })();

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } catch (err) {
      console.error(
        `[ScriptInjector] Failed to inject script "${script.name}" into tab ${tabId} frame ${frameId}:`,
        err
      );
      return false;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Diagnostic helper: returns whether a specific script was injected into tab/frame.
   */
  public hasInjected(
    tabId: number,
    frameId: number,
    scriptId: string,
    runAt: RunAtTiming
  ): boolean {
    const key = `${scriptId}:${runAt}`;
    return this.injectionHistory.get(tabId)?.get(frameId)?.has(key) ?? false;
  }
}
