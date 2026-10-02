/**
 * XOKJ - CDP RPC Request Router & Anti-Spoofing Validator
 */

import type { CdpRpcRequest, CdpRpcResponse } from '@/shared/types';
import { isRestrictedUrl } from '@/shared/match-pattern';

export interface ValidatedRpcRequest {
  error?: CdpRpcResponse;
  reqId: string;
  senderTabId?: number;
}

/**
 * Validates message structure, sender context, and anti-spoofing security rules.
 */
export function validateRpcRequest(
  request: CdpRpcRequest,
  sender: chrome.runtime.MessageSender
): ValidatedRpcRequest {
  const reqId = request.id || `rpc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const senderTabId = sender.tab?.id;
  if (senderTabId === undefined || senderTabId === null) {
    return {
      reqId,
      error: {
        type: 'CDP_RPC_RESPONSE',
        id: reqId,
        success: false,
        error: {
          code: 403,
          message: 'Security error: Message sender has no associated tab context'
        }
      }
    };
  }

  if (request.tabId !== undefined && request.tabId !== senderTabId) {
    return {
      reqId,
      senderTabId,
      error: {
        type: 'CDP_RPC_RESPONSE',
        id: reqId,
        success: false,
        error: {
          code: 403,
          message: `Security violation: Cross-tab CDP access denied. Claimed tab ${request.tabId}, but sender is tab ${senderTabId}`
        }
      }
    };
  }

  if (!request.method || typeof request.method !== 'string' || request.method.trim() === '') {
    return {
      reqId,
      senderTabId,
      error: {
        type: 'CDP_RPC_RESPONSE',
        id: reqId,
        success: false,
        error: {
          code: -32600,
          message: 'Invalid Request: method must be a non-empty string'
        }
      }
    };
  }

  const tabUrl = sender.tab?.url;
  if (tabUrl && isRestrictedUrl(tabUrl)) {
    return {
      reqId,
      senderTabId,
      error: {
        type: 'CDP_RPC_RESPONSE',
        id: reqId,
        success: false,
        error: {
          code: 403,
          message: `Security violation: CDP operations are restricted on system page: ${tabUrl}`
        }
      }
    };
  }

  return { reqId, senderTabId };
}

/**
 * Formats internal unhandled exceptions into structured CdpRpcResponse.
 */
export function formatInternalErrorResponse(id: string | undefined, err: any): CdpRpcResponse {
  return {
    type: 'CDP_RPC_RESPONSE',
    id: id || 'unknown',
    success: false,
    error: {
      code: -32603,
      message: err?.message || 'Internal CDP bridge error',
      data: err?.stack
    }
  };
}

/**
 * Classifies an error thrown from chrome.debugger.sendCommand or attach.
 */
export function classifyCdpCommandError(err: any): { isConflict: boolean; code: number; message: string } {
  const errMsg = err?.message || String(err);
  const isConflict =
    err?.name === 'DevToolsConflictError' ||
    /Another debugger is already attached|DevTools|attached to the tab|canceled_by_user/i.test(errMsg);

  const code = isConflict ? 1001 : (err?.code ?? -32000);
  const message = isConflict
    ? 'DevTools conflict: native developer tools opened on tab'
    : (err?.message || 'CDP command failed');

  return { isConflict, code, message };
}
