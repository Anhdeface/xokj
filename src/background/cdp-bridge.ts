/**
 * XOKJ - Asynchronous CDP RPC Bridge & Event Multiplexer
 *
 * Public coordinator facade delegating single-responsibility concerns to:
 * - CdpPermissionGuard (permissions & match patterns)
 * - TimeoutGuard (inflight command tracking & 30s timeout guards)
 * - CdpBroadcaster (CDP_RPC_EVENT and CDP_LIFECYCLE_EVENT dispatch)
 * - RpcRouter (request validation, anti-spoofing, error mapping)
 * - GmStorageMessageHandler (runtime GM storage routing)
 * - TabDebuggerManager (authoritative CDP attachment & session state)
 */

import type {
  CdpRpcRequest,
  CdpRpcResponse,
  CdpRpcError,
  CdpLifecycleStatus,
  ScriptRecord
} from '@/shared/types';
import { DevToolsConflictError } from '@/shared/types';
import { getScript } from '@/shared/storage';
import {
  IDebuggerManager,
  CdpBridgeServerOptions,
  InflightRequestEntry,
  CdpPermissionGuard,
  TimeoutGuard,
  CdpBroadcaster,
  validateRpcRequest,
  formatInternalErrorResponse
} from './cdp';
import { gmStorageHandler } from './gm-handler';

export type { IDebuggerManager, CdpBridgeServerOptions, InflightRequestEntry };

export class CdpBridgeServer {
  private readonly timeoutMs: number;
  private readonly protocolVersion: string;
  private readonly autoAttach: boolean;
  private readonly debuggerManager?: IDebuggerManager;

  // Submodules
  private permissionGuard: CdpPermissionGuard;
  private timeoutGuard: TimeoutGuard;
  private broadcaster: CdpBroadcaster;

  // State maps preserved for white-box test compatibility
  public readonly inflightRequests: Map<string, InflightRequestEntry>;
  public readonly tabRequests: Map<number, Set<string>>;
  public readonly attachLocks = new Map<number, Promise<void>>();
  public readonly attachedTabs = new Set<number>();

  private isListening = false;

  private handleMessageBound = this.handleMessage.bind(this);
  private handleDebuggerEventBound = this.handleDebuggerEvent.bind(this);
  private handleDebuggerDetachBound = this.handleDebuggerDetach.bind(this);
  private handleTabRemovedBound = this.handleTabRemoved.bind(this);

  constructor(options: CdpBridgeServerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.protocolVersion = options.protocolVersion ?? '1.3';
    this.autoAttach = options.autoAttach ?? true;
    this.debuggerManager = options.debuggerManager;

    this.permissionGuard = new CdpPermissionGuard(
      options.enforcePermissions ?? false,
      options.scriptResolver ?? getScript
    );
    this.timeoutGuard = new TimeoutGuard();
    this.broadcaster = new CdpBroadcaster();

    this.inflightRequests = this.timeoutGuard.inflightRequests;
    this.tabRequests = this.timeoutGuard.tabRequests;

    if (this.debuggerManager && typeof (this.debuggerManager as any).setInflightTracker === 'function') {
      (this.debuggerManager as any).setInflightTracker(this);
    }

    if (options.autoStart) {
      this.init();
    }
  }

  public setEnforcePermissions(enforce: boolean): void {
    this.permissionGuard.setEnforcePermissions(enforce);
  }

  /**
   * Starts listening to chrome.runtime.onMessage and chrome.debugger events.
   */
  public init(): void {
    if (this.isListening) return;

    if (typeof chrome !== 'undefined') {
      chrome.runtime?.onMessage?.addListener?.(this.handleMessageBound);
      chrome.debugger?.onEvent?.addListener?.(this.handleDebuggerEventBound);
      chrome.tabs?.onRemoved?.addListener?.(this.handleTabRemovedBound);

      // Defensive detach listener only in standalone mode without debuggerManager
      if (!this.debuggerManager && chrome.debugger?.onDetach) {
        chrome.debugger.onDetach.addListener(this.handleDebuggerDetachBound);
      }
    }

    this.permissionGuard.init();
    this.isListening = true;
  }

