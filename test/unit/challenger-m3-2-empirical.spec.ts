/**
 * Empirical Challenger M3-2 Verification Suite:
 * 1. SPA Route Navigation Injection in ScriptInjector.handleTabsUpdated
 * 2. Deterministic Ordering Oracle in StageScheduler.getMatchingScripts
 * 3. Fallback Script Execution via EXECUTE_USERSCRIPT in ContentScriptBridge.handleRuntimeMessage
 *
 * Location: test/unit/challenger-m3-2-empirical.spec.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { ScriptInjector } from '@/background/injector';
import { StageScheduler } from '@/background/injector/stage-scheduler';
import { InjectionGuard } from '@/background/injector/injection-guard';
import { PrehydratedStorageLoader } from '@/background/injector/storage-loader';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { ContentScriptBridge } from '@/content/bridge';
import { saveScript, resetToDefaultScripts, deleteScript } from '@/shared/storage';
import type { ScriptRecord, ParsedMetadata } from '@/shared/types';

function mockMeta(partial: Partial<ParsedMetadata> = {}): ParsedMetadata {
  return {
    name: 'Mock Script',
    matches: ['*://*/*'],
    matchPatterns: ['*://*/*'],
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
    rawEntries: {},
    ...partial
  };
}

describe('Empirical Challenger M3-2: Comprehensive Adversarial & Verification Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Dimension 1: SPA Route Update Injection in ScriptInjector.handleTabsUpdated
  // =========================================================================
  describe('Dimension 1: SPA Route Navigation Injection (ScriptInjector.handleTabsUpdated)', () => {
    let debuggerMgr: TabDebuggerManager;
    let injector: ScriptInjector;
    let executedInTab: any[] = [];

    beforeEach(async () => {
      executedInTab = [];
      context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
        executedInTab.push(opts);
        return [{ result: { success: true } }];
      });

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
    });

    it('1.1: SPA in-page pushState (changeInfo.url with status undefined) triggers document-idle injection for new route', async () => {
      const tabId = 101;
      const initialUrl = 'https://spa-app.com/home';
      const nextRouteUrl = 'https://spa-app.com/dashboard';

      // Seed initial navigation
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: initialUrl,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });

      const processStageSpy = vi.spyOn(injector, 'processStage');

      // SPA navigation triggers tabs.onUpdated with new URL but no status: 'complete'
      await injector.handleTabsUpdated(
        tabId,
        { url: nextRouteUrl },
        { id: tabId, url: nextRouteUrl } as any
      );

      expect(processStageSpy).toHaveBeenCalledWith(tabId, 0, nextRouteUrl, 'document-idle');
    });

    it('1.2: Subsequent status: complete on the same SPA route does NOT cause double injection', async () => {
      const tabId = 102;
      const routeUrl = 'https://spa-app.com/analytics';

      // Clear default catch-all scripts to isolate our test script
      await deleteScript('sample-cookie-inspector');
      await deleteScript('sample-cdp-logger');
      await deleteScript('sample-dom-highlighter');

      // Register custom script matching this SPA
      const spaScript: ScriptRecord = {
        id: 'spa-test-script',
        name: 'SPA Analytics Script',
        code: 'console.log("analytics loaded");',
        enabled: true,
        metadata: mockMeta({
          name: 'SPA Analytics Script',
          matches: ['https://spa-app.com/*'],
          runAt: 'document-idle'
        }),
        createdAt: 1000,
        updatedAt: 1000
      };
      await saveScript(spaScript);

      // Initial tab committed to SPA root
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: 'https://spa-app.com/root',
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });

      executedInTab.length = 0;

      // Event 1: SPA URL updates to /analytics (loading or status undefined)
      await injector.handleTabsUpdated(
        tabId,
        { url: routeUrl, status: 'loading' },
        { id: tabId, url: routeUrl } as any
      );

      expect(executedInTab.length).toBe(1);
      expect(executedInTab[0].args[2]).toBe('spa-test-script');

      // Event 2: Tab finishes loading (status: 'complete') for the same URL
      await injector.handleTabsUpdated(
        tabId,
        { status: 'complete' },
        { id: tabId, url: routeUrl } as any
      );

      // Deduplication guard must prevent duplicate injection
      expect(executedInTab.length).toBe(1);
    });

    it('1.3: Multi-hop SPA navigation (Route A -> Route B -> Route C -> Route A) executes scripts for each transition', async () => {
      const tabId = 103;

      await deleteScript('sample-cookie-inspector');
      await deleteScript('sample-cdp-logger');
      await deleteScript('sample-dom-highlighter');

      const scriptA: ScriptRecord = {
        id: 'script-route-a',
        name: 'Script Route A',
        code: 'console.log("A");',
        enabled: true,
        metadata: mockMeta({ name: 'A', matches: ['https://app.io/a*'], runAt: 'document-idle' }),
        createdAt: 10,
        updatedAt: 10
      };
      const scriptB: ScriptRecord = {
        id: 'script-route-b',
        name: 'Script Route B',
        code: 'console.log("B");',
        enabled: true,
        metadata: mockMeta({ name: 'B', matches: ['https://app.io/b*'], runAt: 'document-idle' }),
        createdAt: 20,
        updatedAt: 20
      };
      await saveScript(scriptA);
      await saveScript(scriptB);

      // Hop 1: Land on Route A
      await injector.handleTabsUpdated(
        tabId,
        { url: 'https://app.io/a', status: 'complete' },
        { id: tabId, url: 'https://app.io/a' } as any
      );
      expect(executedInTab.map((e) => e.args[2])).toEqual(['script-route-a']);

      executedInTab.length = 0;

      // Hop 2: Navigate to Route B
      await injector.handleTabsUpdated(
        tabId,
        { url: 'https://app.io/b' },
        { id: tabId, url: 'https://app.io/b' } as any
      );
      expect(executedInTab.map((e) => e.args[2])).toEqual(['script-route-b']);

      executedInTab.length = 0;

      // Hop 3: Navigate back to Route A
      await injector.handleTabsUpdated(
        tabId,
        { url: 'https://app.io/a' },
        { id: tabId, url: 'https://app.io/a' } as any
      );
      // Script A must re-inject because URL changed back to Route A
      expect(executedInTab.map((e) => e.args[2])).toEqual(['script-route-a']);
    });

    it('1.4: Title, favicon or sound state changes without URL change do not trigger injection', async () => {
      const tabId = 104;
      const currentUrl = 'https://example.com/page';

      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: currentUrl,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });

      const processStageSpy = vi.spyOn(injector, 'processStage');

      // Tab updates title only
      await injector.handleTabsUpdated(
        tabId,
        { title: 'New Page Title' } as any,
        { id: tabId, url: currentUrl } as any
      );

      // Tab updates favicon only
      await injector.handleTabsUpdated(
        tabId,
        { favIconUrl: 'https://example.com/icon.png' } as any,
        { id: tabId, url: currentUrl } as any
      );

      // Tab updates audible state
      await injector.handleTabsUpdated(
        tabId,
        { audible: true } as any,
        { id: tabId, url: currentUrl } as any
      );

      expect(processStageSpy).not.toHaveBeenCalled();
    });

    it('1.5: Simultaneous url and status complete in single changeInfo executes exactly once', async () => {
      const tabId = 105;
      const targetUrl = 'https://example.com/one-shot';

      await deleteScript('sample-cookie-inspector');
      await deleteScript('sample-cdp-logger');
      await deleteScript('sample-dom-highlighter');

      const oneShotScript: ScriptRecord = {
        id: 'one-shot-script',
        name: 'One Shot Script',
        code: 'console.log("one shot");',
        enabled: true,
        metadata: mockMeta({ name: 'One Shot', matches: ['https://example.com/one-shot'], runAt: 'document-idle' }),
        createdAt: 100,
        updatedAt: 100
      };
      await saveScript(oneShotScript);

      executedInTab.length = 0;

      await injector.handleTabsUpdated(
        tabId,
        { url: targetUrl, status: 'complete' },
        { id: tabId, url: targetUrl } as any
      );

      expect(executedInTab.length).toBe(1);
      expect(executedInTab[0].args[2]).toBe('one-shot-script');
    });

    it('1.6: Rapid consecutive SPA route transitions do not deadlock or throw unhandled exceptions', async () => {
      const tabId = 106;
      const routes = [
        'https://fast-spa.com/step1',
        'https://fast-spa.com/step2',
        'https://fast-spa.com/step3',
        'https://fast-spa.com/step4',
        'https://fast-spa.com/step5'
      ];

      // Fire 5 rapid route changes concurrently
      const promises = routes.map((url) =>
        injector.handleTabsUpdated(tabId, { url }, { id: tabId, url } as any)
      );

      await expect(Promise.all(promises)).resolves.toBeDefined();
    });
  });

  // =========================================================================
  // Dimension 2: Deterministic Ordering Oracle in StageScheduler
  // =========================================================================
  describe('Dimension 2: Deterministic Ordering Oracle (StageScheduler.getMatchingScripts)', () => {
    let guard: InjectionGuard;
    let loader: PrehydratedStorageLoader;
    let scheduler: StageScheduler;

    beforeEach(() => {
      guard = new InjectionGuard();
      loader = new PrehydratedStorageLoader();
      scheduler = new StageScheduler(guard, loader);
      (scheduler as any).cachedSettings = { globalEnabled: true } as any;
    });

    afterEach(() => {
      scheduler.destroy();
    });

    it('2.1: Priority 1: strict ascending order by createdAt timestamp', async () => {
      const scripts: ScriptRecord[] = [
        { id: 's3', name: 'Script C', code: '', enabled: true, createdAt: 300, updatedAt: 300, metadata: mockMeta({ matches: ['*://*/*'], runAt: 'document-idle' }) },
        { id: 's1', name: 'Script A', code: '', enabled: true, createdAt: 100, updatedAt: 100, metadata: mockMeta({ matches: ['*://*/*'], runAt: 'document-idle' }) },
        { id: 's2', name: 'Script B', code: '', enabled: true, createdAt: 200, updatedAt: 200, metadata: mockMeta({ matches: ['*://*/*'], runAt: 'document-idle' }) }
      ];

      (scheduler as any).cachedScripts = scripts;

      const matched = await scheduler.getMatchingScripts('https://example.com/test', 'document-idle');
      expect(matched.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    });

    it('2.2: Priority 2: name alphabetical order tie-breaker when createdAt is equal', async () => {
      const scripts: ScriptRecord[] = [
        { id: 's_zulu', name: 'Zulu', code: '', enabled: true, createdAt: 500, updatedAt: 500, metadata: mockMeta({ matches: ['*://*/*'], runAt: 'document-idle' }) },
        { id: 's_bravo', name: 'Bravo', code: '', enabled: true, createdAt: 500, updatedAt: 500, metadata: mockMeta({ matches: ['*://*/*'], runAt: 'document-idle' }) },
        { id: 's_alpha', name: 'Alpha', code: '', enabled: true, createdAt: 500, updatedAt: 500, metadata: mockMeta({ matches: ['*://*/*'], runAt: 'document-idle' }) }
      ];

      (scheduler as any).cachedScripts = scripts;

      const matched = await scheduler.getMatchingScripts('https://example.com/test', 'document-idle');
      expect(matched.map((s) => s.id)).toEqual(['s_alpha', 's_bravo', 's_zulu']);
    });

    it('2.3: Priority 3: id alphabetical order tie-breaker when createdAt and name are both equal', async () => {
      const scripts: ScriptRecord[] = [
        { id: 'id-gamma', name: 'Identical Name', code: '', enabled: true, createdAt: 1000, updatedAt: 1000, metadata: mockMeta({ matches: ['*://*/*'], runAt: 'document-idle' }) },
        { id: 'id-alpha', name: 'Identical Name', code: '', enabled: true, createdAt: 1000, updatedAt: 1000, metadata: mockMeta({ matches: ['*://*/*'], runAt: 'document-idle' }) },
        { id: 'id-beta', name: 'Identical Name', code: '', enabled: true, createdAt: 1000, updatedAt: 1000, metadata: mockMeta({ matches: ['*://*/*'], runAt: 'document-idle' }) }
      ];

      (scheduler as any).cachedScripts = scripts;

      const matched = await scheduler.getMatchingScripts('https://example.com/test', 'document-idle');
      expect(matched.map((s) => s.id)).toEqual(['id-alpha', 'id-beta', 'id-gamma']);
    });

    it('2.4: Missing createdAt defaults to 0 and missing name defaults to empty string', async () => {
      const scripts: ScriptRecord[] = [
        { id: 'has-created-at', name: 'Has Time', code: '', enabled: true, createdAt: 10, updatedAt: 10, metadata: mockMeta({ matches: ['*://*/*'], runAt: 'document-idle' }) },
        { id: 'missing-created-at-b', name: 'B', code: '', enabled: true, createdAt: undefined as any, updatedAt: 0, metadata: mockMeta({ matches: ['*://*/*'], runAt: 'document-idle' }) },
        { id: 'missing-created-at-a', name: 'A', code: '', enabled: true, createdAt: undefined as any, updatedAt: 0, metadata: mockMeta({ matches: ['*://*/*'], runAt: 'document-idle' }) }
      ];

      (scheduler as any).cachedScripts = scripts;

      const matched = await scheduler.getMatchingScripts('https://example.com/test', 'document-idle');
      // createdAt undefined treated as 0, so missing-created-at come before has-created-at
      expect(matched.map((s) => s.id)).toEqual(['missing-created-at-a', 'missing-created-at-b', 'has-created-at']);
    });

    it('2.5: Monte-Carlo Permutation Invariant: 100 random shuffles produce identical deterministic output order', async () => {
      // Build an array of 20 scripts with varying createdAt, names, and IDs
      const baseScripts: ScriptRecord[] = [];
      for (let i = 0; i < 20; i++) {
        baseScripts.push({
          id: `script-perm-${String(i).padStart(2, '0')}`,
          name: `Name ${String.fromCharCode(65 + (i % 5))}`,
          code: '',
          enabled: true,
          createdAt: (i % 4) * 1000,
          updatedAt: (i % 4) * 1000,
          metadata: mockMeta({ matches: ['https://target.com/*'], runAt: 'document-idle' })
        });
      }

      // Compute canonical reference order
      (scheduler as any).cachedScripts = [...baseScripts];
      const referenceResult = await scheduler.getMatchingScripts('https://target.com/page', 'document-idle');
      const referenceIds = referenceResult.map((s) => s.id);

      expect(referenceIds.length).toBe(20);

      // Helper for Fisher-Yates shuffle
      function shuffle<T>(arr: T[]): T[] {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }

      // Test across 100 randomized input permutations
      for (let trial = 0; trial < 100; trial++) {
        const randomized = shuffle(baseScripts);
        (scheduler as any).cachedScripts = randomized;

        const trialResult = await scheduler.getMatchingScripts('https://target.com/page', 'document-idle');
        const trialIds = trialResult.map((s) => s.id);

        expect(trialIds).toEqual(referenceIds);
      }
    });
  });

  // =========================================================================
  // Dimension 3: Fallback Userscript Execution via EXECUTE_USERSCRIPT
  // =========================================================================
  describe('Dimension 3: Fallback Script Execution (ContentScriptBridge.handleRuntimeMessage)', () => {
    let bridge: ContentScriptBridge;

    beforeEach(() => {
      bridge = new ContentScriptBridge({
        channelId: 'test-secure-channel-token',
        autoStart: true
      });
    });

    afterEach(() => {
      bridge.destroy();
    });

    it('3.1: handleRuntimeMessage returns true and responds with { acknowledged: true, success: true } for EXECUTE_USERSCRIPT', () => {
      const mockScript: ScriptRecord = {
        id: 'fallback-exec-1',
        name: 'Fallback Exec 1',
        code: 'return 42;',
        enabled: true,
        metadata: mockMeta({ name: 'Fallback Exec 1', runAt: 'document-start' }),
        createdAt: 1,
        updatedAt: 1
      };

      const sendResponse = vi.fn();
      const result = bridge.handleRuntimeMessage(
        {
          type: 'EXECUTE_USERSCRIPT',
          script: mockScript,
          runAt: 'document-start'
        },
        {},
        sendResponse
      );

      expect(result).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith({ acknowledged: true, success: true });
    });

    it('3.2: Immediate synchronous execution in sandbox for @run-at document-start', () => {
      let scriptExecuted = false;
      const markerName = '__xokj_empirical_fallback_doc_start__';
      (globalThis as any)[markerName] = () => {
        scriptExecuted = true;
      };

      const mockScript: ScriptRecord = {
        id: 'fallback-doc-start',
        name: 'Fallback Doc Start',
        code: `globalThis['${markerName}']();`,
        enabled: true,
        metadata: mockMeta({ name: 'Fallback Doc Start', runAt: 'document-start' }),
        createdAt: 1,
        updatedAt: 1
      };

      bridge.handleRuntimeMessage({
        type: 'EXECUTE_USERSCRIPT',
        script: mockScript,
        runAt: 'document-start'
      });

      expect(scriptExecuted).toBe(true);
      delete (globalThis as any)[markerName];
    });

    it('3.3: Message runAt parameter overrides script metadata.runAt', () => {
      let executedTiming = '';
      const markerName = '__xokj_timing_marker__';
      (globalThis as any)[markerName] = (val: string) => {
        executedTiming = val;
      };

      // Script specifies document-idle in metadata, but message overrides to document-start
      const mockScript: ScriptRecord = {
        id: 'fallback-timing-override',
        name: 'Timing Override Script',
        code: `globalThis['${markerName}']('executed-immediately');`,
        enabled: true,
        metadata: mockMeta({ name: 'Timing Override', runAt: 'document-idle' }),
        createdAt: 1,
        updatedAt: 1
      };

      bridge.handleRuntimeMessage({
        type: 'EXECUTE_USERSCRIPT',
        script: mockScript,
        runAt: 'document-start' // Forced immediate execution
      });

      expect(executedTiming).toBe('executed-immediately');
      delete (globalThis as any)[markerName];
    });

    it('3.4: Disabled script is ignored and not executed', () => {
      let scriptExecuted = false;
      const markerName = '__xokj_disabled_marker__';
      (globalThis as any)[markerName] = () => {
        scriptExecuted = true;
      };

      const mockScript: ScriptRecord = {
        id: 'fallback-disabled',
        name: 'Disabled Script',
        code: `globalThis['${markerName}']();`,
        enabled: false, // Disabled
        metadata: mockMeta({ name: 'Disabled', runAt: 'document-start' }),
        createdAt: 1,
        updatedAt: 1
      };

      bridge.handleRuntimeMessage({
        type: 'EXECUTE_USERSCRIPT',
        script: mockScript,
        runAt: 'document-start'
      });

      expect(scriptExecuted).toBe(false);
      delete (globalThis as any)[markerName];
    });

    it('3.5: Sandboxed GM APIs are properly injected into fallback script execution scope with grant isolation', () => {
      let capturedGmSetValue: any = null;
      let capturedGmInfo: any = null;
      let capturedGmGetValue: any = null;
      const markerName = '__xokj_gm_scope_marker__';
      (globalThis as any)[markerName] = (setValue: any, info: any, getValue: any) => {
        capturedGmSetValue = setValue;
        capturedGmInfo = info;
        capturedGmGetValue = getValue;
      };

      const mockScript: ScriptRecord = {
        id: 'fallback-gm-script',
        name: 'Fallback GM Script',
        code: `globalThis['${markerName}'](typeof GM_setValue, typeof GM_info, typeof GM_getValue);`,
        enabled: true,
        metadata: mockMeta({
          name: 'Fallback GM',
          runAt: 'document-start',
          grants: ['GM_setValue', 'GM_info']
        }),
        createdAt: 1,
        updatedAt: 1
      };

      bridge.handleRuntimeMessage({
        type: 'EXECUTE_USERSCRIPT',
        script: mockScript,
        runAt: 'document-start'
      });

      // Granted APIs are injected
      expect(capturedGmSetValue).toBe('function');
      expect(capturedGmInfo).toBe('object');
      // Ungranted APIs remain undefined
      expect(capturedGmGetValue).toBe('undefined');
      delete (globalThis as any)[markerName];
    });

    it('3.6: Exceptions thrown by fallback script do not crash the bridge or prevent acknowledgement', () => {
      const mockScript: ScriptRecord = {
        id: 'fallback-throwing',
        name: 'Throwing Script',
        code: 'throw new Error("Deliberate failure in fallback userscript");',
        enabled: true,
        metadata: mockMeta({ name: 'Throwing', runAt: 'document-start' }),
        createdAt: 1,
        updatedAt: 1
      };

      const sendResponse = vi.fn();
      expect(() => {
        bridge.handleRuntimeMessage(
          {
            type: 'EXECUTE_USERSCRIPT',
            script: mockScript,
            runAt: 'document-start'
          },
          {},
          sendResponse
        );
      }).not.toThrow();

      expect(sendResponse).toHaveBeenCalledWith({ acknowledged: true, success: true });
    });

    it('3.7: Malformed messages without script or with invalid types are safely ignored', () => {
      const sendResponse = vi.fn();

      expect(() => bridge.handleRuntimeMessage(null, {}, sendResponse)).not.toThrow();
      expect(() => bridge.handleRuntimeMessage(undefined, {}, sendResponse)).not.toThrow();
      expect(() => bridge.handleRuntimeMessage('string-message', {}, sendResponse)).not.toThrow();
      expect(() => bridge.handleRuntimeMessage({ type: 'EXECUTE_USERSCRIPT' }, {}, sendResponse)).not.toThrow();
      expect(() => bridge.handleRuntimeMessage({ type: 'UNKNOWN_TYPE' }, {}, sendResponse)).not.toThrow();

      expect(sendResponse).not.toHaveBeenCalled();
    });

    it('3.8: Bridge destruction cleanly cleans up and destroys internal CdpClient instance', () => {
      // Trigger lazy creation of internal cdpClient via fallback execution
      const mockScript: ScriptRecord = {
        id: 'fallback-cdp-test',
        name: 'Fallback CDP Script',
        code: 'return 1;',
        enabled: true,
        metadata: mockMeta({ name: 'Fallback CDP', runAt: 'document-start' }),
        createdAt: 1,
        updatedAt: 1
      };

      bridge.handleRuntimeMessage({
        type: 'EXECUTE_USERSCRIPT',
        script: mockScript,
        runAt: 'document-start'
      });

      const client = (bridge as any).cdpClient;
      expect(client).toBeDefined();

      const destroySpy = vi.spyOn(client, 'destroy');
      bridge.destroy();

      expect(destroySpy).toHaveBeenCalled();
      expect((bridge as any).cdpClient).toBeUndefined();
    });
  });
});
