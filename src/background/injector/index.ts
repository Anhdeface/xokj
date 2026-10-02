/**
 * XOKJ - Script Injection Orchestrator Facade
 *
 * Coordinates userscript injection based on Chromium navigation hooks,
 * match patterns, @run-at timing stages, pre-hydrated storage loading,
 * and early CDP domain sync.
 */

import type { ScriptRecord, RunAtTiming } from '@/shared/types';
import type { TabDebuggerManager } from '../debugger-mgr';
import { pageSandboxRunner } from './page-runner';
import { InjectionGuard } from './injection-guard';
import { PrehydratedStorageLoader } from './storage-loader';
import { StageScheduler } from './stage-scheduler';

export {
  pageSandboxRunner,
  InjectionGuard,
  PrehydratedStorageLoader,
  StageScheduler
};

export interface ScriptInjectorOptions {
  debuggerManager?: TabDebuggerManager;
  autoStart?: boolean;
  channelId?: string;
}

export class ScriptInjector {
  private guard: InjectionGuard;
  private storageLoader: PrehydratedStorageLoader;
  private scheduler: StageScheduler;
  private isListening = false;

  // Direct map references preserved for white-box test compatibility
  public readonly injectionHistory: Map<number, Map<number, Set<string>>>;
  public readonly tabUrls: Map<number, string>;
  public readonly tabDocumentIds: Map<number, string>;
  public readonly frameUrls: Map<number, Map<number, string>>;
  public readonly frameDocumentIds: Map<number, Map<number, string>>;

  private onCommittedBound = this.handleCommitted.bind(this);
  private onDOMContentLoadedBound = this.handleDOMContentLoaded.bind(this);
  private onCompletedBound = this.handleCompleted.bind(this);
  private onTabsUpdatedBound = this.handleTabsUpdated.bind(this);
  private onTabRemovedBound = this.handleTabRemoved.bind(this);

  constructor(options: ScriptInjectorOptions = {}) {
    this.guard = new InjectionGuard();
    this.storageLoader = new PrehydratedStorageLoader();
    this.scheduler = new StageScheduler(this.guard, this.storageLoader, {
      debuggerManager: options.debuggerManager,
      channelId: options.channelId
    });
    this.scheduler.setDelegate(this);

    // Share identical Map references with guard for backward compatibility
    this.injectionHistory = this.guard.injectionHistory;
    this.tabUrls = this.guard.tabUrls;
    this.tabDocumentIds = this.guard.tabDocumentIds;
    this.frameUrls = this.guard.frameUrls;
    this.frameDocumentIds = this.guard.frameDocumentIds;

    if (options.autoStart) {
      this.init();
    }
  }

  public setChannelId(channelId: string): void {
    this.scheduler.setChannelId(channelId);
  }

  public getChannelId(): string | undefined {
    return this.scheduler.getChannelId();
  }

  public setDebuggerManager(debuggerManager: TabDebuggerManager): void {
    this.scheduler.setDebuggerManager(debuggerManager);
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

    this.scheduler.init();
    this.isListening = true;
  }

  /**
   * Clears injection history for a specific frame.
   */
  public clearFrameHistory(tabId: number, frameId: number): void {
    this.guard.clearFrameHistory(tabId, frameId);
  }

  /**
   * Resets injection history for all frames in a tab (e.g. top-level navigation / tab close).
   */
  public resetTabHistory(tabId: number): void {
    this.guard.resetTabHistory(tabId);
  }

  /**
   * Teardown event listeners and clear injection state.
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

    this.scheduler.destroy();
    this.guard.destroy();
    this.isListening = false;
  }

  // Navigation Lifecycle Handlers

  /**
   * Triggers @run-at 'document-start' injection.
   * Handles top-level navigation reset and frame-scoped subframe reset.
   */
  public async handleCommitted(
    details: chrome.webNavigation.WebNavigationTransitionCallbackDetails | any
  ): Promise<void> {
    const { tabId, frameId = 0, url, transitionType, documentId } = details;

    this.guard.handleCommitted(tabId, frameId, url, transitionType, documentId);
    await this.processStage(tabId, frameId, url, 'document-start');
  }

  /**
   * Triggers @run-at 'document-end' injection.
   */
  public async handleDOMContentLoaded(
    details: chrome.webNavigation.WebNavigationCallbackDetails | any
  ): Promise<void> {
    const { tabId, frameId = 0, url } = details;
    if (!this.guard.tabUrls.has(tabId)) {
      this.guard.tabUrls.set(tabId, url);
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
    if (!this.guard.tabUrls.has(tabId)) {
      this.guard.tabUrls.set(tabId, url);
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

    if (changeInfo.url && changeInfo.url !== this.guard.tabUrls.get(tabId)) {
      this.guard.handleUrlUpdate(tabId, changeInfo.url);
    }

    if (changeInfo.status === 'complete') {
      if (!this.guard.tabUrls.has(tabId)) {
        this.guard.tabUrls.set(tabId, targetUrl);
      }
      await this.processStage(tabId, 0, targetUrl, 'document-idle');
    }
  }

  /**
   * Cleans up tracking when a tab is closed.
   */
  public handleTabRemoved(tabId: number): void {
    this.guard.handleTabRemoved(tabId);
  }

  /**
   * Queries storage for enabled scripts matching target URL, timing tier, and frame.
   */
  public async getMatchingScripts(
    url: string,
    runAt?: RunAtTiming,
    frameId = 0
  ): Promise<ScriptRecord[]> {
    return this.scheduler.getMatchingScripts(url, runAt, frameId);
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
    return this.scheduler.processStage(tabId, frameId, url, stage);
  }

  /**
   * Injects userscript into target tab and frame via chrome.scripting.executeScript.
   */
  public async executeScriptInTab(
    tabId: number,
    frameId: number,
    script: ScriptRecord,
    stage: RunAtTiming,
    timeoutMs = 10000
  ): Promise<boolean> {
    return this.scheduler.executeScriptInTab(tabId, frameId, script, stage, timeoutMs);
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
    return this.guard.hasInjected(tabId, frameId, scriptId, runAt);
  }
}
