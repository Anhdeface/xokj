import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { DevToolsConflictHandler } from '@/background/conflict-mgr';
import { ContentScriptBridge } from '@/content/bridge';
import { DevToolsConflictError } from '@/shared/types';
import type { CdpRpcRequest, CdpRpcResponse } from '@/shared/types';

describe('Empirical Challenger M2-1: Attach/Detach Races & DevTools Conflict Stress', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let manager: TabDebuggerManager;
  let server: CdpBridgeServer;
  let conflictHandler: DevToolsConflictHandler;

  beforeEach(async () => {
    context = setupChromeMock();
    manager = new TabDebuggerManager();
    server = new CdpBridgeServer({ autoAttach: true, debuggerManager: manager });
    conflictHandler = new DevToolsConflictHandler(server, manager);

    await manager.init();
    server.init();
    conflictHandler.init();
  });

  afterEach(() => {
    conflictHandler.destroy();
    server.destroy();
    manager.destroy();
  });

  describe('Group 1: Attach/Detach State Machine Concurrency & Race Conditions', () => {
    it('C1.1: calling attachTab while detachTab is in-flight must result in ATTACHED state', async () => {
      // 1. Initially attach tab 42
      await manager.attachTab(42);
      expect(manager.getTabStatus(42)).toBe('ATTACHED');
      expect(context.mockDebugger.attach).toHaveBeenCalledTimes(1);

      // 2. Setup a delayed chrome.debugger.detach
      let resolveDetach: () => void;
      context.mockDebugger.detach.mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveDetach = resolve; })
      );

      // 3. Initiate detachTab(42)
      const detachPromise = manager.detachTab(42);

      // Wait until detach reaches chrome.debugger.detach
      await vi.waitFor(() => {
        expect(context.mockDebugger.detach).toHaveBeenCalledTimes(1);
      });

      // 4. While detachTab is still in-flight, invoke attachTab(42)
      const attachPromise = manager.attachTab(42);

      // 5. Complete the detach
      resolveDetach!();

      await detachPromise;
      await attachPromise;

      // Desired behavior: attachTab was invoked after detachTab, so final status MUST be ATTACHED.
      expect(manager.getTabStatus(42)).toBe('ATTACHED');
      expect(manager.isAttached(42)).toBe(true);
    });

    it('C1.2: interleaved attach1 -> detach -> attach2 sequence must result in ATTACHED state', async () => {
      let resolveAttach1: () => void;
      context.mockDebugger.attach.mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveAttach1 = resolve; })
      );

      // 1. Invoke attach1 (starts ATTACHING)
      const pAttach1 = manager.attachTab(42);
      expect(manager.getTabStatus(42)).toBe('ATTACHING');

      // 2. Queue detach
      const pDetach = manager.detachTab(42);

      // 3. Queue attach2
      const pAttach2 = manager.attachTab(42);

      // Wait until attach1 reaches mockDebugger
      await vi.waitFor(() => {
        expect(context.mockDebugger.attach).toHaveBeenCalledTimes(1);
      });

      // 4. Complete attach1
      resolveAttach1!();

      await Promise.all([pAttach1, pDetach, pAttach2]);

      // Desired behavior: attach2 was invoked after detach, so final status MUST be ATTACHED.
      expect(manager.getTabStatus(42)).toBe('ATTACHED');
    });

    it('C1.3: concurrent detachTab calls must coalesce and invoke chrome.debugger.detach only once', async () => {
      await manager.attachTab(42);
      expect(manager.getTabStatus(42)).toBe('ATTACHED');

      let resolveDetach1: () => void;
      context.mockDebugger.detach.mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveDetach1 = resolve; })
      );

      // Invoke detach1
      const pDetach1 = manager.detachTab(42);

      await vi.waitFor(() => {
        expect(context.mockDebugger.detach).toHaveBeenCalledTimes(1);
      });

      // Invoke detach2 while detach1 is in-flight
      const pDetach2 = manager.detachTab(42);

      resolveDetach1!();
      await Promise.all([pDetach1, pDetach2]);

      // Desired behavior: Only 1 detach call to chrome.debugger.detach
      // FAILS: line 359 skips coalescing because status is still 'ATTACHED', so it calls detach twice.
      expect(context.mockDebugger.detach).toHaveBeenCalledTimes(1);
    });

    it('C1.4: rapid detach while attach is in-flight results in clean DETACHED state without zombie attachment', async () => {
      let resolveAttach: () => void;
      context.mockDebugger.attach.mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveAttach = resolve; })
      );

      const pAttach = manager.attachTab(99);
      expect(manager.getTabStatus(99)).toBe('ATTACHING');

      const pDetach = manager.detachTab(99);

      await vi.waitFor(() => {
        expect(context.mockDebugger.attach).toHaveBeenCalledTimes(1);
      });

      resolveAttach!();

      await Promise.all([pAttach.catch(() => {}), pDetach]);

      expect(manager.getTabStatus(99)).toBe('DETACHED');
      expect(manager.isAttached(99)).toBe(false);
      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 99 });
    });
  });

  describe('Group 2: Inflight CDP Commands Racing Against Unexpected DevTools Detachment', () => {
    it('C2.1: 50 concurrent inflight CDP commands on same tab reject immediately with code 1001 when canceled_by_user fires', async () => {
      await manager.attachTab(42);
      expect(manager.getTabStatus(42)).toBe('ATTACHED');

      // Setup command to hang in flight
      context.mockDebugger.sendCommand.mockImplementation(() => new Promise(() => {}));

      const commandPromises: Promise<CdpRpcResponse>[] = [];
      const count = 50;

      for (let i = 0; i < count; i++) {
        commandPromises.push(
          server.executeCommand(42, 'Page.captureScreenshot', { format: 'png', id: i })
        );
      }

      expect(server.getPendingRequestCount(42)).toBe(count);

      // Trigger unexpected DevTools detachment: canceled_by_user
      context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');

      const results = await Promise.all(commandPromises);

      expect(results.length).toBe(count);
      for (const res of results) {
        expect(res.success).toBe(false);
        expect(res.error).toBeDefined();
        expect(res.error?.code).toBe(1001);
        expect(res.error?.message).toMatch(/conflict|devtools/i);
      }

      // Verify all resources deallocated
      expect(server.getPendingRequestCount(42)).toBe(0);
      expect(server.getPendingRequestCount()).toBe(0);
      expect(server.isTabAttached(42)).toBe(false);
      expect(manager.getTabStatus(42)).toBe('CONFLICT');
    });

    it('C2.2: 50 concurrent inflight CDP commands reject with code 1001 when replaced_with_devtools fires', async () => {
      await manager.attachTab(42);

      context.mockDebugger.sendCommand.mockImplementation(() => new Promise(() => {}));

      const commandPromises: Promise<CdpRpcResponse>[] = [];
      const count = 50;

      for (let i = 0; i < count; i++) {
        commandPromises.push(
          server.executeCommand(42, 'Runtime.evaluate', { expression: `window.val_${i}` })
        );
      }

      expect(server.getPendingRequestCount(42)).toBe(count);

      // Trigger replaced_with_devtools
      context.mockDebugger._emitDetach({ tabId: 42 }, 'replaced_with_devtools');

      const results = await Promise.all(commandPromises);

      expect(results.length).toBe(count);
      for (const res of results) {
        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(1001);
      }

      expect(server.getPendingRequestCount(42)).toBe(0);
      expect(manager.getTabStatus(42)).toBe('CONFLICT');
    });

    it('C2.3: 50 concurrent inflight CDP commands reject with code 1002 when unexpected target_closed fires', async () => {
      await manager.attachTab(42);

      context.mockDebugger.sendCommand.mockImplementation(() => new Promise(() => {}));

      const commandPromises: Promise<CdpRpcResponse>[] = [];
      const count = 50;

      for (let i = 0; i < count; i++) {
        commandPromises.push(
          server.executeCommand(42, 'DOM.getDocument', { depth: i })
        );
      }

      expect(server.getPendingRequestCount(42)).toBe(count);

      // Trigger target_closed
      context.mockDebugger._emitDetach({ tabId: 42 }, 'target_closed');

      const results = await Promise.all(commandPromises);

      expect(results.length).toBe(count);
      for (const res of results) {
        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(1002);
        expect(res.error?.message).toContain('target_closed');
      }

      expect(server.getPendingRequestCount(42)).toBe(0);
      expect(manager.getTabStatus(42)).toBe('DETACHED');
    });

    it('C2.4: cross-tab isolation: Tab 1 detachment does not reject or disrupt Tab 2 inflight commands', async () => {
      await manager.attachTab(1);
      await manager.attachTab(2);

      let resolveTab2: (v: any) => void;
      context.mockDebugger.sendCommand.mockImplementation(({ tabId }: any) => {
        if (tabId === 1) {
          return new Promise(() => {}); // Tab 1 hangs
        }
        if (tabId === 2) {
          return new Promise((res) => { resolveTab2 = res; });
        }
        return Promise.resolve({});
      });

      const p1 = server.executeCommand(1, 'Page.reload');
      const p2 = server.executeCommand(2, 'Network.getCookies');

      await vi.waitFor(() => {
        expect(server.getPendingRequestCount(1)).toBe(1);
        expect(server.getPendingRequestCount(2)).toBe(1);
        expect(resolveTab2).toBeDefined();
      });

      // Detach only Tab 1 via canceled_by_user
      context.mockDebugger._emitDetach({ tabId: 1 }, 'canceled_by_user');

      const res1 = await p1;
      expect(res1.success).toBe(false);
      expect(res1.error?.code).toBe(1001);
      expect(server.getPendingRequestCount(1)).toBe(0);

      // Tab 2 should still be healthy and in flight
      expect(server.getPendingRequestCount(2)).toBe(1);
      expect(manager.getTabStatus(2)).toBe('ATTACHED');

      // Settle Tab 2
      resolveTab2!({ cookies: [] });
      const res2 = await p2;
      expect(res2.success).toBe(true);
      expect(server.getPendingRequestCount(2)).toBe(0);
    });

    it('C2.5: command issued during ensureAttached phase rejects immediately when detachment occurs', async () => {
      let resolveAttach: () => void;
      context.mockDebugger.attach.mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveAttach = resolve; })
      );

      const cmdPromise = server.executeCommand(55, 'Runtime.evaluate', { expression: 'Date.now()' });

      await vi.waitFor(() => {
        expect(context.mockDebugger.attach).toHaveBeenCalled();
        expect(resolveAttach).toBeDefined();
      });

      // Detachment occurs while ensureAttached is pending
      context.mockDebugger._emitDetach({ tabId: 55 }, 'canceled_by_user');

      // Finish attach afterwards
      resolveAttach!();

      const response = await cmdPromise;
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(1001);
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
    });

    it('C2.6: DevTools conflict persists in session and local storage and prevents commands until reconnected', async () => {
      await manager.attachTab(42);
      context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');

      // Check session storage
      const sessionStored = await context.sessionStorage.get('tab_session_42');
      expect(sessionStored.tab_session_42?.status).toBe('CONFLICT');

      // Subsequent commands reject immediately with code 1001
      const res = await server.executeCommand(42, 'Page.reload');
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(1001);
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
    });
  });

  describe('Group 3: Content Script Bridge Request Draining & Lifecycle Stress', () => {
    let bridge: ContentScriptBridge;
    let postedToWindow: any[];

    beforeEach(() => {
      postedToWindow = [];
      vi.stubGlobal('postMessage', (msg: any) => {
        postedToWindow.push(msg);
      });

      bridge = new ContentScriptBridge({
        timeoutMs: 5000,
        autoStart: true,
        tabId: 42
      });
    });

    afterEach(() => {
      bridge.destroy();
      vi.restoreAllMocks();
    });

    it('C3.1: 50 window RPC requests in flight drain immediately with code 1002 on DETACHED lifecycle event', async () => {
      // Background message hangs
      context.mockRuntime.sendMessage.mockImplementation(async () => new Promise(() => {}));

      const count = 50;
      for (let i = 0; i < count; i++) {
        bridge.handleWindowMessage({
          source: window,
          data: {
            source: 'xokj-userscript',
            type: 'CDP_RPC_REQUEST',
            id: `req-drain-${i}`,
            method: 'DOM.getDocument'
          }
        });
      }

      expect((bridge as any).pendingRequests.size).toBe(count);

      // Background pushes CDP_LIFECYCLE_EVENT (DETACHED)
      bridge.handleRuntimeMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 42,
        status: 'DETACHED',
        reason: 'target_closed'
      });

      // All pending requests drained immediately
      expect((bridge as any).pendingRequests.size).toBe(0);
      expect(bridge.getStatus().status).toBe('DETACHED');

      // Verify all 50 responses posted to window with code 1002
      const responses = postedToWindow.filter(
        (m) => m.type === 'CDP_RPC_RESPONSE' && m.error?.code === 1002
      );
      expect(responses.length).toBe(count);
    });

    it('C3.2: 50 window RPC requests in flight drain immediately with code 1001 on CONFLICT lifecycle event', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async () => new Promise(() => {}));

      const count = 50;
      for (let i = 0; i < count; i++) {
        bridge.handleWindowMessage({
          source: window,
          data: {
            source: 'xokj-userscript',
            type: 'CDP_RPC_REQUEST',
            id: `req-conflict-${i}`,
            method: 'Runtime.evaluate'
          }
        });
      }

      expect((bridge as any).pendingRequests.size).toBe(count);

      // Background pushes CDP_LIFECYCLE_EVENT (CONFLICT)
      bridge.handleRuntimeMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 42,
        status: 'CONFLICT',
        reason: 'canceled_by_user'
      });

      expect((bridge as any).pendingRequests.size).toBe(0);
      expect(bridge.getStatus().status).toBe('CONFLICT');
      expect(bridge.getStatus().conflict).toBe(true);

      const responses = postedToWindow.filter(
        (m) => m.type === 'CDP_RPC_RESPONSE' && m.error?.code === 1001
      );
      expect(responses.length).toBe(count);
    });

    it('C3.3: programmatic bridge.send() requests reject immediately with code 1002 on DETACHED event', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async () => new Promise(() => {}));

      const sendPromises: Promise<any>[] = [];
      for (let i = 0; i < 20; i++) {
        sendPromises.push(bridge.send('Page.enable'));
      }

      expect((bridge as any).pendingRequests.size).toBe(20);

      bridge.handleRuntimeMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 42,
        status: 'DETACHED',
        reason: 'tab_navigated'
      });

      expect((bridge as any).pendingRequests.size).toBe(0);

      const settled = await Promise.allSettled(sendPromises);
      for (const res of settled) {
        expect(res.status).toBe('rejected');
        if (res.status === 'rejected') {
          expect(res.reason.code).toBe(1002);
          expect(res.reason.message).toContain('CDP session detached');
        }
      }
    });

    it('C3.4: subsequent window requests rejected immediately when bridge is in CONFLICT state', async () => {
      bridge.handleConflict('canceled_by_user');
      expect(bridge.getStatus().conflict).toBe(true);

      bridge.handleWindowMessage({
        source: window,
        data: {
          source: 'xokj-userscript',
          type: 'CDP_RPC_REQUEST',
          id: 'post-conflict-req',
          method: 'Page.navigate'
        }
      });

      // Did not call chrome.runtime.sendMessage
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

      // Immediately posted 1001 response
      const res = postedToWindow.find((m) => m.id === 'post-conflict-req');
      expect(res).toBeDefined();
      expect(res.error?.code).toBe(1001);
      expect(res.error?.message).toMatch(/conflict/i);
    });
  });

  describe('Group 4: Adversarial Stress Probes & High-Concurrency Edge Cases (Iteration 2)', () => {
    it('C4.1: alternating burst sequence (20 interleaved attach/detach operations ending in attach) ends in ATTACHED state', async () => {
      // Sequence: attach, detach, attach, detach ... ending in attach
      const ops: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          ops.push(manager.attachTab(42));
        } else {
          ops.push(manager.detachTab(42));
        }
      }
      // Final operation is attach
      ops.push(manager.attachTab(42));

      await Promise.all(ops);

      expect(manager.getTabStatus(42)).toBe('ATTACHED');
      expect(manager.isAttached(42)).toBe(true);
    });

    it('C4.2: alternating burst sequence (20 interleaved attach/detach operations ending in detach) ends in DETACHED state', async () => {
      // Sequence ending in detach
      const ops: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          ops.push(manager.attachTab(42));
        } else {
          ops.push(manager.detachTab(42));
        }
      }
      // Final operation is detach
      ops.push(manager.detachTab(42));

      await Promise.all(ops);

      expect(manager.getTabStatus(42)).toBe('DETACHED');
      expect(manager.isAttached(42)).toBe(false);
    });

    it('C4.3: rejection in chrome.debugger.attach does not deadlock subsequent queued operations', async () => {
      // First attach fails with protocol error
      context.mockDebugger.attach.mockImplementationOnce(() =>
        Promise.reject(new Error('Protocol error: Target not found'))
      );

      const pAttach1 = manager.attachTab(77);
      const pAttach2 = manager.attachTab(77);

      // pAttach1 must reject
      await expect(pAttach1).rejects.toThrow('Target not found');

      // pAttach2 must proceed cleanly and attach
      await pAttach2;

      expect(manager.getTabStatus(77)).toBe('ATTACHED');
      expect(manager.isAttached(77)).toBe(true);
    });

    it('C4.4: rejection in chrome.debugger.detach cleans up state and allows subsequent attachTab', async () => {
      await manager.attachTab(88);
      expect(manager.getTabStatus(88)).toBe('ATTACHED');

      // Detach fails unexpectedly
      context.mockDebugger.detach.mockImplementationOnce(() =>
        Promise.reject(new Error('Internal debugger failure'))
      );

      // detachTab must not throw unhandled exception and must mark tab DETACHED
      await manager.detachTab(88);
      expect(manager.getTabStatus(88)).toBe('DETACHED');

      // Subsequent attach must succeed
      await manager.attachTab(88);
      expect(manager.getTabStatus(88)).toBe('ATTACHED');
    });

    it('C4.5: forced attachTab successfully overrides CONFLICT status and clears conflict metadata', async () => {
      await manager.attachTab(42);
      context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');

      expect(manager.getTabStatus(42)).toBe('CONFLICT');

      // Normal unforced attach must fail
      await expect(manager.attachTab(42)).rejects.toThrow(/conflict/i);

      // Forced attach must succeed and clear conflict
      await manager.attachTab(42, true);

      expect(manager.getTabStatus(42)).toBe('ATTACHED');
      const session = manager.getSession(42);
      expect(session?.conflictDetected).toBe(false);
      expect(session?.conflictReason).toBeUndefined();
    });

    it('C4.6: 10 tabs under 10 concurrent random attach/detach operations maintain isolation without deadlock', async () => {
      const tabIds = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
      const allOps: Promise<any>[] = [];

      for (const tid of tabIds) {
        // Run 10 operations per tab
        for (let j = 0; j < 10; j++) {
          if (j % 2 === 0) {
            allOps.push(manager.attachTab(tid));
          } else {
            allOps.push(manager.detachTab(tid));
          }
        }
        // Explicitly end with attachTab for even tabs, detachTab for odd tabs
        if (tid % 2 === 0) {
          allOps.push(manager.attachTab(tid));
        } else {
          allOps.push(manager.detachTab(tid));
        }
      }

      await Promise.all(allOps);

      for (const tid of tabIds) {
        if (tid % 2 === 0) {
          expect(manager.getTabStatus(tid)).toBe('ATTACHED');
          expect(manager.isAttached(tid)).toBe(true);
        } else {
          expect(manager.getTabStatus(tid)).toBe('DETACHED');
          expect(manager.isAttached(tid)).toBe(false);
        }
      }
    });

    it('C4.7: tab removal while attach/detach is chained cleans up session and prevents zombie revival', async () => {
      let resolveAttach: () => void;
      context.mockDebugger.attach.mockImplementationOnce(
        () => new Promise<void>((res) => { resolveAttach = res; })
      );

      const pAttach = manager.attachTab(999);
      const pDetach = manager.detachTab(999);
      const pAttachAgain = manager.attachTab(999);

      // Remove tab while operations are in flight
      await manager.handleTabRemoved(999);

      // Resolve the initial attach
      resolveAttach!();

      await Promise.allSettled([pAttach, pDetach, pAttachAgain]);

      // Session must be removed from manager.sessions and storage
      expect(manager.getSession(999)).toBeUndefined();
      expect(manager.getTabStatus(999)).toBe('IDLE');
      expect(manager.isAttached(999)).toBe(false);

      const storageData = await context.localStorage.get('tab_sessions');
      expect(storageData.tab_sessions?.[999]).toBeUndefined();
    });
  });
});

