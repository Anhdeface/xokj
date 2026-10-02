/**
 * XOKJ - Content Script Bridge Event Relayer
 *
 * Dispatches CDP events and lifecycle updates to local content script listeners
 * and relays them via window.postMessage to Main World userscript subscribers.
 */

import type {
  CdpEventHandler,
  LifecycleEventHandler,
  CdpRpcEventMessage,
  CdpRpcLifecycleMessage,
  CdpLifecycleStatus
} from './types';

export class BridgeEventRelayer {
  private readonly eventListeners = new Map<string, Set<CdpEventHandler>>();
  private readonly lifecycleListeners = new Set<LifecycleEventHandler>();

  /**
   * Subscribes to a local CDP event. Returns an unsubscription closure.
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
   * Unsubscribes a local CDP event listener.
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
   * Subscribes to local lifecycle updates. Returns an unsubscription closure.
   */
  public onLifecycle(handler: LifecycleEventHandler): () => void {
    this.lifecycleListeners.add(handler);
    return () => {
      this.lifecycleListeners.delete(handler);
    };
  }

  /**
   * Dispatches incoming CDP_RPC_EVENT to local listeners and relays to the page window.
   */
  public dispatchCdpEvent(
    event: CdpRpcEventMessage,
    channelId: string,
    postToWindow: (msg: any) => void
  ): void {
    if (!event || !event.method || typeof event.method !== 'string') {
      return;
    }

    // Normalize params (defaults to empty object if omitted/undefined)
    const normalizedParams = event.params !== undefined && event.params !== null ? event.params : {};

    // 1. Dispatch to local content script listeners directly without Array.from allocations
    const listeners = this.eventListeners.get(event.method);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(normalizedParams);
        } catch (err) {
          console.error(`[XOKJ Bridge] Error in event listener for ${event.method}:`, err);
        }
      }
    }

    // 2. Relay to Main World listeners via window.postMessage
    postToWindow({
      source: 'xokj-bridge',
      channelId,
      type: 'CDP_RPC_EVENT',
      tabId: event.tabId,
      method: event.method,
      params: normalizedParams
    });
  }

  /**
   * Relays CDP_LIFECYCLE_EVENT to window and dispatches to local lifecycle listeners.
   */
  public dispatchLifecycleEvent(
    event: CdpRpcLifecycleMessage,
    channelId: string,
    postToWindow: (msg: any) => void
  ): void {
    postToWindow({
      source: 'xokj-bridge',
      channelId,
      type: 'CDP_LIFECYCLE_EVENT',
      tabId: event.tabId,
      status: event.status,
      reason: event.reason
    });

    this.notifyLifecycle(event.status, event.reason, event.tabId);
  }

  /**
   * Dispatches lifecycle notification to internal local listeners with error isolation.
   */
  public notifyLifecycle(status: CdpLifecycleStatus, reason?: string, tabId?: number): void {
    const msg: CdpRpcLifecycleMessage = {
      type: 'CDP_LIFECYCLE_EVENT',
      tabId: tabId ?? 0,
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
   * Resets all listeners on bridge destruction.
   */
  public destroy(): void {
    this.eventListeners.clear();
    this.lifecycleListeners.clear();
  }
}
