/**
 * XOKJ - CDP Inflight Request & Timeout Guard
 */

import type { CdpRpcResponse, CdpRpcError } from '@/shared/types';
import type { InflightRequestEntry } from './types';

export class TimeoutGuard {
  public readonly inflightRequests = new Map<string, InflightRequestEntry>();
  public readonly tabRequests = new Map<number, Set<string>>();

  /**
   * Tracks an active command invocation and arms a timeout timer.
   */
  public track(
    params: {
      id: string;
      tabId: number;
      method: string;
      params?: Record<string, unknown>;
      startTime: number;
      resolve: (response: CdpRpcResponse) => void;
    },
    timeoutMs: number
  ): InflightRequestEntry {
    const timer = setTimeout(() => {
      this.handleTimeout(params.id, timeoutMs);
    }, timeoutMs);

    const entry: InflightRequestEntry = {
      ...params,
      timer
    };

    this.inflightRequests.set(params.id, entry);

    let tabSet = this.tabRequests.get(params.tabId);
    if (!tabSet) {
      tabSet = new Set<string>();
      this.tabRequests.set(params.tabId, tabSet);
    }
    tabSet.add(params.id);

    return entry;
  }

  /**
   * Settles a request entry by ID, clearing its timer and pruning tab index.
   */
  public settle(id: string): InflightRequestEntry | undefined {
    const entry = this.inflightRequests.get(id);
    if (!entry) return undefined;

    clearTimeout(entry.timer);
    this.inflightRequests.delete(id);
    this.removeTabRequest(entry.tabId, id);

    return entry;
  }

  public has(id: string): boolean {
    return this.inflightRequests.has(id);
  }

  public getPendingRequestCount(tabId?: number): number {
    if (tabId !== undefined) {
      return this.tabRequests.get(tabId)?.size ?? 0;
    }
    return this.inflightRequests.size;
  }

  /**
   * Helper to remove a request ID from tabRequests and prune the tab entry if empty.
   */
  public removeTabRequest(tabId: number, id: string): void {
    const reqs = this.tabRequests.get(tabId);
    if (reqs) {
      reqs.delete(id);
      if (reqs.size === 0) {
        this.tabRequests.delete(tabId);
      }
    }
  }

  /**
   * Rejects all in-flight promises for a specific tab (e.g. during DevTools conflict or detachment).
   */
  public rejectPendingRequestsForTab(tabId: number, error: Error | CdpRpcError): number {
    const requestIds = this.tabRequests.get(tabId);
    let rejectedCount = 0;

    if (requestIds && requestIds.size > 0) {
      const rpcError: CdpRpcError =
        error instanceof Error
          ? {
              code: (error as any).code ?? 1001,
              message: error.message,
              data: (error as any).reason
            }
          : error;

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
    }

    this.tabRequests.delete(tabId);
    return rejectedCount;
  }

  public rejectInflightForTab(tabId: number, error: Error | CdpRpcError): number {
    return this.rejectPendingRequestsForTab(tabId, error);
  }

  /**
   * Handles chrome.tabs.onRemoved event by draining closed tab requests and deallocating resources.
   */
  public handleTabRemoved(tabId: number): void {
    const error: CdpRpcError = {
      code: 1002,
      message: `Tab ${tabId} was closed`,
      data: { tabId, reason: 'target_closed' }
    };
    this.rejectPendingRequestsForTab(tabId, error);
  }

  /**
   * Handles timeout for an in-flight request.
   */
  private handleTimeout(id: string, timeoutMs: number): void {
    const entry = this.inflightRequests.get(id);
    if (!entry) return;

    this.inflightRequests.delete(id);
    this.removeTabRequest(entry.tabId, id);

    entry.resolve({
      type: 'CDP_RPC_RESPONSE',
      id,
      success: false,
      error: {
        code: -32000,
        message: `CDP RPC request timed out after ${timeoutMs}ms for method '${entry.method}'`
      }
    });
  }

  public destroy(): void {
    for (const [, entry] of this.inflightRequests) {
      clearTimeout(entry.timer);
    }
    this.inflightRequests.clear();
    this.tabRequests.clear();
  }
}
