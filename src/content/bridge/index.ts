/**
 * XOKJ - Content Script Message Bridge (Modular Subsystem Facade)
 *
 * Multiplexes communication between webpage/userscript context and background service worker.
 * Handles request correlation, timeouts, event relay, DevTools conflict invalidation,
 * and GM storage mutation forwarding.
 */

import type {
  PendingRequestEntry,
  CdpEventHandler,
  LifecycleEventHandler,
  ContentScriptBridgeOptions,
  BridgeStatus,
  CdpRpcRequest,
  CdpRpcResponse,
  CdpRpcEventMessage,
  CdpRpcLifecycleMessage,
  DebuggerSessionStatus
} from './types';
import { DevToolsConflictError } from './types';
import {
  generateSecureChannelId,
  isFastPathAllowed,
  verifySource,
  verifyOrigin as validatorVerifyOrigin,
  verifySenderSource,
  verifyChannelId
} from './validator';
import { PendingRequestManager } from './request-manager';
import { BridgeEventRelayer } from './event-relayer';
import { StorageForwarder } from './storage-forwarder';

export class ContentScriptBridge {
  private readonly timeoutMs: number;
  private readonly channelId: string;
  private readonly requireChannelId: boolean;
  private readonly allowedOrigin?: string | string[];
  private readonly requireOrigin: boolean;
  private status: DebuggerSessionStatus = 'IDLE';
  private conflictReason?: string;
  public isListening = false;
  private tabId?: number;

  // Submodules
  private readonly requestManager = new PendingRequestManager();
  private readonly eventRelayer = new BridgeEventRelayer();
  private readonly storageForwarder = new StorageForwarder();

  // Backward-compatible access to pending requests map for existing tests
  public readonly pendingRequests: Map<string, PendingRequestEntry>;

  private readonly handleWindowMessageBound = this.handleWindowMessage.bind(this);
  private readonly handleRuntimeMessageBound = this.handleRuntimeMessage.bind(this);
  private readonly postToWindowBound = this.postToWindow.bind(this);

  constructor(options: ContentScriptBridgeOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.channelId = options.channelId ?? generateSecureChannelId();
    this.requireChannelId = options.requireChannelId ?? Boolean(options.channelId);
    this.allowedOrigin = options.allowedOrigin;
    this.requireOrigin = options.requireOrigin ?? false;
    this.tabId = options.tabId;

    this.pendingRequests = this.requestManager.pendingRequests;

    if (options.autoStart) {
      this.init();
    }
  }

  /**
   * Initializes listeners on window (postMessage) and chrome.runtime (service worker messages).
   */
  public init(): void {
    if (this.isListening) return;

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('message', this.handleWindowMessageBound);
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(this.handleRuntimeMessageBound);
    }

