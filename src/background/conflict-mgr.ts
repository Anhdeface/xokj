/**
 * XOKJ - DevTools Conflict Management & Reconnection Subsystem
 *
 * Streamlined coordinator that delegates authoritative CDP lifecycle,
 * state persistence, and event broadcasting to TabDebuggerManager.
 */

import type {
  DebuggerSessionStatus,
  TabSessionState,
  ReconnectCdpResponse
} from '@/shared/types';
import { DevToolsConflictError } from '@/shared/types';
import { TabDebuggerManager } from './debugger-mgr';

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
  attachTab(tabId: number, urlOrOptions?: string | boolean | any, force?: boolean): Promise<any>;
  initializeDeclaredDomains?(tabId: number, targetUrl?: string): Promise<void>;
  reconnect?(tabId: number): Promise<ReconnectCdpResponse>;
  handleDetach?(source: chrome.debugger.Debuggee, reason: string): void | Promise<void>;
  getSession?(tabId: number): TabSessionState | undefined;
  isAttached?(tabId: number): boolean;
}

export class DevToolsConflictHandler {
  private inflightTracker: InflightCommandTracker | null = null;
  private debuggerController: TabDebuggerSessionController;
  private isListening = false;

  private handleDetachBound = this.handleDetach.bind(this);
  private handleRuntimeMessageBound = this.handleRuntimeMessage.bind(this);

  constructor(
    inflightTracker?: InflightCommandTracker | null,
    debuggerController?: TabDebuggerSessionController | null
  ) {
    if (inflightTracker) this.inflightTracker = inflightTracker;
    this.debuggerController = debuggerController ?? new TabDebuggerManager();

    if (
      this.debuggerController &&
      inflightTracker &&
      typeof (this.debuggerController as any).setInflightTracker === 'function'
    ) {
      (this.debuggerController as any).setInflightTracker(inflightTracker);
    }
  }

  /**
   * Bind the inflight command tracker from CdpBridgeServer.
   */
  public setInflightTracker(tracker: InflightCommandTracker): void {
    this.inflightTracker = tracker;
    if (
      this.debuggerController &&
      typeof (this.debuggerController as any).setInflightTracker === 'function'
    ) {
      (this.debuggerController as any).setInflightTracker(tracker);
    }
  }

  /**
   * Bind the debugger session controller from TabDebuggerManager.
   */
  public setDebuggerController(controller: TabDebuggerSessionController): void {
    this.debuggerController = controller;
    if (
      this.inflightTracker &&
      typeof (controller as any).setInflightTracker === 'function'
    ) {
      (controller as any).setInflightTracker(this.inflightTracker);
    }
  }

  /**
   * Start listening to chrome.runtime.onMessage for RECONNECT_CDP.
   * Single-owner: TabDebuggerManager is the authoritative listener for chrome.debugger.onDetach.
   */
  public init(): void {
    if (this.isListening) return;

    if (typeof chrome !== 'undefined') {
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
   * Teardown runtime message listener.
   */
  public destroy(): void {
    if (!this.isListening) return;

    if (typeof chrome !== 'undefined') {
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
   * Directly delegates to TabDebuggerManager.
   */
  public async handleDetach(
    source: chrome.debugger.Debuggee,
    reason: string
  ): Promise<void> {
    if (typeof (this.debuggerController as any).handleDetach === 'function') {
      return (this.debuggerController as any).handleDetach(source, reason);
    }
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
   * Delegates to TabDebuggerManager.reconnect(tabId).
   */
  public async reconnectTab(tabId: number): Promise<ReconnectCdpResponse> {
    if (typeof this.debuggerController.reconnect === 'function') {
      return this.debuggerController.reconnect(tabId);
    }

    // Fallback if controller doesn't implement reconnect directly
    try {
      await this.debuggerController.attachTab(tabId, undefined, true);
      if (this.debuggerController.initializeDeclaredDomains) {
        await this.debuggerController.initializeDeclaredDomains(tabId);
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
}
