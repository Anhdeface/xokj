/**
 * XOKJ - Script Injection Orchestrator
 * Location: src/background/injector.ts
 *
 * Coordinates userscript injection based on Chromium navigation hooks,
 * match patterns, @run-at timing stages, and early CDP domain sync.
 */

import type { ScriptRecord, RunAtTiming } from '@/shared/types';
import { matchesAny, isRestrictedUrl } from '@/shared/match-pattern';
import { getScriptList, getSettings } from '@/shared/storage';
import type { TabDebuggerManager } from './debugger-mgr';

export interface ScriptInjectorOptions {
  debuggerManager?: TabDebuggerManager;
  autoStart?: boolean;
}

/**
 * Runner function executed in target page's MAIN world via chrome.scripting.executeScript.
 * Exported for isolated test verification and execution.
 */
export function pageSandboxRunner(
  code: string,
  scriptName: string,
  scriptId: string,
  metadata: Record<string, any>
): void {
  try {
    const grants: string[] = Array.isArray(metadata?.grants) ? metadata.grants : [];
    const cdpDecls = metadata?.cdpDeclarations || metadata?.cdp || [];
    const hasCdpDirectives = Array.isArray(cdpDecls) && cdpDecls.length > 0;
    const hasCdpDomains = Array.isArray(metadata?.cdpDomains) && metadata.cdpDomains.length > 0;
    const isNoneGrant = grants.includes('none');

    // CDP capabilities allowed only if not @grant none and explicitly granted or declared
    const allowCdp =
      !isNoneGrant &&
      (grants.includes('GM_cdp') ||
        grants.includes('cdp') ||
        grants.includes('*') ||
        hasCdpDirectives ||
        hasCdpDomains);

    // GM_info allowed only if not @grant none and explicitly granted or declared.
    // When @grant none or empty grants without CDP directives are declared, GM_info must NOT be exposed
    const allowGmInfo =
      !isNoneGrant &&
      (grants.includes('GM_info') ||
        grants.includes('*') ||
        (grants.length > 0 && allowCdp) ||
        (allowCdp && hasCdpDirectives));

    const cdp = allowCdp
      ? (window as any).cdp || (window as any).__xokj_cdp
      : undefined;

    const GM_cdp = allowCdp
      ? typeof (window as any).GM_cdp === 'function'
        ? (window as any).GM_cdp
        : cdp && typeof cdp.send === 'function'
        ? cdp.send.bind(cdp)
        : undefined
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

    const wrapped = `(function(cdp, GM_cdp, GM_info) {\n${code}\n})(__cdp, __GM_cdp, __GM_info);\n//# sourceURL=xokj://${encodeURIComponent(
      scriptName
    )}.user.js`;

    const runFn = new Function('__cdp', '__GM_cdp', '__GM_info', wrapped);
    runFn(cdp, GM_cdp, GM_info);
  } catch (err) {
    console.error(`[XOKJ Injector] Error running userscript "${scriptName}" (${scriptId}):`, err);
  }
}

export class ScriptInjector {
  private debuggerManager?: TabDebuggerManager;
  private isListening = false;

  // Injection deduplication map: tabId -> Set of `${frameId}:${scriptId}:${stage}`
  private injectionHistory = new Map<number, Set<string>>();

  // Navigation tracker: tabId -> current navigation URL
  private tabUrls = new Map<number, string>();

  private onCommittedBound = this.handleCommitted.bind(this);
  private onDOMContentLoadedBound = this.handleDOMContentLoaded.bind(this);
  private onCompletedBound = this.handleCompleted.bind(this);
  private onTabsUpdatedBound = this.handleTabsUpdated.bind(this);
  private onTabRemovedBound = this.handleTabRemoved.bind(this);

  constructor(options: ScriptInjectorOptions = {}) {
    this.debuggerManager = options.debuggerManager;
    if (options.autoStart) {
      this.init();
    }
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
    }

