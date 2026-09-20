/**
 * XOKJ - Asynchronous CDP RPC Bridge & Event Multiplexer
 * Authoritative implementation for Milestone 2
 */

import type {
  CdpRpcRequest,
  CdpRpcResponse,
  CdpRpcEventMessage,
  CdpRpcLifecycleMessage,
  CdpRpcError,
  DebuggerSessionStatus
} from '@/shared/types';
import { DevToolsConflictError } from '@/shared/types';
import { isRestrictedUrl } from '@/shared/match-pattern';

/**
 * Interface for optional TabDebuggerManager integration.
 */
export interface IDebuggerManager {
  isAttached(tabId: number): boolean;
  attach?(tabId: number, version?: string, force?: boolean): Promise<boolean>;
  attachTab?(
    tabId: number,
    urlOrVersionOrForce?: string | boolean,
    forceOrProtocol?: boolean | string,
    protocolVersion?: string
  ): Promise<void>;
  getTabStatus?(tabId: number): DebuggerSessionStatus;
  setTabStatus?(tabId: number, status: DebuggerSessionStatus, reason?: string): void;
}

/**
 * Configuration options for CdpBridgeServer.
 */
export interface CdpBridgeServerOptions {
  /** Inflight request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** CDP protocol version (default: '1.3') */
  protocolVersion?: string;
  /** Automatically attach debugger if not attached (default: true) */
  autoAttach?: boolean;
  /** Automatically start listening to Chrome events (default: false) */
  autoStart?: boolean;
  /** Optional TabDebuggerManager delegate */
  debuggerManager?: IDebuggerManager;
}

/**
 * Internal tracking entry for an active CDP RPC invocation.
 */
export interface InflightRequestEntry {
  id: string;
  tabId: number;
  method: string;
  params?: Record<string, unknown>;
  startTime: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (response: CdpRpcResponse) => void;
}

export class CdpBridgeServer {
  private readonly timeoutMs: number;
  private readonly protocolVersion: string;
  private readonly autoAttach: boolean;
  private readonly debuggerManager?: IDebuggerManager;

  private inflightRequests = new Map<string, InflightRequestEntry>();
  private tabRequests = new Map<number, Set<string>>();
  private attachLocks = new Map<number, Promise<void>>();
  private attachedTabs = new Set<number>();
  private isListening = false;

  private handleMessageBound = this.handleMessage.bind(this);
  private handleDebuggerEventBound = this.handleDebuggerEvent.bind(this);
  private handleDebuggerDetachBound = this.handleDebuggerDetach.bind(this);

  constructor(options: CdpBridgeServerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.protocolVersion = options.protocolVersion ?? '1.3';
    this.autoAttach = options.autoAttach ?? true;
    this.debuggerManager = options.debuggerManager;

    if (options.autoStart) {
      this.init();
    }
  }

  /**
   * Starts listening to chrome.runtime.onMessage and chrome.debugger events.
   */
  public init(): void {
    if (this.isListening) return;

    if (typeof chrome !== 'undefined') {
      chrome.runtime?.onMessage?.addListener?.(this.handleMessageBound);
      chrome.debugger?.onEvent?.addListener?.(this.handleDebuggerEventBound);
      chrome.debugger?.onDetach?.addListener?.(this.handleDebuggerDetachBound);
    }

    this.isListening = true;
  }

  public start(): void {
    this.init();
  }

  /**
   * Stops listening and cancels all active in-flight commands.
   */
  public destroy(): void {
    if (!this.isListening) return;

    if (typeof chrome !== 'undefined') {
      chrome.runtime?.onMessage?.removeListener?.(this.handleMessageBound);
      chrome.debugger?.onEvent?.removeListener?.(this.handleDebuggerEventBound);
      chrome.debugger?.onDetach?.removeListener?.(this.handleDebuggerDetachBound);
    }

    this.isListening = false;

    for (const [id, entry] of this.inflightRequests.entries()) {
      clearTimeout(entry.timer);
      entry.resolve({
        type: 'CDP_RPC_RESPONSE',
        id,
        success: false,
        error: {
          code: -32000,
          message: 'CdpBridgeServer stopped: pending request cancelled'
        }
      });
    }

    this.inflightRequests.clear();
    this.tabRequests.clear();
    this.attachedTabs.clear();
    this.attachLocks.clear();
  }

  public stop(): void {
    this.destroy();
  }

