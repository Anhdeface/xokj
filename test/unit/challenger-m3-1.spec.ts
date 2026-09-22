/**
 * Empirical Challenger M3-1: Navigation Lifecycle, Subframe Stress & Tab Removal Races
 * Location: test/unit/challenger-m3-1.spec.ts
 *
 * Rigorous empirical stress test suite challenging:
 * 1. Deep nested subframes and multiple sibling iframes navigating simultaneously.
 * 2. Subframe navigating to same vs different URLs (with/without reload, with/without documentId).
 * 3. Same-URL link navigation reset on top-level frame (frameId === 0) with and without documentId.
 * 4. Rapid concurrent tab removals racing against active processStage (zombie tab resurrection / leak test).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { ScriptInjector } from '@/background/injector';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { saveScript, resetToDefaultScripts, deleteScript } from '@/shared/storage';
import type { ScriptRecord } from '@/shared/types';

describe('Empirical Challenger M3-1: Navigation Lifecycle & Subframe Stress', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let debuggerMgr: TabDebuggerManager;
  let injector: ScriptInjector;
  let executedScripts: any[] = [];

  beforeEach(async () => {
    context = setupChromeMock();
    executedScripts = [];

    context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
      executedScripts.push(opts);
      return [{ result: { success: true } }];
    });

    await resetToDefaultScripts();

    debuggerMgr = new TabDebuggerManager();
    await debuggerMgr.init();

    injector = new ScriptInjector({
      debuggerManager: debuggerMgr,
      autoStart: true
    });
  });

  afterEach(() => {
    injector.destroy();
    debuggerMgr.destroy();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Dimension 1: Sibling and Deep Nested Subframes Navigating Simultaneously
  // =========================================================================
  describe('Dimension 1: Sibling & Deep Nested Subframes Navigating Simultaneously', () => {
    it('C1.1: 50 sibling iframes navigating simultaneously inject scripts independently without cross-frame pollution', async () => {
      const tabId = 1001;
      const iframeCount = 50;

      // Script matching all pages and frames
      const universalScript: ScriptRecord = {
        id: 'universal-frame-script',
        name: 'Universal Frame Script',
        code: '// universal',
        metadata: {
          name: 'Universal Frame Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
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
      await deleteScript('sample-cdp-logger');
      await saveScript(universalScript);

      // Simulate 50 sibling iframes navigating at the exact same instant
      await Promise.all(
        Array.from({ length: iframeCount }, (_, i) => {
          const frameId = i + 1;
          return injector.handleCommitted({
            tabId,
            frameId,
            url: `https://example.com/widget-${frameId}`,
            processId: 1,
            transitionType: 'auto_subframe',
            documentId: `doc-subframe-${frameId}`,
            timeStamp: Date.now()
          });
        })
      );

      // Every frame must have received exactly 1 script execution targeting its specific frameId
      expect(executedScripts.length).toBe(iframeCount);

      const targetedFrameIds = executedScripts.map((s) => s.target.frameIds[0]).sort((a, b) => a - b);
      const expectedFrameIds = Array.from({ length: iframeCount }, (_, i) => i + 1);
      expect(targetedFrameIds).toEqual(expectedFrameIds);

      // Verify each frame is marked as injected
      for (let i = 1; i <= iframeCount; i++) {
        expect(injector.hasInjected(tabId, i, 'universal-frame-script', 'document-start')).toBe(true);
      }
    });

    it('C1.2: Deep nested frames (hierarchical frameIds) respect noframes directive on all subframes', async () => {
      const tabId = 1002;
      const deepFrameIds = [0, 10, 100, 1000, 10000];

      const noframesScript: ScriptRecord = {
        id: 'noframes-strict-test',
        name: 'No Frames Strict',
        code: '// top only',
        metadata: {
          name: 'No Frames Strict',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: true,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await deleteScript('sample-cdp-logger');
      await saveScript(noframesScript);

      // Navigate all frames concurrently
      await Promise.all(
        deepFrameIds.map((frameId) =>
          injector.handleCommitted({
            tabId,
            frameId,
            url: `https://example.com/level-${frameId}`,
            processId: 1,
            transitionType: frameId === 0 ? 'link' : 'auto_subframe',
            documentId: `doc-${frameId}`,
            timeStamp: Date.now()
          })
        )
      );

      // Only top-level frame (frameId: 0) should be injected; all subframes blocked
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].target.frameIds).toEqual([0]);
      expect(injector.hasInjected(tabId, 0, 'noframes-strict-test', 'document-start')).toBe(true);
      for (const fid of deepFrameIds.slice(1)) {
        expect(injector.hasInjected(tabId, fid, 'noframes-strict-test', 'document-start')).toBe(false);
      }
    });

    it('C1.3: Partial iframe injection failure rolls back only failed iframes during concurrent storm', async () => {
      const tabId = 1003;
      const frameCount = 10;

      const script: ScriptRecord = {
        id: 'flaky-subframe-script',
        name: 'Flaky Subframe Script',
        code: '// test',
        metadata: {
          name: 'Flaky Subframe Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
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
      await deleteScript('sample-cdp-logger');
      await saveScript(script);

      // Even-numbered frames fail; odd-numbered frames succeed
      context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
        const fid = opts.target.frameIds[0];
        if (fid % 2 === 0) {
          throw new Error(`Frame ${fid} renderer crashed`);
        }
        executedScripts.push(opts);
        return [{ result: { success: true } }];
      });

      await Promise.all(
        Array.from({ length: frameCount }, (_, i) => {
          const frameId = i + 1;
          return injector.handleCommitted({
            tabId,
            frameId,
            url: `https://example.com/frame-${frameId}`,
            processId: 1,
            transitionType: 'auto_subframe',
            documentId: `doc-${frameId}`,
            timeStamp: Date.now()
          });
        })
      );

      // Exactly 5 odd frames succeeded
      expect(executedScripts.length).toBe(5);

      for (let fid = 1; fid <= frameCount; fid++) {
        if (fid % 2 === 1) {
          expect(injector.hasInjected(tabId, fid, 'flaky-subframe-script', 'document-start')).toBe(true);
        } else {
          expect(injector.hasInjected(tabId, fid, 'flaky-subframe-script', 'document-start')).toBe(false);
        }
      }
    });
  });

  // =========================================================================
  // Dimension 2: Subframe Navigating to Same vs Different URLs
  // =========================================================================
  describe('Dimension 2: Subframe Navigating to Same vs Different URLs', () => {
    it('C2.1: Subframe navigating to a DIFFERENT URL re-injects while siblings remain untouched', async () => {
      const tabId = 2001;

      const subframeScript: ScriptRecord = {
        id: 'subframe-diff-url-script',
        name: 'Subframe Diff URL Script',
        code: '// diff',
        metadata: {
          name: 'Subframe Diff URL Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
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
      await deleteScript('sample-cdp-logger');
      await saveScript(subframeScript);

      // Frame 1 and Frame 2 navigate
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/frame1-initial',
        processId: 1,
        transitionType: 'auto_subframe',
        timeStamp: Date.now()
      });
      await injector.handleCommitted({
        tabId,
        frameId: 2,
        url: 'https://example.com/frame2-initial',
        processId: 1,
        transitionType: 'auto_subframe',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(2);

      // Frame 1 re-navigates to a DIFFERENT URL
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/frame1-different',
        processId: 1,
        transitionType: 'auto_subframe',
        timeStamp: Date.now()
      });

      // Frame 1 was re-injected
      expect(executedScripts.length).toBe(3);
      expect(executedScripts[2].target.frameIds).toEqual([1]);
      expect(injector.hasInjected(tabId, 1, 'subframe-diff-url-script', 'document-start')).toBe(true);
      expect(injector.hasInjected(tabId, 2, 'subframe-diff-url-script', 'document-start')).toBe(true);
    });

    it('C2.2: Subframe reloaded with transitionType === "reload" to the SAME URL re-injects', async () => {
      const tabId = 2002;
      const targetUrl = 'https://example.com/same-subframe-url';

      const script: ScriptRecord = {
        id: 'subframe-reload-script',
        name: 'Subframe Reload Script',
        code: '// reload test',
        metadata: {
          name: 'Subframe Reload Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
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
      await deleteScript('sample-cdp-logger');
      await saveScript(script);

      // Initial navigation of subframe
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: targetUrl,
        processId: 1,
        transitionType: 'auto_subframe',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1);

      // Reload subframe with identical URL
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: targetUrl,
        processId: 1,
        transitionType: 'reload',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(2);
      expect(executedScripts[1].target.frameIds).toEqual([1]);
    });

    it('C2.3: Subframe navigation to SAME URL without reload (duplicate protection behavior)', async () => {
      const tabId = 2003;
      const targetUrl = 'https://example.com/subframe-widget';

      const script: ScriptRecord = {
        id: 'subframe-dupe-test',
        name: 'Subframe Dupe Test',
        code: '// dupe test',
        metadata: {
          name: 'Subframe Dupe Test',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
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
      await deleteScript('sample-cdp-logger');
      await saveScript(script);

      // Initial commit
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: targetUrl,
        processId: 1,
        transitionType: 'auto_subframe',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1);

      // Duplicate committed event to same URL without reload
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: targetUrl,
        processId: 1,
        transitionType: 'auto_subframe',
        timeStamp: Date.now()
      });
      // Deduplicated: should not execute again
      expect(executedScripts.length).toBe(1);
    });

    it('C2.4: Subframe navigation to SAME URL with new documentId re-injects userscripts', async () => {
      const tabId = 2004;
      const targetUrl = 'https://example.com/subframe-app';

      const script: ScriptRecord = {
        id: 'subframe-docid-test',
        name: 'Subframe DocId Test',
        code: '// docid test',
        metadata: {
          name: 'Subframe DocId Test',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
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
      await deleteScript('sample-cdp-logger');
      await saveScript(script);

      // 1. Initial navigation of subframe with doc-sub-1
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: targetUrl,
        processId: 1,
        transitionType: 'auto_subframe',
        documentId: 'doc-sub-1',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1);

      // 2. User clicks a link inside the subframe navigating to the exact same URL (new document context doc-sub-2)
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: targetUrl,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-sub-2',
        timeStamp: Date.now()
      });

      // BUG REPRODUCED: Subframe committed handler currently lacks documentId tracking (only checks currentFrameUrl !== url || reload)
      // Therefore same-URL link navigation in subframe fails to re-inject userscripts.
      expect(executedScripts.length).toBe(2);
    });
  });

  // =========================================================================
  // Dimension 3: Same-URL Link Navigation Reset on Top-Level Frame (frameId === 0)
  // =========================================================================
  describe('Dimension 3: Same-URL Link Navigation Reset on Top-Level Frame (frameId === 0)', () => {
    it('C3.1: Top-level same-URL link navigation WITH documentId resets history on new documentId and suppresses duplicate documentId', async () => {
      const tabId = 3001;
      const url = 'https://httpbin.org/get';

      // 1. First navigation
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-alpha',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1);

      // 2. Duplicate event delivery for doc-alpha (same documentId)
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-alpha',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1); // deduplicated

      // 3. Same-URL link navigation resulting in a new document context (doc-beta)
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-beta',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(2); // reset and re-injected

      // 4. Duplicate event delivery for doc-beta
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-beta',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(2); // deduplicated
    });

    it('C3.2: Top-level same-URL link navigation WITHOUT documentId handles duplicate events and reload properly', async () => {
      const tabId = 3002;
      const url = 'https://httpbin.org/get';

      // 1. First navigation without documentId
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1);

      // 2. Duplicate committed event without documentId
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });
      // Correctly deduplicated: prevents duplicate userscript execution
      expect(executedScripts.length).toBe(1);

      // 3. Reload without documentId
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'reload',
        timeStamp: Date.now()
      });
      // Reload resets history and re-injects
      expect(executedScripts.length).toBe(2);

      // 4. Navigation to different URL without documentId
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });
      // Same URL without reload or documentId is suppressed to protect against duplicate delivery
      expect(executedScripts.length).toBe(2);

      // 5. Navigation to different URL without documentId
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: 'https://httpbin.org/get?page=2',
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(3);
    });

    it('C3.3: Transitioning from documentId-enabled navigation to documentId-free navigation cleans documentId state', async () => {
      const tabId = 3003;
      const urlA = 'https://httpbin.org/get';
      const urlB = 'https://httpbin.org/anything';

      // Navigation with documentId
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: urlA,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-with-id-123',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1);
      expect((injector as any).tabDocumentIds.get(tabId)).toBe('doc-with-id-123');

      // Subsequent navigation to new URL without documentId
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: urlB,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(2);
      // Stale documentId must be deleted
      expect((injector as any).tabDocumentIds.has(tabId)).toBe(false);
    });
  });

  // =========================================================================
  // Dimension 4: Rapid Concurrent Tab Removals Racing Against Active processStage
  // =========================================================================
  describe('Dimension 4: Rapid Concurrent Tab Removals Racing Against Active processStage', () => {
    it('C4.1: Tab removal racing against asynchronous script execution does NOT leak zombie tab entries', async () => {
      const tabId = 4001;
      const url = 'https://httpbin.org/get';

      // Simulate a realistic delayed executeScript
      let resolveScript: () => void;
      context.mockScripting.executeScript.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveScript = () => resolve([{ result: { success: true } }]);
          })
      );

      // 1. Navigation committed starts async processStage
      const committedPromise = injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-race-1',
        timeStamp: Date.now()
      });

      // Wait until executeScript has been invoked
      await vi.waitFor(() => {
        expect(context.mockScripting.executeScript).toHaveBeenCalledTimes(1);
      });

      // 2. WHILE executeScript is in-flight, user closes the tab!
      injector.handleTabRemoved(tabId);

      // Verify at this moment, tab history was cleared
      expect((injector as any).injectionHistory.has(tabId)).toBe(false);
      expect((injector as any).tabUrls.has(tabId)).toBe(false);

      // 3. Now executeScript finishes (e.g. Chrome settles the script right before tab destruction)
      resolveScript!();
      await committedPromise;

      // In this specific ordering (tab removed after tabMap was created and during executeScript),
      // injectionHistory remains cleared because executeScriptInTab does not re-add tabMap.
      expect((injector as any).injectionHistory.has(tabId)).toBe(false);
    });

    it('C4.2: Tab removal racing against ensureCdpReadyForScripts does NOT resurrect injectionHistory', async () => {
      const tabId = 4002;
      const url = 'https://httpbin.org/get';

      // Delay ensureCdpReadyForScripts by mocking attachTab with a delay
      let resolveAttach: () => void;
      const attachPromise = new Promise<void>((resolve) => {
        resolveAttach = resolve;
      });

      // Spy on attachTab so it waits for our trigger, then marks attached
      vi.spyOn(debuggerMgr, 'attachTab').mockImplementation(async () => {
        await attachPromise;
        const session = (debuggerMgr as any).sessions.get(tabId) || (debuggerMgr as any).createSession(tabId);
        session.status = 'ATTACHED';
      });

      // 1. Navigation committed starts async processStage, which calls ensureCdpReadyForScripts -> attachTab
      const committedPromise = injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-cdp-race',
        timeStamp: Date.now()
      });

      // Wait until attachTab has been invoked
      await vi.waitFor(() => {
        expect(debuggerMgr.attachTab).toHaveBeenCalledWith(tabId);
      });

      // 2. WHILE attachTab is awaiting, the tab is removed!
      injector.handleTabRemoved(tabId);

      // Verify that immediately upon tab removal, injectionHistory is clean
      expect((injector as any).injectionHistory.has(tabId)).toBe(false);

      // 3. Now attachTab resolves, allowing processStage to continue
      resolveAttach!();
      await committedPromise;

      // BUG REPRODUCED: When processStage resumes after attachTab, it executes:
      //   let tabMap = this.injectionHistory.get(tabId);
      //   if (!tabMap) { tabMap = new Map(); this.injectionHistory.set(tabId, tabMap); }
      // This resurrects the closed tab in injectionHistory even though handleTabRemoved already ran!
      expect((injector as any).injectionHistory.has(tabId)).toBe(false);
    });

    it('C4.3: High-frequency tab churn storm (100 tabs navigating and closing concurrently) leaves ZERO leaked entries', async () => {
      const tabCount = 100;

      // Simulate asynchronous executeScript with jitter
      context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
        const delay = Math.floor(Math.random() * 5) + 1;
        await new Promise((r) => setTimeout(r, delay));
        return [{ result: { success: true } }];
      });

      // Launch 100 tabs concurrently
      await Promise.all(
        Array.from({ length: tabCount }, async (_, i) => {
          const tabId = 5000 + i;
          const url = `https://httpbin.org/get?tab=${tabId}`;

          const navPromise = injector.handleCommitted({
            tabId,
            frameId: 0,
            url,
            processId: 1,
            transitionType: 'link',
            documentId: `doc-${tabId}`,
            timeStamp: Date.now()
          });

          // Randomly close tab either immediately, mid-flight, or shortly after
          const closeTiming = Math.random();
          if (closeTiming < 0.33) {
            injector.handleTabRemoved(tabId);
          } else if (closeTiming < 0.66) {
            setTimeout(() => injector.handleTabRemoved(tabId), 2);
          } else {
            navPromise.finally(() => injector.handleTabRemoved(tabId));
          }

          await navPromise.catch(() => {});
        })
      );

      // Wait a bit for any pending microtasks/timers
      await new Promise((r) => setTimeout(r, 20));

      // After all 100 tabs have been closed, ALL maps must be completely empty
      // BUG REPRODUCED: Closed tabs that were removed while processStage was awaiting are resurrected,
      // resulting in dozens of leaked zombie entries in injectionHistory.
      const leakedTabs = Array.from((injector as any).injectionHistory.keys());
      expect(leakedTabs).toEqual([]);
    });

    it('C4.4: Tab removal racing against asynchronous storage reading (getMatchingScripts) resurrects injectionHistory', async () => {
      const tabId = 4004;
      const url = 'https://httpbin.org/get';

      // Spy on getMatchingScripts to inject an asynchronous delay
      let resolveMatching: () => void;
      const matchingDelayPromise = new Promise<void>((resolve) => {
        resolveMatching = resolve;
      });

      const originalGetMatching = injector.getMatchingScripts.bind(injector);
      vi.spyOn(injector, 'getMatchingScripts').mockImplementation(async (...args) => {
        const res = await originalGetMatching(...args);
        await matchingDelayPromise;
        return res;
      });

      // 1. Start navigation
      const navPromise = injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-storage-race',
        timeStamp: Date.now()
      });

      // Wait until getMatchingScripts is called
      await vi.waitFor(() => {
        expect(injector.getMatchingScripts).toHaveBeenCalled();
      });

      // 2. WHILE storage read is suspended, tab is removed
      injector.handleTabRemoved(tabId);
      expect((injector as any).injectionHistory.has(tabId)).toBe(false);

      // 3. Resolve storage read
      resolveMatching!();
      await navPromise;

      // BUG REPRODUCED: Closed tab is resurrected in injectionHistory
      expect((injector as any).injectionHistory.has(tabId)).toBe(false);
    });
  });
});
