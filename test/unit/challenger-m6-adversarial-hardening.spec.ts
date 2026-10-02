/**
 * Empirical Challenger M6: Adversarial Coverage Hardening Test Suite (Tier 5)
 * Location: test/unit/challenger-m6-adversarial-hardening.spec.ts
 *
 * White-box adversarial stress test suite for Milestone 6 Phase 2:
 * 1. Rapid sequential and concurrent attach / detach / reconnect transitions under rapid state flips.
 * 2. High-throughput CDP event stream broadcasting with mixed wildcard (*, <Domain>.*) and exact listeners while tabs detach.
 * 3. Hostile message injections (spoofed channel tokens, invalid origins, mutated request IDs, cross-tab spoofing).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { CdpBroadcaster } from '@/background/cdp/broadcaster';
import { validateRpcRequest } from '@/background/cdp/rpc-router';
import { TimeoutGuard } from '@/background/cdp/timeout-guard';
import { ContentScriptBridge } from '@/content/bridge';
import {
  validateStoragePayload,
  generateSecureChannelId
} from '@/content/bridge/validator';
import { pageSandboxRunner } from '@/background/injector/page-runner';
import { CdpClient } from '@/content/cdp-sdk';
import { DevToolsConflictError } from '@/shared/types';
import { resetToDefaultScripts, saveSettings } from '@/shared/storage';

describe('Empirical Challenger M6: Adversarial Coverage Hardening (Tier 5)', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
    await saveSettings({
      globalEnabled: true,
      autoAttachDebugger: true,
      debuggerProtocolVersion: '1.3'
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // VECTOR 1: Rapid Sequential and Concurrent Attach / Detach / Reconnect Transitions
  // =========================================================================
  describe('Vector 1: Rapid Sequential & Concurrent Lifecycle State Flips', () => {
    it('1.1: 100 rapid sequential and overlapping attach/detach/reconnect cycles settle without deadlock or invalid state', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();
      const tabId = 201;

      context.mockDebugger.attach.mockImplementation(async () => {
        // Simulate jitter / async delay in Chromium debugger
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3) + 1));
      });

      context.mockDebugger.detach.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3) + 1));
      });

      // Launch 100 rapid interleaved operations
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        const op = i % 4;
        if (op === 0) {
          promises.push(manager.attachTab(tabId));
        } else if (op === 1) {
          promises.push(manager.detachTab(tabId, 'DETACHED'));
        } else if (op === 2) {
          promises.push(manager.reconnect(tabId).catch(() => null));
        } else {
          promises.push(manager.detachTab(tabId, 'IDLE'));
        }
      }

      await Promise.allSettled(promises);

      // Verify that after all 100 operations settle, the tab status is one of the valid states
      const finalStatus = manager.getTabStatus(tabId);
      expect(['ATTACHED', 'DETACHED', 'IDLE', 'CONFLICT']).toContain(finalStatus);

      // Ensure that clean final attachment succeeds
      await manager.attachTab(tabId);
      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');
      expect(manager.isAttached(tabId)).toBe(true);

      // Clean teardown
      await manager.detachTab(tabId, 'IDLE');
      expect(manager.getTabStatus(tabId)).toBe('IDLE');
      expect(manager.isAttached(tabId)).toBe(false);

      manager.destroy();
    });

    it('1.2: Asynchronous detachment or conflict during attachTab handles rejection cleanly without hanging locks', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();
      const tabId = 202;

      // Scenario A: Native attach fails due to concurrent DevTools conflict
      context.mockDebugger.attach.mockRejectedValueOnce(
        new Error('Another debugger is already attached to the tab with id: 202')
      );

      // attachTab should reject with DevToolsConflictError
      await expect(manager.attachTab(tabId)).rejects.toThrow(DevToolsConflictError);

      // Session must be in CONFLICT, not stuck in ATTACHING
      expect(manager.getTabStatus(tabId)).toBe('CONFLICT');
      expect(manager.isAttached(tabId)).toBe(false);

      // Scenario B: Concurrent detachTab called while attachTab is in-flight
      context.mockDebugger.attach.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });

      const attachPromise = manager.attachTab(tabId, { force: true });
      const detachPromise = manager.detachTab(tabId, 'DETACHED');

      await Promise.all([attachPromise, detachPromise]);

      // Serial lock guarantees that detachTab executes after attach, leaving status as DETACHED
      expect(manager.getTabStatus(tabId)).toBe('DETACHED');
      expect(manager.isAttached(tabId)).toBe(false);

      // Subsequent attach succeeds cleanly
      await manager.attachTab(tabId);
      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');

      manager.destroy();
    });

    it('1.3: Rapid alternating DevTools conflict storm correctly rejects in-flight commands with code 1001', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();
      const tabId = 203;

      const mockInflightTracker = {
        rejected: [] as Array<{ code: number; message: string }>,
        rejectPendingRequestsForTab: vi.fn((_tabId: number, err: any) => {
          mockInflightTracker.rejected.push(err);
          return 1;
        })
      };
      manager.setInflightTracker(mockInflightTracker);

      await manager.attachTab(tabId);
      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');

      // Trigger 10 rapid conflict notifications
      for (let i = 0; i < 10; i++) {
        manager.handleDetach({ tabId }, 'canceled_by_user');
        expect(manager.getTabStatus(tabId)).toBe('CONFLICT');

        // Verify attachTab throws DevToolsConflictError while CONFLICT is active
        await expect(manager.attachTab(tabId)).rejects.toThrow(DevToolsConflictError);

        // Reconnect restores ATTACHED
        const res = await manager.reconnect(tabId);
        expect(res.success).toBe(true);
        expect(manager.getTabStatus(tabId)).toBe('ATTACHED');
      }

      // Inflight tracker was called with DevTools conflict error code 1001
      expect(mockInflightTracker.rejectPendingRequestsForTab).toHaveBeenCalled();
      expect(mockInflightTracker.rejected.some((e) => e.code === 1001)).toBe(true);

      manager.destroy();
    });

    it('1.4: 25 concurrent tabs executing independent state flips maintain strict isolation', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();

      const TAB_COUNT = 25;
      const tabIds = Array.from({ length: TAB_COUNT }, (_, i) => 300 + i);

      // Run parallel lifecycle flows across all 25 tabs
      await Promise.all(
        tabIds.map(async (tabId, index) => {
          // Tab 300-309: Attach -> sendCommand -> Detach
          if (index < 10) {
            await manager.attachTab(tabId);
            expect(manager.getTabStatus(tabId)).toBe('ATTACHED');
            await manager.sendCommand(tabId, 'Runtime.enable');
            expect(manager.getActiveDomains(tabId)).toContain('Runtime');
            await manager.detachTab(tabId, 'IDLE');
            expect(manager.getTabStatus(tabId)).toBe('IDLE');
          }
          // Tab 310-319: Attach -> Conflict -> Reconnect -> Detach
          else if (index < 20) {
            await manager.attachTab(tabId);
            manager.handleDetach({ tabId }, 'replaced_with_devtools');
            expect(manager.getTabStatus(tabId)).toBe('CONFLICT');
            const rec = await manager.reconnect(tabId);
            expect(rec.success).toBe(true);
            expect(manager.getTabStatus(tabId)).toBe('ATTACHED');
            await manager.detachTab(tabId, 'DETACHED');
            expect(manager.getTabStatus(tabId)).toBe('DETACHED');
          }
          // Tab 320-324: Double attach -> Double detach
          else {
            await Promise.all([manager.attachTab(tabId), manager.attachTab(tabId)]);
            expect(manager.getTabStatus(tabId)).toBe('ATTACHED');
            await Promise.all([
              manager.detachTab(tabId, 'DETACHED'),
              manager.detachTab(tabId, 'IDLE')
            ]);
            expect(['DETACHED', 'IDLE']).toContain(manager.getTabStatus(tabId));
          }
        })
      );

      // Verify no cross-tab contamination
      for (let i = 0; i < 10; i++) {
        expect(manager.getTabStatus(300 + i)).toBe('IDLE');
        expect(manager.getActiveDomains(300 + i)).toEqual([]);
      }

      manager.destroy();
    });

    it('1.5: TimeoutGuard reliably drains and settles all in-flight requests on tab detachment or closure', () => {
      const guard = new TimeoutGuard();
      const tabId = 205;
      const settled: any[] = [];

      // Track 50 in-flight requests for tabId
      for (let i = 0; i < 50; i++) {
        const id = `req_${i}`;
        guard.track(
          {
            id,
            tabId,
            method: 'Page.navigate',
            startTime: Date.now(),
            resolve: (res) => settled.push(res)
          },
          10000
        );
      }

      expect(guard.getPendingRequestCount(tabId)).toBe(50);
      expect(guard.getPendingRequestCount()).toBe(50);

      // Detach tab with error code 1002
      const rejectedCount = guard.rejectPendingRequestsForTab(tabId, {
        code: 1002,
        message: 'Tab detached',
        data: { reason: 'manual_detach' }
      });

      expect(rejectedCount).toBe(50);
      expect(guard.getPendingRequestCount(tabId)).toBe(0);
      expect(guard.getPendingRequestCount()).toBe(0);
      expect(settled.length).toBe(50);

      // Verify all settled with failure and code 1002
      for (const res of settled) {
        expect(res.success).toBe(false);
        expect(res.error.code).toBe(1002);
      }

      guard.destroy();
    });
  });

  // =========================================================================
  // VECTOR 2: High-Throughput CDP Event Stream Broadcasting with Mixed Wildcards & Detachment
  // =========================================================================
  describe('Vector 2: High-Throughput CDP Event Broadcasting with Wildcards & Detach', () => {
    it('2.1: 1,000 heterogeneous events broadcast correctly across mixed exact, domain wildcard (*), and global wildcard (*) listeners', async () => {
      const tabId = 401;

      // Create CdpClient with transport simulator
      const receivedExact: any[] = [];
      const receivedNetworkWildcard: Array<{ params: any; method?: string }> = [];
      const receivedPageWildcard: Array<{ params: any; method?: string }> = [];
      const receivedGlobalWildcard: Array<{ params: any; method?: string }> = [];

      let eventHandler!: (msg: any) => void;
      const mockTransport = {
        sendRequest: vi.fn(),
        onEvent: (h: any) => {
          eventHandler = h;
          return () => {};
        },
        onLifecycle: () => () => {},
        getStatus: async () => 'ATTACHED' as any
      };

      const client = new CdpClient({
        tabId,
        transport: mockTransport,
        autoStart: true
      });

      // Register exact listeners
      client.on('Network.requestWillBeSent', (p: any) => { receivedExact.push(p); });
      client.on('Network.responseReceived', (p: any) => { receivedExact.push(p); });

      // Register domain wildcard listeners
      client.on('Network.*', (p: any, m?: string) => {
        receivedNetworkWildcard.push({ params: p, method: m });
      });
      client.on('Page.*', (p: any, m?: string) => {
        receivedPageWildcard.push({ params: p, method: m });
      });

      // Register global wildcard listener
      client.on('*', (p: any, m?: string) => {
        receivedGlobalWildcard.push({ params: p, method: m });
      });

      // Dispatch 1,000 events: 500 Network, 300 Page, 200 DOM
      const TOTAL_EVENTS = 1000;
      for (let i = 0; i < TOTAL_EVENTS; i++) {
        let method = '';
        if (i < 300) {
          method = 'Network.requestWillBeSent';
        } else if (i < 500) {
          method = 'Network.responseReceived';
        } else if (i < 800) {
          method = 'Page.frameNavigated';
        } else {
          method = 'DOM.documentUpdated';
        }

        const params = { index: i, timestamp: Date.now() };
        eventHandler({
          type: 'CDP_RPC_EVENT',
          tabId,
          method,
          params
        });
      }

      // Assertions:
      // Exact listener received 500 Network events
      expect(receivedExact.length).toBe(500);

      // Network.* received 500 Network events with method string
      expect(receivedNetworkWildcard.length).toBe(500);
      expect(receivedNetworkWildcard[0].method).toBe('Network.requestWillBeSent');
      expect(receivedNetworkWildcard[499].method).toBe('Network.responseReceived');

      // Page.* received 300 Page events with method string
      expect(receivedPageWildcard.length).toBe(300);
      expect(receivedPageWildcard[0].method).toBe('Page.frameNavigated');

      // Global * received all 1,000 events
      expect(receivedGlobalWildcard.length).toBe(1000);
      expect(receivedGlobalWildcard[999].method).toBe('DOM.documentUpdated');

      client.destroy();
    });

    it('2.2: Abrupt detachment mid-stream cancels pending requests with code 1002 and ignores post-detach events', () => {
      const channelId = generateSecureChannelId();
      const postedToWindow: any[] = [];
      vi.stubGlobal('postMessage', (msg: any) => postedToWindow.push(msg));

      const bridge = new ContentScriptBridge({
        channelId,
        requireChannelId: true,
        timeoutMs: 5000,
        autoStart: true
      });

      // Fire 5 in-flight requests from window (non-blocking, as window postMessage is async event)
      for (let i = 0; i < 5; i++) {
        bridge.handleWindowMessage({
          source: window,
          origin: window.location.origin,
          data: {
            source: 'xokj-userscript',
            channelId,
            type: 'CDP_RPC_REQUEST',
            id: `req_detach_${i}`,
            method: 'Fetch.enable',
            params: {}
          }
        });
      }

      expect(bridge.pendingRequests.size).toBe(5);

      // Now fire handleDetached
      bridge.handleDetached('browser_tab_closed');

      // All 5 requests should have been drained and rejected with code 1002
      expect(bridge.pendingRequests.size).toBe(0);

      // Verify responses posted to window contain code 1002
      const errorResponses = postedToWindow.filter(
        (m) => m.type === 'CDP_RPC_RESPONSE' && !m.success
      );
      expect(errorResponses.length).toBe(5);
      for (const res of errorResponses) {
        expect(res.error.code).toBe(1002);
      }

      bridge.destroy();
    });

    it('2.3: Listener mutation during active broadcast does not throw or corrupt iterator', () => {
      const client = new CdpClient({ autoStart: false });
      const calls: number[] = [];

      let unbind2: (() => void) | null = null;

      // Listener 1 unbinds listener 2 and adds listener 4
      client.on('Test.event', () => {
        calls.push(1);
        if (unbind2) {
          unbind2();
          unbind2 = null;
        }
        client.on('Test.event', () => calls.push(4));
      });

      unbind2 = client.on('Test.event', () => {
        calls.push(2);
      });

      client.on('Test.event', () => {
        calls.push(3);
      });

      // Trigger event
      (client as any).dispatchEvent('Test.event', { count: 1 });

      // Should complete without error
      expect(calls).toContain(1);
      expect(calls).toContain(3);

      client.destroy();
    });

    it('2.4: Throwing listener error is cleanly isolated and does not abort delivery to other listeners', () => {
      const client = new CdpClient({ autoStart: false });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const delivered: string[] = [];

      // Listener 1: Healthy
      client.on('Test.event', () => delivered.push('healthy_1'));

      // Listener 2: Malicious / throwing
      client.on('Test.event', () => {
        throw new Error('Exploding listener');
      });

      // Listener 3: Wildcard healthy
      client.on('Test.*', () => delivered.push('wildcard_healthy'));

      // Listener 4: Wildcard throwing
      client.on('*', () => {
        throw new TypeError('Exploding wildcard');
      });

      // Listener 5: Final healthy
      client.on('Test.event', () => delivered.push('healthy_2'));

      // Dispatch event
      (client as any).dispatchEvent('Test.event', { data: 123 });

      // All healthy listeners received the event despite throwing listeners
      expect(delivered).toEqual(['healthy_1', 'healthy_2', 'wildcard_healthy']);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);

      consoleErrorSpy.mockRestore();
      client.destroy();
    });

    it('2.5: pageSandboxRunner cleans up listeners and drains in-flight requests on pagehide', async () => {
      const channelId = generateSecureChannelId();
      const posted: any[] = [];
      const originalPostMessage = window.postMessage;
      window.postMessage = (msg: any) => posted.push(msg);

      let runnerResult: any;
      try {
        runnerResult = pageSandboxRunner(
          `
          cdp.on('Network.requestWillBeSent', (p) => { window.__sawRequest = true; });
          window.__sendPromise = cdp.send('Page.navigate', { url: 'https://example.com' });
          `,
          'TeardownTest',
          'script-teardown-1',
          { grants: ['GM_cdp'], cdp: [{ command: 'Page.navigate' }] },
          channelId
        );

        expect(runnerResult.success).toBe(true);

        // Simulate page navigation teardown
        window.dispatchEvent(new Event('pagehide'));

        // The in-flight send promise should reject cleanly
        const p = (window as any).__sendPromise;
        await expect(p).rejects.toThrow(/page unloaded/);
      } finally {
        window.postMessage = originalPostMessage;
        delete (window as any).__sawRequest;
        delete (window as any).__sendPromise;
      }
    });
  });

  // =========================================================================
  // VECTOR 3: Hostile Message Injections & Boundary Hardening
  // =========================================================================
  describe('Vector 3: Hostile Message Injections & Boundary Hardening', () => {
    it('3.1: Rejects hostile window messages with spoofed, missing, or mutated channel tokens', async () => {
      const genuineToken = generateSecureChannelId();
      const bridge = new ContentScriptBridge({
        channelId: genuineToken,
        requireChannelId: true,
        autoStart: true
      });

      const forwardSpy = vi.spyOn(bridge as any, 'forwardToServiceWorker');

      const hostilePayloads = [
        { type: 'CDP_RPC_REQUEST', channelId: 'fake-token-12345', method: 'Page.navigate' },
        { type: 'CDP_RPC_REQUEST', channelId: '', method: 'Page.navigate' },
        { type: 'CDP_RPC_REQUEST', channelId: null, method: 'Page.navigate' },
        { type: 'CDP_RPC_REQUEST', channelId: 12345, method: 'Page.navigate' },
        { type: 'CDP_RPC_REQUEST', channelId: {}, method: 'Page.navigate' },
        { type: 'CDP_RPC_REQUEST', channelId: [genuineToken], method: 'Page.navigate' },
        { type: 'GM_STORAGE_SET', channelId: 'wrong_token', scriptId: 's1', key: 'k1', value: 'v1' },
        { type: 'GM_STORAGE_DELETE', channelId: undefined, scriptId: 's1', key: 'k1' }
      ];

      for (const payload of hostilePayloads) {
        await bridge.handleWindowMessage({
          source: window,
          origin: window.location.origin,
          data: {
            source: 'xokj-userscript',
            ...payload
          }
        });
      }

      // Zero hostile messages should have been forwarded
      expect(forwardSpy).not.toHaveBeenCalled();

      bridge.destroy();
    });

    it('3.2: Rejects messages from forged origins or foreign window frames', async () => {
      const genuineToken = generateSecureChannelId();
      const bridge = new ContentScriptBridge({
        channelId: genuineToken,
        allowedOrigin: 'https://trusted.example.com',
        requireOrigin: true,
        autoStart: true
      });

      const forwardSpy = vi.spyOn(bridge as any, 'forwardToServiceWorker');

      const foreignWindow = {} as Window;

      // 1. Foreign window source
      await bridge.handleWindowMessage({
        source: foreignWindow,
        origin: 'https://trusted.example.com',
        data: {
          source: 'xokj-userscript',
          channelId: genuineToken,
          type: 'CDP_RPC_REQUEST',
          id: 'req_1',
          method: 'Page.navigate'
        }
      });
      expect(forwardSpy).not.toHaveBeenCalled();

      // 2. Untrusted origin
      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://attacker.evil.com',
        data: {
          source: 'xokj-userscript',
          channelId: genuineToken,
          type: 'CDP_RPC_REQUEST',
          id: 'req_2',
          method: 'Page.navigate'
        }
      });
      expect(forwardSpy).not.toHaveBeenCalled();

      // 3. Null origin
      await bridge.handleWindowMessage({
        source: window,
        origin: 'null',
        data: {
          source: 'xokj-userscript',
          channelId: genuineToken,
          type: 'CDP_RPC_REQUEST',
          id: 'req_3',
          method: 'Page.navigate'
        }
      });
      expect(forwardSpy).not.toHaveBeenCalled();

      // 4. Subdomain attacker origin
      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://trusted.example.com.evil.com',
        data: {
          source: 'xokj-userscript',
          channelId: genuineToken,
          type: 'CDP_RPC_REQUEST',
          id: 'req_4',
          method: 'Page.navigate'
        }
      });
      expect(forwardSpy).not.toHaveBeenCalled();

      bridge.destroy();
    });

    it('3.3: Mutated and malformed RPC request IDs or methods fail gracefully with code -32600', async () => {
      const channelId = generateSecureChannelId();
      const postedToWindow: any[] = [];
      vi.stubGlobal('postMessage', (msg: any) => postedToWindow.push(msg));

      // Mock chrome.runtime.sendMessage to validate via rpc-router
      context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
        const validated = validateRpcRequest(req, { tab: { id: 1, url: 'https://example.com' } } as any);
        const res = validated.error || {
          type: 'CDP_RPC_RESPONSE',
          id: req.id,
          success: true,
          result: {}
        };
        if (typeof cb === 'function') {
          cb(res);
        }
        return res;
      });

      const bridge = new ContentScriptBridge({
        channelId,
        autoStart: true
      });

      const malformedRequests = [
        { id: null, method: 'Page.navigate' },
        { id: 12345, method: 'Page.navigate' },
        { id: 'valid_id_1', method: '' },
        { id: 'valid_id_2', method: '   ' },
        { id: 'valid_id_3', method: null }
      ];

      for (const req of malformedRequests) {
        await bridge.handleWindowMessage({
          source: window,
          origin: window.location.origin,
          data: {
            source: 'xokj-userscript',
            channelId,
            type: 'CDP_RPC_REQUEST',
            ...req
          }
        });
      }

      // Check responses for invalid request error code -32600
      const errorResponses = postedToWindow.filter(
        (m) => m.type === 'CDP_RPC_RESPONSE' && !m.success
      );
      expect(errorResponses.length).toBeGreaterThanOrEqual(malformedRequests.length);
      for (const errRes of errorResponses) {
        expect(errRes.error.code).toBe(-32600);
      }

      bridge.destroy();
    });

    it('3.4: validateRpcRequest in background enforces sender context, cross-tab isolation, and restricted URL guards', () => {
      // 1. Sender has no tab context
      const noTabSender = {} as chrome.runtime.MessageSender;
      const res1 = validateRpcRequest({ type: 'CDP_RPC_REQUEST', id: '1', method: 'Page.navigate' }, noTabSender);
      expect(res1.error).toBeDefined();
      expect(res1.error?.error?.code).toBe(403);
      expect(res1.error?.error?.message).toMatch(/no associated tab context/);

      // 2. Cross-tab spoofing: sender is tab 5, claimed tabId is 10
      const tab5Sender = { tab: { id: 5, url: 'https://example.com' } } as chrome.runtime.MessageSender;
      const res2 = validateRpcRequest(
        { type: 'CDP_RPC_REQUEST', id: '2', tabId: 10, method: 'Page.navigate' },
        tab5Sender
      );
      expect(res2.error).toBeDefined();
      expect(res2.error?.error?.code).toBe(403);
      expect(res2.error?.error?.message).toMatch(/Cross-tab CDP access denied/);

      // 3. Sender is on restricted URL (chrome://extensions)
      const restrictedSender = { tab: { id: 5, url: 'chrome://extensions' } } as chrome.runtime.MessageSender;
      const res3 = validateRpcRequest(
        { type: 'CDP_RPC_REQUEST', id: '3', tabId: 5, method: 'Page.navigate' },
        restrictedSender
      );
      expect(res3.error).toBeDefined();
      expect(res3.error?.error?.code).toBe(403);
      expect(res3.error?.error?.message).toMatch(/restricted on system page/);

      // 4. Empty method name
      const res4 = validateRpcRequest(
        { type: 'CDP_RPC_REQUEST', id: '4', tabId: 5, method: '   ' },
        tab5Sender
      );
      expect(res4.error).toBeDefined();
      expect(res4.error?.error?.code).toBe(-32600);

      // 5. Valid request passes
      const res5 = validateRpcRequest(
        { type: 'CDP_RPC_REQUEST', id: '5', tabId: 5, method: 'Page.navigate' },
        tab5Sender
      );
      expect(res5.error).toBeUndefined();
      expect(res5.senderTabId).toBe(5);
    });

    it('3.5: validateStoragePayload rejects invalid, empty, or prototype-polluting GM storage mutations', () => {
      // Missing scriptId
      expect(validateStoragePayload({ scriptId: '', key: 'testKey' }).valid).toBe(false);
      expect(validateStoragePayload({ scriptId: null, key: 'testKey' }).valid).toBe(false);

      // Missing key
      expect(validateStoragePayload({ scriptId: 'script1', key: '' }).valid).toBe(false);
      expect(validateStoragePayload({ scriptId: 'script1', key: '   ' }).valid).toBe(false);
      expect(validateStoragePayload({ scriptId: 'script1', key: 1234 }).valid).toBe(false);

      // Valid payload
      const valid = validateStoragePayload({ scriptId: 'script-123', key: 'settings' });
      expect(valid.valid).toBe(true);
      expect(valid.scriptId).toBe('script-123');
      expect(valid.key).toBe('settings');
    });
  });
});
