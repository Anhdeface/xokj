/**
 * XOKJ - Content Script Message Bridge
 * Location: src/content/bridge.ts
 *
 * Multiplexes communication between webpage/userscript context and background service worker.
 * Handles request correlation, 30s timeout, event relay, and DevTools conflict invalidation.
 */

import type {
  CdpRpcRequest,
  CdpRpcResponse,
  CdpRpcEventMessage,
  CdpRpcLifecycleMessage,
  CdpRpcError,
  DebuggerSessionStatus,
  CdpLifecycleStatus
} from '@/shared/types';
import { DevToolsConflictError } from '@/shared/types';

export interface PendingRequestEntry {
  id: string;
  method: string;
  originatesFromWindow: boolean;
  startTime: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

export type CdpEventHandler = (params: any) => void;
export type LifecycleEventHandler = (event: CdpRpcLifecycleMessage) => void;

export interface ContentScriptBridgeOptions {
  timeoutMs?: number;
  channelId?: string;
  requireChannelId?: boolean;
  allowedOrigin?: string | string[];
  requireOrigin?: boolean;
  autoStart?: boolean;
  tabId?: number;
}

function generateSecureChannelId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return `xokj_${crypto.randomUUID()}`;
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return `xokj_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return `xokj_${Math.random().toString(36).slice(2, 12)}_${Date.now().toString(36)}`;
}

export class ContentScriptBridge {
  private readonly timeoutMs: number;
  private readonly channelId: string;
  private readonly requireChannelId: boolean;
  private readonly allowedOrigin?: string | string[];
  private readonly requireOrigin: boolean;
  private status: DebuggerSessionStatus = 'IDLE';
  private conflictReason?: string;
  private isListening = false;
  private tabId?: number;

  private pendingRequests = new Map<string, PendingRequestEntry>();
  private eventListeners = new Map<string, Set<CdpEventHandler>>();
  private lifecycleListeners = new Set<LifecycleEventHandler>();

  private handleWindowMessageBound = this.handleWindowMessage.bind(this);
  private handleRuntimeMessageBound = this.handleRuntimeMessage.bind(this);

  constructor(options: ContentScriptBridgeOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.channelId = options.channelId ?? generateSecureChannelId();
    this.requireChannelId = options.requireChannelId ?? Boolean(options.channelId);
    this.allowedOrigin = options.allowedOrigin;
    this.requireOrigin = options.requireOrigin ?? false;
    this.tabId = options.tabId;

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

    // Cancel all in-flight promises
    for (const [id, entry] of this.pendingRequests.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('ContentScriptBridge destroyed'));
    }

    this.pendingRequests.clear();
    this.eventListeners.clear();
    this.lifecycleListeners.clear();
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
  public getStatus(): { status: DebuggerSessionStatus; conflict: boolean; reason?: string } {
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
      const timer = setTimeout(() => {
        this.handleTimeout(id);
      }, timeout);

      this.pendingRequests.set(id, {
        id,
        method,
        originatesFromWindow: false,
        startTime: Date.now(),
        timer,
        resolve,
        reject
      });

      this.forwardToServiceWorker({
        type: 'CDP_RPC_REQUEST',
        id,
        method,
        params
      })
        .then((response) => {
          this.handleResponse(response);
        })
        .catch((err) => {
          const entry = this.pendingRequests.get(id);
          if (entry) {
            clearTimeout(entry.timer);
            this.pendingRequests.delete(id);
          }
          reject(err);
        });
    });
  }

  /**
   * Subscribes to a CDP event. Returns unsubscribe closure.
   */
  public on(event: string, handler: CdpEventHandler): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);

    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Unsubscribes an event listener.
   */
  public off(event: string, handler: CdpEventHandler): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(handler);
      if (listeners.size === 0) {
        this.eventListeners.delete(event);
      }
    }
  }

  /**
   * Registers a callback for CDP lifecycle changes (ATTACHED, CONFLICT, DETACHED).
   */
  public onLifecycle(handler: LifecycleEventHandler): () => void {
    this.lifecycleListeners.add(handler);
    return () => {
      this.lifecycleListeners.delete(handler);
    };
  }

  /**
   * Verifies that the message origin matches window.location.origin or configured allowedOrigin.
   */
  public verifyOrigin(origin?: string): boolean {
    if (this.requireOrigin && !origin) {
      return false;
    }
    if (this.allowedOrigin) {
      if (origin === undefined) {
        return !this.requireOrigin;
      }
      if (this.allowedOrigin === '*') {
        return true;
      }
      if (Array.isArray(this.allowedOrigin)) {
        return this.allowedOrigin.includes('*') || this.allowedOrigin.includes(origin);
      }
      return origin === this.allowedOrigin;
    }
    if (
      typeof window !== 'undefined' &&
      window.location &&
      window.location.origin &&
      window.location.origin !== 'null'
    ) {
      if (origin !== undefined && origin !== '' && origin !== window.location.origin) {
        return false;
      }
    }
    return true;
  }

  /**
   * Handler for window.addEventListener('message') from userscripts in Main World.
   */
  public async handleWindowMessage(
    event: MessageEvent | { source?: any; data?: any; origin?: string }
  ): Promise<void> {
    // Layer 1: Source verification - must be current window
    if (event.source !== window) return;

    // Layer 2: Origin verification
    if (!this.verifyOrigin(event.origin)) {
      return;
    }

    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // Layer 3: Message type filtering
    if (data.type !== 'CDP_RPC_REQUEST') return;

    // Layer 4: Sender source verification
    if (data.source && data.source !== 'xokj-userscript') {
      return;
    }

    // Layer 5: Channel token validation
    if (this.requireChannelId) {
      if (!data.channelId || typeof data.channelId !== 'string' || data.channelId !== this.channelId) {
        return;
      }
    } else if (this.channelId && data.channelId && data.channelId !== this.channelId) {
      return;
    }

    await this.processWindowRpcRequest(data);
  }

  /**
   * Alias for handleWindowMessage for testing and backward compatibility.
   */
  public async handlePageMessage(event: MessageEvent | { source?: any; data?: any }): Promise<void> {
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

    // Track request to support timeout and conflict cancellation
    const timer = setTimeout(() => {
      this.handleTimeout(id);
    }, this.timeoutMs);

    this.pendingRequests.set(id, {
      id,
      method,
      originatesFromWindow: true,
      startTime: Date.now(),
      timer,
      resolve: (result) => {
        this.postToWindow({
          source: 'xokj-bridge',
          channelId: this.channelId,
          type: 'CDP_RPC_RESPONSE',
          id,
          success: true,
          result
        });
      },
      reject: (err) => {
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
      }
    });

    try {
      // Strip client-provided tabId; background identifies sender tab strictly
      const response = await this.forwardToServiceWorker({
        type: 'CDP_RPC_REQUEST',
        id,
        method,
        params,
        scriptId
      });

      this.handleResponse(response);
    } catch (sendErr: any) {
      const entry = this.pendingRequests.get(id);
      if (!entry) return;

      clearTimeout(entry.timer);
      this.pendingRequests.delete(id);
      entry.reject(sendErr);
    }
  }

  /**
   * Settles a pending request with the response received from the background service worker.
   */
  private handleResponse(response: CdpRpcResponse): void {
    if (!response || !response.id) return;

    const entry = this.pendingRequests.get(response.id);
    if (!entry) return; // Request already timed out, cancelled, or handled

    clearTimeout(entry.timer);
    this.pendingRequests.delete(response.id);

    if (response.success) {
      entry.resolve(response.result);
    } else {
      const err = response.error;
      const isConflict =
        err?.code === 1001 ||
        /conflict/i.test(err?.message || '');

      if (isConflict) {
        const reason = (err?.data as any)?.reason || 'canceled_by_user';
        const conflictErr = new DevToolsConflictError(
          this.tabId ?? 0,
          reason,
          err?.message || 'DevTools conflict: native developer tools opened on tab'
        );
        (conflictErr as any).data = { reason };

        // Settle the triggering request
        entry.reject(conflictErr);

        // Transition tab status to CONFLICT and drain any remaining pending requests
        this.handleConflict(reason);
      } else {
        const errorObj: any = new Error(err?.message || 'CDP command execution failed');
        errorObj.code = err?.code ?? -32603;
        errorObj.data = err?.data;
        entry.reject(errorObj);
      }
    }
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

    // 1. Dispatch to local event listeners
    const listeners = this.eventListeners.get(event.method);
    if (listeners) {
      for (const listener of Array.from(listeners)) {
        try {
          listener(event.params);
        } catch (err) {
          console.error(`[XOKJ Bridge] Error in event listener for ${event.method}:`, err);
        }
      }
    }

    // 2. Relay to Main World listeners via window.postMessage
    this.postToWindow({
      source: 'xokj-bridge',
      channelId: this.channelId,
      type: 'CDP_RPC_EVENT',
      tabId: event.tabId,
      method: event.method,
      params: event.params
    });
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
    this.postToWindow({
      source: 'xokj-bridge',
      channelId: this.channelId,
      type: 'CDP_LIFECYCLE_EVENT',
      tabId: event.tabId,
      status: event.status,
      reason: event.reason
    });

    // Notify local lifecycle listeners
    this.notifyLifecycleListeners(event.status, event.reason);
  }

  /**
   * Immediately drains all active pending requests with code 1002 (CDP session detached).
   */
  public handleDetached(reason: string = 'detached'): void {
    this.status = 'DETACHED';
    this.conflictReason = undefined;

    const message =
      reason && reason !== 'detached'
        ? `CDP session detached: ${reason}`
        : 'CDP session detached';

    for (const [id, entry] of this.pendingRequests.entries()) {
      clearTimeout(entry.timer);
      this.pendingRequests.delete(id);

      const detachedErr: any = new Error(message);
      detachedErr.code = 1002;
      detachedErr.data = { reason };

      // entry.reject handles window response posting if entry.originatesFromWindow is true,
      // or promise rejection if entry was initiated via bridge.send().
      entry.reject(detachedErr);
    }

    // Broadcast CDP_LIFECYCLE_EVENT to Page Main World
    this.postToWindow({
      source: 'xokj-bridge',
      channelId: this.channelId,
      type: 'CDP_LIFECYCLE_EVENT',
      tabId: this.tabId ?? 0,
      status: 'DETACHED',
      reason
    });

    // Notify internal lifecycle listeners
    this.notifyLifecycleListeners('DETACHED', reason);
  }

  /**
   * Immediately drains all active pending requests with typed DevToolsConflictError (code 1001).
   */
  public handleConflict(reason: string = 'canceled_by_user'): void {
    this.status = 'CONFLICT';
    this.conflictReason = reason;

    const conflictError: CdpRpcError = {
      code: 1001,
      message: 'DevTools conflict: native developer tools opened on tab',
      data: { reason }
    };

    for (const [id, entry] of this.pendingRequests.entries()) {
      clearTimeout(entry.timer);
      this.pendingRequests.delete(id);

      const conflictErr = new DevToolsConflictError(
        this.tabId ?? 0,
        reason,
        conflictError.message
      );
      (conflictErr as any).data = conflictError.data;

      // entry.reject handles window response posting if entry.originatesFromWindow is true,
      // or promise rejection if entry was initiated via bridge.send().
      entry.reject(conflictErr);
    }

    // Broadcast CDP_LIFECYCLE_EVENT to Page Main World
    this.postToWindow({
      source: 'xokj-bridge',
      channelId: this.channelId,
      type: 'CDP_LIFECYCLE_EVENT',
      tabId: this.tabId ?? 0,
      status: 'CONFLICT',
      reason
    });

    // Notify internal lifecycle listeners
    this.notifyLifecycleListeners('CONFLICT', reason);
  }

  /**
   * Handles timeout for an unfulfilled pending request.
   */
  private handleTimeout(id: string): void {
    const entry = this.pendingRequests.get(id);
    if (!entry) return;

    this.pendingRequests.delete(id);
    const timeoutErr: any = new Error(
      `CDP RPC request timed out after ${this.timeoutMs}ms for method '${entry.method}'`
    );
    timeoutErr.code = -32000;

    // entry.reject handles window response posting if entry.originatesFromWindow is true,
    // or promise rejection if entry was initiated via bridge.send().
    entry.reject(timeoutErr);
  }

  /**
   * Dispatches lifecycle notification to internal listeners.
   */
  private notifyLifecycleListeners(status: CdpLifecycleStatus, reason?: string): void {
    const msg: CdpRpcLifecycleMessage = {
      type: 'CDP_LIFECYCLE_EVENT',
      tabId: this.tabId ?? 0,
      status,
      reason
    };

    for (const listener of this.lifecycleListeners) {
      try {
        listener(msg);
      } catch (err) {
        console.error('[XOKJ Bridge] Error in lifecycle listener:', err);
      }
    }
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
