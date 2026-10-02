/**
 * Empirical Challenger M4: Runtime CDP Event Pipeline & Persistent GM Storage Engine
 * Location: test/unit/challenger-m4-empirical.spec.ts
 *
 * Empirical stress tests and adversarial verification suite covering:
 * 1. High-frequency CDP event burst:
 *    - Emit 5,000+ CDP_RPC_EVENT messages across exact, domain wildcard (<Domain>.*),
 *      and global wildcard (*) subscriptions in pageSandboxRunner, CdpClient, and ContentScriptBridge.
 *    - Verify 100% receipt, zero event drops, and sequential ordering.
 * 2. Error resilience:
 *    - Subscribe misbehaved handlers throwing synchronous errors, raw objects/strings,
 *      and asynchronous rejections.
 *    - Verify neighboring listeners (exact and wildcards) continue receiving events without corruption.
 * 3. Listener unregistration:
 *    - Call cdp.off and returned unsubscribe closures across exact and wildcard events.
 *    - Challenge with active-dispatch unregistration (self and cross-handler unregistration).
 *    - Verify zero further events received and zero iteration glitches.
 * 4. Persistent GM Storage Engine:
 *    - Rapid concurrent GM_setValue and GM_deleteValue calls (2,500+ operations).
 *    - Verify synchronous cache consistency and write-through message emission in exact order.
 *    - Verify initialValues pre-hydration, value isolation, prototype pollution safety, and circular reference resilience.
 * 5. Serialization & Context Independence:
 *    - Verify pageSandboxRunner.toString() executes cleanly in a pure sandboxed node:vm context
 *      without ReferenceError or unresolved module imports.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vm from 'node:vm';
import { pageSandboxRunner } from '@/background/injector';
import { CdpClient } from '@/content/cdp-sdk';
import { ContentScriptBridge } from '@/content/bridge';
import { setupChromeMock } from '../mocks/chrome';

describe('Empirical Challenger M4: Runtime CDP Event Pipeline & Persistent GM Storage', () => {
  let originalPostMessage: typeof window.postMessage;

  beforeEach(() => {
    originalPostMessage = window.postMessage;
  });

  afterEach(() => {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new Event('pagehide'));
      } catch {}
    }
    window.postMessage = originalPostMessage;
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Challenge 1: High-Frequency CDP Event Burst (5,000+ events)
  // =========================================================================
  describe('Challenge 1: High-Frequency CDP Event Burst (5,000+ events)', () => {
    it('1.1: pageSandboxRunner receives 5,500 high-frequency events with 100% delivery across exact, domain wildcard, and global wildcard', () => {
      const channelId = 'burst-channel-001';
      const scriptId = 'burst-runner-script';

      const scriptCode = `
        window.__burstReceipts = {
          exactRequest: [],
          exactResponse: [],
          domainNetwork: [],
          domainPage: [],
          domainDom: [],
          globalAll: []
        };

        // 1. Exact subscriptions
        cdp.on('Network.requestWillBeSent', function(params) {
          window.__burstReceipts.exactRequest.push(params.seq);
        });
        cdp.on('Network.responseReceived', function(params) {
          window.__burstReceipts.exactResponse.push(params.seq);
        });

        // 2. Domain wildcard subscriptions (<Domain>.*)
        cdp.on('Network.*', function(params, method) {
          window.__burstReceipts.domainNetwork.push({ seq: params.seq, method: method });
        });
        cdp.on('Page.*', function(params, method) {
          window.__burstReceipts.domainPage.push({ seq: params.seq, method: method });
        });
        cdp.on('DOM.*', function(params, method) {
          window.__burstReceipts.domainDom.push({ seq: params.seq, method: method });
        });

        // 3. Global wildcard subscription (*)
        cdp.on('*', function(params, method) {
          window.__burstReceipts.globalAll.push({ seq: params.seq, method: method });
        });
      `;

      const runRes = pageSandboxRunner(
        scriptCode,
        'Burst Script',
        scriptId,
        { grants: ['cdp'] },
        channelId
      );
      expect(runRes.success).toBe(true);

      const receipts = (window as any).__burstReceipts;
      expect(receipts).toBeDefined();

      const TOTAL_EVENTS = 5500;
      // Distribution:
      // 0..2499: Network.requestWillBeSent (2,500)
      // 2500..3999: Network.responseReceived (1,500)
      // 4000..4999: Page.loadEventFired (1,000)
      // 5000..5499: DOM.documentUpdated (500)

      for (let seq = 0; seq < TOTAL_EVENTS; seq++) {
        let method = '';
        if (seq < 2500) {
          method = 'Network.requestWillBeSent';
        } else if (seq < 4000) {
          method = 'Network.responseReceived';
        } else if (seq < 5000) {
          method = 'Page.loadEventFired';
        } else {
          method = 'DOM.documentUpdated';
        }

        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            data: {
              source: 'xokj-bridge',
              channelId,
              type: 'CDP_RPC_EVENT',
              method,
              params: { seq, timestamp: Date.now() }
            }
          })
        );
      }

      // Exact matches verification
      expect(receipts.exactRequest).toHaveLength(2500);
      expect(receipts.exactRequest[0]).toBe(0);
      expect(receipts.exactRequest[2499]).toBe(2499);

      expect(receipts.exactResponse).toHaveLength(1500);
      expect(receipts.exactResponse[0]).toBe(2500);
      expect(receipts.exactResponse[1499]).toBe(3999);

      // Domain wildcard matches verification
      // Network.* should receive 2500 request + 1500 response = 4000 events
      expect(receipts.domainNetwork).toHaveLength(4000);
      expect(receipts.domainNetwork[0]).toEqual({ seq: 0, method: 'Network.requestWillBeSent' });
      expect(receipts.domainNetwork[2500]).toEqual({ seq: 2500, method: 'Network.responseReceived' });
      expect(receipts.domainNetwork[3999]).toEqual({ seq: 3999, method: 'Network.responseReceived' });

      // Page.* should receive 1000 events
      expect(receipts.domainPage).toHaveLength(1000);
      expect(receipts.domainPage[0]).toEqual({ seq: 4000, method: 'Page.loadEventFired' });
      expect(receipts.domainPage[999]).toEqual({ seq: 4999, method: 'Page.loadEventFired' });

      // DOM.* should receive 500 events
      expect(receipts.domainDom).toHaveLength(500);
      expect(receipts.domainDom[0]).toEqual({ seq: 5000, method: 'DOM.documentUpdated' });
      expect(receipts.domainDom[499]).toEqual({ seq: 5499, method: 'DOM.documentUpdated' });

      // Global wildcard (*) should receive ALL 5500 events with 100% receipt and zero drops
      expect(receipts.globalAll).toHaveLength(5500);
      expect(receipts.globalAll[0]).toEqual({ seq: 0, method: 'Network.requestWillBeSent' });
      expect(receipts.globalAll[5499]).toEqual({ seq: 5499, method: 'DOM.documentUpdated' });

      // Total callback invocations across all listeners:
      // exactRequest(2500) + exactResponse(1500) + domainNetwork(4000) + domainPage(1000) + domainDom(500) + globalAll(5500) = 15,000
      const totalInvocations =
        receipts.exactRequest.length +
        receipts.exactResponse.length +
        receipts.domainNetwork.length +
        receipts.domainPage.length +
        receipts.domainDom.length +
        receipts.globalAll.length;
      expect(totalInvocations).toBe(15000);

      delete (window as any).__burstReceipts;
    });

    it('1.2: CdpClient receives 5,000 high-frequency events across exact, domain wildcard, and global wildcard with zero drops', () => {
      const channelId = 'cdpclient-burst-channel';
      const client = new CdpClient({ channelId, autoStart: true });

      const exactReceived: number[] = [];
      const domainReceived: { seq: number; method: string }[] = [];
      const globalReceived: { seq: number; method: string }[] = [];

      client.on('Fetch.requestPaused', (params: any) => {
        exactReceived.push(params.seq);
      });

      client.on('Fetch.*', (params: any, method?: string) => {
        domainReceived.push({ seq: params.seq, method: method || '' });
      });

      client.on('*', (params: any, method?: string) => {
        globalReceived.push({ seq: params.seq, method: method || '' });
      });

      const COUNT = 5000;
      for (let seq = 0; seq < COUNT; seq++) {
        client.handleWindowMessage({
          source: window,
          data: {
            channelId,
            type: 'CDP_RPC_EVENT',
            method: 'Fetch.requestPaused',
            params: { seq, requestId: `req_${seq}` }
          }
        });
      }

      expect(exactReceived).toHaveLength(COUNT);
      expect(exactReceived[0]).toBe(0);
      expect(exactReceived[COUNT - 1]).toBe(COUNT - 1);

      expect(domainReceived).toHaveLength(COUNT);
      expect(domainReceived[0]).toEqual({ seq: 0, method: 'Fetch.requestPaused' });
      expect(domainReceived[COUNT - 1]).toEqual({ seq: COUNT - 1, method: 'Fetch.requestPaused' });

      expect(globalReceived).toHaveLength(COUNT);
      expect(globalReceived[0]).toEqual({ seq: 0, method: 'Fetch.requestPaused' });
      expect(globalReceived[COUNT - 1]).toEqual({ seq: COUNT - 1, method: 'Fetch.requestPaused' });

      client.destroy();
    });

    it('1.3: ContentScriptBridge relays 5,000 live events from background to window postMessage with zero loss', async () => {
      const channelId = 'bridge-burst-channel';
      const bridge = new ContentScriptBridge({ channelId });
      bridge.init();

      const postedEvents: any[] = [];
      window.postMessage = (msg: any) => {
        if (msg?.type === 'CDP_RPC_EVENT') {
          postedEvents.push(msg);
        }
      };

      const localExact: number[] = [];
      bridge.on('Network.loadingFinished', (params: any) => {
        localExact.push(params.seq);
      });

      const BURST_SIZE = 5000;
      for (let i = 0; i < BURST_SIZE; i++) {
        bridge.handleRuntimeMessage({
          type: 'CDP_RPC_EVENT',
          tabId: 101,
          method: 'Network.loadingFinished',
          params: { seq: i, encodedDataLength: 1024 }
        });
      }

      // Verify all 5,000 events reached local listener and were posted to window
      expect(localExact).toHaveLength(BURST_SIZE);
      expect(localExact[0]).toBe(0);
      expect(localExact[BURST_SIZE - 1]).toBe(BURST_SIZE - 1);

      expect(postedEvents).toHaveLength(BURST_SIZE);
      expect(postedEvents[0]).toEqual({
        source: 'xokj-bridge',
        channelId,
        type: 'CDP_RPC_EVENT',
        tabId: 101,
        method: 'Network.loadingFinished',
        params: { seq: 0, encodedDataLength: 1024 }
      });
      expect(postedEvents[BURST_SIZE - 1].params.seq).toBe(BURST_SIZE - 1);

      bridge.destroy();
    });
  });

  // =========================================================================
  // Challenge 2: Error Resilience & Neighbor Protection
  // =========================================================================
  describe('Challenge 2: Error Resilience & Neighbor Protection', () => {
    it('2.1: pageSandboxRunner protects neighboring listeners when handlers throw synchronous errors, raw objects, or undefined', () => {
      const channelId = 'err-channel-001';
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const code = `
        window.__resilienceLog = [];

        // 1. Throw standard Error
        cdp.on('Console.messageAdded', function(params) {
          throw new Error('Exploding listener 1');
        });

        // 2. Throw raw string
        cdp.on('Console.messageAdded', function(params) {
          throw 'Raw string exception';
        });

        // 3. Throw undefined
        cdp.on('Console.messageAdded', function(params) {
          throw undefined;
        });

        // 4. Well-behaved neighbor
        cdp.on('Console.messageAdded', function(params) {
          window.__resilienceLog.push('neighbor_1_exact:' + params.id);
        });

        // 5. Wildcard neighbor
        cdp.on('Console.*', function(params, method) {
          window.__resilienceLog.push('neighbor_2_domain:' + params.id);
        });

        // 6. Global wildcard neighbor
        cdp.on('*', function(params, method) {
          window.__resilienceLog.push('neighbor_3_global:' + params.id);
        });
      `;

      const result = pageSandboxRunner(code, 'Resilience Script', 'resilience-id', { grants: ['cdp'] }, channelId);
      expect(result.success).toBe(true);

      // Emit event
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: {
            source: 'xokj-bridge',
            channelId,
            type: 'CDP_RPC_EVENT',
            method: 'Console.messageAdded',
            params: { id: 777 }
          }
        })
      );

      const log = (window as any).__resilienceLog;
      expect(log).toEqual([
        'neighbor_1_exact:777',
        'neighbor_2_domain:777',
        'neighbor_3_global:777'
      ]);

      // Verify errors were logged safely
      expect(consoleErrorSpy).toHaveBeenCalled();
      delete (window as any).__resilienceLog;
    });

    it('2.2: pageSandboxRunner protects exact and wildcard listeners when domain wildcard or global wildcard throws', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const code = `
        window.__wildcardErrLog = [];

        cdp.on('Network.requestWillBeSent', function(params) {
          window.__wildcardErrLog.push('exact_ok:' + params.id);
        });

        // Domain wildcard throws
        cdp.on('Network.*', function() {
          throw new Error('Domain wildcard failed!');
        });

        // Global wildcard throws
        cdp.on('*', function() {
          throw new Error('Global wildcard failed!');
        });

        // Second global wildcard should still execute
        cdp.on('*', function(params, method) {
          window.__wildcardErrLog.push('global_ok:' + params.id);
        });
      `;

      pageSandboxRunner(code, 'Wildcard Error Script', 'wc-err-id', { grants: ['cdp'] });

      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: {
            source: 'xokj-bridge',
            type: 'CDP_RPC_EVENT',
            method: 'Network.requestWillBeSent',
            params: { id: 99 }
          }
        })
      );

      expect((window as any).__wildcardErrLog).toEqual(['exact_ok:99', 'global_ok:99']);
      delete (window as any).__wildcardErrLog;
    });

    it('2.3: pageSandboxRunner handles asynchronous listener rejections without crashing engine or dropping neighbors', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      // Temporarily stash Vitest's unhandledRejection listeners so intentional rejection in misbehaved handler
      // does not cause Vitest to fail the process runner
      const originalListeners = process.rawListeners('unhandledRejection');
      process.removeAllListeners('unhandledRejection');
      const interceptedRejections: any[] = [];
      process.on('unhandledRejection', (err) => {
        interceptedRejections.push(err);
      });

      try {
        const code = `
          window.__asyncResilienceLog = [];

          // Async function rejecting with Error
          cdp.on('Page.domContentEventFired', async function(params) {
            throw new Error('Async promise rejection in handler');
          });

          // Async function returning rejected Promise
          cdp.on('Page.domContentEventFired', function(params) {
            return Promise.reject(new Error('Returned rejected promise'));
          });

          // Synchronous neighbor
          cdp.on('Page.domContentEventFired', function(params) {
            window.__asyncResilienceLog.push('sync_neighbor:' + params.timestamp);
          });

          // Wildcard neighbor
          cdp.on('Page.*', function(params) {
            window.__asyncResilienceLog.push('wildcard_neighbor:' + params.timestamp);
          });
        `;

        pageSandboxRunner(code, 'Async Resilience Script', 'async-res-id', { grants: ['cdp'] });

        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            data: {
              source: 'xokj-bridge',
              type: 'CDP_RPC_EVENT',
              method: 'Page.domContentEventFired',
              params: { timestamp: 123456 }
            }
          })
        );

        expect((window as any).__asyncResilienceLog).toEqual([
          'sync_neighbor:123456',
          'wildcard_neighbor:123456'
        ]);
        delete (window as any).__asyncResilienceLog;
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 20));
        process.removeAllListeners('unhandledRejection');
        for (const listener of originalListeners) {
          process.on('unhandledRejection', listener as any);
        }
      }
    });

    it('2.4: CdpClient isolates listener exceptions across exact, domain wildcard, and global wildcard', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const client = new CdpClient();

      const received: string[] = [];

      client.on('Target.targetCreated', () => {
        throw new Error('CdpClient exact crash');
      });

      client.on('Target.targetCreated', (params: any) => {
        received.push('exact:' + params.id);
      });

      client.on('Target.*', () => {
        throw new Error('CdpClient domain crash');
      });

      client.on('Target.*', (params: any) => {
        received.push('domain:' + params.id);
      });

      client.on('*', () => {
        throw new Error('CdpClient global crash');
      });

      client.on('*', (params: any) => {
        received.push('global:' + params.id);
      });

      client.handleWindowMessage({
        source: window,
        data: {
          type: 'CDP_RPC_EVENT',
          method: 'Target.targetCreated',
          params: { id: 't-1' }
        }
      });

      expect(received).toEqual(['exact:t-1', 'domain:t-1', 'global:t-1']);
      client.destroy();
    });

    it('2.5: BridgeEventRelayer isolates local subscriber exceptions and preserves window.postMessage relay', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const bridge = new ContentScriptBridge();
      bridge.init();

      const postedMessages: any[] = [];
      window.postMessage = (msg: any) => {
        postedMessages.push(msg);
      };

      const localLog: string[] = [];
      bridge.on('Log.entryAdded', () => {
        throw new Error('Bridge local listener crash');
      });
      bridge.on('Log.entryAdded', (params: any) => {
        localLog.push('neighbor:' + params.text);
      });

      bridge.handleRuntimeMessage({
        type: 'CDP_RPC_EVENT',
        method: 'Log.entryAdded',
        params: { text: 'isolated test' }
      });

      // Neighbor local listener received event
      expect(localLog).toEqual(['neighbor:isolated test']);

      // postMessage relay to window was NOT blocked by listener error
      expect(postedMessages.some((m) => m.type === 'CDP_RPC_EVENT' && m.params.text === 'isolated test')).toBe(true);

      bridge.destroy();
    });
  });

  // =========================================================================
  // Challenge 3: Listener Unregistration & Active Dispatch Mutation
  // =========================================================================
  describe('Challenge 3: Listener Unregistration & Active Dispatch Mutation', () => {
    it('3.1: unregister via returned closure and cdp.off across exact, domain wildcard, and global wildcard', () => {
      const code = `
        window.__unsubResults = {
          exact: 0,
          domain: 0,
          global: 0
        };

        function exactH() { window.__unsubResults.exact++; }
        function domainH() { window.__unsubResults.domain++; }
        function globalH() { window.__unsubResults.global++; }

        var unsubExact = cdp.on('Storage.indexedDBListUpdated', exactH);
        var unsubDomain = cdp.on('Storage.*', domainH);
        cdp.on('*', globalH);

        // First round: all active
        // Will be triggered externally

        window.__runUnsubscribeRound1 = function() {
          unsubExact();
          unsubDomain();
          cdp.off('*', globalH);
        };
      `;

      pageSandboxRunner(code, 'Unsub Script', 'unsub-runner', { grants: ['cdp'] });

      const emit = () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            data: {
              source: 'xokj-bridge',
              type: 'CDP_RPC_EVENT',
              method: 'Storage.indexedDBListUpdated',
              params: {}
            }
          })
        );
      };

      // Round 1: all 3 fire
      emit();
      expect((window as any).__unsubResults).toEqual({ exact: 1, domain: 1, global: 1 });

      // Unsubscribe all
      (window as any).__runUnsubscribeRound1();

      // Round 2: none should fire
      emit();
      expect((window as any).__unsubResults).toEqual({ exact: 1, domain: 1, global: 1 });

      delete (window as any).__unsubResults;
      delete (window as any).__runUnsubscribeRound1;
    });

    it('3.2: partial unregistration when multiple handlers listen to the same event', () => {
      const code = `
        window.__multiCounts = { h1: 0, h2: 0, h3: 0 };
        function h1() { window.__multiCounts.h1++; }
        function h2() { window.__multiCounts.h2++; }
        function h3() { window.__multiCounts.h3++; }

        cdp.on('Overlay.inspectNodeRequested', h1);
        var unsubH2 = cdp.on('Overlay.inspectNodeRequested', h2);
        cdp.on('Overlay.inspectNodeRequested', h3);

        window.__unsubH2 = unsubH2;
        window.__unsubH3 = function() {
          cdp.off('Overlay.inspectNodeRequested', h3);
        };
      `;

      pageSandboxRunner(code, 'Multi Handler Script', 'multi-h-id', { grants: ['cdp'] });

      const emit = () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            data: {
              source: 'xokj-bridge',
              type: 'CDP_RPC_EVENT',
              method: 'Overlay.inspectNodeRequested',
              params: {}
            }
          })
        );
      };

      emit();
      expect((window as any).__multiCounts).toEqual({ h1: 1, h2: 1, h3: 1 });

      // Remove H2 only
      (window as any).__unsubH2();

      emit();
      expect((window as any).__multiCounts).toEqual({ h1: 2, h2: 1, h3: 2 });

      // Remove H3 only
      (window as any).__unsubH3();

      emit();
      expect((window as any).__multiCounts).toEqual({ h1: 3, h2: 1, h3: 2 });

      delete (window as any).__multiCounts;
      delete (window as any).__unsubH2;
      delete (window as any).__unsubH3;
    });

    it('3.3: dynamic unregistration during active event dispatch (self-unregistration and cross-unregistration)', () => {
      const code = `
        window.__activeDispatchLog = [];

        var unsub1;
        var h1Called = 0;
        var h2Called = 0;
        var h3Called = 0;

        function h1() {
          h1Called++;
          window.__activeDispatchLog.push('h1_run_' + h1Called);
          // Handler 1 unsubscribes itself during execution
          unsub1();
        }

        function h2() {
          h2Called++;
          window.__activeDispatchLog.push('h2_run_' + h2Called);
          // Handler 2 unsubscribes Handler 3 during execution
          cdp.off('Debugger.paused', h3);
        }

        function h3() {
          h3Called++;
          window.__activeDispatchLog.push('h3_run_' + h3Called);
        }

        unsub1 = cdp.on('Debugger.paused', h1);
        cdp.on('Debugger.paused', h2);
        cdp.on('Debugger.paused', h3);
      `;

      pageSandboxRunner(code, 'Active Dispatch Script', 'active-disp-id', { grants: ['cdp'] });

      const emit = () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            data: {
              source: 'xokj-bridge',
              type: 'CDP_RPC_EVENT',
              method: 'Debugger.paused',
              params: {}
            }
          })
        );
      };

      // Event 1: Snapshot was taken before dispatch, so all 3 run for event 1
      emit();
      expect((window as any).__activeDispatchLog).toEqual([
        'h1_run_1',
        'h2_run_1',
        'h3_run_1'
      ]);

      // Event 2: H1 and H3 are now unregistered; only H2 should run!
      emit();
      expect((window as any).__activeDispatchLog).toEqual([
        'h1_run_1',
        'h2_run_1',
        'h3_run_1',
        'h2_run_2'
      ]);

      // Event 3: Only H2 runs again
      emit();
      expect((window as any).__activeDispatchLog).toEqual([
        'h1_run_1',
        'h2_run_1',
        'h3_run_1',
        'h2_run_2',
        'h2_run_3'
      ]);

      delete (window as any).__activeDispatchLog;
    });

    it('3.4: idempotency and edge cases: duplicate unregistration, non-existent event, and whitespace trimming', () => {
      const code = `
        window.__edgeResults = { called: 0 };
        function handler() { window.__edgeResults.called++; }

        // Register with whitespace
        var unsub = cdp.on('  Profiler.consoleProfileStarted  ', handler);

        // Multiple unregister calls should not throw
        unsub();
        unsub();
        cdp.off('Profiler.consoleProfileStarted', handler);
        cdp.off('Profiler.consoleProfileStarted', handler);

        // Unregister non-existent
        cdp.off('NonExistent.event', function() {});
        cdp.off('', function() {});
        cdp.off('   ', function() {});

        window.__edgeResults.unsubSafe = true;
      `;

      const res = pageSandboxRunner(code, 'Edge Unsub', 'edge-unsub-id', { grants: ['cdp'] });
      expect(res.success).toBe(true);
      expect((window as any).__edgeResults.unsubSafe).toBe(true);

      // Emit event: should not be received
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          data: {
            source: 'xokj-bridge',
            type: 'CDP_RPC_EVENT',
            method: 'Profiler.consoleProfileStarted',
            params: {}
          }
        })
      );
      expect((window as any).__edgeResults.called).toBe(0);

      delete (window as any).__edgeResults;
    });
  });

  // =========================================================================
  // Challenge 4: Persistent GM Storage Engine (Concurrency & Consistency)
  // =========================================================================
  describe('Challenge 4: Persistent GM Storage Engine', () => {
    it('4.1: rapid concurrent operations (2,500 calls) maintain 100% synchronous cache consistency and write-through order', () => {
      const channelId = 'storage-stress-channel';
      const scriptId = 'storage-stress-script';

      const postedMessages: any[] = [];
      window.postMessage = (msg: any) => {
        if (msg?.type === 'GM_STORAGE_SET' || msg?.type === 'GM_STORAGE_DELETE') {
          postedMessages.push(msg);
        }
      };

      const code = `
        window.__storageTest = function() {
          var results = {
            setValueCheck: true,
            deleteValueCheck: true,
            listValuesCheck: true,
            undefinedIsDeleteCheck: true
          };

          // 1. Rapid alternating set and get across 500 keys
          for (var i = 0; i < 500; i++) {
            var k = 'key_' + i;
            var v = { id: i, payload: 'val_' + i, active: i % 2 === 0 };
            GM_setValue(k, v);

            // Immediate synchronous read must match exactly
            var readBack = GM_getValue(k);
            if (!readBack || readBack.id !== i || readBack.payload !== 'val_' + i || readBack.active !== (i % 2 === 0)) {
              results.setValueCheck = false;
            }
          }

          // 2. GM_listValues check
          var keys = GM_listValues();
          if (keys.length !== 500) {
            results.listValuesCheck = false;
          }

          // 3. Delete 250 keys and verify immediate synchronous absence
          for (var j = 0; j < 250; j++) {
            var delKey = 'key_' + j;
            GM_deleteValue(delKey);

            var readDeleted = GM_getValue(delKey, 'FALLBACK_VAL');
            if (readDeleted !== 'FALLBACK_VAL') {
              results.deleteValueCheck = false;
            }
          }

          // 4. Verify listValues shrunk to 250
          var remainingKeys = GM_listValues();
          if (remainingKeys.length !== 250) {
            results.listValuesCheck = false;
          }

          // 5. Setting undefined acts as delete
          GM_setValue('key_250', undefined);
          if (GM_getValue('key_250', 'DELETED') !== 'DELETED') {
            results.undefinedIsDeleteCheck = false;
          }

          return results;
        };
      `;

      const runnerRes = pageSandboxRunner(
        code,
        'Storage Stress Script',
        scriptId,
        { grants: ['GM_setValue', 'GM_getValue', 'GM_deleteValue', 'GM_listValues'] },
        channelId
      );
      expect(runnerRes.success).toBe(true);

      const testResults = (window as any).__storageTest();
      expect(testResults.setValueCheck).toBe(true);
      expect(testResults.deleteValueCheck).toBe(true);
      expect(testResults.listValuesCheck).toBe(true);
      expect(testResults.undefinedIsDeleteCheck).toBe(true);

      // Verify write-through message emission count and structure:
      // 500 sets + 250 deletes + 1 set(undefined -> delete) = 751 total write-through messages
      expect(postedMessages).toHaveLength(751);

      // Verify first message: GM_STORAGE_SET for key_0
      expect(postedMessages[0]).toEqual({
        source: 'xokj-userscript',
        channelId,
        type: 'GM_STORAGE_SET',
        scriptId,
        key: 'key_0',
        value: { id: 0, payload: 'val_0', active: true }
      });

      // Verify 500th message (index 499): key_499
      expect(postedMessages[499]).toEqual({
        source: 'xokj-userscript',
        channelId,
        type: 'GM_STORAGE_SET',
        scriptId,
        key: 'key_499',
        value: { id: 499, payload: 'val_499', active: false }
      });

      // Verify 501st message (index 500): GM_STORAGE_DELETE for key_0
      expect(postedMessages[500]).toEqual({
        source: 'xokj-userscript',
        channelId,
        type: 'GM_STORAGE_DELETE',
        scriptId,
        key: 'key_0'
      });

      // Verify last message (index 750): GM_STORAGE_DELETE for key_250 (emitted by setting undefined)
      expect(postedMessages[750]).toEqual({
        source: 'xokj-userscript',
        channelId,
        type: 'GM_STORAGE_DELETE',
        scriptId,
        key: 'key_250'
      });

      delete (window as any).__storageTest;
    });

    it('4.2: initialValues pre-hydration guarantees synchronous access, deep cloning, and value isolation', () => {
      const initialSnapshot = {
        theme: 'dracula',
        userConfig: { notifications: true, maxTabs: 10, nested: { deepProp: 42 } },
        flags: [1, 2, 3],
        emptyObj: {}
      };

      const code = `
        window.__hydrateTest = function() {
          var config1 = GM_getValue('userConfig');
          var theme = GM_getValue('theme');
          var flags = GM_getValue('flags');
          var missing = GM_getValue('nonExistentKey', 'default-123');
          var keys = GM_listValues();

          // Value mutation isolation test:
          // Modifying the returned object must NOT mutate the internal cached store
          config1.maxTabs = 999;
          config1.nested.deepProp = 9999;

          var config2 = GM_getValue('userConfig');

          return {
            theme: theme,
            flags: flags,
            missing: missing,
            keys: keys,
            config1MaxTabs: config1.maxTabs,
            config2MaxTabs: config2.maxTabs,
            config2DeepProp: config2.nested.deepProp
          };
        };
      `;

      pageSandboxRunner(
        code,
        'Hydrate Script',
        'hydrate-script-id',
        { grants: ['GM_getValue', 'GM_listValues'] },
        undefined,
        initialSnapshot
      );

      const res = (window as any).__hydrateTest();
      expect(res.theme).toBe('dracula');
      expect(res.flags).toEqual([1, 2, 3]);
      expect(res.missing).toBe('default-123');
      expect(res.keys).toEqual(expect.arrayContaining(['theme', 'userConfig', 'flags', 'emptyObj']));

      // Deep value isolation: mutating config1 did NOT affect config2 read
      expect(res.config1MaxTabs).toBe(999);
      expect(res.config2MaxTabs).toBe(10);
      expect(res.config2DeepProp).toBe(42);

      delete (window as any).__hydrateTest;
    });

    it('4.3: prototype pollution and reserved property name safety', () => {
      const hostileKeys = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'];

      const code = `
        window.__hostileKeyResults = Object.create(null);

        for (var i = 0; i < hostileKeys.length; i++) {
          var k = hostileKeys[i];
          GM_setValue(k, 'value_for_' + k);
          window.__hostileKeyResults[k] = GM_getValue(k);
        }

        // Verify keys listed
        window.__listedHostileKeys = GM_listValues();
      `;

      (window as any).hostileKeys = hostileKeys;
      pageSandboxRunner(
        code,
        'Hostile Key Script',
        'hostile-script-id',
        { grants: ['GM_setValue', 'GM_getValue', 'GM_deleteValue', 'GM_listValues'] }
      );

      // Verify Object prototype was not polluted
      expect((Object.prototype as any)['__proto__']).not.toBe('value_for___proto__');
      expect((Object.prototype as any)['constructor']).not.toBe('value_for_constructor');

      // Verify values were safely saved and retrieved within the sandbox Map
      for (const k of hostileKeys) {
        expect((window as any).__hostileKeyResults[k]).toBe('value_for_' + k);
      }
      expect((window as any).__listedHostileKeys).toEqual(expect.arrayContaining(hostileKeys));

      delete (window as any).hostileKeys;
      delete (window as any).__hostileKeyResults;
      delete (window as any).__listedHostileKeys;
    });

    it('4.4: resilient handling of circular reference objects without crashing sandbox', () => {
      const code = `
        window.__circularResult = null;
        try {
          var circular = { name: 'circular_root' };
          circular.self = circular;

          GM_setValue('circular_key', circular);
          window.__circularResult = GM_getValue('circular_key');
        } catch (err) {
          window.__circularResult = 'CRASH:' + err.message;
        }
      `;

      const res = pageSandboxRunner(
        code,
        'Circular Script',
        'circ-id',
        { grants: ['GM_setValue', 'GM_getValue'] }
      );
      expect(res.success).toBe(true);

      // Should safely store stringified representation without throwing JSON circular error
      const circVal = (window as any).__circularResult;
      expect(circVal).toBe('[object Object]');
      delete (window as any).__circularResult;
    });

    it('4.5: strict storage isolation between concurrent userscript instances', () => {
      const code1 = `
        GM_setValue('sharedKey', 'SCRIPT_A_VALUE');
        window.__scriptA_read = GM_getValue('sharedKey');
      `;

      const code2 = `
        window.__scriptB_initial = GM_getValue('sharedKey', 'DEFAULT_B');
        GM_setValue('sharedKey', 'SCRIPT_B_VALUE');
        window.__scriptB_read = GM_getValue('sharedKey');
      `;

      // Run Script A
      pageSandboxRunner(code1, 'Script A', 'script-a', { grants: ['GM_setValue', 'GM_getValue'] });

      // Run Script B
      pageSandboxRunner(code2, 'Script B', 'script-b', { grants: ['GM_setValue', 'GM_getValue'] });

      expect((window as any).__scriptA_read).toBe('SCRIPT_A_VALUE');
      expect((window as any).__scriptB_initial).toBe('DEFAULT_B'); // Could not see Script A's value
      expect((window as any).__scriptB_read).toBe('SCRIPT_B_VALUE');

      delete (window as any).__scriptA_read;
      delete (window as any).__scriptB_initial;
      delete (window as any).__scriptB_read;
    });
  });

  // =========================================================================
  // Challenge 5: Serialization Check (Zero Unresolved Imports in Sandboxed Context)
  // =========================================================================
  describe('Challenge 5: Serialization Check (Zero Unresolved Imports in Sandboxed Context)', () => {
    it('5.1: pageSandboxRunner.toString() evaluates cleanly in pure node:vm context with zero imports', () => {
      const vmWindow: any = {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
      const vmDoc: any = {
        createElement: vi.fn(() => ({
          setAttribute: vi.fn(),
          textContent: ''
        })),
        head: { appendChild: vi.fn() }
      };

      // Create pure VM context without host Function override
      const sandboxContext = vm.createContext({
        console: { log: vi.fn(), error: vi.fn() },
        setTimeout,
        clearTimeout,
        window: vmWindow,
        document: vmDoc
      });

      // 1. Serialize pageSandboxRunner to string
      const serializedFn = pageSandboxRunner.toString();
      expect(typeof serializedFn).toBe('string');
      expect(serializedFn).toContain('function pageSandboxRunner');

      // 2. Evaluate function in completely isolated VM context (no require, no exports, no module)
      const vmCode = `
        const runner = (${serializedFn});
        const runResult = runner(
          'window.executedInsideVM = true; GM_setValue("vm_key", 42);',
          'VM Userscript',
          'vm-script-id',
          { grants: ['GM_setValue', 'GM_getValue', 'cdp'] },
          'vm-channel-id',
          { preloaded: 'yes' }
        );
        runResult;
      `;

      const result = vm.runInContext(vmCode, sandboxContext);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(vmWindow.executedInsideVM).toBe(true);
    });

    it('5.2: full live CDP event dispatch and persistent storage pipeline works inside VM sandbox', () => {
      const messagesDispatchedToPostMessage: any[] = [];
      let windowMessageListener: Function | null = null;

      const vmWindow: any = {
        postMessage: (msg: any) => {
          messagesDispatchedToPostMessage.push(msg);
        },
        addEventListener: (event: string, fn: Function) => {
          if (event === 'message') {
            windowMessageListener = fn;
          }
        },
        removeEventListener: (event: string, fn: Function) => {
          if (event === 'message') {
            windowMessageListener = null;
          }
        }
      };

      const sandboxContext = vm.createContext({
        console: { log: vi.fn(), error: vi.fn() },
        setTimeout,
        clearTimeout,
        window: vmWindow,
        document: { createElement: vi.fn() }
      });

      const userscriptCode = `
        window.__events = [];
        cdp.on('Page.loadEventFired', function(params) {
          window.__events.push('exact:' + params.timestamp);
        });
        cdp.on('Page.*', function(params, method) {
          window.__events.push('wildcard:' + method);
        });

        GM_setValue('test_persist', { hello: 'world' });
        window.__readSync = GM_getValue('test_persist');
        window.__keysSync = GM_listValues();
      `;

      const vmScript = `
        const runner = (${pageSandboxRunner.toString()});
        const res = runner(
          ${JSON.stringify(userscriptCode)},
          'VM Full Pipeline Test',
          'vm-pipeline-script',
          { grants: ['cdp', 'GM_setValue', 'GM_getValue', 'GM_listValues'] },
          'vm-channel-xyz'
        );
        res;
      `;

      const res = vm.runInContext(vmScript, sandboxContext);
      expect(res.success).toBe(true);

      expect(vmWindow.__readSync).toEqual({ hello: 'world' });
      expect(vmWindow.__keysSync).toEqual(['test_persist']);

      // Verify postMessage for GM_setValue was emitted inside VM
      expect(messagesDispatchedToPostMessage).toHaveLength(1);
      expect(messagesDispatchedToPostMessage[0]).toEqual({
        source: 'xokj-userscript',
        channelId: 'vm-channel-xyz',
        type: 'GM_STORAGE_SET',
        scriptId: 'vm-pipeline-script',
        key: 'test_persist',
        value: { hello: 'world' }
      });

      // Now emit live CDP event into VM window listener
      expect(windowMessageListener).toBeTypeOf('function');
      windowMessageListener!({
        source: vmWindow,
        data: {
          source: 'xokj-bridge',
          channelId: 'vm-channel-xyz',
          type: 'CDP_RPC_EVENT',
          method: 'Page.loadEventFired',
          params: { timestamp: 88888 }
        }
      });

      // Verify events received inside VM
      expect(vmWindow.__events).toEqual([
        'exact:88888',
        'wildcard:Page.loadEventFired'
      ]);
    });

    it('5.3: lexical analysis confirms zero free identifier references to out-of-scope modules or classes', () => {
      const codeStr = pageSandboxRunner.toString();

      // Prohibited imports or module symbols:
      const prohibitedSymbols = [
        'import ',
        'export ',
        'require(',
        'DevToolsConflictError',
        'CdpBridgeServer',
        'TabDebuggerManager',
        'GmStorageRepository',
        'ScriptInjector'
      ];

      for (const symbol of prohibitedSymbols) {
        // pageSandboxRunner itself should not contain any of these
        expect(codeStr).not.toContain(symbol);
      }
    });
  });
});
