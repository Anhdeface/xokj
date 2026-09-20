/**
 * XOKJ Background Service Worker Entry Point
 * Wires together TabDebuggerManager, CdpBridgeServer, and DevToolsConflictHandler.
 */

import { TabDebuggerManager } from './debugger-mgr';
import { CdpBridgeServer } from './cdp-bridge';
import { DevToolsConflictHandler } from './conflict-mgr';

console.log('[XOKJ Background] Initializing service worker subsystems...');

// 1. Initialize core debugger manager
export const debuggerMgr = new TabDebuggerManager();

// 2. Initialize CDP bridge server with debugger delegate
export const cdpBridge = new CdpBridgeServer({
  debuggerManager: debuggerMgr,
  autoAttach: true
});

// 3. Initialize DevTools conflict handler wired to bridge and debugger manager
export const conflictHandler = new DevToolsConflictHandler(cdpBridge, debuggerMgr);

// 4. Start all services
async function initSubsystems(): Promise<void> {
  try {
    await debuggerMgr.init();
    cdpBridge.init();
    conflictHandler.init();
    console.log('[XOKJ Background] All CDP and conflict subsystems successfully initialized');
  } catch (err) {
    console.error('[XOKJ Background] Failed to initialize subsystems:', err);
  }
}

initSubsystems();

export { TabDebuggerManager, CdpBridgeServer, DevToolsConflictHandler };