    this.isListening = true;
  }

  /**
   * Cleans up listeners, cancels pending requests, and resets state.
   */
  public destroy(): void {
    if (!this.isListening) return;

    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('message', this.handleWindowMessageBound);
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(this.handleRuntimeMessageBound);
    }

    this.requestManager.destroy();
    this.eventRelayer.destroy();
    this.isListening = false;
  }

  /**
   * Disconnects the bridge, cleanly draining all pending requests with a detachment error (code 1002)
   * and unregistering the window message event listener.
   */
  public disconnect(reason: string = 'detached'): void {
    // 1. Drain pending requests with detachment error (code 1002)
    this.handleDetached(reason);

    // 2. Remove window message and runtime message event listeners
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('message', this.handleWindowMessageBound);
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(this.handleRuntimeMessageBound);
    }

    this.isListening = false;
  }

  /**
   * Returns the channel ID required for window.postMessage authorization.
   */
  public getChannelId(): string {
    return this.channelId;
  }

  /**
   * Sets or overrides tab ID.
   */
  public setTabId(tabId: number): void {
    this.tabId = tabId;
  }

  /**
   * Returns current debugger session status for this tab.
   */
  public getStatus(): BridgeStatus {
    return {
      status: this.status,
      conflict: this.status === 'CONFLICT',
      reason: this.conflictReason
    };
  }

  /**
   * Programmatic CDP command invocation for userscripts running in content script context.
   */
  public async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    customTimeoutMs?: number
  ): Promise<T> {
    if (this.status === 'CONFLICT') {
      throw new DevToolsConflictError(
        this.tabId ?? 0,
        this.conflictReason || 'canceled_by_user',
        'DevTools conflict: debugger cannot execute commands while tab is in CONFLICT state'
      );
    }

    const id = `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const timeout = customTimeoutMs ?? this.timeoutMs;

    return new Promise<T>((resolve, reject) => {
      this.requestManager.registerRequest(
        id,
        method,
        false,
        timeout,
        resolve,
        reject,
        (reqId) => this.requestManager.handleTimeout(reqId, timeout)
      );

      this.forwardToServiceWorker({
        type: 'CDP_RPC_REQUEST',
        id,
        method,
        params
      })
        .then((response) => {
          this.requestManager.handleResponse(
            response,
            this.tabId,
            this.conflictReason,
            (reason) => this.handleConflict(reason)
          );
        })
        .catch((err) => {
          const entry = this.requestManager.get(id);
          if (entry) {
            clearTimeout(entry.timer);
            this.requestManager.delete(id);
          }
          reject(err);
        });
    });
  }

  /**
   * Subscribes to a CDP event. Returns unsubscribe closure.
   */
  public on(event: string, handler: CdpEventHandler): () => void {
    return this.eventRelayer.on(event, handler);
  }

  /**
   * Unsubscribes an event listener.
   */
  public off(event: string, handler: CdpEventHandler): void {
    this.eventRelayer.off(event, handler);
  }

  /**
   * Registers a callback for CDP lifecycle changes (ATTACHED, CONFLICT, DETACHED).
   */
  public onLifecycle(handler: LifecycleEventHandler): () => void {
    return this.eventRelayer.onLifecycle(handler);
  }

  /**
   * Verifies that the message origin matches window.location.origin or configured allowedOrigin.
   * Bound instance method preserved for spy compatibility in unit tests.
   */
  public verifyOrigin(origin?: string): boolean {
    return validatorVerifyOrigin(origin, this.allowedOrigin, this.requireOrigin);
  }

  /**
   * Handler for window.addEventListener('message') from userscripts in Main World.
   */
  public async handleWindowMessage(
    event: MessageEvent | { source?: any; data?: any; origin?: string }
  ): Promise<void> {
    if (!this.isListening || this.status === 'DETACHED') {
      return;
    }

    // Step 0 Fast-path: Check event.data before touching origin or source to drop ~99.9% noise
    const data = (event as any)?.data;
    if (!isFastPathAllowed(data)) {
      return;
    }

    // Layer 1: Source verification - must be current window
    if (!verifySource(event.source)) return;

    // Layer 2: Origin verification
    if (!this.verifyOrigin(event.origin)) {
      return;
    }

    // Layer 3: Sender source verification
    if (!verifySenderSource(data.source)) {
      return;
    }

    // Layer 4: Channel token validation
    if (!verifyChannelId(data.channelId, this.channelId, this.requireChannelId)) {
      return;
    }

    if (data.type === 'CDP_RPC_REQUEST') {
      await this.processWindowRpcRequest(data);
    } else if (data.type === 'GM_STORAGE_SET' || data.type === 'GM_STORAGE_DELETE') {
      // GM storage mutations proceed even if debugger status is CONFLICT
      await this.storageForwarder.processStorageMutation(data, this.channelId, this.postToWindowBound);
    }
  }

  /**
   * Alias for handleWindowMessage for testing and backward compatibility.
   */
  public async handlePageMessage(event: MessageEvent | { source?: any; data?: any; origin?: string }): Promise<void> {
    return this.handleWindowMessage(event);
  }

  /**
   * Forwards a validated Main World RPC request to the background service worker.
   */
  private async processWindowRpcRequest(data: any): Promise<void> {
    const { id, method, params, scriptId } = data;

    if (!id || typeof id !== 'string' || !method || typeof method !== 'string') {
      this.postToWindow({
        source: 'xokj-bridge',
        channelId: this.channelId,
        type: 'CDP_RPC_RESPONSE',
        id: id || 'invalid',
        success: false,
        error: { code: -32600, message: 'Invalid request: id and method must be strings' }
      });
      return;
    }

    // Check conflict status fast-path
    if (this.status === 'CONFLICT') {
      this.postToWindow({
        source: 'xokj-bridge',
        channelId: this.channelId,
        type: 'CDP_RPC_RESPONSE',
        id,
        success: false,
        error: {
          code: 1001,
          message: 'DevTools conflict: debugger cannot execute commands while tab is in CONFLICT state',
          data: { reason: this.conflictReason || 'canceled_by_user' }
        }
      });
      return;
    }

    if (this.status === 'DETACHED') {
      this.postToWindow({
        source: 'xokj-bridge',
        channelId: this.channelId,
        type: 'CDP_RPC_RESPONSE',
        id,
        success: false,
        error: { code: 1002, message: 'CDP session detached', data: { reason: 'detached' } }
      });
      return;
    }

    // Track request to support timeout and conflict cancellation
    this.requestManager.registerRequest(
      id,
      method,
      true,
      this.timeoutMs,
      (result) => {
        this.postToWindow({
          source: 'xokj-bridge',
          channelId: this.channelId,
          type: 'CDP_RPC_RESPONSE',
          id,
          success: true,
          result
        });
      },
      (err) => {
        const isConflict =
          err instanceof DevToolsConflictError ||
          err?.code === 1001 ||
          /conflict/i.test(err?.message || '');

        const conflictReason =
          (err as any)?.reason ||
          (err as any)?.data?.reason ||
          this.conflictReason ||
          'canceled_by_user';

        this.postToWindow({
          source: 'xokj-bridge',
          channelId: this.channelId,
          type: 'CDP_RPC_RESPONSE',
          id,
          success: false,
          error: {
            code: isConflict ? 1001 : (err?.code ?? -32603),
            message: err?.message || 'CDP command failed',
            data: err?.data ?? (isConflict ? { reason: conflictReason } : undefined)
          }
        });
      },
      (reqId) => this.requestManager.handleTimeout(reqId, this.timeoutMs)
    );

    // Strip client-provided tabId; background identifies sender tab strictly
    return this.forwardToServiceWorker({
      type: 'CDP_RPC_REQUEST',
      id,
      method,
      params,
      scriptId
    })
      .then((response) => {
        this.requestManager.handleResponse(
          response,
          this.tabId,
          this.conflictReason,
          (reason) => this.handleConflict(reason)
        );
      })
      .catch((sendErr: any) => {
        const entry = this.requestManager.get(id);
        if (!entry) return;

        clearTimeout(entry.timer);
        this.requestManager.delete(id);
        entry.reject(sendErr);
      });
  }

  /**
   * Relays a message to the Background Service Worker via chrome.runtime.sendMessage.
   */
  private async forwardToServiceWorker(request: CdpRpcRequest): Promise<CdpRpcResponse> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is unavailable');
    }

    return new Promise<CdpRpcResponse>((resolve, reject) => {
      try {
        const maybePromise: any = chrome.runtime.sendMessage(request, (response: CdpRpcResponse) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message || 'Failed to send message to extension background'));
            return;
          }
          if (response !== undefined) {
            resolve(response);
          }
        });

        // In environments where sendMessage returns a Promise directly
        if (maybePromise && typeof (maybePromise as any).then === 'function') {
          (maybePromise as Promise<any>).then(
            (res) => {
              if (res) resolve(res);
            },
            (err) => reject(err)
          );
        }
      } catch (ex) {
        reject(ex);
      }
    });
  }

  /**
   * Handler for chrome.runtime.onMessage (events and lifecycle pushed from background).
   */
  public handleRuntimeMessage(
    message: any,
    _sender?: chrome.runtime.MessageSender,
    sendResponse?: (res?: any) => void
  ): boolean | void {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'CDP_RPC_EVENT') {
      this.handleCdpRpcEvent(message as CdpRpcEventMessage);
      sendResponse?.({ acknowledged: true });
      return;
    }

    if (message.type === 'CDP_LIFECYCLE_EVENT') {
      this.handleLifecycleEvent(message as CdpRpcLifecycleMessage);
      sendResponse?.({ acknowledged: true });
      return;
    }
  }

  /**
   * Processes incoming CDP_RPC_EVENT pushed from background.
   */
  private handleCdpRpcEvent(event: CdpRpcEventMessage): void {
    if (event.tabId !== undefined) {
      this.tabId = event.tabId;
    }

    this.eventRelayer.dispatchCdpEvent(event, this.channelId, this.postToWindowBound);
  }

  /**
   * Processes incoming CDP_LIFECYCLE_EVENT from background.
   */
  private handleLifecycleEvent(event: CdpRpcLifecycleMessage): void {
    if (event.tabId !== undefined) {
      this.tabId = event.tabId;
    }

    this.status =
      event.status === 'CONFLICT'
        ? 'CONFLICT'
        : event.status === 'ATTACHED'
        ? 'ATTACHED'
        : 'DETACHED';
    this.conflictReason = event.status === 'CONFLICT' ? event.reason : undefined;

    // If transitioning into CONFLICT, immediately drain all inflight promises
    if (this.status === 'CONFLICT') {
      this.handleConflict(event.reason || 'canceled_by_user');
      return;
    }

    // If transitioning into DETACHED, immediately drain all inflight promises with code 1002
    if (this.status === 'DETACHED') {
      this.handleDetached(event.reason || 'detached');
      return;
    }

    // Relay to Main World (e.g. ATTACHED)
    this.eventRelayer.dispatchLifecycleEvent(event, this.channelId, this.postToWindowBound);
  }

  /**
   * Immediately drains all active pending requests with code 1002 (CDP session detached).
   */
  public handleDetached(reason: string = 'detached'): void {
    this.status = 'DETACHED';
    this.conflictReason = undefined;

    this.requestManager.drainDetached(reason);

    this.postToWindow({
      source: 'xokj-bridge',
      channelId: this.channelId,
      type: 'CDP_LIFECYCLE_EVENT',
      tabId: this.tabId ?? 0,
      status: 'DETACHED',
      reason
    });

    this.eventRelayer.notifyLifecycle('DETACHED', reason, this.tabId);
  }

  /**
   * Immediately drains all active pending requests with typed DevToolsConflictError (code 1001).
   */
  public handleConflict(reason: string = 'canceled_by_user'): void {
    this.status = 'CONFLICT';
    this.conflictReason = reason;

    this.requestManager.drainConflict(reason, this.tabId);

    this.postToWindow({
      source: 'xokj-bridge',
      channelId: this.channelId,
      type: 'CDP_LIFECYCLE_EVENT',
      tabId: this.tabId ?? 0,
      status: 'CONFLICT',
      reason
    });

    this.eventRelayer.notifyLifecycle('CONFLICT', reason, this.tabId);
  }

  /**
   * Safe postMessage helper targeting current window.
   */
  private postToWindow(message: any): void {
    if (typeof window !== 'undefined' && typeof window.postMessage === 'function') {
      try {
        const targetOrigin =
          window.location && window.location.origin && window.location.origin !== 'null'
            ? window.location.origin
            : '*';
        window.postMessage(message, targetOrigin);
      } catch (err) {
        try {
          window.postMessage(message, '*');
        } catch {
          // Ignored
        }
      }
    }
  }
}

// Aliases for compatibility
export const ContentBridge = ContentScriptBridge;
export type ContentBridge = ContentScriptBridge;
export default ContentScriptBridge;

export * from './types';
export * from './validator';
export * from './request-manager';
export * from './event-relayer';
export * from './storage-forwarder';
