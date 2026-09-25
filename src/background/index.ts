/**
 * XOKJ Background Service Worker Entry Point
 * Wires together TabDebuggerManager, CdpBridgeServer, DevToolsConflictHandler, and ScriptInjector.
 */

import { TabDebuggerManager } from './debugger-mgr';
import { CdpBridgeServer } from './cdp-bridge';
import { DevToolsConflictHandler } from './conflict-mgr';
import { ScriptInjector } from './injector';
import { UiIpcServer } from './ui-ipc';

console.log('[XOKJ Background] Initializing service worker subsystems...');

export const debuggerMgr = new TabDebuggerManager();

export const cdpBridge = new CdpBridgeServer({
  debuggerManager: debuggerMgr,
  autoAttach: true
});

// Route detach command rejection to bridge (single-owner detach architecture)
debuggerMgr.setInflightTracker(cdpBridge);

export const conflictHandler = new DevToolsConflictHandler(cdpBridge, debuggerMgr);

export const scriptInjector = new ScriptInjector({
  debuggerManager: debuggerMgr,
  autoStart: true
});

export const uiIpcServer = new UiIpcServer(debuggerMgr);

// Start all services synchronously to guarantee MV3 listener registration in the initial turn
function initSubsystems(): void {
  try {
    cdpBridge.init();
    conflictHandler.init();
    scriptInjector.init();
    uiIpcServer.init();
    debuggerMgr.init().catch((err) => {
      console.error('[XOKJ Background] debuggerMgr.init failed:', err);
    });
    console.log('[XOKJ Background] All subsystems initialized');
  } catch (err) {
    console.error('[XOKJ Background] Failed to initialize subsystems:', err);
  }
}

initSubsystems();

export { TabDebuggerManager, CdpBridgeServer, DevToolsConflictHandler, ScriptInjector, UiIpcServer };
