/**
 * XOKJ - CDP Subsystem Types & Interface Contracts
 */

import type { CdpRpcResponse, DebuggerSessionStatus, ScriptRecord } from '@/shared/types';

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

/**
 * Interface contract for TabDebuggerManager integration.
 */
export interface IDebuggerManager {
  isAttached(tabId: number): boolean;
  attach?(tabId: number, version?: string, force?: boolean): Promise<boolean>;
  attachTab?(
    tabId: number,
    urlOrVersionOrForce?: string | boolean | any,
    forceOrProtocol?: boolean | string,
    protocolVersion?: string
  ): Promise<any>;
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
  /** When true, requires scriptId on all requests from tabs */
  enforcePermissions?: boolean;
  /** Custom script lookup override */
  scriptResolver?: (scriptId: string) => Promise<ScriptRecord | null>;
}
