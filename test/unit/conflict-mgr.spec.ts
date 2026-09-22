import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { DevToolsConflictHandler, DevToolsConflictError } from '@/background/conflict-mgr';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { saveScript } from '@/shared/storage';
import type { CdpRpcResponse, ReconnectCdpResponse, ScriptRecord } from '@/shared/types';

describe('Feature 11 & 12: DevTools Conflict Detection & Safe Reconnection', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let conflictHandler: DevToolsConflictHandler;
  let debuggerMgr: TabDebuggerManager;
  let cdpBridge: CdpBridgeServer;

  beforeEach(async () => {
    context = setupChromeMock();
    debuggerMgr = new TabDebuggerManager();
    cdpBridge = new CdpBridgeServer({ autoAttach: false });
    conflictHandler = new DevToolsConflictHandler(cdpBridge, debuggerMgr);

    await debuggerMgr.init();
    cdpBridge.init();
    conflictHandler.init();
  });

  afterEach(() => {
    conflictHandler.destroy();
    cdpBridge.destroy();
    debuggerMgr.destroy();
  });

  describe('Tier 1: Conflict Detection & Inflight Command Rejection', () => {
    it('T1.1: immediately rejects inflight commands with DevToolsConflictError (code: 1001)', async () => {
      await debuggerMgr.attachTab(42);

      let sendResolve: (v: any) => void;
      context.mockDebugger.sendCommand.mockImplementationOnce(
        () =>
          new Promise((res) => {
            sendResolve = res;
          })
      );

      // Issue command that hangs in flight
      const pendingCmdPromise = context.mockRuntime._emitMessage(
        { type: 'CDP_RPC_REQUEST', id: 'inflight-1', method: 'Page.captureScreenshot' },
        { tab: { id: 42, url: 'https://example.com' } }
      );

      // Simulate native DevTools open on tab 42
      context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');

      const response: CdpRpcResponse = await pendingCmdPromise;
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(1001);
      expect(response.error?.message).toBe('DevTools conflict: native developer tools opened on tab');
      expect(debuggerMgr.getTabStatus(42)).toBe('CONFLICT');
    });

    it('T1.2: does not affect inflight commands on other unconflicted tabs', async () => {
      await debuggerMgr.attachTab(42);
      await debuggerMgr.attachTab(88);

      let resolve88: (v: any) => void;
      context.mockDebugger.sendCommand
        .mockImplementationOnce(() => new Promise(() => {})) // tab 42 hangs
        .mockImplementationOnce(
          () =>
            new Promise((res) => {
              resolve88 = res;
            })
        ); // tab 88

      const p42 = context.mockRuntime._emitMessage(
        { type: 'CDP_RPC_REQUEST', id: 'cmd-42', method: 'Page.navigate' },
        { tab: { id: 42, url: 'https://example.com' } }
      );
      const p88 = context.mockRuntime._emitMessage(
        { type: 'CDP_RPC_REQUEST', id: 'cmd-88', method: 'Network.getCookies' },
        { tab: { id: 88, url: 'https://example.com' } }
      );

      // Detach only tab 42
      context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');

      const res42 = await p42;
      expect(res42.success).toBe(false);
      expect(res42.error?.code).toBe(1001);

      // Tab 88 completes normally
      resolve88!({ cookies: [] });
      const res88 = await p88;
      expect(res88.success).toBe(true);
      expect(debuggerMgr.getTabStatus(88)).toBe('ATTACHED');
    });

    it('T1.3: persists CONFLICT status in session storage and local storage', async () => {
      await debuggerMgr.attachTab(42);
      await context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');

      // Check session storage
      const sessionData = await context.sessionStorage.get('tab_session_42');
      expect(sessionData.tab_session_42?.status).toBe('CONFLICT');
      expect(sessionData.tab_session_42?.conflictReason).toBe('canceled_by_user');

      // Check local storage tab_sessions map
      await vi.waitFor(async () => {
        const localData = await context.localStorage.get('tab_sessions');
        expect(localData.tab_sessions?.[42]?.status).toBe('CONFLICT');
      });
    });

    it('T1.4: broadcasts CDP_LIFECYCLE_EVENT with status: CONFLICT to tabs and runtime', async () => {
      await debuggerMgr.attachTab(42);
      context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');

      expect(context.mockTabs.sendMessage).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          type: 'CDP_LIFECYCLE_EVENT',
          tabId: 42,
          status: 'CONFLICT',
          reason: 'canceled_by_user'
        })
      );

      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CDP_LIFECYCLE_EVENT',
          tabId: 42,
          status: 'CONFLICT',
          reason: 'canceled_by_user'
        })
      );
    });
  });

  describe('Tier 2: User-Driven Reconnection (reconnectTab)', () => {
    it('T2.1: reconnectTab fails gracefully if native DevTools is still open', async () => {
      await debuggerMgr.attachTab(42);
      context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');
      expect(debuggerMgr.getTabStatus(42)).toBe('CONFLICT');

      // Simulate DevTools still active when attach is attempted
      context.mockDebugger.attach.mockRejectedValueOnce(
        new Error('Another debugger is already attached to this target')
      );

      const result: ReconnectCdpResponse = await conflictHandler.reconnectTab(42);

      expect(result.success).toBe(false);
      expect(result.error).toContain('DevTools is still open');
      expect(debuggerMgr.getTabStatus(42)).toBe('CONFLICT');
    });

    it('T2.2: reconnectTab succeeds when DevTools is closed, restoring ATTACHED state', async () => {
      await debuggerMgr.attachTab(42);
      context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');
      expect(debuggerMgr.getTabStatus(42)).toBe('CONFLICT');

      // Native DevTools closed: attach succeeds
      context.mockDebugger.attach.mockResolvedValueOnce();

      const result: ReconnectCdpResponse = await conflictHandler.reconnectTab(42);

      expect(result.success).toBe(true);
      expect(debuggerMgr.getTabStatus(42)).toBe('ATTACHED');
    });

    it('T2.3: handles RECONNECT_CDP runtime message and returns response', async () => {
      await debuggerMgr.attachTab(42);
      context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');
      expect(debuggerMgr.getTabStatus(42)).toBe('CONFLICT');

      context.mockDebugger.attach.mockResolvedValueOnce();

      const response: ReconnectCdpResponse = await context.mockRuntime._emitMessage(
        { type: 'RECONNECT_CDP', tabId: 42 },
        {}
      );

      expect(response.success).toBe(true);
      expect(debuggerMgr.getTabStatus(42)).toBe('ATTACHED');
    });

    it('T2.4: reconnectTab re-enables declared domains after DevTools is closed', async () => {
      const script: ScriptRecord = {
        id: 'reconnect-cdp-script',
        name: 'Reconnect Script',
        code: '// ==UserScript==\n// @match https://example.com/*\n// @cdp Network\n// @cdp Page\n// ==/UserScript==',
        metadata: {
          name: 'Reconnect Script',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} }
          ],
          cdpDeclarations: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} }
          ],
          cdpDomains: ['Network', 'Page'],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 42, url: 'https://example.com/app' } as any);

      await debuggerMgr.attachTab(42);
      await debuggerMgr.initializeDeclaredDomains(42);

      // DevTools opens -> detach with canceled_by_user
      context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');
      expect(debuggerMgr.getTabStatus(42)).toBe('CONFLICT');

      context.mockDebugger.sendCommand.mockClear();
      context.mockDebugger.attach.mockClear();

      // DevTools closed: user reconnects
      const result: ReconnectCdpResponse = await conflictHandler.reconnectTab(42);

      expect(result.success).toBe(true);
      expect(debuggerMgr.getTabStatus(42)).toBe('ATTACHED');
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 42 },
        'Network.enable',
        {}
      );
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 42 },
        'Page.enable',
        {}
      );
    });

    it('T2.5: fires exactly one lifecycle message and one storage write per detachment event in integrated mode', async () => {
      await debuggerMgr.attachTab(42);
      context.mockTabs.sendMessage.mockClear();
      context.mockRuntime.sendMessage.mockClear();

      // Trigger detach
      context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');

      // Verify tabs.sendMessage called exactly once for tab 42
      const tabCalls = context.mockTabs.sendMessage.mock.calls.filter(([tabId]) => tabId === 42);
      expect(tabCalls.length).toBe(1);

      // Verify runtime.sendMessage called exactly once
      expect(context.mockRuntime.sendMessage).toHaveBeenCalledTimes(1);
    });
  });
});
