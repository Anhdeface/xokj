/**
 * UI IPC Server for Background Service Worker
 * Handles extension UI runtime messages from Popup and Management Dashboard:
 * - GET_ACTIVE_SCRIPTS_FOR_TAB
 * - GET_CDP_STATUS
 * - TOGGLE_SCRIPT
 * - TOGGLE_GLOBAL
 * - GET_TAB_SESSION
 */

import type { TabDebuggerManager } from './debugger-mgr';
import { getAllScripts, toggleScript, saveSettings } from '@/shared/storage';
import type {
  GetActiveScriptsResponse,
  GetCdpStatusResponse,
  ToggleScriptResponse,
  ToggleGlobalResponse,
  GetTabSessionResponse
} from '@/shared/types';

export class UiIpcServer {
  private debuggerMgr: TabDebuggerManager;
  private isListening = false;
  private handleMessageBound = this.handleMessage.bind(this);

  constructor(debuggerMgr: TabDebuggerManager) {
    this.debuggerMgr = debuggerMgr;
  }

  public init(): void {
    if (this.isListening) return;
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(this.handleMessageBound);
    }
    this.isListening = true;
  }

  public destroy(): void {
    if (!this.isListening) return;
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(this.handleMessageBound);
    }
    this.isListening = false;
  }

  public handleMessage(
    message: any,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: any) => void
  ): boolean | void {
    if (!message || typeof message !== 'object') return;

    switch (message.type) {
      case 'GET_ACTIVE_SCRIPTS_FOR_TAB': {
        const tabId = message.tabId;
        const url = message.url;

        (async () => {
          try {
            const scripts = await getAllScripts({ url });
            let session = typeof tabId === 'number' ? this.debuggerMgr.getSession(tabId) : undefined;
            if (!session && typeof tabId === 'number' && typeof chrome !== 'undefined' && chrome.storage?.local) {
              const stored = await chrome.storage.local.get('tab_sessions');
              session = stored.tab_sessions?.[tabId];
            }
            const response: GetActiveScriptsResponse = {
              scripts,
              cdpStatus: session?.status ?? 'IDLE',
              conflictReason: session?.conflictReason
            };
            sendResponse(response);
          } catch (err: any) {
            sendResponse({
              scripts: [],
              cdpStatus: 'IDLE',
              conflictReason: err?.message || String(err)
            });
          }
        })();
        return true; // Keep channel open for async response
      }

      case 'GET_CDP_STATUS': {
        const tabId = message.tabId;
        let session = typeof tabId === 'number' ? this.debuggerMgr.getSession(tabId) : undefined;
        if (!session && typeof tabId === 'number' && typeof chrome !== 'undefined' && chrome.storage?.local) {
          (async () => {
            const stored = await chrome.storage.local.get('tab_sessions');
            const s = stored.tab_sessions?.[tabId];
            sendResponse({
              status: s?.status ?? 'IDLE',
              reason: s?.conflictReason
            });
          })();
          return true;
        }
        const response: GetCdpStatusResponse = {
          status: session?.status ?? 'IDLE',
          reason: session?.conflictReason
        };
        sendResponse(response);
        return false;
      }

      case 'TOGGLE_SCRIPT': {
        const { scriptId, enabled } = message;
        (async () => {
          try {
            const newStatus = await toggleScript(scriptId, enabled);
            const response: ToggleScriptResponse = { success: true, enabled: newStatus };
            sendResponse(response);
          } catch (err: any) {
            sendResponse({ success: false, error: err?.message || String(err) });
          }
        })();
        return true;
      }

      case 'TOGGLE_GLOBAL': {
        const { enabled } = message;
        (async () => {
          try {
            const updated = await saveSettings({ globalEnabled: enabled });
            const response: ToggleGlobalResponse = { success: true, enabled: updated.globalEnabled };
            sendResponse(response);
          } catch (err: any) {
            sendResponse({ success: false, error: err?.message || String(err) });
          }
        })();
        return true;
      }

      case 'GET_TAB_SESSION': {
        const tabId = message.tabId;
        const session = typeof tabId === 'number' ? this.debuggerMgr.getSession(tabId) : undefined;
        const response: GetTabSessionResponse = { session };
        sendResponse(response);
        return false;
      }

      default:
        // Allow other background listeners (cdp-bridge, conflict-mgr) to handle other messages
        return undefined;
    }
  }
}
