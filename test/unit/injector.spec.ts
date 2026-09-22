/**
 * Unit Test Suite: Script Injection Orchestrator
 * Location: test/unit/injector.spec.ts
 *
 * Tests URL matching, @run-at timing stages, declarative CDP synchronization, and duplicate prevention.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { ScriptInjector, pageSandboxRunner } from '@/background/injector';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { saveScript, resetToDefaultScripts, saveSettings, deleteScript } from '@/shared/storage';
import type { ScriptRecord } from '@/shared/types';

describe('Feature 16: Lifecycle-based Script Injection (injector.ts)', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let debuggerMgr: TabDebuggerManager;
  let injector: ScriptInjector;
  let executedScripts: any[] = [];

  beforeEach(async () => {
    context = setupChromeMock();
    executedScripts = [];

    context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
      executedScripts.push(opts);
      return [{ result: true }];
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

  describe('Tier 1: URL & Metadata Matching', () => {
    it('T1.1: matches scripts whose @match patterns cover target URL', async () => {
      const matches = await injector.getMatchingScripts('https://httpbin.org/get');
      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches.some((s) => s.id === 'sample-cdp-logger')).toBe(true);
    });

    it('T1.2: rejects scripts when URL is covered by @exclude (strict precedence)', async () => {
      const scriptWithExclude: ScriptRecord = {
        id: 'exclude-test',
        name: 'Exclude Test',
        code: '// ==UserScript==\n// @name Exclude Test\n// ==/UserScript==',
        metadata: {
          name: 'Exclude Test',
          matches: ['*://*.example.com/*'],
          matchPatterns: ['*://*.example.com/*'],
          includes: [],
          excludes: ['*://*.example.com/admin/*'],
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
      await saveScript(scriptWithExclude);

      const allowed = await injector.getMatchingScripts('https://sub.example.com/public');
      expect(allowed.some((s) => s.id === 'exclude-test')).toBe(true);

      const blocked = await injector.getMatchingScripts('https://sub.example.com/admin/settings');
      expect(blocked.some((s) => s.id === 'exclude-test')).toBe(false);
    });

    it('T1.3: ignores disabled scripts', async () => {
      const disabledScript: ScriptRecord = {
        id: 'disabled-test',
        name: 'Disabled Script',
        code: '// ==UserScript==\n// @name Disabled\n// ==/UserScript==',
        metadata: {
          name: 'Disabled',
          matches: ['<all_urls>'],
          matchPatterns: ['<all_urls>'],
          includes: [],
          excludes: [],
          runAt: 'document-idle',
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
        enabled: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await saveScript(disabledScript);

      const matching = await injector.getMatchingScripts('https://example.com');
      expect(matching.some((s) => s.id === 'disabled-test')).toBe(false);
    });

    it('T1.4: never matches restricted URLs (e.g. chrome://extensions)', async () => {
      const matching = await injector.getMatchingScripts('chrome://extensions');
      expect(matching.length).toBe(0);
    });

    it('T1.5: respects globalEnabled setting and returns empty when disabled', async () => {
      await saveSettings({ globalEnabled: false });

      const matching = await injector.getMatchingScripts('https://example.com');
      expect(matching.length).toBe(0);
    });

    it('T1.6: respects noframes directive on iframe frames', async () => {
      const noframeScript: ScriptRecord = {
        id: 'noframe-script',
        name: 'Noframe Script',
        code: '// ==UserScript==\n// @name Noframe\n// ==/UserScript==',
        metadata: {
          name: 'Noframe',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-idle',
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
      await saveScript(noframeScript);

      // Top-level frame allows it
      const topMatches = await injector.getMatchingScripts('https://example.com/page', undefined, 0);
      expect(topMatches.some((s) => s.id === 'noframe-script')).toBe(true);

      // Subframe blocks it
      const iframeMatches = await injector.getMatchingScripts('https://example.com/page', undefined, 1);
      expect(iframeMatches.some((s) => s.id === 'noframe-script')).toBe(false);
    });
  });

  describe('Tier 2: @run-at Timing Orchestration', () => {
    it('T2.1: onCommitted triggers only document-start scripts with injectImmediately', async () => {
      await injector.handleCommitted({
        tabId: 42,
        frameId: 0,
        url: 'https://httpbin.org/get',
        processId: 1,
        transitionType: 'link',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });

      expect(executedScripts.length).toBe(1);
      const injectedArgs = executedScripts[0].args;
      expect(injectedArgs[2]).toBe('sample-cdp-logger'); // ID of document-start script
      expect(executedScripts[0].injectImmediately).toBe(true);
    });

    it('T2.2: onDOMContentLoaded triggers only document-end scripts', async () => {
      await injector.handleDOMContentLoaded({
        tabId: 42,
        frameId: 0,
        url: 'https://example.com/page',
        processId: 1,
        timeStamp: Date.now()
      });

      expect(executedScripts.length).toBe(1);
      const injectedArgs = executedScripts[0].args;
      expect(injectedArgs[2]).toBe('sample-dom-highlighter'); // ID of document-end script
      expect(executedScripts[0].injectImmediately).toBe(false);
    });

    it('T2.3: onCompleted triggers only document-idle scripts', async () => {
      await injector.handleCompleted({
        tabId: 42,
        frameId: 0,
        url: 'https://example.com/page',
        processId: 1,
        timeStamp: Date.now()
      });

      expect(executedScripts.length).toBe(1);
      const injectedArgs = executedScripts[0].args;
      expect(injectedArgs[2]).toBe('sample-cookie-inspector'); // ID of document-idle script
    });

    it('T2.4: handleTabsUpdated triggers document-idle when status is complete', async () => {
      await injector.handleTabsUpdated(
        42,
        { status: 'complete', url: 'https://example.com/page' },
        { id: 42, url: 'https://example.com/page' } as any
      );

      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('sample-cookie-inspector');
    });
  });

  describe('Tier 3: Declarative CDP Coordination at document-start', () => {
    it('T3.1: ensures debugger has attached and initialized declared domains before injecting document-start script', async () => {
      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');
      const initDomainsSpy = vi.spyOn(debuggerMgr, 'initializeDeclaredDomains');

      await injector.handleCommitted({
        tabId: 42,
        frameId: 0,
        url: 'https://httpbin.org/get',
        processId: 1,
        transitionType: 'link',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });

      expect(attachSpy).toHaveBeenCalledWith(42);
      expect(initDomainsSpy).toHaveBeenCalledWith(42, 'https://httpbin.org/get');
      expect(executedScripts.length).toBe(1);
    });

    it('T3.2: does not block injection if debugger encounters DevTools conflict', async () => {
      debuggerMgr.setTabStatus(42, 'CONFLICT', 'canceled_by_user');

      await injector.handleCommitted({
        tabId: 42,
        frameId: 0,
        url: 'https://httpbin.org/get',
        processId: 1,
        transitionType: 'link',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });

      // Script should still be injected so DOM features function
      expect(executedScripts.length).toBe(1);
    });
  });

  describe('Tier 4: Deduplication & Tab Navigation Lifecycle', () => {
    it('T4.1: does not inject the same script twice for the same navigation and timing stage', async () => {
      await injector.handleCommitted({
        tabId: 42,
        frameId: 0,
        url: 'https://httpbin.org/get',
        processId: 1,
        transitionType: 'link',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1);

      // Duplicate event on same frame & navigation
      await injector.handleCommitted({
        tabId: 42,
        frameId: 0,
        url: 'https://httpbin.org/get',
        processId: 1,
        transitionType: 'link',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1); // Not duplicated
    });

    it('T4.2: resets injection history when top-level navigation occurs', async () => {
      await injector.handleCommitted({
        tabId: 42,
        frameId: 0,
        url: 'https://httpbin.org/get',
        processId: 1,
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1);

      // New top-level navigation on same tab
      await injector.handleCommitted({
        tabId: 42,
        frameId: 0,
        url: 'https://httpbin.org/anything',
        processId: 1,
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(2);
    });

    it('T4.3: cleans up injection history when tab is closed via onRemoved', async () => {
      await injector.handleCommitted({
        tabId: 42,
        frameId: 0,
        url: 'https://httpbin.org/get',
        processId: 1,
        transitionType: 'link',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });
      expect(injector.hasInjected(42, 0, 'sample-cdp-logger', 'document-start')).toBe(true);

      injector.handleTabRemoved(42);
      expect(injector.hasInjected(42, 0, 'sample-cdp-logger', 'document-start')).toBe(false);
    });

    it('T4.4: concurrent navigation event flooding does not inject duplicate scripts (concurrency deduplication)', async () => {
      const tabId = 101;
      const frameId = 0;
      const url = 'https://httpbin.org/get';

      // Simulate realistic asynchronous execution delay in chrome.scripting.executeScript
      context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        executedScripts.push(opts);
        return [{ result: true }];
      });

      // Flood 20 concurrent navigation events simultaneously on the same tab and URL
      const floodCount = 20;
      await Promise.all(
        Array.from({ length: floodCount }, () =>
          injector.handleCommitted({
            tabId,
            frameId,
            url,
            processId: 1,
            transitionType: 'link',
            transitionQualifiers: [],
            timeStamp: Date.now()
          })
        )
      );

      // Exactly 1 injection must occur despite the concurrent 20-event flood
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('sample-cdp-logger');
      expect(injector.hasInjected(tabId, frameId, 'sample-cdp-logger', 'document-start')).toBe(true);
    });

    it('T4.5: failed script injection rolls back deduplication key allowing subsequent retry', async () => {
      const tabId = 102;
      const frameId = 0;
      const url = 'https://httpbin.org/get';

      // First attempt fails
      context.mockScripting.executeScript.mockRejectedValueOnce(new Error('Target frame detached'));

      await injector.handleCommitted({
        tabId,
        frameId,
        url,
        processId: 1,
        transitionType: 'link',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });

      // Failed injection must NOT leave key in history
      expect(injector.hasInjected(tabId, frameId, 'sample-cdp-logger', 'document-start')).toBe(false);

      // Second attempt succeeds
      context.mockScripting.executeScript.mockImplementationOnce(async (opts: any) => {
        executedScripts.push(opts);
        return [{ result: true }];
      });

      await injector.handleCommitted({
        tabId,
        frameId,
        url,
        processId: 1,
        transitionType: 'link',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });

      expect(executedScripts.length).toBe(1);
      expect(injector.hasInjected(tabId, frameId, 'sample-cdp-logger', 'document-start')).toBe(true);
    });
  });

  describe('Tier 5: Sandbox Scope & Grant Isolation (pageSandboxRunner)', () => {
    it('T5.1: @grant none scripts do not receive GM_info, cdp, or GM_cdp in sandbox scope even if page defines window.cdp', async () => {
      // Simulate target webpage having native or foreign window.cdp and window.GM_cdp
      (window as any).cdp = { send: vi.fn(), on: vi.fn() };
      (window as any).__xokj_cdp = (window as any).cdp;
      (window as any).GM_cdp = vi.fn();

      const grantNoneScript: ScriptRecord = {
        id: 'test-grant-none',
        name: 'Grant None Script',
        code: `
          window.__probeResults = {
            hasGmInfo: typeof GM_info !== 'undefined' && GM_info !== undefined,
            hasCdp: typeof cdp !== 'undefined' && cdp !== undefined,
            hasGmCdp: typeof GM_cdp !== 'undefined' && GM_cdp !== undefined,
            typeofGmInfo: typeof GM_info,
            typeofCdp: typeof cdp,
            typeofGmCdp: typeof GM_cdp
          };
        `,
        metadata: {
          name: 'Grant None Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-idle',
          grants: ['none'],
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
      await saveScript(grantNoneScript);

      await injector.handleCompleted({
        tabId: 50,
        frameId: 0,
        url: 'https://example.com/test',
        processId: 1,
        timeStamp: Date.now()
      });

      const call = executedScripts.find((s) => s.args[2] === 'test-grant-none');
      expect(call).toBeDefined();

      // Execute the exact pageSandboxRunner function passed to chrome.scripting.executeScript
      call.func(...call.args);

      const probe = (window as any).__probeResults;
      expect(probe).toBeDefined();
      expect(probe.hasGmInfo).toBe(false);
      expect(probe.hasCdp).toBe(false);
      expect(probe.hasGmCdp).toBe(false);
      expect(probe.typeofGmInfo).toBe('undefined');
      expect(probe.typeofCdp).toBe('undefined');
      expect(probe.typeofGmCdp).toBe('undefined');

      // Cleanup test globals
      delete (window as any).cdp;
      delete (window as any).__xokj_cdp;
      delete (window as any).GM_cdp;
      delete (window as any).__probeResults;
    });

    it('T5.2: scripts with explicit grants receive requested GM_info and cdp in sandbox scope', async () => {
      (window as any).cdp = { send: vi.fn(), on: vi.fn() };

      const grantedScript: ScriptRecord = {
        id: 'test-granted-script',
        name: 'Granted Script',
        code: `
          window.__probeGrantedResults = {
            hasGmInfo: typeof GM_info !== 'undefined' && GM_info !== undefined,
            hasCdp: typeof cdp !== 'undefined' && cdp !== undefined,
            gmInfoName: typeof GM_info !== 'undefined' ? GM_info.script.name : undefined
          };
        `,
        metadata: {
          name: 'Granted Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-idle',
          grants: ['GM_info', 'GM_cdp'],
          cdp: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }
          ],
          cdpDeclarations: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }
          ],
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
      await saveScript(grantedScript);

      await injector.handleCompleted({
        tabId: 51,
        frameId: 0,
        url: 'https://example.com/test',
        processId: 1,
        timeStamp: Date.now()
      });

      const call = executedScripts.find((s) => s.args[2] === 'test-granted-script');
      expect(call).toBeDefined();

      call.func(...call.args);

      const probe = (window as any).__probeGrantedResults;
      expect(probe).toBeDefined();
      expect(probe.hasGmInfo).toBe(true);
      expect(probe.hasCdp).toBe(true);
      expect(probe.gmInfoName).toBe('Granted Script');

      delete (window as any).cdp;
      delete (window as any).__probeGrantedResults;
    });
  });

  // =========================================================================
  // Milestone 3: Injection Pipeline & Navigation Lifecycle Hardening
  // =========================================================================

  // Feature 11: Frame-Scoped Navigation Deduplication
  describe('Feature 11: Frame-Scoped Navigation Deduplication', () => {
    const subframeScript: ScriptRecord = {
      id: 'subframe-multi-test',
      name: 'Subframe Multi Test',
      code: '// ==UserScript==\n// @name Subframe Multi Test\n// ==/UserScript==',
      metadata: {
        name: 'Subframe Multi Test',
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

    beforeEach(async () => {
      await deleteScript('sample-cdp-logger');
      await deleteScript('sample-dom-highlighter');
      await deleteScript('sample-cookie-inspector');
      await saveScript(subframeScript);
    });

    it('M3.1.1: subframe A injection does not block subframe B in the same tab', async () => {
      const tabId = 100;

      // Inject Subframe A (frameId: 1)
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/iframeA',
        processId: 1,
        transitionType: 'auto_subframe',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });

      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].target.frameIds).toEqual([1]);
      expect(injector.hasInjected(tabId, 1, 'subframe-multi-test', 'document-start')).toBe(true);

      // Inject Subframe B (frameId: 2)
      await injector.handleCommitted({
        tabId,
        frameId: 2,
        url: 'https://example.com/iframeB',
        processId: 1,
        transitionType: 'auto_subframe',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });

      // Subframe B must NOT be blocked by Subframe A
      expect(executedScripts.length).toBe(2);
      expect(executedScripts[1].target.frameIds).toEqual([2]);
      expect(injector.hasInjected(tabId, 2, 'subframe-multi-test', 'document-start')).toBe(true);
    });

    it('M3.1.2: re-navigating subframe A clears only subframe A history and preserves subframe B', async () => {
      const tabId = 101;

      // 1. Initial injection into Frame 1 and Frame 2
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/iframeA',
        processId: 1,
        transitionType: 'auto_subframe',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });
      await injector.handleCommitted({
        tabId,
        frameId: 2,
        url: 'https://example.com/iframeB',
        processId: 1,
        transitionType: 'auto_subframe',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(2);

      // 2. Re-navigate Subframe A (frameId: 1) to a new URL
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/iframeA-v2',
        processId: 1,
        transitionType: 'manual_subframe',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });

      // Frame 1 must re-inject
      expect(executedScripts.length).toBe(3);
      expect(executedScripts[2].target.frameIds).toEqual([1]);

      // 3. Subframe B was NOT re-navigated; a duplicate commit on Frame 2 must be blocked
      await injector.handleCommitted({
        tabId,
        frameId: 2,
        url: 'https://example.com/iframeB',
        processId: 1,
        transitionType: 'auto_subframe',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });

      // Total injections must remain 3
      expect(executedScripts.length).toBe(3);
    });

    it('M3.1.3: top-level navigation (frameId === 0) clears all nested subframe injection histories', async () => {
      const tabId = 102;

      // Setup Frame 0, Frame 1
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: 'https://example.com/main',
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/iframe1',
        processId: 1,
        transitionType: 'auto_subframe',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(2);

      // Top-level navigation occurs on Tab 102 to a new URL
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: 'https://example.com/main-page-2',
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(3);

      // Subframe 1 now loads again under new page: must re-inject
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/iframe1',
        processId: 1,
        transitionType: 'auto_subframe',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(4);
    });

    it('M3.1.4: tab closure completely removes all nested subframe history maps without memory leaks', async () => {
      const tabId = 103;

      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/iframe1',
        processId: 1,
        transitionType: 'auto_subframe',
        timeStamp: Date.now()
      });
      expect(injector.hasInjected(tabId, 1, 'subframe-multi-test', 'document-start')).toBe(true);

      // Tab closed
      injector.handleTabRemoved(tabId);

      expect(injector.hasInjected(tabId, 1, 'subframe-multi-test', 'document-start')).toBe(false);
      // Access private maps via index signature to verify zero leaked entries
      expect((injector as any).injectionHistory.has(tabId)).toBe(false);
      expect((injector as any).tabUrls.has(tabId)).toBe(false);
      expect((injector as any).tabDocumentIds.has(tabId)).toBe(false);
    });
  });

  // Feature 12: Same-URL Link Navigation Reset
  describe('Feature 12: Same-URL Link Navigation Reset', () => {
    it('M3.2.1: same-URL navigation with new documentId resets deduplication for frameId === 0', async () => {
      const tabId = 200;
      const targetUrl = 'https://httpbin.org/get';

      // 1. Initial navigation
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        transitionType: 'link',
        transitionQualifiers: [],
        documentId: 'doc-initial-1',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1);

      // 2. User clicks link pointing to the exact same URL (new documentId committed)
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        transitionType: 'link',
        transitionQualifiers: [],
        documentId: 'doc-nav-same-url-2',
        timeStamp: Date.now()
      });

      // Must re-execute script because a new document context was committed
      expect(executedScripts.length).toBe(2);
      expect(executedScripts[1].args[2]).toBe('sample-cdp-logger');
      expect(injector.hasInjected(tabId, 0, 'sample-cdp-logger', 'document-start')).toBe(true);
    });

    it('M3.2.2: typed/form_submit with new documentId resets deduplication for frameId === 0', async () => {
      const tabId = 201;
      const targetUrl = 'https://httpbin.org/get';

      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        transitionType: 'typed',
        documentId: 'doc-typed-1',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1);

      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        transitionType: 'form_submit',
        documentId: 'doc-submit-2',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(2);
    });

    it('M3.2.3: duplicate committed events on same document do NOT duplicate', async () => {
      const tabId = 202;
      const targetUrl = 'https://httpbin.org/get';

      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-same-3',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1);

      // Duplicate delivery of committed event with identical documentId
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-same-3',
        timeStamp: Date.now()
      });
      expect(executedScripts.length).toBe(1); // Not duplicated
    });
  });

  // Feature 13: Declarative CDP Ordering for All Stages
  describe('Feature 13: Declarative CDP Ordering for All Stages', () => {
    it('M3.3.1: document-end script with @cdp triggers attachTab & initializeDeclaredDomains', async () => {
      const docEndCdpScript: ScriptRecord = {
        id: 'doc-end-cdp',
        name: 'Doc End CDP',
        code: '// ==UserScript==\n// @name Doc End CDP\n// @run-at document-end\n// @grant GM_cdp\n// @cdp Network.enable {"maxTotalBufferSize": 5000}\n// ==/UserScript==',
        metadata: {
          name: 'Doc End CDP',
          matches: ['*://example.com/end-test*'],
          matchPatterns: ['*://example.com/end-test*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['GM_cdp'],
          cdp: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: { maxTotalBufferSize: 5000 } }],
          cdpDeclarations: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: { maxTotalBufferSize: 5000 } }],
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
      await deleteScript('sample-dom-highlighter');
      await saveScript(docEndCdpScript);

      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');
      const initDomainsSpy = vi.spyOn(debuggerMgr, 'initializeDeclaredDomains');

      await injector.handleDOMContentLoaded({
        tabId: 300,
        frameId: 0,
        url: 'https://example.com/end-test',
        processId: 1,
        timeStamp: Date.now()
      });

      expect(attachSpy).toHaveBeenCalledWith(300);
      expect(initDomainsSpy).toHaveBeenCalledWith(300, 'https://example.com/end-test');
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('doc-end-cdp');
    });

    it('M3.3.2: document-idle script with @cdp triggers attach & init', async () => {
      const docIdleCdpScript: ScriptRecord = {
        id: 'doc-idle-cdp',
        name: 'Doc Idle CDP',
        code: '// ==UserScript==\n// @name Doc Idle CDP\n// @run-at document-idle\n// @grant GM_cdp\n// @cdp Page.enable\n// ==/UserScript==',
        metadata: {
          name: 'Doc Idle CDP',
          matches: ['*://example.com/idle-test*'],
          matchPatterns: ['*://example.com/idle-test*'],
          includes: [],
          excludes: [],
          runAt: 'document-idle',
          grants: ['GM_cdp'],
          cdp: [{ domain: 'Page', method: 'enable', command: 'Page.enable', params: {} }],
          cdpDeclarations: [{ domain: 'Page', method: 'enable', command: 'Page.enable', params: {} }],
          cdpDomains: ['Page'],
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
      await deleteScript('sample-cookie-inspector');
      await saveScript(docIdleCdpScript);

      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');
      const initDomainsSpy = vi.spyOn(debuggerMgr, 'initializeDeclaredDomains');

      await injector.handleCompleted({
        tabId: 301,
        frameId: 0,
        url: 'https://example.com/idle-test',
        processId: 1,
        timeStamp: Date.now()
      });

      expect(attachSpy).toHaveBeenCalledWith(301);
      expect(initDomainsSpy).toHaveBeenCalledWith(301, 'https://example.com/idle-test');
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('doc-idle-cdp');
    });

    it('M3.3.3: plain script without @cdp does not trigger attach', async () => {
      const plainScript: ScriptRecord = {
        id: 'plain-dom-script',
        name: 'Plain DOM Script',
        code: '// ==UserScript==\n// @name Plain DOM\n// @run-at document-end\n// @grant none\n// ==/UserScript==',
        metadata: {
          name: 'Plain DOM',
          matches: ['*://example.com/plain*'],
          matchPatterns: ['*://example.com/plain*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['none'],
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
      await deleteScript('sample-dom-highlighter');
      await saveScript(plainScript);

      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');

      await injector.handleDOMContentLoaded({
        tabId: 302,
        frameId: 0,
        url: 'https://example.com/plain',
        processId: 1,
        timeStamp: Date.now()
      });

      expect(attachSpy).not.toHaveBeenCalled();
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('plain-dom-script');
    });

    it('M3.3.4: progressive multi-stage: tab attached at start is not re-attached at end', async () => {
      const tabId = 303;
      const targetUrl = 'https://httpbin.org/get'; // Default sample-cdp-logger runs at document-start

      const docEndCdpScript: ScriptRecord = {
        id: 'progressive-doc-end',
        name: 'Progressive Doc End',
        code: '// ==UserScript==\n// @name Progressive\n// @run-at document-end\n// @cdp DOM.enable\n// ==/UserScript==',
        metadata: {
          name: 'Progressive',
          matches: ['https://httpbin.org/get*'],
          matchPatterns: ['https://httpbin.org/get*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['GM_cdp'],
          cdp: [{ domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} }],
          cdpDeclarations: [{ domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} }],
          cdpDomains: ['DOM'],
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
      await deleteScript('sample-dom-highlighter');
      await saveScript(docEndCdpScript);

      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');

      // 1. Stage: document-start
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });
      const callsAfterStart = attachSpy.mock.calls.length;
      expect(callsAfterStart).toBeGreaterThanOrEqual(1);

      // 2. Stage: document-end
      await injector.handleDOMContentLoaded({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        timeStamp: Date.now()
      });

      // attachTab should NOT be called again because tab is already ATTACHED
      expect(attachSpy).toHaveBeenCalledTimes(callsAfterStart);
      expect(executedScripts.length).toBe(2);
    });
  });

  // Feature 14: Injection Failure Deduplication Rollback
  describe('Feature 14: Injection Failure Deduplication Rollback', () => {
    it('M3.4.1: multi-script batch partial failure rolls back only failed script', async () => {
      const tabId = 400;
      const targetUrl = 'https://example.com/batch-test';

      const scriptA: ScriptRecord = {
        id: 'script-fail',
        name: 'Script Fail',
        code: '// fail',
        metadata: {
          name: 'Script Fail',
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

      const scriptB: ScriptRecord = {
        id: 'script-succeed',
        name: 'Script Succeed',
        code: '// succeed',
        metadata: {
          name: 'Script Succeed',
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
      await saveScript(scriptA);
      await saveScript(scriptB);

      // Script A fails; Script B succeeds
      context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
        if (opts.args[2] === 'script-fail') {
          throw new Error('Sandbox creation error');
        }
        executedScripts.push(opts);
        return [{ result: true }];
      });

      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });

      // Script A rolled back; Script B retained
      expect(injector.hasInjected(tabId, 0, 'script-fail', 'document-start')).toBe(false);
      expect(injector.hasInjected(tabId, 0, 'script-succeed', 'document-start')).toBe(true);
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('script-succeed');

      // Now fix Script A failure and trigger processStage again
      context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
        executedScripts.push(opts);
        return [{ result: true }];
      });

      await injector.processStage(tabId, 0, targetUrl, 'document-start');

      // Script A is now injected; Script B was already deduplicated and NOT re-injected
      expect(executedScripts.length).toBe(2);
      expect(executedScripts[1].args[2]).toBe('script-fail');
      expect(injector.hasInjected(tabId, 0, 'script-fail', 'document-start')).toBe(true);
      expect(injector.hasInjected(tabId, 0, 'script-succeed', 'document-start')).toBe(true);
    });

    it('M3.4.2: subframe failure rolls back only subframe', async () => {
      const tabId = 401;

      const subframeScript: ScriptRecord = {
        id: 'subframe-rollback-script',
        name: 'Subframe Rollback Script',
        code: '// test',
        metadata: {
          name: 'Subframe Rollback Script',
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

      // Frame 1 fails; Frame 2 succeeds
      context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
        if (opts.target.frameIds?.includes(1)) {
          throw new Error('Frame 1 detached');
        }
        executedScripts.push(opts);
        return [{ result: true }];
      });

      // Frame 1 injection fails
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/frame1',
        processId: 1,
        transitionType: 'auto_subframe',
        timeStamp: Date.now()
      });
      expect(injector.hasInjected(tabId, 1, 'subframe-rollback-script', 'document-start')).toBe(false);

      // Frame 2 injection succeeds
      await injector.handleCommitted({
        tabId,
        frameId: 2,
        url: 'https://example.com/frame2',
        processId: 1,
        transitionType: 'auto_subframe',
        timeStamp: Date.now()
      });
      expect(injector.hasInjected(tabId, 2, 'subframe-rollback-script', 'document-start')).toBe(true);
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].target.frameIds).toEqual([2]);
    });

    it('M3.4.3: syntax error in pageSandboxRunner rolls back dedupe key', async () => {
      const tabId = 402;
      const targetUrl = 'https://example.com/syntax-test';

      // Verify pageSandboxRunner directly returns failure object on syntax error
      const brokenCode = `// ==UserScript==
// @name Syntax Error Script
// @match *://example.com/syntax-test*
// @run-at document-start
// ==/UserScript==
var x = ; // syntax error`;

      const fixedCode = `// ==UserScript==
// @name Syntax Error Script
// @match *://example.com/syntax-test*
// @run-at document-start
// ==/UserScript==
var x = 123; // valid code`;

      const runnerRes = pageSandboxRunner(brokenCode, 'Syntax Error Script', 'syntax-err-script', {});
      expect(runnerRes.success).toBe(false);
      expect(runnerRes.error).toBeDefined();

      // Now test complete pipeline rollback through executeScript & processStage
      const brokenScript: ScriptRecord = {
        id: 'syntax-err-script',
        name: 'Syntax Error Script',
        code: brokenCode,
        metadata: {
          name: 'Syntax Error Script',
          matches: ['*://example.com/syntax-test*'],
          matchPatterns: ['*://example.com/syntax-test*'],
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
      await saveScript(brokenScript);

      // Mock executeScript to simulate Chrome running pageSandboxRunner and returning its result
      context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
        executedScripts.push(opts);
        if (typeof opts.func === 'function') {
          const res = opts.func(...opts.args);
          return [{ result: res }];
        }
        return [{ result: true }];
      });

      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });

      // Script execution should have failed and dedupe key must be rolled back
      expect(injector.hasInjected(tabId, 0, 'syntax-err-script', 'document-start')).toBe(false);

      // Now fix the script code and re-inject
      const fixedScript = {
        ...brokenScript,
        code: fixedCode,
        updatedAt: Date.now()
      };
      await saveScript(fixedScript);

      await injector.processStage(tabId, 0, targetUrl, 'document-start');

      // Fixed script should now successfully inject
      expect(injector.hasInjected(tabId, 0, 'syntax-err-script', 'document-start')).toBe(true);
    });
  });
});