  /**
   * Message listener registered on chrome.runtime.onMessage.
   * Returns true synchronously if message is a CDP RPC request to keep port open.
   */
  public handleMessage(
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (res: any) => void
  ): boolean | void {
    if (!message || (message.type !== 'CDP_RPC_REQUEST' && message.type !== 'XOKJ_CDP_REQUEST')) {
      return;
    }

    this.processRpcRequest(message as CdpRpcRequest, sender)
      .then((response) => {
        sendResponse(response);
      })
      .catch((err) => {
        sendResponse(this.formatInternalErrorResponse(message?.id, err));
      });

    return true;
  }

  /**
   * Internal processing pipeline: validates identity, checks security, executes command.
   */
  private async processRpcRequest(
    request: CdpRpcRequest,
    sender: chrome.runtime.MessageSender
  ): Promise<CdpRpcResponse> {
    const reqId = request.id || `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // 1. Identity Verification: Must originate from a tab context
    const senderTabId = sender.tab?.id;
    if (senderTabId === undefined || senderTabId === null) {
      return {
        type: 'CDP_RPC_RESPONSE',
        id: reqId,
        success: false,
        error: {
          code: 403,
          message: 'Security error: Message sender has no associated tab context'
        }
      };
    }

    // 2. Anti-Spoofing: Declared tabId cannot claim a foreign tab
    if (request.tabId !== undefined && request.tabId !== senderTabId) {
      return {
        type: 'CDP_RPC_RESPONSE',
        id: reqId,
        success: false,
        error: {
          code: 403,
          message: `Security violation: Cross-tab CDP access denied. Claimed tab ${request.tabId}, but sender is tab ${senderTabId}`
        }
      };
    }

    // 3. Method validation
    if (!request.method || typeof request.method !== 'string' || request.method.trim() === '') {
      return {
        type: 'CDP_RPC_RESPONSE',
        id: reqId,
        success: false,
        error: {
          code: -32600,
          message: 'Invalid Request: method must be a non-empty string'
        }
      };
    }

    // 4. Restricted URL guard
    const tabUrl = sender.tab?.url;
    if (tabUrl && isRestrictedUrl(tabUrl)) {
      return {
        type: 'CDP_RPC_RESPONSE',
        id: reqId,
        success: false,
        error: {
          code: 403,
          message: `Security violation: CDP operations are restricted on system page: ${tabUrl}`
        }
      };
    }

    // 5. Execute against sender's verified tab ID
    return this.executeCommand(senderTabId, request.method, request.params, reqId);
  }

  /**
   * Executes a CDP command on target tab with timeout tracking and auto-attachment.
   */
  public async executeCommand(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
    requestId?: string
  ): Promise<CdpRpcResponse> {
    const id = requestId || `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Fast-check if tab is already in CONFLICT status
    if (this.debuggerManager?.getTabStatus?.(tabId) === 'CONFLICT') {
      return {
        type: 'CDP_RPC_RESPONSE',
        id,
        success: false,
        error: {
          code: 1001,
          message: 'DevTools conflict: debugger cannot execute commands while tab is in CONFLICT state',
          data: { tabId, reason: 'CONFLICT' }
        }
      };
    }

    if (this.autoAttach) {
      try {
        await this.ensureAttached(tabId);
      } catch (attachErr: any) {
        const isConflict =
          attachErr instanceof DevToolsConflictError ||
          attachErr?.code === 1001 ||
          attachErr?.message?.includes('conflict') ||
          attachErr?.message?.includes('Another debugger');

        return {
          type: 'CDP_RPC_RESPONSE',
          id,
          success: false,
          error: {
            code: isConflict ? 1001 : -32002,
            message: attachErr?.message || `Failed to attach debugger to tab ${tabId}`,
            data: attachErr
          }
        };
      }
    }

    return new Promise<CdpRpcResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.handleTimeout(id);
      }, this.timeoutMs);

      const entry: InflightRequestEntry = {
        id,
        tabId,
        method,
        params,
        startTime: Date.now(),
        timer,
        resolve
      };

      this.inflightRequests.set(id, entry);
      if (!this.tabRequests.has(tabId)) {
        this.tabRequests.set(tabId, new Set());
      }
      this.tabRequests.get(tabId)!.add(id);

      if (typeof chrome === 'undefined' || !chrome.debugger?.sendCommand) {
        clearTimeout(timer);
        this.inflightRequests.delete(id);
        this.tabRequests.get(tabId)?.delete(id);
        resolve({
          type: 'CDP_RPC_RESPONSE',
          id,
          success: false,
          error: {
            code: -32000,
            message: 'chrome.debugger API is unavailable'
          }
        });
        return;
      }

      chrome.debugger
        .sendCommand({ tabId }, method, params || {})
        .then((result) => {
          if (!this.inflightRequests.has(id)) return;

          clearTimeout(timer);
          this.inflightRequests.delete(id);
          this.tabRequests.get(tabId)?.delete(id);

          resolve({
            type: 'CDP_RPC_RESPONSE',
            id,
            success: true,
            result: result ?? {}
          });
        })
        .catch((cmdErr: any) => {
          if (!this.inflightRequests.has(id)) return;

          clearTimeout(timer);
          this.inflightRequests.delete(id);
          this.tabRequests.get(tabId)?.delete(id);

          const errMsg = cmdErr?.message || String(cmdErr) || 'CDP command failed';
          const isConflict =
            errMsg.includes('canceled_by_user') ||
            errMsg.includes('replaced_with_devtools') ||
            errMsg.includes('Detached while handling command') ||
            cmdErr?.code === 1001;

          resolve({
            type: 'CDP_RPC_RESPONSE',
            id,
            success: false,
            error: {
              code: isConflict ? 1001 : -32603,
              message: errMsg,
              data: cmdErr
            }
          });
        });
    });
  }

  /**
   * Ensures the debugger is attached to the tab, using per-tab locking to prevent race conditions.
   */
  public async ensureAttached(tabId: number): Promise<void> {
    if (this.isTabAttached(tabId)) {
      return;
    }

    const existingLock = this.attachLocks.get(tabId);
    if (existingLock) {
      await existingLock;
      return;
    }

    const lock = (async () => {
      try {
        if (this.debuggerManager) {
          if (this.debuggerManager.attachTab) {
            await this.debuggerManager.attachTab(tabId, this.protocolVersion);
          } else if (this.debuggerManager.attach) {
            const ok = await this.debuggerManager.attach(tabId, this.protocolVersion);
            if (!ok) {
              throw new Error(`Failed to attach debugger to tab ${tabId}`);
            }
          }
        } else {
          if (typeof chrome !== 'undefined' && chrome.debugger?.attach) {
            await chrome.debugger.attach({ tabId }, this.protocolVersion);
          }
        }
        this.attachedTabs.add(tabId);
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        const hasAlreadyAttached = /already attached/i.test(errMsg);
        const isConflict =
          err instanceof DevToolsConflictError ||
          err?.code === 1001 ||
          /another debugger|devtools|canceled_by_user|conflict/i.test(errMsg);

        // Check if extension actually owns the attachment via debuggerManager
        const isActuallyAttached = this.debuggerManager
          ? this.debuggerManager.isAttached(tabId)
          : false;

        // Genuine self-attachment idempotency: extension already owns session
        if (isActuallyAttached && !isConflict && hasAlreadyAttached) {
          this.attachedTabs.add(tabId);
          return;
        }

        // Native DevTools or foreign debugger conflict
        if (isConflict || hasAlreadyAttached) {
          this.attachedTabs.delete(tabId);

          if (this.debuggerManager?.setTabStatus) {
            this.debuggerManager.setTabStatus(tabId, 'CONFLICT', errMsg);
          }

          const conflictReason = /canceled_by_user|replaced_with_devtools/.test(errMsg)
            ? (errMsg.includes('replaced_with_devtools') ? 'replaced_with_devtools' : 'canceled_by_user')
            : 'canceled_by_user';

          const conflictError =
            err instanceof DevToolsConflictError
              ? err
              : new DevToolsConflictError(tabId, conflictReason, errMsg);

          await this.broadcastLifecycle({
            type: 'CDP_LIFECYCLE_EVENT',
            tabId,
            status: 'CONFLICT',
            reason: conflictError.message
          });
          throw conflictError;
        }

        // Generic attach failure
        this.attachedTabs.delete(tabId);
        throw err;
      } finally {
        this.attachLocks.delete(tabId);
      }
    })();

    this.attachLocks.set(tabId, lock);
    await lock;
  }

  /**
   * Rejects all in-flight promises for a specific tab (e.g. during DevTools conflict).
   */
  public rejectPendingRequestsForTab(tabId: number, error: Error | CdpRpcError): number {
    const requestIds = this.tabRequests.get(tabId);
    if (!requestIds || requestIds.size === 0) return 0;

    const rpcError: CdpRpcError =
      error instanceof Error
        ? {
            code: (error as any).code ?? 1001,
            message: error.message,
            data: (error as any).reason
          }
        : error;

    let rejectedCount = 0;
    for (const id of Array.from(requestIds)) {
      const entry = this.inflightRequests.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        this.inflightRequests.delete(id);
        entry.resolve({
          type: 'CDP_RPC_RESPONSE',
          id,
          success: false,
          error: rpcError
        });
        rejectedCount++;
      }
    }

    this.tabRequests.delete(tabId);
    this.attachedTabs.delete(tabId);
    this.attachLocks.delete(tabId);

    return rejectedCount;
  }

  public rejectInflightForTab(tabId: number, error: Error | CdpRpcError): number {
    return this.rejectPendingRequestsForTab(tabId, error);
  }

  /**
   * Handles timeout for an in-flight request.
   */
  private handleTimeout(id: string): void {
    const entry = this.inflightRequests.get(id);
    if (!entry) return;

    this.inflightRequests.delete(id);
    this.tabRequests.get(entry.tabId)?.delete(id);

    entry.resolve({
      type: 'CDP_RPC_RESPONSE',
      id,
      success: false,
      error: {
        code: -32000,
        message: `CDP RPC request timed out after ${this.timeoutMs}ms for method '${entry.method}'`
      }
    });
  }

  /**
   * Listener for chrome.debugger.onEvent.
   */
  private handleDebuggerEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params?: any
  ): void {
    if (source.tabId === undefined || source.tabId === null) {
      return;
    }
    this.broadcastEvent(source.tabId, method, params);
  }

  /**
   * Forwards a CDP event message to the content script of the specified tab.
   */
  public async broadcastEvent(tabId: number, method: string, params?: unknown): Promise<void> {
    const eventMsg: CdpRpcEventMessage = {
      type: 'CDP_RPC_EVENT',
      tabId,
      method,
      params: params ?? {}
    };

    try {
      if (typeof chrome !== 'undefined' && chrome.tabs?.sendMessage) {
        await chrome.tabs.sendMessage(tabId, eventMsg);
      }
    } catch {
      // Non-fatal
    }
  }

  /**
   * Broadcasts a lifecycle notification to content scripts and runtime (popup/dashboard).
   */
  public async broadcastLifecycle(
    eventOrTabId: CdpRpcLifecycleMessage | number,
    status?: 'ATTACHED' | 'DETACHED' | 'CONFLICT',
    reason?: string
  ): Promise<void> {
    const event: CdpRpcLifecycleMessage =
      typeof eventOrTabId === 'number'
        ? {
            type: 'CDP_LIFECYCLE_EVENT',
            tabId: eventOrTabId,
            status: status || 'DETACHED',
            reason
          }
        : eventOrTabId;

    if (typeof chrome !== 'undefined') {
      if (chrome.tabs?.sendMessage && typeof event.tabId === 'number') {
        try {
          await chrome.tabs.sendMessage(event.tabId, event);
        } catch {
          // Non-fatal if content script is not listening
        }
      }

      if (chrome.runtime?.sendMessage) {
        try {
          await chrome.runtime.sendMessage(event);
        } catch {
          // Non-fatal if popup/dashboard is closed
        }
      }
    }
  }

  /**
   * Defensive listener for chrome.debugger.onDetach.
   */
  private handleDebuggerDetach(source: chrome.debugger.Debuggee, reason: string): void {
    if (source.tabId === undefined || source.tabId === null) return;
    const tabId = source.tabId;

    const isConflict = reason === 'canceled_by_user' || reason === 'replaced_with_devtools';
    const error: CdpRpcError = {
      code: isConflict ? 1001 : 1002,
      message: isConflict
        ? `DevTools conflict: native developer tools opened on tab`
        : `Debugger detached from tab: ${reason}`,
      data: { reason }
    };

    this.rejectPendingRequestsForTab(tabId, error);
  }

  /**
   * Formats internal unhandled exceptions into structured CdpRpcResponse.
   */
  private formatInternalErrorResponse(id: string | undefined, err: any): CdpRpcResponse {
    return {
      type: 'CDP_RPC_RESPONSE',
      id: id || 'unknown',
      success: false,
      error: {
        code: -32603,
        message: err?.message || 'Internal CDP bridge error',
        data: err?.stack
      }
    };
  }

  // Accessors & query helpers
  public isTabAttached(tabId: number): boolean {
    if (this.debuggerManager) {
      return this.debuggerManager.isAttached(tabId);
    }
    return this.attachedTabs.has(tabId);
  }

  public markTabAttached(tabId: number): void {
    this.attachedTabs.add(tabId);
  }

  public markTabDetached(tabId: number): void {
    this.attachedTabs.delete(tabId);
    this.attachLocks.delete(tabId);
  }

  public getAttachedTabs(): number[] {
    return Array.from(this.attachedTabs);
  }

  public getPendingRequestCount(tabId?: number): number {
    if (tabId !== undefined) {
      return this.tabRequests.get(tabId)?.size ?? 0;
    }
    return this.inflightRequests.size;
  }
}
