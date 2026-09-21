/**
 * Unit Test Suite: Script Injection Orchestrator
 * Location: test/unit/injector.spec.ts
 *
 * Tests URL matching, @run-at timing stages, declarative CDP synchronization, and duplicate prevention.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { ScriptInjector } from '@/background/injector';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { saveScript, resetToDefaultScripts, saveSettings } from '@/shared/storage';
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
});
