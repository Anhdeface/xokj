/**
 * XOKJ - Content Script Bridge Types & Interfaces
 */

import type {
  CdpRpcRequest,
  CdpRpcResponse,
  CdpRpcEventMessage,
  CdpRpcLifecycleMessage,
  CdpRpcError,
  DebuggerSessionStatus,
  CdpLifecycleStatus,
  GmStorageMessage,
  GmStorageResponse
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

export interface BridgeStatus {
  status: DebuggerSessionStatus;
  conflict: boolean;
  reason?: string;
}

export {
  DevToolsConflictError,
  type CdpRpcRequest,
  type CdpRpcResponse,
  type CdpRpcEventMessage,
  type CdpRpcLifecycleMessage,
  type CdpRpcError,
  type DebuggerSessionStatus,
  type CdpLifecycleStatus,
  type GmStorageMessage,
  type GmStorageResponse
};
