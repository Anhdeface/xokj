/**
 * XOKJ - Userscript CDP SDK & Greasemonkey Compatibility Layer
 * Location: src/content/cdp-sdk.ts
 *
 * Implements client-side `cdp` object, GM_cdp alias, and standard GM_* API grants.
 */

import type {
  CdpRpcRequest,
  CdpRpcResponse,
  CdpRpcEventMessage,
  CdpRpcLifecycleMessage,
  CdpClient as ICdpClient,
  CdpClientStatus,
  DebuggerSessionStatus,
  ScriptRecord
} from '@/shared/types';
import { DevToolsConflictError } from '@/shared/types';

export { DevToolsConflictError };

/**
 * Transport bridge interface for SDK communication.
 */
export interface ICdpTransport {
  sendRequest(request: CdpRpcRequest): Promise<CdpRpcResponse>;
  onEvent(handler: (event: CdpRpcEventMessage) => void): () => void;
  onLifecycle(handler: (lifecycle: CdpRpcLifecycleMessage) => void): () => void;
  getStatus?(): Promise<DebuggerSessionStatus>;
}

export interface CdpClientOptions {
  channelId?: string;
  timeoutMs?: number;
  tabId?: number;
  transport?: ICdpTransport;
  autoStart?: boolean;
}

interface InflightEntry {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

/**
 * Client-side CDP SDK exposed to userscripts as `cdp`.
 */
export class CdpClient implements ICdpClient {
  private readonly channelId?: string;
  private readonly timeoutMs: number;
  private tabId: number;
  private currentStatus: CdpClientStatus = 'IDLE';
  private conflictReason?: string;
  private isListening = false;
  private transport?: ICdpTransport;

  private pendingRequests = new Map<string, InflightEntry>();
  private eventListeners = new Map<string, Set<(params: any) => void>>();
  private lifecycleUnsub?: () => void;
  private eventUnsub?: () => void;

  private handleWindowMessageBound = this.handleWindowMessage.bind(this);
  private handlePageHideBound = () => {
    this.destroy();
  };

  constructor(options: CdpClientOptions = {}) {
    this.channelId = options.channelId;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.tabId = options.tabId ?? 0;
    this.transport = options.transport;

    if (options.autoStart !== false) {
      this.init();
    }
  }

  /**
   * Initializes listeners on transport or window message events, and hooks pagehide for teardown.
   */
  public init(): void {
    if (this.isListening) return;

    if (this.transport) {
      this.eventUnsub = this.transport.onEvent((eventMsg) => {
        if (typeof eventMsg.tabId === 'number' && this.tabId === 0) {
          this.tabId = eventMsg.tabId;
        }
        this.dispatchEvent(eventMsg.method, eventMsg.params);
      });

      this.lifecycleUnsub = this.transport.onLifecycle((lifecycleMsg) => {
        if (typeof lifecycleMsg.tabId === 'number') {
          this.tabId = lifecycleMsg.tabId;
        }
        this.handleLifecycleChange(lifecycleMsg.status, lifecycleMsg.reason);
      });
    } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('message', this.handleWindowMessageBound);
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', this.handlePageHideBound, { once: true });
    }

    this.isListening = true;
  }

  /**
   * Cleans up listeners, cancels pending requests, and clears timers.
   */
  public destroy(): void {
    if (!this.isListening) return;

    this.lifecycleUnsub?.();
    this.eventUnsub?.();

    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('message', this.handleWindowMessageBound);
      window.removeEventListener('pagehide', this.handlePageHideBound);
    }

