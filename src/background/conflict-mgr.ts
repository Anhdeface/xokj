/**
 * XOKJ - DevTools Conflict Management & Reconnection Subsystem
 */

import type {
  CdpRpcLifecycleMessage,
  DebuggerSessionStatus,
  TabSessionState,
  ReconnectCdpResponse
} from '@/shared/types';
import { DevToolsConflictError } from '@/shared/types';
import { AsyncMutex, getSettings } from '@/shared/storage';

export { DevToolsConflictError };

/**
 * Interface contract for tracking and canceling inflight commands in CdpBridgeServer.
 */
export interface InflightCommandTracker {
  rejectInflightForTab(tabId: number, error: Error): number;
}

/**
 * Interface contract for managing tab sessions in TabDebuggerManager.
 */
export interface TabDebuggerSessionController {
  setTabStatus(tabId: number, status: DebuggerSessionStatus, reason?: string): void;
  getTabStatus(tabId: number): DebuggerSessionStatus;
  attachTab(tabId: number, url?: string, force?: boolean): Promise<void>;
  initializeDeclaredDomains?(tabId: number, targetUrl?: string): Promise<void>;
}

export class DevToolsConflictHandler {
  private inflightTracker: InflightCommandTracker | null = null;
  private debuggerController: TabDebuggerSessionController | null = null;
  private sessionMutex = new AsyncMutex();
  private isListening = false;

  private handleDetachBound = this.handleDetach.bind(this);
  private handleRuntimeMessageBound = this.handleRuntimeMessage.bind(this);

  constructor(
    inflightTracker?: InflightCommandTracker | null,
    debuggerController?: TabDebuggerSessionController | null
  ) {
    if (inflightTracker) this.inflightTracker = inflightTracker;
    if (debuggerController) this.debuggerController = debuggerController;

    if (debuggerController && inflightTracker && typeof (debuggerController as any).setInflightTracker === 'function') {
      (debuggerController as any).setInflightTracker(inflightTracker);
    }
  }

  /**
   * Bind the inflight command tracker from CdpBridgeServer.
   */
  public setInflightTracker(tracker: InflightCommandTracker): void {
    this.inflightTracker = tracker;
    if (this.debuggerController && typeof (this.debuggerController as any).setInflightTracker === 'function') {
      (this.debuggerController as any).setInflightTracker(tracker);
    }
  }

  /**
   * Bind the debugger session controller from TabDebuggerManager.
   */
  public setDebuggerController(controller: TabDebuggerSessionController): void {
    this.debuggerController = controller;
    if (this.inflightTracker && typeof (controller as any).setInflightTracker === 'function') {
      (controller as any).setInflightTracker(this.inflightTracker);
    }
  }

  /**
   * Start listening to chrome.debugger.onDetach and chrome.runtime.onMessage.
   */
  public init(): void {
    if (this.isListening) return;

    if (typeof chrome !== 'undefined') {
      // Single Owner: When debuggerController is present, TabDebuggerManager is the sole
      // listener for chrome.debugger.onDetach. Only attach directly in standalone fallback mode.
      if (!this.debuggerController && chrome.debugger?.onDetach) {
        chrome.debugger.onDetach.addListener(this.handleDetachBound);
      }
      if (chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener(this.handleRuntimeMessageBound);
      }
    }

    this.isListening = true;
  }

  public start(): void {
    this.init();
  }

  /**
   * Teardown event listeners.
   */
  public destroy(): void {
    if (!this.isListening) return;

    if (typeof chrome !== 'undefined') {
      if (!this.debuggerController && chrome.debugger?.onDetach) {
        chrome.debugger.onDetach.removeListener(this.handleDetachBound);
      }
      if (chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(this.handleRuntimeMessageBound);
      }
    }

    this.isListening = false;
  }

  public stop(): void {
    this.destroy();
  }

  /**
   * Core handler for chrome.debugger.onDetach.
   */
  public async handleDetach(
    source: chrome.debugger.Debuggee,
    reason: string
  ): Promise<void> {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') return;

    let isEngineDisabled = false;
    try {
      const settings = await getSettings();
      if (settings && !settings.globalEnabled) {
        isEngineDisabled = true;
      }
    } catch {}

    const isCleanDetach =
      this.debuggerController?.getTabStatus(tabId) === 'IDLE' ||
      this.debuggerController?.getTabStatus(tabId) === 'DETACHED';

    const isConflict =
      !isCleanDetach &&
      !isEngineDisabled &&
      (reason === 'canceled_by_user' || reason === 'replaced_with_devtools');
    const targetStatus: DebuggerSessionStatus = isConflict ? 'CONFLICT' : (isEngineDisabled ? 'IDLE' : 'DETACHED');

    const conflictError = isConflict
      ? new DevToolsConflictError(
          tabId,
          reason,
          'DevTools conflict: native developer tools opened on tab'
        )
      : new Error(`CDP session detached: ${reason}`);

    // Reject all inflight command promises for this tab
    if (this.inflightTracker) {
      this.inflightTracker.rejectInflightForTab(tabId, conflictError as any);
    }

    // Update memory state
    if (this.debuggerController) {
      this.debuggerController.setTabStatus(tabId, targetStatus, reason);
    }

    // Persist and broadcast
    await this.persistTabState(tabId, targetStatus, reason);
    await this.broadcastLifecycle(tabId, targetStatus, reason);
  }

