/**
 * XOKJ - CDP Event & Lifecycle Broadcaster
 */

import type {
  CdpRpcEventMessage,
  CdpRpcLifecycleMessage,
  CdpLifecycleStatus
} from '@/shared/types';

export class CdpBroadcaster {
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
    status?: CdpLifecycleStatus,
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
}
