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

// 1. Initialize core debugger manager
export const debuggerMgr = new TabDebuggerManager();

// 2. Initialize CDP bridge server with debugger delegate
export const cdpBridge = new CdpBridgeServer({
  debuggerManager: debuggerMgr,
  autoAttach: true
});

// Complete single-owner detach architecture: route detach command rejection to bridge
debuggerMgr.setInflightTracker(cdpBridge);

// 3. Initialize DevTools conflict handler wired to bridge and debugger manager
export const conflictHandler = new DevToolsConflictHandler(cdpBridge, debuggerMgr);

// 4. Initialize script injector wired to debugger manager
export const scriptInjector = new ScriptInjector({
  debuggerManager: debuggerMgr,
  autoStart: true
});

// 5. Initialize UI IPC server wired to debugger manager
export const uiIpcServer = new UiIpcServer(debuggerMgr);

// 6. Start all services
async function initSubsystems(): Promise<void> {
  try {
    await debuggerMgr.init();
    cdpBridge.init();
    conflictHandler.init();
    scriptInjector.init();
    uiIpcServer.init();
    console.log('[XOKJ Background] All CDP, conflict, injector, and UI-IPC subsystems successfully initialized');
  } catch (err) {
    console.error('[XOKJ Background] Failed to initialize subsystems:', err);
  }
}

initSubsystems();

export { TabDebuggerManager, CdpBridgeServer, DevToolsConflictHandler, ScriptInjector, UiIpcServer };