    this.isListening = true;
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
    }

    this.injectionHistory.clear();
    this.tabUrls.clear();
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
   */
  public async handleCommitted(
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails | any
  ): Promise<void> {
    const { tabId, frameId = 0, url, transitionType } = details;

    if (frameId === 0) {
      const currentUrl = this.tabUrls.get(tabId);
      if (currentUrl !== url || transitionType === 'reload') {
        // New top-level navigation: reset injection history for this tab
        this.injectionHistory.delete(tabId);
        this.tabUrls.set(tabId, url);
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
    await this.processStage(tabId, frameId, url, 'document-end');
  }

  /**
   * Triggers @run-at 'document-idle' injection.
   */
  public async handleCompleted(
    details: chrome.webNavigation.WebNavigationCallbackDetails | any
  ): Promise<void> {
    const { tabId, frameId = 0, url } = details;
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
      this.injectionHistory.delete(tabId);
      this.tabUrls.set(tabId, changeInfo.url);
    }

    if (changeInfo.status === 'complete') {
      await this.processStage(tabId, 0, targetUrl, 'document-idle');
    }
  }

  /**
   * Cleans up tracking when a tab is closed.
   */
  public handleTabRemoved(tabId: number): void {
    this.injectionHistory.delete(tabId);
    this.tabUrls.delete(tabId);
  }

  // -------------------------------------------------------------------------
  // Matching & Injection Engine
  // -------------------------------------------------------------------------

  /**
   * Queries storage for enabled scripts matching target URL, timing tier, and frame.
   */
  public async getMatchingScripts(
    url: string,
    runAt?: RunAtTiming,
    frameId = 0
  ): Promise<ScriptRecord[]> {
    if (!url || isRestrictedUrl(url)) {
      return [];
    }

    const settings = await getSettings();
    if (!settings.globalEnabled) {
      return [];
    }

    const allScripts = await getScriptList();

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

    const matchingScripts = await this.getMatchingScripts(url, stage, frameId);
    if (matchingScripts.length === 0) return;

    // For document-start scripts with CDP requirements, ensure CDP domains are initialized
    if (stage === 'document-start') {
      await this.ensureCdpReadyForScripts(tabId, url, matchingScripts);
    }

    let tabHistory = this.injectionHistory.get(tabId);
    if (!tabHistory) {
      tabHistory = new Set<string>();
      this.injectionHistory.set(tabId, tabHistory);
    }

    // Synchronously pre-register deduplication keys before any async script execution
    // to eliminate TOCTOU race conditions under concurrent navigation events.
    const scriptsToInject: ScriptRecord[] = [];
    for (const script of matchingScripts) {
      const dedupeKey = `${frameId}:${script.id}:${stage}`;
      if (!tabHistory.has(dedupeKey)) {
        tabHistory.add(dedupeKey);
        scriptsToInject.push(script);
      }
    }

    for (const script of scriptsToInject) {
      const dedupeKey = `${frameId}:${script.id}:${stage}`;
      let success = false;
      try {
        success = await this.executeScriptInTab(tabId, frameId, script, stage);
      } catch (err) {
        success = false;
      }

      // Rollback reservation if execution failed
      if (!success) {
        tabHistory.delete(dedupeKey);
      }
    }
  }

  /**
   * Ensures declarative CDP domains are enabled before script executes at document-start.
   */
  private async ensureCdpReadyForScripts(
    tabId: number,
    url: string,
    scripts: ScriptRecord[]
  ): Promise<void> {
    if (!this.debuggerManager) return;

    const hasCdpNeeds = scripts.some(
      (s) =>
        (s.metadata?.cdpDeclarations && s.metadata.cdpDeclarations.length > 0) ||
        (s.metadata?.cdp && s.metadata.cdp.length > 0) ||
        (s.metadata?.cdpDomains && s.metadata.cdpDomains.length > 0) ||
        (s.metadata?.grants && s.metadata.grants.includes('GM_cdp'))
    );

    if (!hasCdpNeeds) return;

    // Check if tab is in conflict; if so, do not block injection
    if (this.debuggerManager.getTabStatus?.(tabId) === 'CONFLICT') {
      return;
    }

    try {
      if (!this.debuggerManager.isAttached(tabId)) {
        await this.debuggerManager.attachTab(tabId);
      }
      if (this.debuggerManager.initializeDeclaredDomains) {
        await this.debuggerManager.initializeDeclaredDomains(tabId, url);
      } else if (this.debuggerManager.executeDeclarativeInit) {
        await this.debuggerManager.executeDeclarativeInit(tabId, url);
      }
    } catch (err) {
      console.warn(`[ScriptInjector] Failed to ensure CDP ready on tab ${tabId}:`, err);
    }
  }

  /**
   * Injects userscript into target tab and frame via chrome.scripting.executeScript.
   */
  public async executeScriptInTab(
    tabId: number,
    frameId: number,
    script: ScriptRecord,
    stage: RunAtTiming
  ): Promise<boolean> {
    try {
      if (typeof chrome !== 'undefined' && chrome.scripting?.executeScript) {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          world: 'MAIN',
          injectImmediately: stage === 'document-start',
          func: pageSandboxRunner,
          args: [script.code, script.name, script.id, script.metadata || {}]
        });
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
    } catch (err) {
      console.error(
        `[ScriptInjector] Failed to inject script "${script.name}" into tab ${tabId} frame ${frameId}:`,
        err
      );
      return false;
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
    const key = `${frameId}:${scriptId}:${runAt}`;
    return this.injectionHistory.get(tabId)?.has(key) ?? false;
  }
}
