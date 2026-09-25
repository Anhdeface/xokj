/**
 * Empirical Challenger Opt-M3-2: Deep Adversarial Challenge on Selective GM API Closures
 * and Lifecycle Teardown Optimization Suite
 * Location: test/unit/challenger-opt-m3-2.spec.ts
 *
 * Exhaustively challenges:
 * 1. Selective GM API Closures (Feature 11):
 *    - All 8 individual single-grant permutations to verify zero ungranted closures are instantiated.
 *    - Strict absence of CDP bound closures (createGmCdp) when CDP is not granted.
 *    - Directives & domain-driven grant promotion without storage closure leakage.
 *    - Sandbox parameter shadowing and runtime defense under restricted grants.
 *    - Wildcard and legacy backward-compatibility behavior.
 * 2. Lifecycle Teardown & Resource Cleanup (Feature 10 & Feature 12):
 *    - Massive concurrency teardown on pagehide (100 inflight requests rejected with code 1002).
 *    - Window-originated inflight requests teardown and lifecycle event broadcasting.
 *    - Removal of window and runtime message listeners.
 *    - CdpClient inflight timer cancellation and event listener cleanup on pagehide.
 *    - Multi-tenant isolated GM storage eviction across multiple scripts.
 *    - Teardown idempotence and post-teardown stability.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { ContentScriptBridge } from '@/content/bridge';
import {
  CdpClient,
  createGmApi,
  getIsolatedScriptStore,
  clearIsolatedGmStorage
} from '@/content/cdp-sdk';
import { buildSandboxScope, createSandboxRunner } from '@/content/sandbox';
import type { ScriptRecord } from '@/shared/types';

describe('Empirical Challenger Opt-M3-2: Selective GM Closures & Lifecycle Teardown Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let cdpClient: CdpClient;

  beforeEach(() => {
    context = setupChromeMock();
    cdpClient = new CdpClient({ timeoutMs: 1000, autoStart: false });
    clearIsolatedGmStorage();
  });

  afterEach(() => {
    cdpClient.destroy();
    clearIsolatedGmStorage();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Challenge 1: Exhaustive Verification of Selective GM API Closures
  // =========================================================================
  describe('Challenge 1: Selective GM API Closures & Ungranted Allocation Prevention', () => {
    const STANDARD_ALL_KEYS = [
      'GM_setValue',
      'GM_getValue',
      'GM_deleteValue',
      'GM_listValues',
      'GM_addStyle',
      'GM_log',
      'GM_cdp',
      'cdp'
    ];

    it('1.1: single grant GM_setValue instantiates ONLY GM_setValue and GM_info', () => {
      const script: ScriptRecord = {
        id: 'script-set-val',
        name: 'SetVal Only Script',
        code: 'return 1;',
        metadata: {
          name: 'SetVal Only Script',
          grants: ['GM_setValue']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient, ['GM_setValue']);

      expect(typeof api.GM_setValue).toBe('function');
      expect(api.GM_info).toBeDefined();

      // Verify every other API is completely absent
      const ungranted = STANDARD_ALL_KEYS.filter((k) => k !== 'GM_setValue');
      for (const key of ungranted) {
        expect(api[key]).toBeUndefined();
        expect(key in api).toBe(false);
      }

      // Verify GM_setValue executes properly
      (api.GM_setValue as Function)('sampleKey', { test: 123 });
      const store = getIsolatedScriptStore('script-set-val');
      expect(store.get('sampleKey')).toBe(JSON.stringify({ test: 123 }));
    });

    it('1.2: single grant GM_getValue instantiates ONLY GM_getValue and GM_info', () => {
      const script: ScriptRecord = {
        id: 'script-get-val',
        name: 'GetVal Only Script',
        code: 'return 1;',
        metadata: {
          name: 'GetVal Only Script',
          grants: ['GM_getValue']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient, ['GM_getValue']);

      expect(typeof api.GM_getValue).toBe('function');
      expect(api.GM_info).toBeDefined();

      const ungranted = STANDARD_ALL_KEYS.filter((k) => k !== 'GM_getValue');
      for (const key of ungranted) {
        expect(api[key]).toBeUndefined();
        expect(key in api).toBe(false);
      }

      // Prepopulate store and verify getValue reads it
      getIsolatedScriptStore('script-get-val').set('foo', JSON.stringify('bar'));
      expect((api.GM_getValue as Function)('foo')).toBe('bar');
      expect((api.GM_getValue as Function)('missing', 'fallback')).toBe('fallback');
    });

    it('1.3: single grant GM_deleteValue instantiates ONLY GM_deleteValue and GM_info', () => {
      const script: ScriptRecord = {
        id: 'script-del-val',
        name: 'DelVal Only Script',
        code: 'return 1;',
        metadata: {
          name: 'DelVal Only Script',
          grants: ['GM_deleteValue']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient, ['GM_deleteValue']);

      expect(typeof api.GM_deleteValue).toBe('function');
      expect(api.GM_info).toBeDefined();

      const ungranted = STANDARD_ALL_KEYS.filter((k) => k !== 'GM_deleteValue');
      for (const key of ungranted) {
        expect(api[key]).toBeUndefined();
        expect(key in api).toBe(false);
      }

      getIsolatedScriptStore('script-del-val').set('toDelete', 'value');
      (api.GM_deleteValue as Function)('toDelete');
      expect(getIsolatedScriptStore('script-del-val').has('toDelete')).toBe(false);
    });

    it('1.4: single grant GM_listValues instantiates ONLY GM_listValues and GM_info', () => {
      const script: ScriptRecord = {
        id: 'script-list-val',
        name: 'ListVal Only Script',
        code: 'return 1;',
        metadata: {
          name: 'ListVal Only Script',
          grants: ['GM_listValues']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient, ['GM_listValues']);

      expect(typeof api.GM_listValues).toBe('function');
      expect(api.GM_info).toBeDefined();

      const ungranted = STANDARD_ALL_KEYS.filter((k) => k !== 'GM_listValues');
      for (const key of ungranted) {
        expect(api[key]).toBeUndefined();
        expect(key in api).toBe(false);
      }

      const store = getIsolatedScriptStore('script-list-val');
      store.set('k1', 'v1');
      store.set('k2', 'v2');
      const list = (api.GM_listValues as Function)();
      expect(list).toEqual(['k1', 'k2']);
    });

    it('1.5: single grant GM_addStyle instantiates ONLY GM_addStyle and GM_info', () => {
      const script: ScriptRecord = {
        id: 'script-add-style',
        name: 'AddStyle Only Script',
        code: 'return 1;',
        metadata: {
          name: 'AddStyle Only Script',
          grants: ['GM_addStyle']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient, ['GM_addStyle']);

      expect(typeof api.GM_addStyle).toBe('function');
      expect(api.GM_info).toBeDefined();

      const ungranted = STANDARD_ALL_KEYS.filter((k) => k !== 'GM_addStyle');
      for (const key of ungranted) {
        expect(api[key]).toBeUndefined();
        expect(key in api).toBe(false);
      }

      const styleEl = (api.GM_addStyle as Function)('h1 { color: blue; }');
      expect(styleEl).toBeInstanceOf(HTMLElement);
      expect(styleEl.getAttribute('data-xokj-script')).toBe('script-add-style');
      expect(styleEl.textContent).toBe('h1 { color: blue; }');
      styleEl.remove();
    });

    it('1.6: single grant GM_log instantiates ONLY GM_log and GM_info', () => {
      const script: ScriptRecord = {
        id: 'script-log',
        name: 'Logger Script',
        code: 'return 1;',
        metadata: {
          name: 'Logger Script',
          grants: ['GM_log']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient, ['GM_log']);

      expect(typeof api.GM_log).toBe('function');
      expect(api.GM_info).toBeDefined();

      const ungranted = STANDARD_ALL_KEYS.filter((k) => k !== 'GM_log');
      for (const key of ungranted) {
        expect(api[key]).toBeUndefined();
        expect(key in api).toBe(false);
      }

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      (api.GM_log as Function)('Hello', 42);
      expect(logSpy).toHaveBeenCalledWith('[XOKJ: Logger Script]', 'Hello', 42);
      logSpy.mockRestore();
    });

    it('1.7: single grant GM_cdp instantiates GM_cdp AND cdp without unrequested storage/DOM APIs', () => {
      const script: ScriptRecord = {
        id: 'script-cdp',
        name: 'CDP Only Script',
        code: 'return 1;',
        metadata: {
          name: 'CDP Only Script',
          grants: ['GM_cdp']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient, ['GM_cdp']);

      expect(typeof api.GM_cdp).toBe('function');
      expect(api.cdp).toBeDefined();

      const ungranted = ['GM_setValue', 'GM_getValue', 'GM_deleteValue', 'GM_listValues', 'GM_addStyle', 'GM_log'];
      for (const key of ungranted) {
        expect(api[key]).toBeUndefined();
        expect(key in api).toBe(false);
      }
    });

    it('1.8: multiple explicit grants allocate exactly requested subset', () => {
      const script: ScriptRecord = {
        id: 'script-multi',
        name: 'Multi Script',
        code: 'return 1;',
        metadata: {
          name: 'Multi Script',
          grants: ['GM_setValue', 'GM_getValue', 'GM_log']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient, ['GM_setValue', 'GM_getValue', 'GM_log']);

      expect(typeof api.GM_setValue).toBe('function');
      expect(typeof api.GM_getValue).toBe('function');
      expect(typeof api.GM_log).toBe('function');
      expect(api.GM_info).toBeDefined();

      // Remaining must be undefined
      expect(api.GM_deleteValue).toBeUndefined();
      expect(api.GM_listValues).toBeUndefined();
      expect(api.GM_addStyle).toBeUndefined();
      expect(api.GM_cdp).toBeUndefined();
      expect(api.cdp).toBeUndefined();
    });

    it('1.9: buildSandboxScope promotes @cdp.domains to cdp grants without storage/style closures', () => {
      const script: ScriptRecord = {
        id: 'script-cdp-domains',
        name: 'CDP Domains Script',
        code: 'return 1;',
        metadata: {
          name: 'CDP Domains Script',
          grants: [], // Empty grants with CDP domains
          cdpDomains: ['Page', 'DOM']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);

      expect(typeof scope.GM_cdp).toBe('function');
      expect(scope.cdp).toBe(cdpClient);

      // Storage and styling closures MUST NOT be instantiated
      expect(scope.GM_setValue).toBeUndefined();
      expect(scope.GM_getValue).toBeUndefined();
      expect(scope.GM_deleteValue).toBeUndefined();
      expect(scope.GM_listValues).toBeUndefined();
      expect(scope.GM_addStyle).toBeUndefined();
      expect(scope.GM_log).toBeUndefined();
    });

    it('1.10: wildcard grant @grant * instantiates all APIs', () => {
      const script: ScriptRecord = {
        id: 'script-wildcard',
        name: 'Wildcard Script',
        code: 'return 1;',
        metadata: {
          name: 'Wildcard Script',
          grants: ['*']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient, ['*']);

      for (const key of STANDARD_ALL_KEYS) {
        expect(api[key]).toBeDefined();
      }
      expect(api.GM_info).toBeDefined();
    });

    it('1.11: sandbox runner enforces runtime defense: ungranted APIs throw TypeError', () => {
      const script: ScriptRecord = {
        id: 'script-defense',
        name: 'Restricted Script',
        code: `
          try {
            GM_setValue("k", "v");
          } catch(e) {
            throw new Error("setValue failed");
          }
          GM_getValue("k");
        `,
        metadata: {
          name: 'Restricted Script',
          grants: ['GM_setValue']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);

      // GM_setValue succeeded, but GM_getValue was shadowed to undefined -> TypeError
      expect(() => runner()).toThrow(TypeError);
    });

    it('1.12: script declaring @grant none throws when calling cdp or GM_* APIs', () => {
      const script: ScriptRecord = {
        id: 'script-none-defense',
        name: 'None Script',
        code: `
          cdp.send("Page.enable");
        `,
        metadata: {
          name: 'None Script',
          grants: ['none']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);

      expect(() => runner()).toThrow(TypeError);
    });
  });

  // =========================================================================
  // Challenge 2: Deep Verification of Lifecycle Teardown Hooks
  // =========================================================================
  describe('Challenge 2: Lifecycle Teardown, Timer Clearance & Memory Leaks', () => {
    let bridge: ContentScriptBridge;
    let postedToWindow: any[] = [];

    beforeEach(() => {
      postedToWindow = [];
      vi.stubGlobal('postMessage', (msg: any) => {
        postedToWindow.push(msg);
      });

      bridge = new ContentScriptBridge({
        timeoutMs: 5000,
        autoStart: true,
        channelId: 'test_channel_m3_2'
      });
    });

    afterEach(() => {
      bridge.destroy();
    });

    it('2.1: massive concurrency (100 inflight requests) cleanly drained with code 1002 on disconnect', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async () => {
        // Background never returns, simulating long-running commands
        return new Promise(() => {});
      });

      const promises: Promise<any>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(bridge.send(`Method_${i}`, { param: i }));
      }

      // All 100 requests should be pending
      expect((bridge as any).pendingRequests.size).toBe(100);

      // Trigger disconnect simulating pagehide navigation
      bridge.disconnect('pagehide_navigation');

      // Verify all 100 promises rejected with detachment code 1002
      const results = await Promise.allSettled(promises);
      expect(results.length).toBe(100);

      for (const res of results) {
        expect(res.status).toBe('rejected');
        if (res.status === 'rejected') {
          expect(res.reason.code).toBe(1002);
          expect(res.reason.message).toContain('CDP session detached: pagehide_navigation');
        }
      }

      // Pending requests map must be completely empty
      expect((bridge as any).pendingRequests.size).toBe(0);
      expect(bridge.getStatus().status).toBe('DETACHED');
    });

    it('2.2: window-originated inflight requests are responded to window with code 1002 on disconnect', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async () => {
        return new Promise(() => {});
      });

      // Submit 20 requests from window Main World asynchronously (without awaiting hanging backend)
      for (let i = 0; i < 20; i++) {
        bridge.handleWindowMessage({
          source: window,
          data: {
            source: 'xokj-userscript',
            channelId: 'test_channel_m3_2',
            type: 'CDP_RPC_REQUEST',
            id: `win_req_${i}`,
            method: `DOM.getNode_${i}`
          }
        } as any);
      }

      expect((bridge as any).pendingRequests.size).toBe(20);

      // Disconnect
      bridge.disconnect('page_unloaded');

      expect((bridge as any).pendingRequests.size).toBe(0);

      // Verify all 20 responses posted to window with code 1002
      for (let i = 0; i < 20; i++) {
        const matchingRes = postedToWindow.find(
          (m) => m.type === 'CDP_RPC_RESPONSE' && m.id === `win_req_${i}`
        );
        expect(matchingRes).toBeDefined();
        expect(matchingRes.success).toBe(false);
        expect(matchingRes.error.code).toBe(1002);
        expect(matchingRes.error.message).toContain('CDP session detached: page_unloaded');
      }

      // Verify detachment lifecycle broadcast was posted
      const lifecycleBroadcast = postedToWindow.find((m) => m.type === 'CDP_LIFECYCLE_EVENT');
      expect(lifecycleBroadcast).toBeDefined();
      expect(lifecycleBroadcast.status).toBe('DETACHED');
      expect(lifecycleBroadcast.reason).toBe('page_unloaded');
    });

    it('2.3: bridge unregisters window and chrome runtime message listeners on disconnect', () => {
      const removeWindowListenerSpy = vi.spyOn(window, 'removeEventListener');
      const removeRuntimeListenerSpy = vi.spyOn(chrome.runtime.onMessage, 'removeListener');

      bridge.disconnect('tab_closed');

      expect(removeWindowListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
      expect(removeRuntimeListenerSpy).toHaveBeenCalledWith(expect.any(Function));
      expect((bridge as any).isListening).toBe(false);
    });

    it('2.4: CdpClient cancels all pending request timers on pagehide without uncaught timeout errors', async () => {
      vi.useFakeTimers();

      const client = new CdpClient({ timeoutMs: 30000, autoStart: true });

      const pendingPromises: Promise<any>[] = [];
      for (let i = 0; i < 20; i++) {
        pendingPromises.push(client.send(`Page.captureScreenshot_${i}`));
      }

      expect((client as any).pendingRequests.size).toBe(20);

      // Dispatch pagehide
      window.dispatchEvent(new Event('pagehide'));

      expect((client as any).pendingRequests.size).toBe(0);
      expect((client as any).isListening).toBe(false);

      // Advance virtual clock past the original 30s timeout
      vi.advanceTimersByTime(40000);

      // Check all promises rejected cleanly with destruction error
      const results = await Promise.allSettled(pendingPromises);
      for (const res of results) {
        expect(res.status).toBe('rejected');
        if (res.status === 'rejected') {
          expect(res.reason.message).toContain('CdpClient destroyed: request cancelled');
        }
      }

      vi.useRealTimers();
    });

    it('2.5: pagehide purges isolated GM storage partitions across multiple distinct scripts', () => {
      const scriptIds = ['script_alpha', 'script_beta', 'script_gamma', 'script_delta'];

      // Populate 4 script partitions with 10 keys each
      for (const id of scriptIds) {
        const store = getIsolatedScriptStore(id);
        for (let i = 0; i < 10; i++) {
          store.set(`key_${i}`, `val_${id}_${i}`);
        }
        expect(store.size).toBe(10);
      }

      // Fire pagehide event
      window.dispatchEvent(new Event('pagehide'));

      // Verify all 4 partitions were purged
      for (const id of scriptIds) {
        const freshStore = getIsolatedScriptStore(id);
        expect(freshStore.size).toBe(0);
        for (let i = 0; i < 10; i++) {
          expect(freshStore.get(`key_${i}`)).toBeUndefined();
        }
      }
    });

    it('2.6: selective storage clearIsolatedGmStorage(scriptId) purges only target partition', () => {
      const storeA = getIsolatedScriptStore('script_preserve');
      storeA.set('foo', 'bar');

      const storeB = getIsolatedScriptStore('script_target');
      storeB.set('baz', 'qux');

      // Purge only script_target
      clearIsolatedGmStorage('script_target');

      expect(getIsolatedScriptStore('script_target').size).toBe(0);
      expect(getIsolatedScriptStore('script_preserve').get('foo')).toBe('bar');
    });

    it('2.7: disconnect() and destroy() are idempotent and safe to call multiple times', () => {
      expect(() => {
        bridge.disconnect();
        bridge.disconnect();
        bridge.disconnect();
      }).not.toThrow();

      const client = new CdpClient({ autoStart: true });
      expect(() => {
        client.destroy();
        client.destroy();
        client.disconnect();
      }).not.toThrow();
    });
  });
});
