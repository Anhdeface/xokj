/**
 * XOKJ - Content Script Bridge In-Flight Request & Timeout Manager
 *
 * Manages pending RPC promises, 30s timeouts, and bulk cancellation on conflict or detachment.
 */

import type { PendingRequestEntry, CdpRpcResponse } from './types';
import { DevToolsConflictError } from './types';

export class PendingRequestManager {
  public readonly pendingRequests = new Map<string, PendingRequestEntry>();

  public get size(): number {
    return this.pendingRequests.size;
  }

  public has(id: string): boolean {
    return this.pendingRequests.has(id);
  }

  public get(id: string): PendingRequestEntry | undefined {
    return this.pendingRequests.get(id);
  }

  public delete(id: string): boolean {
    return this.pendingRequests.delete(id);
  }

  /**
   * Registers a new in-flight RPC request with automatic timeout handler.
   */
  public registerRequest(
    id: string,
    method: string,
    originatesFromWindow: boolean,
    timeoutMs: number,
    resolve: (val: any) => void,
    reject: (err: any) => void,
    onTimeout: (id: string) => void
  ): PendingRequestEntry {
    const timer = setTimeout(() => {
      onTimeout(id);
    }, timeoutMs);

    const entry: PendingRequestEntry = {
      id,
      method,
      originatesFromWindow,
      startTime: Date.now(),
      timer,
      resolve,
      reject
    };

    this.pendingRequests.set(id, entry);
    return entry;
  }

  /**
   * Handles timeout for an unfulfilled pending request.
   */
  public handleTimeout(id: string, timeoutMs: number): void {
    const entry = this.pendingRequests.get(id);
    if (!entry) return;

    this.pendingRequests.delete(id);
    const timeoutErr: any = new Error(
      `CDP RPC request timed out after ${timeoutMs}ms for method '${entry.method}'`
    );
    timeoutErr.code = -32000;

    entry.reject(timeoutErr);
  }

  /**
   * Settles a pending request with the response received from the background service worker.
   */
  public handleResponse(
    response: CdpRpcResponse,
    tabId: number | undefined,
    currentConflictReason: string | undefined,
    onConflict: (reason: string) => void
  ): void {
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
        const reason = (err?.data as any)?.reason || currentConflictReason || 'canceled_by_user';
        const conflictErr = new DevToolsConflictError(
          tabId ?? 0,
          reason,
          err?.message || 'DevTools conflict: native developer tools opened on tab'
        );
        (conflictErr as any).data = { reason };

        // Settle the triggering request
        entry.reject(conflictErr);

        // Transition bridge status to CONFLICT and drain any remaining pending requests
        onConflict(reason);
      } else {
        const errorObj: any = new Error(err?.message || 'CDP command execution failed');
        errorObj.code = err?.code ?? -32603;
        errorObj.data = err?.data;
        entry.reject(errorObj);
      }
    }
  }

  /**
   * Immediately drains all active pending requests with typed DevToolsConflictError (code 1001).
   */
  public drainConflict(reason: string = 'canceled_by_user', tabId?: number): void {
    const conflictMessage = 'DevTools conflict: native developer tools opened on tab';

    for (const [id, entry] of this.pendingRequests.entries()) {
      clearTimeout(entry.timer);
      this.pendingRequests.delete(id);

      const conflictErr = new DevToolsConflictError(
        tabId ?? 0,
        reason,
        conflictMessage
      );
      (conflictErr as any).data = { reason };

      entry.reject(conflictErr);
    }
  }

  /**
   * Immediately drains all active pending requests with code 1002 (CDP session detached).
   */
  public drainDetached(reason: string = 'detached'): void {
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

      entry.reject(detachedErr);
    }
  }

  /**
   * Cleans up all pending requests on destruction.
   */
  public destroy(): void {
    for (const [id, entry] of this.pendingRequests.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('ContentScriptBridge destroyed'));
    }
    this.pendingRequests.clear();
  }
}
