/**
 * XOKJ - Stage Scheduler & Userscript Execution Coordinator
 *
 * Coordinates match pattern evaluation, timing stage execution,
 * CDP domain synchronization, pre-hydrated storage loading,
 * and isolated execution in the target tab.
 */

import type { ScriptRecord, RunAtTiming, AppSettings } from '@/shared/types';
import { matchesAny, isRestrictedUrl } from '@/shared/match-pattern';
import { getScriptList, getSettings, onScriptsChanged } from '@/shared/storage';
import type { TabDebuggerManager } from '../debugger-mgr';
import { pageSandboxRunner } from './page-runner';
import type { InjectionGuard } from './injection-guard';
import type { PrehydratedStorageLoader } from './storage-loader';

export class StageScheduler {
  private guard: InjectionGuard;
  private storageLoader: PrehydratedStorageLoader;
  private debuggerManager?: TabDebuggerManager;
  private channelId?: string;
  private delegate?: any;

  // In-memory script and settings caches
  private cachedSettings: AppSettings | null = null;
  private cachedScripts: ScriptRecord[] | null = null;
  private unsubscribeScripts?: () => void;
  private isStorageListening = false;
  private storageOnChangedBound = this.handleStorageChanged.bind(this);

  constructor(
    guard: InjectionGuard,
    storageLoader: PrehydratedStorageLoader,
    options: {
      debuggerManager?: TabDebuggerManager;
      channelId?: string;
    } = {}
  ) {
    this.guard = guard;
    this.storageLoader = storageLoader;
    this.debuggerManager = options.debuggerManager;
    this.channelId = options.channelId;
  }

  public setChannelId(channelId: string): void {
    this.channelId = channelId;
  }

  public getChannelId(): string | undefined {
    return this.channelId;
  }

  public setDebuggerManager(debuggerManager: TabDebuggerManager): void {
    this.debuggerManager = debuggerManager;
  }

  public setDelegate(delegate: any): void {
    this.delegate = delegate;
  }

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

  public init(): void {
    if (typeof chrome !== 'undefined') {
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

    getSettings()
      .then((s) => {
        if (this.cachedSettings === null) this.cachedSettings = s;
      })
      .catch(() => {});

    getScriptList()
      .then((list) => {
        if (this.cachedScripts === null) this.cachedScripts = list;
      })
      .catch(() => {});
  }

  public destroy(): void {
    if (typeof chrome !== 'undefined' && this.isStorageListening && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(this.storageOnChangedBound);
      this.isStorageListening = false;
    }

    if (this.unsubscribeScripts) {
      this.unsubscribeScripts();
      this.unsubscribeScripts = undefined;
    }

    this.cachedSettings = null;
    this.cachedScripts = null;
  }

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
   * Checks whether scripts require CDP capabilities.
   */
  public hasCdpNeeds(scripts: ScriptRecord[]): boolean {
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
  public async ensureCdpReadyForScripts(
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
      console.warn(`[StageScheduler] Failed to ensure CDP ready on tab ${tabId}:`, err);
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
        // Pre-hydrate storage values if script has storage grants
        const preloadedStorage = await this.storageLoader.loadStorageSnapshot(script);

        const results = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frameId] },
          world: 'MAIN',
          injectImmediately: stage === 'document-start',
          func: pageSandboxRunner,
          args: [
            script.code,
            script.name,
            script.id,
            script.metadata || {},
            scriptChannelId,
            preloadedStorage
          ]
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
   * Processes an injection stage for a given tab, frame, and timing.
   */
  public async processStage(
    tabId: number,
    frameId: number,
    url: string,
    stage: RunAtTiming
  ): Promise<void> {
    if (!url || isRestrictedUrl(url)) return;

    if (!this.guard.tabUrls.has(tabId)) {
      this.guard.tabUrls.set(tabId, url);
    }

    const matchingScripts = this.delegate?.getMatchingScripts
      ? await this.delegate.getMatchingScripts(url, stage, frameId)
      : await this.getMatchingScripts(url, stage, frameId);
    if (matchingScripts.length === 0) return;

    // If tab was removed while awaiting matching scripts, abort immediately
    if (!this.guard.tabUrls.has(tabId)) return;
    // If main frame navigated to a different URL while awaiting, abort stale execution
    if (frameId === 0 && this.guard.tabUrls.get(tabId) !== url) return;

    // Ensure CDP readiness across all execution stages
    await this.ensureCdpReadyForScripts(tabId, url, matchingScripts);

    // If tab was removed while awaiting CDP readiness, abort immediately
    if (!this.guard.tabUrls.has(tabId)) return;
    // If main frame navigated to a different URL while awaiting, abort stale execution
    if (frameId === 0 && this.guard.tabUrls.get(tabId) !== url) return;

    // Synchronously pre-register deduplication keys before any async script execution
    // to eliminate TOCTOU race conditions under concurrent navigation events.
    const scriptsToInject: ScriptRecord[] = [];
    for (const script of matchingScripts) {
      if (this.guard.reserveInjection(tabId, frameId, script.id, stage)) {
        scriptsToInject.push(script);
      }
    }

    for (const script of scriptsToInject) {
      if (!this.guard.tabUrls.has(tabId)) {
        this.guard.rollbackReservation(tabId, frameId, script.id, stage);
        break;
      }

      let success = false;
      try {
        success = this.delegate?.executeScriptInTab
          ? await this.delegate.executeScriptInTab(tabId, frameId, script, stage)
          : await this.executeScriptInTab(tabId, frameId, script, stage);
      } catch {
        success = false;
      }

      if (!this.guard.tabUrls.has(tabId)) {
        this.guard.rollbackReservation(tabId, frameId, script.id, stage);
        break;
      }

      // Rollback reservation if execution failed
      if (!success) {
        this.guard.rollbackReservation(tabId, frameId, script.id, stage);
      }
    }
  }
}