  public start(): void {
    this.init();
  }

  /**
   * Teardown event listeners and drain inflight requests.
   */
  public destroy(): void {
    if (!this.isListening) return;

    if (typeof chrome !== 'undefined') {
      chrome.runtime?.onMessage?.removeListener?.(this.handleMessageBound);
      chrome.debugger?.onEvent?.removeListener?.(this.handleDebuggerEventBound);
      chrome.tabs?.onRemoved?.removeListener?.(this.handleTabRemovedBound);

      if (!this.debuggerManager && chrome.debugger?.onDetach) {
        chrome.debugger.onDetach.removeListener(this.handleDebuggerDetachBound);
      }
    }

    this.permissionGuard.destroy();
    this.timeoutGuard.destroy();
    this.attachLocks.clear();
    this.attachedTabs.clear();

    this.isListening = false;
  }

  public stop(): void {
    this.destroy();
  }

  /**
   * Message listener registered on chrome.runtime.onMessage.
   * Handles CDP RPC requests and routes GM storage requests.
   */
  public handleMessage(
    message: any,
    sender: chrome.runtime.MessageSender,
    sendResponse: (res: any) => void
  ): boolean | void {
    if (!message) return;

    if (message.type === 'GM_STORAGE_SET' || message.type === 'GM_STORAGE_DELETE') {
      return gmStorageHandler.handleMessage(message, sender, sendResponse);
    }

    if (message.type !== 'CDP_RPC_REQUEST' && message.type !== 'XOKJ_CDP_REQUEST') {
      return;
    }

    this.processRpcRequest(message as CdpRpcRequest, sender)
      .then((response) => {
        sendResponse(response);
      })
      .catch((err) => {
        sendResponse(formatInternalErrorResponse(message?.id, err));
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
    const validated = validateRpcRequest(request, sender);
    if (validated.error) {
      return validated.error;
    }

    const { reqId, senderTabId } = validated;

    if (request.scriptId || this.permissionGuard.enforcePermissions) {
      const permissionError = await this.permissionGuard.validateScriptPermissions(request, sender);
      if (permissionError) {
        return {
          type: 'CDP_RPC_RESPONSE',
          id: reqId,
          success: false,
          error: permissionError
        };
      }
    }

    return this.executeCommand(senderTabId!, request.method, request.params, reqId);
  }

  public async validateScriptPermissions(
    request: CdpRpcRequest,
    sender: chrome.runtime.MessageSender
  ): Promise<CdpRpcError | null> {
    return this.permissionGuard.validateScriptPermissions(request, sender);
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

    return new Promise<CdpRpcResponse>(async (resolve) => {
      this.timeoutGuard.track(
        {
          id,
          tabId,
          method,
          params,
          startTime: Date.now(),
          resolve
        },
        this.timeoutMs
      );

      if (this.autoAttach) {
        try {
          await this.ensureAttached(tabId);
        } catch (attachErr: any) {
          if (!this.timeoutGuard.has(id)) {
            return;
          }

          this.timeoutGuard.settle(id);

          const isConflict =
            attachErr instanceof DevToolsConflictError ||
            attachErr?.code === 1001 ||
            attachErr?.message?.includes('conflict') ||
            attachErr?.message?.includes('Another debugger');

          resolve({
            type: 'CDP_RPC_RESPONSE',
            id,
            success: false,
            error: {
              code: isConflict ? 1001 : -32002,
              message: attachErr?.message || `Failed to attach debugger to tab ${tabId}`,
              data: attachErr
            }
          });
          return;
        }
      }

      if (!this.timeoutGuard.has(id)) {
        return;
      }

      if (typeof chrome === 'undefined' || !chrome.debugger?.sendCommand) {
        this.timeoutGuard.settle(id);
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
          if (!this.timeoutGuard.has(id)) return;
          this.timeoutGuard.settle(id);

          resolve({
            type: 'CDP_RPC_RESPONSE',
            id,
            success: true,
            result: result ?? {}
          });
        })
        .catch((cmdErr: any) => {
          if (!this.timeoutGuard.has(id)) return;
          this.timeoutGuard.settle(id);

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
   * Ensures the debugger is attached to the tab.
   * Delegates to TabDebuggerManager when available.
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

    let lock!: Promise<void>;
    lock = (async () => {
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

        const isStillAttached = this.debuggerManager
          ? this.debuggerManager.isAttached(tabId)
          : this.attachLocks.get(tabId) === lock;

        if (isStillAttached) {
          this.attachedTabs.add(tabId);
        } else {
          this.attachedTabs.delete(tabId);
          if (!this.debuggerManager && typeof chrome !== 'undefined' && chrome.debugger?.detach) {
            try {
              await chrome.debugger.detach({ tabId });
            } catch {}
          }
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        const hasAlreadyAttached = /already attached/i.test(errMsg);
        const isConflict =
          err instanceof DevToolsConflictError ||
          err?.code === 1001 ||
          /another debugger|devtools|canceled_by_user|conflict/i.test(errMsg);

        const isActuallyAttached = this.debuggerManager
          ? this.debuggerManager.isAttached(tabId)
          : false;

        if (isActuallyAttached && !isConflict && hasAlreadyAttached) {
          this.attachedTabs.add(tabId);
          return;
        }

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

          // Only broadcast if not delegated to manager
          if (!this.debuggerManager) {
            await this.broadcastLifecycle({
              type: 'CDP_LIFECYCLE_EVENT',
              tabId,
              status: 'CONFLICT',
              reason: conflictError.message
            });
          }
          throw conflictError;
        }

        this.attachedTabs.delete(tabId);
        throw err;
      } finally {
        if (this.attachLocks.get(tabId) === lock) {
          this.attachLocks.delete(tabId);
        }
      }
    })();

    this.attachLocks.set(tabId, lock);
    await lock;
  }

  /**
   * Rejects all in-flight promises for a specific tab (e.g. during DevTools conflict).
   */
  public rejectPendingRequestsForTab(tabId: number, error: Error | CdpRpcError): number {
    const count = this.timeoutGuard.rejectPendingRequestsForTab(tabId, error);
    this.attachedTabs.delete(tabId);
    this.attachLocks.delete(tabId);
    return count;
  }

  public rejectInflightForTab(tabId: number, error: Error | CdpRpcError): number {
    return this.rejectPendingRequestsForTab(tabId, error);
  }

  public handleTabRemoved(tabId: number): void {
    this.timeoutGuard.handleTabRemoved(tabId);
    this.attachedTabs.delete(tabId);
    this.attachLocks.delete(tabId);
  }

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

  public async broadcastEvent(tabId: number, method: string, params?: unknown): Promise<void> {
    return this.broadcaster.broadcastEvent(tabId, method, params);
  }

  public async broadcastLifecycle(
    eventOrTabId: any,
    status?: CdpLifecycleStatus,
    reason?: string
  ): Promise<void> {
    return this.broadcaster.broadcastLifecycle(eventOrTabId, status, reason);
  }

  private handleDebuggerDetach(
    source: chrome.debugger.Debuggee,
    reason: string
  ): void {
    const tabId = source.tabId;
    if (tabId === undefined || tabId === null) return;

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
    this.rejectPendingRequestsForTab(tabId, new Error('Debugger detached'));
  }

  public getAttachedTabs(): number[] {
    return Array.from(this.attachedTabs);
  }

  public getPendingRequestCount(tabId?: number): number {
    return this.timeoutGuard.getPendingRequestCount(tabId);
  }
}