  /**
   * Handles user-driven reconnection requests from popup / dashboard.
   */
  public handleRuntimeMessage(
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ReconnectCdpResponse) => void
  ): boolean | void {
    if (message && message.type === 'RECONNECT_CDP') {
      const tabId = message.tabId ?? sender?.tab?.id;
      if (typeof tabId !== 'number') {
        sendResponse({ success: false, error: 'Missing or invalid tabId for reconnect' });
        return;
      }

      this.reconnectTab(tabId)
        .then((result) => sendResponse(result))
        .catch((err) => {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err)
          });
        });

      return true; // Keep channel open for async response
    }
  }

  /**
   * Reconnect debugger to target tab after DevTools is closed.
   */
  public async reconnectTab(tabId: number): Promise<ReconnectCdpResponse> {
    try {
      if (this.debuggerController) {
        await this.debuggerController.attachTab(tabId, undefined, true);
        if (this.debuggerController.initializeDeclaredDomains) {
          await this.debuggerController.initializeDeclaredDomains(tabId);
        }
      } else if (typeof chrome !== 'undefined' && chrome.debugger?.attach) {
        await chrome.debugger.attach({ tabId }, '1.3');
        await this.persistTabState(tabId, 'ATTACHED');
        await this.broadcastLifecycle(tabId, 'ATTACHED');
      }

      return { success: true };
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      const isStillConflict = /another debugger|already attached|canceled_by_user|devtools/i.test(
        errorMessage
      );

      if (isStillConflict) {
        if (this.debuggerController) {
          this.debuggerController.setTabStatus(tabId, 'CONFLICT', 'DevTools is still active');
        }
        await this.persistTabState(tabId, 'CONFLICT', 'DevTools is still active');
        return {
          success: false,
          error: 'DevTools is still open. Please close DevTools before reconnecting.'
        };
      }

      return {
        success: false,
        error: `Reconnection failed: ${errorMessage}`
      };
    }
  }

  /**
   * Persist session state to storage areas without throwing.
   */
  private async persistTabState(
    tabId: number,
    status: DebuggerSessionStatus,
    reason?: string
  ): Promise<void> {
    const sessionRecord: Partial<TabSessionState> = {
      tabId,
      status,
      attached: status === 'ATTACHED',
      conflictDetected: status === 'CONFLICT',
      conflictReason: status === 'CONFLICT' ? reason : undefined,
      activeDomains: status === 'IDLE' ? [] : undefined,
      updatedAt: Date.now()
    };

    if (typeof chrome !== 'undefined') {
      if (chrome.storage?.session?.set) {
        try {
          await chrome.storage.session.set({
            [`tab_session_${tabId}`]: sessionRecord
          });
        } catch {
          // Non-fatal
        }
      }

      if (chrome.storage?.local?.get && chrome.storage?.local?.set) {
        try {
          await this.sessionMutex.runExclusive(async () => {
            const stored = await chrome.storage.local.get('tab_sessions');
            const sessions = stored.tab_sessions || {};
            sessions[tabId] = {
              ...sessions[tabId],
              ...sessionRecord
            };
            await chrome.storage.local.set({ tab_sessions: sessions });
          });
        } catch {
          // Non-fatal
        }
      }
    }
  }

  /**
   * Safe broadcast to content scripts and popup UI.
   */
  private async broadcastLifecycle(
    tabId: number,
    status: DebuggerSessionStatus,
    reason?: string
  ): Promise<void> {
    const lifecycleStatus =
      status === 'CONFLICT' ? 'CONFLICT' : status === 'ATTACHED' ? 'ATTACHED' : 'DETACHED';

    const lifecycleMessage: CdpRpcLifecycleMessage = {
      type: 'CDP_LIFECYCLE_EVENT',
      tabId,
      status: lifecycleStatus,
      reason
    };

    if (typeof chrome !== 'undefined' && chrome.tabs?.sendMessage) {
      try {
        await chrome.tabs.sendMessage(tabId, lifecycleMessage);
      } catch {
        // Non-fatal
      }
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        await chrome.runtime.sendMessage(lifecycleMessage);
      } catch {
        // Non-fatal
      }
    }
  }
}
