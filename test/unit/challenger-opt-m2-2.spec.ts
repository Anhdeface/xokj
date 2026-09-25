import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { ScriptInjector } from '@/background/injector';
import { DevToolsConflictError } from '@/shared/types';
import { resetToDefaultScripts, saveScript } from '@/shared/storage';
import type { ScriptRecord } from '@/shared/types';

describe('Empirical Challenger Opt-M2-2: Memory Retention, Cleanup & Map Pruning Under High-Volume Stress', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();

    // Universal script to ensure all test URLs match for injection tests
    const universalScript: ScriptRecord = {
      id: 'universal-challenger-script',
      name: 'Universal Challenger Script',
      code: '// ==UserScript==\n// @match *://*/*\n// ==/UserScript==',
      metadata: {
        name: 'Universal Challenger Script',
        matches: ['*://*/*'],
        matchPatterns: ['*://*/*'],
        includes: [],
        excludes: [],
        runAt: 'document-start',
        grants: [],
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
    await saveScript(universalScript);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Challenge Suite 1: CdpBridgeServer tabRequests Map Lifecycle & Memory Pruning
  // =========================================================================
  describe('Challenge 1: CdpBridgeServer tabRequests Map Lifecycle & Pruning (500+ requests)', () => {
    it('1.1: 500 sequential requests on a single tab prune tabRequests key after each completion', async () => {
      const server = new CdpBridgeServer({ autoAttach: false });
      server.init();

      context.mockDebugger.sendCommand.mockResolvedValue({ success: true });
      const tabId = 42;

      // Access internal map via private accessor
      const tabRequestsMap = (server as any).tabRequests as Map<number, Set<string>>;
      const inflightMap = (server as any).inflightRequests as Map<string, any>;

      for (let i = 0; i < 500; i++) {
        const reqId = `seq-req-${i}`;
        const cmdPromise = server.executeCommand(tabId, 'Runtime.evaluate', { expression: `${i}` }, reqId);

        // While inflight, tabRequests must contain tabId with 1 request
        expect(tabRequestsMap.has(tabId)).toBe(true);
        expect(tabRequestsMap.get(tabId)?.size).toBe(1);
        expect(tabRequestsMap.get(tabId)?.has(reqId)).toBe(true);

        const res = await cmdPromise;
        expect(res.success).toBe(true);

        // Immediately after completion, tabRequests key MUST be deleted (not an empty Set!)
        expect(tabRequestsMap.has(tabId)).toBe(false);
        expect(tabRequestsMap.get(tabId)).toBeUndefined();
        expect(tabRequestsMap.size).toBe(0);
        expect(inflightMap.size).toBe(0);
      }

      expect(tabRequestsMap.size).toBe(0);
      server.destroy();
    });

    it('1.2: 500 concurrent requests across 50 tabs (10 per tab) prune all tabRequests entries to size 0', async () => {
      const server = new CdpBridgeServer({ autoAttach: false });
      server.init();

      const TAB_COUNT = 50;
      const REQS_PER_TAB = 10;
      const TOTAL_REQS = TAB_COUNT * REQS_PER_TAB;

      // Delayed resolution to ensure all requests are concurrently inflight
      let resolveAllCommand: (val: any) => void;
      const delayedCommandPromise = new Promise<any>((resolve) => {
        resolveAllCommand = resolve;
      });
      context.mockDebugger.sendCommand.mockImplementation(() => delayedCommandPromise);

      const tabRequestsMap = (server as any).tabRequests as Map<number, Set<string>>;
      const inflightMap = (server as any).inflightRequests as Map<string, any>;

      const promises: Promise<any>[] = [];

      for (let t = 1; t <= TAB_COUNT; t++) {
        const tabId = 1000 + t;
        for (let r = 0; r < REQS_PER_TAB; r++) {
          promises.push(
            server.executeCommand(tabId, 'DOM.getDocument', { depth: 1 }, `tab-${tabId}-req-${r}`)
          );
        }
      }

      // Assert all 500 are inflight and registered in tabRequests across all 50 tabs
      expect(inflightMap.size).toBe(TOTAL_REQS);
      expect(tabRequestsMap.size).toBe(TAB_COUNT);
      for (let t = 1; t <= TAB_COUNT; t++) {
        const tabId = 1000 + t;
        expect(tabRequestsMap.has(tabId)).toBe(true);
        expect(tabRequestsMap.get(tabId)?.size).toBe(REQS_PER_TAB);
      }

      // Resolve all 500 commands concurrently
      resolveAllCommand!({ root: { nodeId: 1 } });
      const results = await Promise.all(promises);

      expect(results.length).toBe(TOTAL_REQS);
      for (const res of results) {
        expect(res.success).toBe(true);
      }

      // Assert complete memory deallocation: every tab entry is pruned
      expect(tabRequestsMap.size).toBe(0);
      expect(inflightMap.size).toBe(0);
      for (let t = 1; t <= TAB_COUNT; t++) {
        const tabId = 1000 + t;
        expect(tabRequestsMap.has(tabId)).toBe(false);
      }

      server.destroy();
    });

    it('1.3: 500 high-volume requests with mixed outcomes (success, failure, timeout, attach error) cleanly deallocate', async () => {
      // Short timeout for fast testing of timeouts
      const server = new CdpBridgeServer({ autoAttach: true, timeoutMs: 15 });
      server.init();

      const tabRequestsMap = (server as any).tabRequests as Map<number, Set<string>>;
      const inflightMap = (server as any).inflightRequests as Map<string, any>;

      // Mock debugger behavior based on method:
      // - "Success.method": resolves normally
      // - "Fail.method": rejects command
      // - "Timeout.method": hangs until timeout
      // - Tab 9001-9010: attach fails
      context.mockDebugger.attach.mockImplementation(async (target: { tabId?: number }) => {
        if ((target.tabId ?? 0) >= 9000) {
          throw new Error(`Failed to attach debugger to tab ${target.tabId}`);
        }
      });

      context.mockDebugger.sendCommand.mockImplementation(async (_target, method) => {
        if (method === 'Success.method') {
          return { data: 'ok' };
        }
        if (method === 'Fail.method') {
          throw new Error('CDP internal execution error');
        }
        if (method === 'Timeout.method') {
          return new Promise(() => {}); // never resolves, triggers timeout
        }
        return {};
      });

      const promises: Promise<any>[] = [];

      // 150 successes across tabs 101-115 (10 each)
      for (let t = 0; t < 15; t++) {
        const tabId = 101 + t;
        for (let r = 0; r < 10; r++) {
          promises.push(server.executeCommand(tabId, 'Success.method', {}, `success-${tabId}-${r}`));
        }
      }

      // 150 failures across tabs 201-215 (10 each)
      for (let t = 0; t < 15; t++) {
        const tabId = 201 + t;
        for (let r = 0; r < 10; r++) {
          promises.push(server.executeCommand(tabId, 'Fail.method', {}, `fail-${tabId}-${r}`));
        }
      }

      // 100 timeouts across tabs 301-310 (10 each)
      for (let t = 0; t < 10; t++) {
        const tabId = 301 + t;
        for (let r = 0; r < 10; r++) {
          promises.push(server.executeCommand(tabId, 'Timeout.method', {}, `timeout-${tabId}-${r}`));
        }
      }

      // 100 attach failures across tabs 9001-9010 (10 each)
      for (let t = 0; t < 10; t++) {
        const tabId = 9001 + t;
        for (let r = 0; r < 10; r++) {
          promises.push(server.executeCommand(tabId, 'Success.method', {}, `attacherr-${tabId}-${r}`));
        }
      }

      expect(promises.length).toBe(500);

      const results = await Promise.all(promises);
      expect(results.length).toBe(500);

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success && r.error?.message?.includes('CDP internal execution error')).length;
      const timeoutCount = results.filter((r) => !r.success && r.error?.message?.includes('timed out')).length;
      const attachErrCount = results.filter((r) => !r.success && r.error?.message?.includes('Failed to attach')).length;

      expect(successCount).toBe(150);
      expect(failCount).toBe(150);
      expect(timeoutCount).toBe(100);
      expect(attachErrCount).toBe(100);

      // CRITICAL ASSERTION: Across all 500 requests with 4 diverse failure modes,
      // ZERO entries or sets are leaked in tabRequests or inflightRequests
      expect(tabRequestsMap.size).toBe(0);
      expect(inflightMap.size).toBe(0);

      server.destroy();
    });

    it('1.4: 500 inflight requests across 25 tabs racing against sudden tab closures (handleTabRemoved)', async () => {
      const server = new CdpBridgeServer({ autoAttach: false });
      server.init();

      const tabRequestsMap = (server as any).tabRequests as Map<number, Set<string>>;
      const inflightMap = (server as any).inflightRequests as Map<string, any>;

      // Track all resolvers per tab to resolve or cancel accurately
      const deferredResolvers = new Map<number, ((val: any) => void)[]>();
      context.mockDebugger.sendCommand.mockImplementation((target, _method, _params) => {
        return new Promise((resolve) => {
          const tabId = target.tabId!;
          let list = deferredResolvers.get(tabId);
          if (!list) {
            list = [];
            deferredResolvers.set(tabId, list);
          }
          list.push(resolve);
        });
      });

      const promises: Promise<any>[] = [];
      const TAB_COUNT = 25;
      const REQS_PER_TAB = 20;

      for (let t = 1; t <= TAB_COUNT; t++) {
        const tabId = 500 + t;
        for (let r = 0; r < REQS_PER_TAB; r++) {
          promises.push(
            server.executeCommand(tabId, 'Page.captureScreenshot', {}, `close-race-${tabId}-${r}`)
          );
        }
      }

      expect(inflightMap.size).toBe(500);
      expect(tabRequestsMap.size).toBe(25);

      // Close the first 15 tabs simultaneously while 300 requests are inflight
      for (let t = 1; t <= 15; t++) {
        const tabId = 500 + t;
        server.handleTabRemoved(tabId);
        // tabRequests for closed tab must be deleted instantly
        expect(tabRequestsMap.has(tabId)).toBe(false);
      }

      // The remaining 10 tabs (tabs 516 to 525, 200 requests) finish normally
      for (let t = 16; t <= TAB_COUNT; t++) {
        const tabId = 500 + t;
        const resolvers = deferredResolvers.get(tabId) || [];
        for (const resolve of resolvers) {
          resolve({ data: 'image_bytes' });
        }
      }

      const results = await Promise.all(promises);
      expect(results.length).toBe(500);

      // Verify that all 300 closed-tab requests failed with code 1002 (target closed)
      const closedResults = results.slice(0, 300);
      for (const res of closedResults) {
        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(1002);
        expect(res.error?.message).toContain('was closed');
      }

      // Verify that remaining 200 requests succeeded
      const normalResults = results.slice(300);
      for (const res of normalResults) {
        expect(res.success).toBe(true);
      }

      // Verify complete deallocation of maps
      expect(tabRequestsMap.size).toBe(0);
      expect(inflightMap.size).toBe(0);

      server.destroy();
    });

    it('1.5: 200 inflight requests across 10 tabs racing against DevTools conflict detachment', async () => {
      const server = new CdpBridgeServer({ autoAttach: false });
      server.init();

      const tabRequestsMap = (server as any).tabRequests as Map<number, Set<string>>;
      const inflightMap = (server as any).inflightRequests as Map<string, any>;

      context.mockDebugger.sendCommand.mockImplementation(() => new Promise(() => {}));

      const promises: Promise<any>[] = [];
      const TAB_COUNT = 10;
      const REQS_PER_TAB = 20;

      for (let t = 1; t <= TAB_COUNT; t++) {
        const tabId = 600 + t;
        for (let r = 0; r < REQS_PER_TAB; r++) {
          promises.push(
            server.executeCommand(tabId, 'Network.enable', {}, `conflict-${tabId}-${r}`)
          );
        }
      }

      expect(inflightMap.size).toBe(200);
      expect(tabRequestsMap.size).toBe(10);

      // Trigger DevTools conflict on all 10 tabs
      for (let t = 1; t <= TAB_COUNT; t++) {
        const tabId = 600 + t;
        const rejected = server.rejectPendingRequestsForTab(
          tabId,
          new DevToolsConflictError(tabId, 'replaced_with_devtools', `DevTools opened on tab ${tabId}`)
        );
        expect(rejected).toBe(REQS_PER_TAB);
        expect(tabRequestsMap.has(tabId)).toBe(false);
      }

      const results = await Promise.all(promises);
      expect(results.length).toBe(200);

      for (const res of results) {
        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(1001);
      }

      expect(tabRequestsMap.size).toBe(0);
      expect(inflightMap.size).toBe(0);

      server.destroy();
    });

    it('1.6: Continuous churn: 1,000 rapid requests in randomized bursts leave zero residual entries', async () => {
      const server = new CdpBridgeServer({ autoAttach: false });
      server.init();

      context.mockDebugger.sendCommand.mockResolvedValue({ status: 'ok' });

      const tabRequestsMap = (server as any).tabRequests as Map<number, Set<string>>;
      const inflightMap = (server as any).inflightRequests as Map<string, any>;

      let totalSent = 0;
      const TOTAL_TARGET = 1000;

      while (totalSent < TOTAL_TARGET) {
        const burstSize = Math.min(Math.floor(Math.random() * 20) + 1, TOTAL_TARGET - totalSent);
        const burstPromises: Promise<any>[] = [];

        for (let i = 0; i < burstSize; i++) {
          const tabId = 700 + Math.floor(Math.random() * 10); // 10 random tabs
          burstPromises.push(
            server.executeCommand(tabId, 'DOM.enable', {}, `churn-${totalSent + i}`)
          );
        }

        totalSent += burstSize;
        await Promise.all(burstPromises);

        // Every burst completion must leave no orphaned empty Sets in tabRequests
        for (const [tabId, reqSet] of tabRequestsMap.entries()) {
          expect(reqSet.size).toBeGreaterThan(0);
        }
      }

      expect(totalSent).toBe(TOTAL_TARGET);
      expect(tabRequestsMap.size).toBe(0);
      expect(inflightMap.size).toBe(0);

      server.destroy();
    });

    it('1.7: Re-entrant requests on a recently closed and pruned tab correctly recreate and prune entries', async () => {
      const server = new CdpBridgeServer({ autoAttach: false });
      server.init();

      context.mockDebugger.sendCommand.mockResolvedValue({ step: 1 });

      const tabRequestsMap = (server as any).tabRequests as Map<number, Set<string>>;
      const tabId = 888;

      // Cycle 1: execute and complete
      await server.executeCommand(tabId, 'Runtime.enable', {}, 'c1-req');
      expect(tabRequestsMap.has(tabId)).toBe(false);

      // Cycle 2: simulate tab closure event
      server.handleTabRemoved(tabId);
      expect(tabRequestsMap.has(tabId)).toBe(false);

      // Cycle 3: re-entrant new request on same tabId
      const p = server.executeCommand(tabId, 'Runtime.enable', {}, 'c3-req');
      expect(tabRequestsMap.has(tabId)).toBe(true);
      expect(tabRequestsMap.get(tabId)?.size).toBe(1);

      await p;
      expect(tabRequestsMap.has(tabId)).toBe(false);
      expect(tabRequestsMap.size).toBe(0);

      server.destroy();
    });
  });

  // =========================================================================
  // Challenge Suite 2: ScriptInjector injectionHistory & Frame Tracking Pruning
  // =========================================================================
  describe('Challenge 2: ScriptInjector injectionHistory & Frame Tracking Map Pruning', () => {
    let injector: ScriptInjector;

    beforeEach(() => {
      injector = new ScriptInjector({ autoStart: true });
    });

    afterEach(() => {
      injector.destroy();
    });

    it('2.1: Multi-frame injection creates isolated history sets per frame under a single tab entry', async () => {
      const tabId = 100;
      const historyMap = (injector as any).injectionHistory as Map<number, Map<number, Set<string>>>;

      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: 'https://example.com/main',
        transitionType: 'link',
        documentId: 'doc-main-1'
      });

      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/iframe1',
        transitionType: 'auto_subframe',
        documentId: 'doc-sub-1'
      });

      await injector.handleCommitted({
        tabId,
        frameId: 2,
        url: 'https://example.com/iframe2',
        transitionType: 'auto_subframe',
        documentId: 'doc-sub-2'
      });

      expect(historyMap.has(tabId)).toBe(true);
      const tabMap = historyMap.get(tabId)!;
      expect(tabMap.has(0)).toBe(true);
      expect(tabMap.has(1)).toBe(true);
      expect(tabMap.has(2)).toBe(true);

      const frameUrls = (injector as any).frameUrls.get(tabId);
      expect(frameUrls?.get(1)).toBe('https://example.com/iframe1');
      expect(frameUrls?.get(2)).toBe('https://example.com/iframe2');
    });

    it('2.2: Subframe navigation with new documentId resets subframe history without leaking stale document IDs', async () => {
      const tabId = 101;
      const historyMap = (injector as any).injectionHistory as Map<number, Map<number, Set<string>>>;
      const frameDocMap = (injector as any).frameDocumentIds as Map<number, Map<number, string>>;

      // Main frame commit
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: 'https://example.com/app',
        documentId: 'doc-main'
      });

      // Subframe 1 commits initial doc
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/sub/v1',
        documentId: 'doc-sub-v1'
      });

      expect(frameDocMap.get(tabId)?.get(1)).toBe('doc-sub-v1');

      // Populate history for frame 1
      historyMap.get(tabId)!.get(1)!.add('script-a:document-start');
      expect(historyMap.get(tabId)!.get(1)!.has('script-a:document-start')).toBe(true);

      // Subframe 1 navigates to new doc
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/sub/v2',
        documentId: 'doc-sub-v2'
      });

      // Frame 1 documentId must be updated
      expect(frameDocMap.get(tabId)?.get(1)).toBe('doc-sub-v2');

      // Frame 1 previous script history must have been reset and not retained
      expect(historyMap.get(tabId)!.get(1)!.has('script-a:document-start')).toBe(false);
      expect(historyMap.get(tabId)!.get(0)).toBeDefined(); // main frame intact
    });

    it('2.3: Subframe reload or navigation without documentId resets subframe history', async () => {
      const tabId = 102;
      const historyMap = (injector as any).injectionHistory as Map<number, Map<number, Set<string>>>;

      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: 'https://example.com/app'
      });

      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/sub/v1'
      });

      historyMap.get(tabId)!.get(1)!.add('custom-script:document-start');

      // Subframe reload without documentId
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/sub/v1',
        transitionType: 'reload'
      });

      // History for frame 1 must be cleared
      expect(historyMap.get(tabId)!.get(1)!.has('custom-script:document-start')).toBe(false);
    });

    it('2.4: Sequential clearing of subframes progressively removes frame entries and unregisters tabId when the final frame is cleared', () => {
      const tabId = 103;
      const historyMap = (injector as any).injectionHistory as Map<number, Map<number, Set<string>>>;
      const frameUrlsMap = (injector as any).frameUrls as Map<number, Map<number, string>>;
      const frameDocsMap = (injector as any).frameDocumentIds as Map<number, Map<number, string>>;

      // Setup 5 subframes (frames 1 to 5) under tab 103
      const frameMap = new Map<number, Set<string>>();
      const urlMap = new Map<number, string>();
      const docMap = new Map<number, string>();

      for (let f = 1; f <= 5; f++) {
        frameMap.set(f, new Set([`script-${f}:document-start`]));
        urlMap.set(f, `https://example.com/sub-${f}`);
        docMap.set(f, `doc-sub-${f}`);
      }

      historyMap.set(tabId, frameMap);
      frameUrlsMap.set(tabId, urlMap);
      frameDocsMap.set(tabId, docMap);

      expect(historyMap.has(tabId)).toBe(true);
      expect(frameUrlsMap.has(tabId)).toBe(true);
      expect(frameDocsMap.has(tabId)).toBe(true);

      // Progressively clear frames 1 through 4
      for (let f = 1; f <= 4; f++) {
        injector.clearFrameHistory(tabId, f);

        expect(frameMap.has(f)).toBe(false);
        expect(urlMap.has(f)).toBe(false);
        expect(docMap.has(f)).toBe(false);

        // Tab entry must still exist because frame 5 is still present
        expect(historyMap.has(tabId)).toBe(true);
        expect(frameUrlsMap.has(tabId)).toBe(true);
        expect(frameDocsMap.has(tabId)).toBe(true);
      }

      // Clear final frame (frame 5)
      injector.clearFrameHistory(tabId, 5);

      // Now all maps must have pruned the tabId completely (size 0)
      expect(historyMap.has(tabId)).toBe(false);
      expect(frameUrlsMap.has(tabId)).toBe(false);
      expect(frameDocsMap.has(tabId)).toBe(false);
    });

    it('2.5: Top-level navigation (frameId === 0) resets all nested subframe injection histories and frame tracking maps', async () => {
      const tabId = 104;
      const historyMap = (injector as any).injectionHistory as Map<number, Map<number, Set<string>>>;
      const frameUrlsMap = (injector as any).frameUrls as Map<number, Map<number, string>>;
      const frameDocsMap = (injector as any).frameDocumentIds as Map<number, Map<number, string>>;

      // Initial commit on page 1 with 3 subframes
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: 'https://site-a.com/',
        documentId: 'doc-site-a'
      });

      for (let f = 1; f <= 3; f++) {
        await injector.handleCommitted({
          tabId,
          frameId: f,
          url: `https://site-a.com/sub-${f}`,
          documentId: `doc-sub-${f}`
        });
      }

      expect(historyMap.get(tabId)?.size).toBe(4); // frames 0, 1, 2, 3
      expect(frameUrlsMap.get(tabId)?.size).toBe(3);
      expect(frameDocsMap.get(tabId)?.size).toBe(3);

      // Top-level navigation to site B with new documentId
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: 'https://site-b.com/',
        documentId: 'doc-site-b'
      });

      // Frame URLs and Frame Docs for old subframes must be completely pruned
      expect(frameUrlsMap.has(tabId)).toBe(false);
      expect(frameDocsMap.has(tabId)).toBe(false);

      // Injection history for old subframes must be gone; only new frame 0 exists
      const currentHistory = historyMap.get(tabId);
      expect(currentHistory?.has(1)).toBe(false);
      expect(currentHistory?.has(2)).toBe(false);
      expect(currentHistory?.has(3)).toBe(false);
      expect(currentHistory?.has(0)).toBe(true);
    });

    it('2.6: Tab closure (handleTabRemoved) unconditionally purges injectionHistory, tabUrls, tabDocumentIds, frameUrls, and frameDocumentIds', async () => {
      const tabId = 105;
      const historyMap = (injector as any).injectionHistory as Map<number, Map<number, Set<string>>>;
      const tabUrlsMap = (injector as any).tabUrls as Map<number, string>;
      const tabDocsMap = (injector as any).tabDocumentIds as Map<number, string>;
      const frameUrlsMap = (injector as any).frameUrls as Map<number, Map<number, string>>;
      const frameDocsMap = (injector as any).frameDocumentIds as Map<number, Map<number, string>>;

      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: 'https://example.com/app',
        documentId: 'doc-tab-105'
      });

      for (let f = 1; f <= 5; f++) {
        await injector.handleCommitted({
          tabId,
          frameId: f,
          url: `https://example.com/frame-${f}`,
          documentId: `doc-sub-${f}`
        });
      }

      expect(historyMap.has(tabId)).toBe(true);
      expect(tabUrlsMap.has(tabId)).toBe(true);
      expect(tabDocsMap.has(tabId)).toBe(true);
      expect(frameUrlsMap.has(tabId)).toBe(true);
      expect(frameDocsMap.has(tabId)).toBe(true);

      // Trigger tab removal
      injector.handleTabRemoved(tabId);

      expect(historyMap.has(tabId)).toBe(false);
      expect(tabUrlsMap.has(tabId)).toBe(false);
      expect(tabDocsMap.has(tabId)).toBe(false);
      expect(frameUrlsMap.has(tabId)).toBe(false);
      expect(frameDocsMap.has(tabId)).toBe(false);
    });

    it('2.7: High-volume tab churn: 100 tabs with 5 subframes each (600 frames total) completely purged to map size 0 upon tab closures', async () => {
      const historyMap = (injector as any).injectionHistory as Map<number, Map<number, Set<string>>>;
      const tabUrlsMap = (injector as any).tabUrls as Map<number, string>;
      const tabDocsMap = (injector as any).tabDocumentIds as Map<number, string>;
      const frameUrlsMap = (injector as any).frameUrls as Map<number, Map<number, string>>;
      const frameDocsMap = (injector as any).frameDocumentIds as Map<number, Map<number, string>>;

      const TAB_COUNT = 100;
      const SUBFRAMES_PER_TAB = 5;

      // Open and commit all 100 tabs with subframes
      for (let t = 1; t <= TAB_COUNT; t++) {
        const tabId = 2000 + t;
        await injector.handleCommitted({
          tabId,
          frameId: 0,
          url: `https://test-${t}.org/`,
          documentId: `doc-${tabId}-0`
        });

        for (let f = 1; f <= SUBFRAMES_PER_TAB; f++) {
          await injector.handleCommitted({
            tabId,
            frameId: f,
            url: `https://test-${t}.org/sub/${f}`,
            documentId: `doc-${tabId}-${f}`
          });
        }
      }

      expect(historyMap.size).toBe(TAB_COUNT);
      expect(tabUrlsMap.size).toBe(TAB_COUNT);
      expect(tabDocsMap.size).toBe(TAB_COUNT);
      expect(frameUrlsMap.size).toBe(TAB_COUNT);
      expect(frameDocsMap.size).toBe(TAB_COUNT);

      // Close all 100 tabs
      for (let t = 1; t <= TAB_COUNT; t++) {
        const tabId = 2000 + t;
        injector.handleTabRemoved(tabId);
      }

      // Memory footprint must be exactly 0 across all tracking structures
      expect(historyMap.size).toBe(0);
      expect(tabUrlsMap.size).toBe(0);
      expect(tabDocsMap.size).toBe(0);
      expect(frameUrlsMap.size).toBe(0);
      expect(frameDocsMap.size).toBe(0);
    });

    it('2.8: Repeated subframe re-navigations (50 times) maintain bounded single-entry frame tracking maps without memory accumulation', async () => {
      const tabId = 300;
      const frameUrlsMap = (injector as any).frameUrls as Map<number, Map<number, string>>;
      const frameDocsMap = (injector as any).frameDocumentIds as Map<number, Map<number, string>>;
      const historyMap = (injector as any).injectionHistory as Map<number, Map<number, Set<string>>>;

      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: 'https://example.com/',
        documentId: 'doc-root'
      });

      // Navigate frame 1 fifty times with unique URLs and documentIds
      for (let n = 1; n <= 50; n++) {
        await injector.handleCommitted({
          tabId,
          frameId: 1,
          url: `https://example.com/step/${n}`,
          documentId: `doc-step-${n}`
        });

        // Frame tracking must stay strictly bounded: exactly 1 entry for frame 1
        expect(frameUrlsMap.get(tabId)?.size).toBe(1);
        expect(frameDocsMap.get(tabId)?.size).toBe(1);
        expect(frameUrlsMap.get(tabId)?.get(1)).toBe(`https://example.com/step/${n}`);
        expect(frameDocsMap.get(tabId)?.get(1)).toBe(`doc-step-${n}`);
      }

      // Only frames 0 and 1 exist in history
      expect(historyMap.get(tabId)?.size).toBe(2);

      // Now unload frame 1
      injector.clearFrameHistory(tabId, 1);
      expect(frameUrlsMap.has(tabId)).toBe(false);
      expect(frameDocsMap.has(tabId)).toBe(false);
      expect(historyMap.get(tabId)?.size).toBe(1); // frame 0 remains
    });

    it('2.9: Subframe committed navigation before main frame navigation cleanly clears and prunes without throwing or leaking', async () => {
      const tabId = 400;
      const frameUrlsMap = (injector as any).frameUrls as Map<number, Map<number, string>>;
      const frameDocsMap = (injector as any).frameDocumentIds as Map<number, Map<number, string>>;
      const historyMap = (injector as any).injectionHistory as Map<number, Map<number, Set<string>>>;

      // Subframe navigates without prior frame 0 commit
      await injector.handleCommitted({
        tabId,
        frameId: 99,
        url: 'https://orphan-sub.example.com/',
        documentId: 'doc-orphan-99'
      });

      expect(frameUrlsMap.get(tabId)?.get(99)).toBe('https://orphan-sub.example.com/');
      expect(frameDocsMap.get(tabId)?.get(99)).toBe('doc-orphan-99');

      // Unload subframe 99
      injector.clearFrameHistory(tabId, 99);

      // Entire tab entry must be pruned
      expect(frameUrlsMap.has(tabId)).toBe(false);
      expect(frameDocsMap.has(tabId)).toBe(false);
      expect(historyMap.has(tabId)).toBe(false);
    });

    it('2.10: destroy() thoroughly clears all nested Sets and Maps across all tracking structures', async () => {
      const tabId = 500;
      const historyMap = (injector as any).injectionHistory as Map<number, Map<number, Set<string>>>;
      const tabUrlsMap = (injector as any).tabUrls as Map<number, string>;
      const tabDocsMap = (injector as any).tabDocumentIds as Map<number, string>;
      const frameUrlsMap = (injector as any).frameUrls as Map<number, Map<number, string>>;
      const frameDocsMap = (injector as any).frameDocumentIds as Map<number, Map<number, string>>;

      for (let f = 0; f <= 3; f++) {
        await injector.handleCommitted({
          tabId,
          frameId: f,
          url: `https://destroy-test.com/frame-${f}`,
          documentId: `doc-${f}`
        });
      }

      // Capture references to nested sets and maps to verify .clear() was called
      const frameMapRef = historyMap.get(tabId)!;
      expect(frameMapRef).toBeDefined();
      const scriptSet0Ref = frameMapRef.get(0)!;
      expect(scriptSet0Ref).toBeDefined();
      const subUrlMapRef = frameUrlsMap.get(tabId)!;
      expect(subUrlMapRef).toBeDefined();
      const subDocMapRef = frameDocsMap.get(tabId)!;
      expect(subDocMapRef).toBeDefined();

      injector.destroy();

      // All outer maps must be empty
      expect(historyMap.size).toBe(0);
      expect(tabUrlsMap.size).toBe(0);
      expect(tabDocsMap.size).toBe(0);
      expect(frameUrlsMap.size).toBe(0);
      expect(frameDocsMap.size).toBe(0);

      // All inner maps and sets must have been cleared
      expect(frameMapRef.size).toBe(0);
      expect(scriptSet0Ref.size).toBe(0);
      expect(subUrlMapRef.size).toBe(0);
      expect(subDocMapRef.size).toBe(0);
    });
  });

  // =========================================================================
  // Challenge Suite 3: Cross-Subsystem Combined High-Load Stress Harness
  // =========================================================================
  describe('Challenge 3: Combined Background Subsystem Memory Integrity & Stress Harness', () => {
    it('3.1: 50 concurrent tabs simultaneously executing CDP commands and script injections deallocate 100% cleanly', async () => {
      const server = new CdpBridgeServer({ autoAttach: false });
      server.init();
      const injector = new ScriptInjector({ autoStart: true });

      context.mockDebugger.sendCommand.mockResolvedValue({ result: 'pass' });

      const cdpTabRequests = (server as any).tabRequests as Map<number, Set<string>>;
      const cdpInflight = (server as any).inflightRequests as Map<string, any>;
      const injectorHistory = (injector as any).injectionHistory as Map<number, Map<number, Set<string>>>;
      const injectorTabUrls = (injector as any).tabUrls as Map<number, string>;
      const injectorFrameUrls = (injector as any).frameUrls as Map<number, Map<number, string>>;

      const TAB_COUNT = 50;
      const cdpPromises: Promise<any>[] = [];

      for (let t = 1; t <= TAB_COUNT; t++) {
        const tabId = 3000 + t;

        // Script injector navigation commit
        await injector.handleCommitted({
          tabId,
          frameId: 0,
          url: `https://stress-app-${t}.com/`,
          documentId: `doc-${tabId}`
        });

        // 2 subframes per tab
        await injector.handleCommitted({
          tabId,
          frameId: 1,
          url: `https://stress-app-${t}.com/sub1`,
          documentId: `doc-${tabId}-sub1`
        });
        await injector.handleCommitted({
          tabId,
          frameId: 2,
          url: `https://stress-app-${t}.com/sub2`,
          documentId: `doc-${tabId}-sub2`
        });

        // 4 CDP commands per tab (200 total)
        for (let c = 0; c < 4; c++) {
          cdpPromises.push(
            server.executeCommand(tabId, 'Runtime.evaluate', { expression: `${t}:${c}` }, `stress-${tabId}-${c}`)
          );
        }
      }

      expect(injectorHistory.size).toBe(TAB_COUNT);
      expect(injectorFrameUrls.size).toBe(TAB_COUNT);

      // Wait for all CDP commands to complete
      const cdpResults = await Promise.all(cdpPromises);
      expect(cdpResults.length).toBe(200);
      for (const res of cdpResults) {
        expect(res.success).toBe(true);
      }

      // Assert CDP tabRequests is already completely pruned
      expect(cdpTabRequests.size).toBe(0);
      expect(cdpInflight.size).toBe(0);

      // Close all 50 tabs in both subsystems
      for (let t = 1; t <= TAB_COUNT; t++) {
        const tabId = 3000 + t;
        server.handleTabRemoved(tabId);
        injector.handleTabRemoved(tabId);
      }

      // Assert both subsystems have zero retained tab entries
      expect(cdpTabRequests.size).toBe(0);
      expect(cdpInflight.size).toBe(0);
      expect(injectorHistory.size).toBe(0);
      expect(injectorTabUrls.size).toBe(0);
      expect(injectorFrameUrls.size).toBe(0);

      server.destroy();
      injector.destroy();
    });
  });
});