    for (const [id, entry] of this.pendingRequests.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('CdpClient destroyed: request cancelled'));
    }

    this.pendingRequests.clear();
    this.eventListeners.clear();
    this.isListening = false;
  }

  /**
   * Disconnects the client, cancelling pending requests and unregistering listeners.
   */
  public disconnect(): void {
    this.destroy();
  }

  /**
   * Handler for window.addEventListener('message') from ContentScriptBridge.
   */
  public handleWindowMessage(event: MessageEvent | { source?: any; data?: any }): void {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // Filter messages intended for this channel if configured
    if (this.channelId && data.channelId && data.channelId !== this.channelId) {
      return;
    }

    // 1. Process RPC response
    if (data.type === 'CDP_RPC_RESPONSE') {
      const entry = this.pendingRequests.get(data.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pendingRequests.delete(data.id);

        if (data.success) {
          this.currentStatus = 'ATTACHED';
          entry.resolve(data.result);
        } else {
          const err = data.error;
          if (err?.code === 1001 || /conflict|canceled_by_user|DevTools/i.test(err?.message || '')) {
            const conflictReason = (err?.data as any)?.reason || 'canceled_by_user';
            this.handleLifecycleChange('CONFLICT', conflictReason);
            entry.reject(new DevToolsConflictError(this.tabId, conflictReason, err?.message));
          } else {
            const errorObj = new Error(err?.message || 'CDP RPC command failed');
            (errorObj as any).code = err?.code ?? -32603;
            (errorObj as any).data = err?.data;
            entry.reject(errorObj);
          }
        }
      }
      return;
    }

    // 2. Process push event
    if (data.type === 'CDP_RPC_EVENT') {
      if (typeof data.tabId === 'number' && this.tabId === 0) {
        this.tabId = data.tabId;
      }
      this.dispatchEvent(data.method, data.params);
      return;
    }

    // 3. Process lifecycle change
    if (data.type === 'CDP_LIFECYCLE_EVENT') {
      if (typeof data.tabId === 'number') {
        this.tabId = data.tabId;
      }
      this.handleLifecycleChange(data.status, data.reason);
      return;
    }
  }

  /**
   * Dispatches an asynchronous CDP command to the tab debugger.
   */
  public async send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    if (!method || typeof method !== 'string' || method.trim() === '') {
      throw new Error('Invalid CDP command: method must be a non-empty string');
    }

    // Pre-flight check: reject immediately if tab is in DevTools conflict state
    if (this.currentStatus === 'CONFLICT') {
      throw new DevToolsConflictError(
        this.tabId,
        this.conflictReason || 'canceled_by_user',
        'DevTools conflict: debugger cannot execute commands while tab is in CONFLICT state'
      );
    }

    const reqId = `cdp_req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rpcRequest: CdpRpcRequest = {
      type: 'CDP_RPC_REQUEST',
      id: reqId,
      method: method.trim(),
      params: params || {}
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          reject(new Error(`CDP RPC request timed out after ${this.timeoutMs}ms for '${method}'`));
        }
      }, this.timeoutMs);

      this.pendingRequests.set(reqId, {
        resolve,
        reject,
        timer,
        method
      });

      if (this.transport) {
        this.transport
          .sendRequest(rpcRequest)
          .then((response) => {
            const entry = this.pendingRequests.get(reqId);
            if (!entry) return;

            clearTimeout(entry.timer);
            this.pendingRequests.delete(reqId);

            if (response.success) {
              this.currentStatus = 'ATTACHED';
              resolve(response.result as T);
            } else {
              const err = response.error;
              if (err?.code === 1001 || /conflict|canceled_by_user|DevTools/i.test(err?.message || '')) {
                const reason = (err?.data as any)?.reason || 'canceled_by_user';
                this.handleLifecycleChange('CONFLICT', reason);
                reject(new DevToolsConflictError(this.tabId, reason, err?.message));
              } else {
                const errorObj = new Error(err?.message || 'CDP command execution failed');
                (errorObj as any).code = err?.code ?? -32603;
                (errorObj as any).data = err?.data;
                reject(errorObj);
              }
            }
          })
          .catch((err) => {
            const entry = this.pendingRequests.get(reqId);
            if (!entry) return;

            clearTimeout(entry.timer);
            this.pendingRequests.delete(reqId);
            reject(err);
          });
      } else {
        // Dispatch over window.postMessage
        this.postToBridge({
          source: 'xokj-userscript',
          channelId: this.channelId,
          type: 'CDP_RPC_REQUEST',
          id: reqId,
          method: method.trim(),
          params: params || {}
        });
      }
    });
  }

  /**
   * Compatibility alias on CdpClient: delegates to send().
   */
  public GM_cdp = (method: string, params?: Record<string, unknown>): Promise<any> => {
    return this.send(method, params);
  };

  /**
   * Registers a callback for CDP events. Returns an unsubscribe function.
   */
  public on<T = unknown>(event: string, handler: (params: T) => void): () => void {
    if (!event || typeof handler !== 'function') {
      return () => {};
    }

    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }

    this.eventListeners.get(event)!.add(handler as (params: any) => void);

    return () => {
      this.off(event, handler);
    };
  }

  /**
   * Unregisters an event callback.
   */
  public off<T = unknown>(event: string, handler: (params: T) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(handler as (params: any) => void);
      if (listeners.size === 0) {
        this.eventListeners.delete(event);
      }
    }
  }

  /**
   * Queries whether the current tab's debugger session is actively attached.
   */
  public async isAttached(): Promise<boolean> {
    const status = await this.getStatus();
    return status === 'ATTACHED';
  }

  /**
   * Queries the current debugger connection status for the tab.
   */
  public async getStatus(): Promise<CdpClientStatus> {
    if (this.transport?.getStatus) {
      try {
        const status = await this.transport.getStatus();
        if (status === 'ATTACHED' || status === 'CONFLICT' || status === 'DETACHED' || status === 'IDLE') {
          this.currentStatus = status;
          return status;
        }
      } catch {
        // Fallback to internal state
      }
    }
    return this.currentStatus;
  }

  /**
   * Dispatches incoming event to all matching subscribers.
   */
  private dispatchEvent(method: string, params: unknown): void {
    const listeners = this.eventListeners.get(method);
    if (!listeners || listeners.size === 0) return;

    for (const handler of Array.from(listeners)) {
      try {
        handler(params);
      } catch (err) {
        console.error(`[XOKJ CDP SDK] Uncaught exception in event listener for '${method}':`, err);
      }
    }
  }

  /**
   * Handles tab debugger status changes, rejecting inflight requests on conflict.
   */
  public handleLifecycleChange(status: DebuggerSessionStatus | CdpClientStatus, reason?: string): void {
    const normalizedStatus: CdpClientStatus =
      status === 'CONFLICT'
        ? 'CONFLICT'
        : status === 'ATTACHED'
        ? 'ATTACHED'
        : status === 'DETACHED'
        ? 'DETACHED'
        : 'IDLE';

    this.currentStatus = normalizedStatus;
    this.conflictReason = status === 'CONFLICT' ? (reason || 'canceled_by_user') : undefined;

    if (normalizedStatus === 'CONFLICT') {
      const conflictError = new DevToolsConflictError(
        this.tabId,
        this.conflictReason || 'canceled_by_user',
        'DevTools conflict: native developer tools opened on tab'
      );

      for (const [id, entry] of this.pendingRequests.entries()) {
        clearTimeout(entry.timer);
        entry.reject(conflictError);
      }
      this.pendingRequests.clear();
    } else if (normalizedStatus === 'DETACHED') {
      const detachError = new Error(`CDP session detached: ${reason || 'unknown'}`);
      for (const [id, entry] of this.pendingRequests.entries()) {
        clearTimeout(entry.timer);
        entry.reject(detachError);
      }
      this.pendingRequests.clear();
    }
  }

  /**
   * Helper to dispatch window.postMessage to ContentScriptBridge.
   */
  private postToBridge(message: any): void {
    if (typeof window !== 'undefined' && typeof window.postMessage === 'function') {
      try {
        const origin = window.location && window.location.origin && window.location.origin !== 'null'
          ? window.location.origin
          : '*';
        window.postMessage(message, origin);
      } catch {
        window.postMessage(message, '*');
      }
    }
  }
}

// Aliases for compatibility
export const CdpClientSdk = CdpClient;
export type CdpClientSdk = CdpClient;

/**
 * Creates an instance of CdpClient.
 */
export function createCdpClient(options: CdpClientOptions = {}): CdpClient {
  return new CdpClient(options);
}

/**
 * Creates a Greasemonkey-compatible GM_cdp callable function.
 */
export function createGmCdp(cdp: CdpClient) {
  const gmCdp = function(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return cdp.send(method, params);
  };

  gmCdp.send = cdp.send.bind(cdp);
  gmCdp.on = cdp.on.bind(cdp);
  gmCdp.off = cdp.off.bind(cdp);
  gmCdp.isAttached = cdp.isAttached.bind(cdp);
  gmCdp.getStatus = cdp.getStatus.bind(cdp);

  return gmCdp;
}

/**
 * Partitioned in-memory storage for userscripts, strictly isolating userscript state
 * from webpage localStorage and other scripts.
 */
const isolatedScriptStorage = new Map<string, Map<string, string>>();

/**
 * Clears isolated GM storage for a specific scriptId or all scripts.
 */
export function clearIsolatedGmStorage(scriptId?: string): void {
  if (scriptId) {
    const store = isolatedScriptStorage.get(scriptId);
    if (store) {
      store.clear();
    }
    isolatedScriptStorage.delete(scriptId);
  } else {
    for (const store of isolatedScriptStorage.values()) {
      store.clear();
    }
    isolatedScriptStorage.clear();
  }
}

/**
 * Returns the isolated in-memory key-value store for a specific scriptId.
 */
export function getIsolatedScriptStore(scriptId: string): Map<string, string> {
  let store = isolatedScriptStorage.get(scriptId);
  if (!store) {
    store = new Map<string, string>();
    isolatedScriptStorage.set(scriptId, store);
  }
  return store;
}

// Automatically clear isolated storage on page navigation/unload
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => {
    clearIsolatedGmStorage();
  });
}

/**
 * Constructs standard GM_* helper APIs for a given script or scriptId.
 * Supports:
 * - createGmApi(script: ScriptRecord, cdp?: CdpClient, explicitGrants?: string[])
 * - createGmApi(scriptId: string, grants?: string[] | null, channelId?: string)
 */
export function createGmApi(
  script: ScriptRecord,
  cdp?: CdpClient,
  explicitGrants?: string[]
): Record<string, unknown>;
export function createGmApi(
  scriptId: string,
  grants?: string[] | null,
  channelId?: string
): Record<string, unknown>;
export function createGmApi(
  scriptOrId: ScriptRecord | string,
  cdpOrGrants?: CdpClient | string[] | null,
  channelIdOrGrants?: string | string[]
): Record<string, unknown> {
  let scriptId: string;
  let scriptName = 'userscript';
  let scriptVersion = '1.0.0';
  let scriptDescription = '';
  let scriptMatches: string[] = [];
  let grants: string[] | undefined | null;
  let cdp: CdpClient | undefined;
  let channelId: string | undefined;
  let isScriptRecord = false;

  if (typeof scriptOrId === 'string') {
    scriptId = scriptOrId || 'script';
    scriptName = scriptOrId || 'userscript';

    if (Array.isArray(cdpOrGrants)) {
      grants = cdpOrGrants;
      channelId = typeof channelIdOrGrants === 'string' ? channelIdOrGrants : undefined;
    } else if (cdpOrGrants === null || cdpOrGrants === undefined) {
      grants = cdpOrGrants;
      channelId = typeof channelIdOrGrants === 'string' ? channelIdOrGrants : undefined;
    } else if (typeof cdpOrGrants === 'object' && 'send' in cdpOrGrants) {
      cdp = cdpOrGrants as CdpClient;
      grants = Array.isArray(channelIdOrGrants) ? channelIdOrGrants : undefined;
    }
  } else {
    isScriptRecord = true;
    const script = scriptOrId;
    scriptId = script.id || 'script';
    scriptName = script.name || 'userscript';
    scriptVersion = script.metadata?.version || '1.0.0';
    scriptDescription = script.metadata?.description || '';
    scriptMatches = script.metadata?.matches || [];

    if (cdpOrGrants && typeof cdpOrGrants === 'object' && 'send' in cdpOrGrants) {
      cdp = cdpOrGrants as CdpClient;
    }

    if (Array.isArray(channelIdOrGrants)) {
      grants = channelIdOrGrants;
    } else if (typeof channelIdOrGrants === 'string') {
      channelId = channelIdOrGrants;
      grants = script.metadata?.grants;
    } else {
      grants = script.metadata?.grants;
    }
  }

  const isGrantNone = Array.isArray(grants) && grants.includes('none');

  let instantiateAll = false;
  if (isScriptRecord && (grants === undefined || grants === null)) {
    // Legacy ScriptRecord without grants array specified in metadata (test fixtures)
    instantiateAll = true;
  } else if (Array.isArray(grants) && grants.includes('*')) {
    instantiateAll = true;
  }

  const shouldInstantiate = (grantKey: string): boolean => {
    if (isGrantNone) return false;
    if (instantiateAll) return true;
    return Array.isArray(grants) && grants.includes(grantKey);
  };

  const GM_info = {
    script: {
      name: scriptName,
      version: scriptVersion,
      description: scriptDescription,
      matches: scriptMatches
    },
    scriptHandler: 'XOKJ',
    version: '0.1.0'
  };

  const api: Record<string, unknown> = {
    GM_info
  };

  if (shouldInstantiate('GM_setValue')) {
    api['GM_setValue'] = (key: string, value: unknown): void => {
      getIsolatedScriptStore(scriptId).set(key, JSON.stringify(value));
    };
  }

  if (shouldInstantiate('GM_getValue')) {
    api['GM_getValue'] = (key: string, defaultValue?: unknown): unknown => {
      const raw = getIsolatedScriptStore(scriptId).get(key);
      if (raw === null || raw === undefined) {
        return defaultValue;
      }
      try {
        return JSON.parse(raw);
      } catch {
        return defaultValue;
      }
    };
  }

  if (shouldInstantiate('GM_deleteValue')) {
    api['GM_deleteValue'] = (key: string): void => {
      getIsolatedScriptStore(scriptId).delete(key);
    };
  }

  if (shouldInstantiate('GM_listValues')) {
    api['GM_listValues'] = (): string[] => {
      return Array.from(getIsolatedScriptStore(scriptId).keys());
    };
  }

  if (shouldInstantiate('GM_addStyle')) {
    api['GM_addStyle'] = (css: string): HTMLStyleElement => {
      const style = document.createElement('style');
      style.setAttribute('type', 'text/css');
      style.setAttribute('data-xokj-script', scriptId);
      style.textContent = css;

      const target = document.head || document.documentElement || document.body;
      if (target) {
        target.appendChild(style);
      } else {
        document.addEventListener(
          'DOMContentLoaded',
          () => {
            (document.head || document.documentElement || document.body)?.appendChild(style);
          },
          { once: true }
        );
      }
      return style;
    };
  }

  if (shouldInstantiate('GM_log')) {
    api['GM_log'] = (...args: unknown[]): void => {
      console.log(`[XOKJ: ${scriptName}]`, ...args);
    };
  }

  // Populate CDP capabilities if explicitly requested or wildcard
  const needsCdp =
    shouldInstantiate('GM_cdp') ||
    shouldInstantiate('cdp') ||
    (cdp && instantiateAll);

  if (needsCdp) {
    const client = cdp || (channelId ? new CdpClient({ channelId }) : new CdpClient());
    api['GM_cdp'] = createGmCdp(client);
    api['cdp'] = client;
  }

  return api;
}
