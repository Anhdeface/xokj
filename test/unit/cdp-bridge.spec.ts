import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import type { CdpRpcRequest, CdpRpcResponse, ScriptRecord } from '@/shared/types';
import { saveScript } from '@/shared/storage';

describe('Feature 9 & 10: Asynchronous CDP RPC Bridge & Event Dispatcher', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let server: CdpBridgeServer;

  beforeEach(() => {
    context = setupChromeMock();
    server = new CdpBridgeServer({ autoAttach: false });
    server.init();
  });

  afterEach(() => {
    server.destroy();
  });

  describe('Tier 1: Request Validation & Tab Security Enforcement', () => {
    it('T1.1: routes valid CDP_RPC_REQUEST to chrome.debugger.sendCommand and returns result', async () => {
      context.mockDebugger.sendCommand.mockResolvedValueOnce({
        cookies: [{ name: 'auth_token', value: 'xyz123' }]
      });

      const request: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'req-001',
        method: 'Network.getCookies',
        params: { urls: ['https://example.com'] }
      };

      const response: CdpRpcResponse = await context.mockRuntime._emitMessage(
        request,
        { tab: { id: 42, url: 'https://example.com' } }
      );

      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 42 },
        'Network.getCookies',
        { urls: ['https://example.com'] }
      );
      expect(response).toEqual({
        type: 'CDP_RPC_RESPONSE',
        id: 'req-001',
        success: true,
        result: { cookies: [{ name: 'auth_token', value: 'xyz123' }] }
      });
    });

    it('T1.2: prevents tabId spoofing: rejects message if claimed tabId != sender.tab.id with code 403', async () => {
      const spoofedRequest: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'spoof-001',
        tabId: 999,
        method: 'Page.navigate',
        params: { url: 'https://attacker.com' }
      };

      const response: CdpRpcResponse = await context.mockRuntime._emitMessage(
        spoofedRequest,
        { tab: { id: 42, url: 'https://example.com' } }
      );

      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalledWith(
        { tabId: 999 },
        expect.anything(),
        expect.anything()
      );
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(403);
      expect(response.error?.message).toMatch(/cross-tab|security/i);
    });

    it('T1.3: rejects requests with no sender tab context', async () => {
      const request: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'no-tab-001',
        method: 'Network.enable'
      };

      const response: CdpRpcResponse = await context.mockRuntime._emitMessage(request, {});

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(403);
      expect(response.error?.message).toMatch(/tab/i);
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
    });

    it('T1.4: safely handles malformed requests (missing id or method)', async () => {
      const malformed: any = { type: 'CDP_RPC_REQUEST' };
      const response: CdpRpcResponse = await context.mockRuntime._emitMessage(
        malformed,
        { tab: { id: 42, url: 'https://example.com' } }
      );

      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
    });

    it('T1.5: ignores non-CDP message types', async () => {
      const ignored = await context.mockRuntime._emitMessage(
        { type: 'UNKNOWN_TYPE_ACTION' },
        { tab: { id: 42, url: 'https://example.com' } }
      );
      expect(ignored).toBeUndefined();
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
    });

    it('T1.6: rejects requests from restricted system URLs', async () => {
      const request: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'req-restricted',
        method: 'Network.enable'
      };

      const response: CdpRpcResponse = await context.mockRuntime._emitMessage(
        request,
        { tab: { id: 42, url: 'chrome://settings' } }
      );

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(403);
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
    });
  });

  describe('Tier 2: Response Mapping & Error Boundaries', () => {
    it('T2.1: returns structured error when chrome.debugger.sendCommand rejects', async () => {
      context.mockDebugger.sendCommand.mockRejectedValueOnce(
        new Error('Cannot find execution context')
      );

      const request: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'err-001',
        method: 'Runtime.evaluate',
        params: { expression: 'alert(1)' }
      };

      const response: CdpRpcResponse = await context.mockRuntime._emitMessage(
        request,
        { tab: { id: 42, url: 'https://example.com' } }
      );

      expect(response.success).toBe(false);
      expect(response.id).toBe('err-001');
      expect(response.error?.message).toContain('Cannot find execution context');
    });

    it('T2.2: tracks concurrent inflight requests independently', async () => {
      let resolveCmd1: (v: any) => void;
      let resolveCmd2: (v: any) => void;

      context.mockDebugger.sendCommand
        .mockImplementationOnce(() => new Promise((res) => { resolveCmd1 = res; }))
        .mockImplementationOnce(() => new Promise((res) => { resolveCmd2 = res; }));

      const p1 = context.mockRuntime._emitMessage(
        { type: 'CDP_RPC_REQUEST', id: 'req-1', method: 'Page.enable' },
        { tab: { id: 42, url: 'https://example.com' } }
      );
      const p2 = context.mockRuntime._emitMessage(
        { type: 'CDP_RPC_REQUEST', id: 'req-2', method: 'Network.enable' },
        { tab: { id: 42, url: 'https://example.com' } }
      );

      resolveCmd2!({ network: 'ok' });
      const res2 = await p2;
      expect(res2.id).toBe('req-2');
      expect(res2.result).toEqual({ network: 'ok' });

      resolveCmd1!({ page: 'ok' });
      const res1 = await p1;
      expect(res1.id).toBe('req-1');
      expect(res1.result).toEqual({ page: 'ok' });
    });

    it('T2.3: rejects with timeout if command exceeds timeout threshold', async () => {
      vi.useFakeTimers();

      context.mockDebugger.sendCommand.mockImplementationOnce(
        () => new Promise(() => {}) // never resolves
      );

      const promise = context.mockRuntime._emitMessage(
        { type: 'CDP_RPC_REQUEST', id: 'timeout-001', method: 'Network.getCookies' },
        { tab: { id: 42, url: 'https://example.com' } }
      );

      vi.advanceTimersByTime(31000); // Exceeds 30s timeout

      const response: CdpRpcResponse = await promise;
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(-32000);
      expect(response.error?.message).toMatch(/timed out/i);

      vi.useRealTimers();
    });

    it('T2.4: (ADV-4.8) rejects with code 1001 when autoAttach encounters native DevTools conflict', async () => {
      server.destroy();
      const autoServer = new CdpBridgeServer({ autoAttach: true });
      autoServer.init();

      context.mockDebugger.attach.mockRejectedValueOnce(
        new Error('Another debugger is already attached to the tab with id: 42')
      );

      const request: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'conflict-probe-48',
        method: 'Page.reload'
      };

      const response: CdpRpcResponse = await context.mockRuntime._emitMessage(
        request,
        { tab: { id: 42, url: 'https://example.com' } }
      );

      expect(response.success).toBe(false);
      expect(response.id).toBe('conflict-probe-48');
      expect(response.error?.code).toBe(1001);
      expect(response.error?.message).toMatch(/conflict|Another debugger/i);

      autoServer.destroy();
    });

    it('T2.5: (ADV-4.8 direct) executeCommand rejects with code 1001 on foreign debugger attach collision', async () => {
      const autoServer = new CdpBridgeServer({ autoAttach: true });
      context.mockDebugger.attach.mockRejectedValueOnce(
        new Error('Another debugger is already attached to the tab with id: 42')
      );

      const res = await autoServer.executeCommand(42, 'Page.reload', {}, 'probe_cmd');

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(1001);
      expect(res.error?.message).toMatch(/conflict|Another debugger/i);

      autoServer.destroy();
    });

    it('T2.6: (ADV-4.8 wired) executeCommand with TabDebuggerManager delegate propagates code 1001 and transitions manager to CONFLICT', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();
      const wiredServer = new CdpBridgeServer({ debuggerManager: manager, autoAttach: true });
      wiredServer.init();

      context.mockDebugger.attach.mockRejectedValueOnce(
        new Error('Another debugger is already attached to the tab with id: 42')
      );

      const res = await wiredServer.executeCommand(42, 'Page.reload', {}, 'probe_wired');

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(1001);
      expect(res.error?.message).toMatch(/conflict|Another debugger/i);
      expect(manager.getTabStatus(42)).toBe('CONFLICT');

      wiredServer.destroy();
      manager.destroy();
    });

    it('T2.7: commands sent while tab is in CONFLICT reject immediately with code 1001 without invoking sendCommand', async () => {
      server.destroy();
      const manager = new TabDebuggerManager();
      await manager.init();
      const wiredServer = new CdpBridgeServer({ debuggerManager: manager, autoAttach: true });
      wiredServer.init();

      manager.setTabStatus(42, 'CONFLICT', 'canceled_by_user');
      expect(manager.getTabStatus(42)).toBe('CONFLICT');

      const request: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'req-conflict-state',
        method: 'Runtime.evaluate',
        params: { expression: '1 + 1' }
      };

      const response: CdpRpcResponse = await context.mockRuntime._emitMessage(
        request,
        { tab: { id: 42, url: 'https://example.com' } }
      );

      expect(response.success).toBe(false);
      expect(response.id).toBe('req-conflict-state');
      expect(response.error?.code).toBe(1001);
      expect(response.error?.message).toMatch(/conflict|DevTools/i);
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();

      wiredServer.destroy();
      manager.destroy();
    });

    it('T2.8: executeCommand on a tab in CONFLICT state rejects immediately with code 1001', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();
      const wiredServer = new CdpBridgeServer({ debuggerManager: manager, autoAttach: true });
      wiredServer.init();

      manager.setTabStatus(42, 'CONFLICT', 'canceled_by_user');

      const res = await wiredServer.executeCommand(42, 'Page.navigate', { url: 'https://example.com' });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(1001);
      expect(res.error?.message).toMatch(/conflict/i);
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();

      wiredServer.destroy();
      manager.destroy();
    });

    it('T2.9: detachment with zero inflight requests cleanly removes tab from attachedTabs, tabRequests, and attachLocks', async () => {
      // 1. Setup attached state for tab 42 with zero in-flight requests
      (server as any).attachedTabs.add(42);
      (server as any).tabRequests.set(42, new Set());
      (server as any).attachLocks.set(42, Promise.resolve());

      expect(server.isTabAttached(42)).toBe(true);
      expect((server as any).tabRequests.get(42)?.size).toBe(0);

      // 2. Trigger detachment with zero requests in flight
      const rejectedCount = server.rejectPendingRequestsForTab(
        42,
        new Error('Debugger detached from tab: target_closed')
      );

      // 3. Assertions
      expect(rejectedCount).toBe(0);
      expect(server.isTabAttached(42)).toBe(false);
      expect((server as any).attachedTabs.has(42)).toBe(false);
      expect((server as any).tabRequests.has(42)).toBe(false);
      expect((server as any).attachLocks.has(42)).toBe(false);
    });

    it('T2.10: chrome.debugger.onDetach with zero inflight requests cleans up attachedTabs without leaks', async () => {
      (server as any).attachedTabs.add(77);
      expect(server.isTabAttached(77)).toBe(true);

      // Simulate chrome.debugger.onDetach event from browser
      context.mockDebugger._emitDetach({ tabId: 77 }, 'canceled_by_user');

      expect(server.isTabAttached(77)).toBe(false);
      expect((server as any).attachedTabs.has(77)).toBe(false);
      expect((server as any).tabRequests.has(77)).toBe(false);
      expect((server as any).attachLocks.has(77)).toBe(false);
    });

    it('T2.11: rejects pending requests with code 1002 and cleans up state on chrome.tabs.onRemoved', async () => {
      const standalone = new CdpBridgeServer({ autoAttach: false });
      standalone.init();
      standalone.markTabAttached(42);

      context.mockDebugger.sendCommand.mockImplementationOnce(() => new Promise(() => {})); // hangs

      const cmdPromise = standalone.executeCommand(42, 'Page.reload');

      // Tab 42 closed by user
      context.mockTabs._emitRemoved(42);

      const response = await cmdPromise;
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(1002);
      expect(response.error?.message).toContain('closed');
      expect(standalone.isTabAttached(42)).toBe(false);
      expect(standalone.getPendingRequestCount(42)).toBe(0);
      standalone.destroy();
    });

    it('T2.12: immediately rejects command when detachment occurs while ensureAttached is pending', async () => {
      const autoServer = new CdpBridgeServer({ autoAttach: true });
      autoServer.init();

      let resolveAttach: () => void;
      context.mockDebugger.attach.mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveAttach = resolve; })
      );

      const cmdPromise = autoServer.executeCommand(55, 'Runtime.evaluate', { expression: '1+1' });

      // Detachment occurs while attach is still in flight
      autoServer.rejectPendingRequestsForTab(55, {
        code: 1001,
        message: 'DevTools conflict: native developer tools opened on tab'
      });

      // Finish attach afterwards
      resolveAttach!();

      const response = await cmdPromise;
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(1001);
      expect(response.error?.message).toContain('DevTools conflict');
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
      autoServer.destroy();
    });
  });

  describe('Tier 3: CDP Event Multiplexing & Dispatch', () => {
    it('T3.1: intercepts chrome.debugger.onEvent and dispatches to specific tab', async () => {
      context.mockDebugger._emitEvent(
        { tabId: 42 },
        'Network.requestWillBeSent',
        { requestId: 'net-101', request: { url: 'https://example.com/api' } }
      );

      expect(context.mockTabs.sendMessage).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          type: 'CDP_RPC_EVENT',
          tabId: 42,
          method: 'Network.requestWillBeSent',
          params: expect.objectContaining({ requestId: 'net-101' })
        })
      );
    });

    it('T3.2: does not broadcast events across foreign tabs', async () => {
      context.mockDebugger._emitEvent({ tabId: 10 }, 'Page.loadEventFired', { timestamp: 1234 });

      expect(context.mockTabs.sendMessage).toHaveBeenCalledWith(10, expect.anything());
      expect(context.mockTabs.sendMessage).not.toHaveBeenCalledWith(42, expect.anything());
    });

    it('T3.3: suppresses errors when tab has no receiver or is closing', async () => {
      context.mockTabs.sendMessage.mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.')
      );

      expect(() => {
        context.mockDebugger._emitEvent({ tabId: 99 }, 'Network.dataReceived', {});
      }).not.toThrow();
    });
  });

  describe('Tier 4: Background Userscript Permission Validation (M4 / Feature 16)', () => {
    it('T4.1: allows CDP command for script with @grant GM_cdp on matching URL', async () => {
      const script: ScriptRecord = {
        id: 'script-cdp-all',
        name: 'Full CDP Script',
        code: '// code',
        metadata: {
          name: 'Full CDP Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
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

      context.mockDebugger.sendCommand.mockResolvedValueOnce({ cookies: [] });

      const res = await context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'perm-1',
          scriptId: 'script-cdp-all',
          method: 'Network.getCookies'
        },
        { tab: { id: 42, url: 'https://example.com/test' } }
      );

      expect(res.success).toBe(true);
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 42 }),
        'Network.getCookies',
        expect.anything()
      );
    });

    it('T4.2: allows command matching declared @cdp domain', async () => {
      const script: ScriptRecord = {
        id: 'script-net-only',
        name: 'Network Only Script',
        code: '// code',
        metadata: {
          name: 'Network Only Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: [],
          cdp: [],
          cdpDeclarations: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }],
          cdpDomains: ['Network'],
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

      context.mockDebugger.sendCommand.mockResolvedValueOnce({ enabled: true });

      const res = await context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'perm-2',
          scriptId: 'script-net-only',
          method: 'Network.enable'
        },
        { tab: { id: 42, url: 'https://example.com/test' } }
      );

      expect(res.success).toBe(true);
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({ tabId: 42 }),
        'Network.enable',
        expect.anything()
      );
    });

    it('T4.3: rejects command when method domain is not authorized for script', async () => {
      const script: ScriptRecord = {
        id: 'script-net-restricted',
        name: 'Net Restricted Script',
        code: '// code',
        metadata: {
          name: 'Net Restricted Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: ['Network'],
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

      const res = await context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'perm-3',
          scriptId: 'script-net-restricted',
          method: 'Page.navigate',
          params: { url: 'https://evil.com' }
        },
        { tab: { id: 42, url: 'https://example.com/test' } }
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(403);
      expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'DOMAIN_NOT_AUTHORIZED' }));
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
    });

    it('T4.4: rejects command when script declared @grant none', async () => {
      const script: ScriptRecord = {
        id: 'script-grant-none',
        name: 'Grant None Script',
        code: '// code',
        metadata: {
          name: 'Grant None Script',
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['none'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: ['Network'], // Conflicting directive ignored due to @grant none
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

      const res = await context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'perm-4',
          scriptId: 'script-grant-none',
          method: 'Network.enable'
        },
        { tab: { id: 42, url: 'https://example.com/test' } }
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(403);
      expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'GRANT_NONE' }));
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
    });

    it('T4.5: rejects command when script has no CDP permissions declared', async () => {
      const script: ScriptRecord = {
        id: 'script-no-cdp',
        name: 'No CDP Script',
        code: '// code',
        metadata: {
          name: 'No CDP Script',
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['GM_setValue', 'GM_getValue'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
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

      const res = await context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'perm-5',
          scriptId: 'script-no-cdp',
          method: 'Network.getCookies'
        },
        { tab: { id: 42, url: 'https://example.com/test' } }
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(403);
      expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'NO_CDP_PERMISSIONS' }));
    });

    it('T4.6: rejects command when scriptId is not found in registry', async () => {
      const res = await context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'perm-6',
          scriptId: 'ghost-script-404',
          method: 'Network.enable'
        },
        { tab: { id: 42, url: 'https://example.com/test' } }
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(403);
      expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'SCRIPT_NOT_FOUND' }));
    });

    it('T4.7: rejects command when script is disabled', async () => {
      const script: ScriptRecord = {
        id: 'script-disabled-test',
        name: 'Disabled Script',
        code: '// code',
        metadata: {
          name: 'Disabled Script',
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await saveScript(script);

      const res = await context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'perm-7',
          scriptId: 'script-disabled-test',
          method: 'Network.enable'
        },
        { tab: { id: 42, url: 'https://example.com/test' } }
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(403);
      expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'SCRIPT_DISABLED' }));
    });

    it('T4.8: rejects command when tab URL does not match script match patterns', async () => {
      const script: ScriptRecord = {
        id: 'script-bank-only',
        name: 'Bank Script',
        code: '// code',
        metadata: {
          name: 'Bank Script',
          matches: ['https://secure.bank.com/*'],
          matchPatterns: ['https://secure.bank.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
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

      const res = await context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'perm-8',
          scriptId: 'script-bank-only',
          method: 'Network.getCookies'
        },
        { tab: { id: 42, url: 'https://evil.org/phishing' } }
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(403);
      expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'URL_NOT_MATCHED' }));
    });

    it('T4.9: rejects command when tab URL matches script exclusion pattern', async () => {
      const script: ScriptRecord = {
        id: 'script-exclude-test',
        name: 'Exclude Script',
        code: '// code',
        metadata: {
          name: 'Exclude Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: ['*://example.com/admin/*'],
          runAt: 'document-end',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
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

      const res = await context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'perm-9',
          scriptId: 'script-exclude-test',
          method: 'Network.getCookies'
        },
        { tab: { id: 42, url: 'https://example.com/admin/settings' } }
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(403);
      expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'URL_EXCLUDED' }));
    });

    it('T4.10: rejects untagged request when enforcePermissions is active', async () => {
      server.setEnforcePermissions(true);

      const res = await context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'perm-10',
          method: 'Network.enable'
        },
        { tab: { id: 42, url: 'https://example.com/test' } }
      );

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(403);
      expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'MISSING_SCRIPT_ID' }));

      server.setEnforcePermissions(false);
    });

    it('T4.11: supports custom scriptResolver option', async () => {
      const customScript: ScriptRecord = {
        id: 'custom-resolved',
        name: 'Custom Resolved Script',
        code: '',
        metadata: {
          name: 'Custom Resolved',
          matches: ['<all_urls>'],
          matchPatterns: ['<all_urls>'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const customServer = new CdpBridgeServer({
        autoAttach: false,
        scriptResolver: async (id) => (id === 'custom-resolved' ? customScript : null)
      });
      customServer.init();

      context.mockDebugger.sendCommand.mockResolvedValueOnce({ ok: true });

      const res = await (customServer as any).processRpcRequest(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'perm-11',
          scriptId: 'custom-resolved',
          method: 'DOM.getDocument'
        },
        { tab: { id: 42, url: 'https://example.com/' } }
      );

      expect(res.success).toBe(true);
      customServer.destroy();
    });
  });
});
