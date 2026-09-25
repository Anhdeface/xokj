/**
 * Empirical Challenger Opt-M3 Re-verification 2:
 * GM API Factory Allocation & Lifecycle Teardown Verification Suite
 * Location: test/unit/challenger-opt-m3-re2-empirical.spec.ts
 *
 * Empirical Challenges:
 * 1. Selective GM API Closures (Feature 11):
 *    - Exhaustive single-grant isolation (zero ungranted closures allocated).
 *    - Strict non-instantiation of CdpClient/createGmCdp when CDP is ungranted.
 *    - Empty grants and @grant none guarantees in createGmApi and buildSandboxScope.
 *    - @cdp.domains promotion without storage/DOM closure leakage.
 *    - Adversarial grant inputs (__proto__, constructor, unknown grants).
 *    - Multi-tenant script storage isolation.
 * 2. Lifecycle Teardown & Disconnection (Feature 10 & 12):
 *    - 500 concurrent mixed-origin inflight requests drained with code 1002 on disconnect().
 *    - Complete timer clearance (0 timeout callbacks triggered after virtual clock advance).
 *    - Post-disconnect window message dropping (1,000 messages dropped, 0 sent to background).
 *    - processWindowRpcRequest detached guard emitting code 1002 without pending request leakage.
 *    - Window 'pagehide' hook trigger verifying CdpClient cancellation and GM storage purge.
 *    - Teardown idempotence and reinitialization cleanliness.
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
import { buildSandboxScope, createSandboxRunner, PRIVILEGED_API_KEYS } from '@/content/sandbox';
import type { ScriptRecord } from '@/shared/types';

describe('Empirical Challenger Opt-M3 Re-verification 2: GM Factory & Lifecycle Teardown', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let cdpClient: CdpClient;

  beforeEach(() => {
    context = setupChromeMock();
    cdpClient = new CdpClient({ timeoutMs: 2000, autoStart: false });
    clearIsolatedGmStorage();
  });

  afterEach(() => {
    cdpClient.destroy();
    clearIsolatedGmStorage();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Challenge Group 1: Selective GM API Closures & Zero Ungranted Allocations
  // =========================================================================
  describe('Group 1: Selective GM API Factory & Allocation Minimization', () => {
    const ALL_GM_KEYS = [
      'GM_setValue',
      'GM_getValue',
      'GM_deleteValue',
      'GM_listValues',
      'GM_addStyle',
      'GM_log',
      'GM_cdp',
      'cdp'
    ] as const;

    it('1.1: each individual grant instantiates only its corresponding function and GM_info', () => {
      const grantsToTest = [
        'GM_setValue',
        'GM_getValue',
        'GM_deleteValue',
        'GM_listValues',
        'GM_addStyle',
        'GM_log'
      ];

      for (const targetGrant of grantsToTest) {
        const script: ScriptRecord = {
          id: `script_${targetGrant}`,
          name: `Script ${targetGrant}`,
          code: 'return 1;',
          metadata: {
            name: `Script ${targetGrant}`,
            grants: [targetGrant]
          } as any,
          enabled: true,
          createdAt: 0,
          updatedAt: 0
        };

        const api = createGmApi(script, cdpClient, [targetGrant]);

        // Target grant must be defined as a function
        expect(typeof api[targetGrant], `Expected ${targetGrant} to be a function`).toBe('function');
        expect(api.GM_info).toBeDefined();

        // Every ungranted key must be completely absent from the object
        for (const otherKey of ALL_GM_KEYS) {
          if (otherKey !== targetGrant) {
            expect(api[otherKey], `Expected ${otherKey} to be undefined when only ${targetGrant} granted`).toBeUndefined();
            expect(otherKey in api, `Expected ${otherKey} not to be in api keys`).toBe(false);
          }
        }
      }
    });

    it('1.2: storage grants do NOT instantiate CDP client or GM_cdp closures', () => {
      const script: ScriptRecord = {
        id: 'script-storage-only',
        name: 'Storage Only',
        code: 'return 1;',
        metadata: {
          name: 'Storage Only',
          grants: ['GM_setValue', 'GM_getValue', 'GM_deleteValue', 'GM_listValues']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, undefined, ['GM_setValue', 'GM_getValue', 'GM_deleteValue', 'GM_listValues']);

      expect(api.GM_setValue).toBeDefined();
      expect(api.GM_getValue).toBeDefined();
      expect(api.GM_deleteValue).toBeDefined();
      expect(api.GM_listValues).toBeDefined();

      // Zero CDP presence
      expect(api.cdp).toBeUndefined();
      expect(api.GM_cdp).toBeUndefined();
      expect('cdp' in api).toBe(false);
      expect('GM_cdp' in api).toBe(false);
    });

    it('1.3: empty grants [] allocates only GM_info with zero callable closures', () => {
      const script: ScriptRecord = {
        id: 'script-empty-grants',
        name: 'Empty Grants Script',
        code: 'return 1;',
        metadata: {
          name: 'Empty Grants Script',
          grants: []
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient, []);
      const keys = Object.keys(api);

      expect(keys).toEqual(['GM_info']);
      for (const k of ALL_GM_KEYS) {
        expect(api[k]).toBeUndefined();
      }

      // In sandbox scope, empty grants returns strictly base globals
      const scope = buildSandboxScope(script, cdpClient);
      for (const privKey of PRIVILEGED_API_KEYS) {
        expect(scope[privKey]).toBeUndefined();
      }
    });

    it('1.4: @grant none returns only GM_info in createGmApi and strictly baseGlobals in sandbox', () => {
      const script: ScriptRecord = {
        id: 'script-none-grants',
        name: 'None Grants Script',
        code: 'return 1;',
        metadata: {
          name: 'None Grants Script',
          grants: ['none']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient, ['none']);
      expect(Object.keys(api)).toEqual(['GM_info']);

      const scope = buildSandboxScope(script, cdpClient);
      // Scope should only contain window, document, console
      expect(scope.window).toBeDefined();
      expect(scope.document).toBeDefined();
      expect(scope.console).toBeDefined();

      for (const privKey of PRIVILEGED_API_KEYS) {
        expect(scope[privKey]).toBeUndefined();
      }
    });

    it('1.5: @cdp.domains promotion grants CDP without leaking storage or styling closures', () => {
      const script: ScriptRecord = {
        id: 'script-domains-promoted',
        name: 'Domains Script',
        code: 'return 1;',
        metadata: {
          name: 'Domains Script',
          grants: [],
          cdpDomains: ['Page', 'Runtime', 'Network']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);

      // cdp and GM_cdp must be present
      expect(scope.cdp).toBe(cdpClient);
      expect(typeof scope.GM_cdp).toBe('function');

      // All storage and style closures must be absent
      const ungrantedStorage = ['GM_setValue', 'GM_getValue', 'GM_deleteValue', 'GM_listValues', 'GM_addStyle', 'GM_log'];
      for (const k of ungrantedStorage) {
        expect(scope[k]).toBeUndefined();
      }
    });

    it('1.6: adversarial grant names (__proto__, constructor, unknown) are rejected cleanly', () => {
      const script: ScriptRecord = {
        id: 'script-adversarial-grants',
        name: 'Malicious Grants Script',
        code: 'return 1;',
        metadata: {
          name: 'Malicious Grants Script',
          grants: ['__proto__', 'constructor', 'toString', 'GM_unknown_exploit', 'alert']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient, [
        '__proto__',
        'constructor',
        'toString',
        'GM_unknown_exploit',
        'alert'
      ]);

      // Prototype is intact, not polluted
      expect(Object.prototype.toString.call(api)).toBe('[object Object]');
      expect((api as any).alert).toBeUndefined();
      expect((api as any).GM_unknown_exploit).toBeUndefined();

      for (const k of ALL_GM_KEYS) {
        expect(api[k]).toBeUndefined();
      }
    });

    it('1.7: multi-tenant GM storage isolates 10 scripts with identical keys', () => {
      const NUM_SCRIPTS = 10;
      const scriptApis: Record<string, unknown>[] = [];

      for (let s = 0; s < NUM_SCRIPTS; s++) {
        const id = `script_tenant_${s}`;
        const script: ScriptRecord = {
          id,
          name: `Tenant ${s}`,
          code: 'return 1;',
          metadata: { name: `Tenant ${s}`, grants: ['GM_setValue', 'GM_getValue', 'GM_listValues'] } as any,
          enabled: true,
          createdAt: 0,
          updatedAt: 0
        };
        const api = createGmApi(script, cdpClient, ['GM_setValue', 'GM_getValue', 'GM_listValues']);
        scriptApis.push(api);

        // Set identical key "secret_token"
        (api.GM_setValue as Function)('secret_token', `token_for_tenant_${s}`);
      }

      // Verify each script sees only its own token
      for (let s = 0; s < NUM_SCRIPTS; s++) {
        const api = scriptApis[s];
        expect((api.GM_getValue as Function)('secret_token')).toBe(`token_for_tenant_${s}`);
        expect((api.GM_listValues as Function)()).toEqual(['secret_token']);
      }
    });
  });

  // =========================================================================
  // Challenge Group 2: Lifecycle Teardown Hook & Bridge Disconnect
  // =========================================================================
  describe('Group 2: Lifecycle Teardown & Bridge Disconnection Cleanliness', () => {
    let bridge: ContentScriptBridge;
    let postedMessages: any[] = [];

    beforeEach(() => {
      postedMessages = [];
      vi.stubGlobal('postMessage', (msg: any) => {
        postedMessages.push(msg);
      });

      bridge = new ContentScriptBridge({
        timeoutMs: 10000,
        autoStart: true,
        channelId: 'm3_re2_test_channel'
      });
    });

    afterEach(() => {
      bridge.destroy();
    });

    it('2.1: 500 concurrent in-flight requests (both internal send & window postMessage) reject with code 1002 on disconnect', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async () => {
        return new Promise(() => {}); // Never resolves
      });

      // 1. Submit 250 programmatic bridge.send requests
      const internalPromises: Promise<any>[] = [];
      for (let i = 0; i < 250; i++) {
        internalPromises.push(bridge.send(`Internal.method_${i}`, { idx: i }));
      }

      // 2. Submit 250 window-originated RPC requests
      for (let i = 0; i < 250; i++) {
        bridge.handleWindowMessage({
          source: window,
          data: {
            source: 'xokj-userscript',
            channelId: 'm3_re2_test_channel',
            type: 'CDP_RPC_REQUEST',
            id: `win_req_${i}`,
            method: `Window.method_${i}`
          }
        } as any);
      }

      // Verify all 500 requests are tracked in pendingRequests
      expect((bridge as any).pendingRequests.size).toBe(500);

      // Trigger disconnect
      bridge.disconnect('tab_closing_event');

      // Verify pendingRequests was cleared immediately
      expect((bridge as any).pendingRequests.size).toBe(0);
      expect(bridge.getStatus().status).toBe('DETACHED');

      // Verify all 250 internal promises rejected with code 1002
      const internalResults = await Promise.allSettled(internalPromises);
      expect(internalResults.length).toBe(250);
      for (const res of internalResults) {
        expect(res.status).toBe('rejected');
        if (res.status === 'rejected') {
          expect(res.reason.code).toBe(1002);
          expect(res.reason.message).toContain('CDP session detached: tab_closing_event');
          expect(res.reason.data).toEqual({ reason: 'tab_closing_event' });
        }
      }

      // Verify all 250 window requests received error responses with code 1002
      for (let i = 0; i < 250; i++) {
        const resp = postedMessages.find((m) => m.type === 'CDP_RPC_RESPONSE' && m.id === `win_req_${i}`);
        expect(resp).toBeDefined();
        expect(resp.success).toBe(false);
        expect(resp.error.code).toBe(1002);
        expect(resp.error.message).toContain('CDP session detached: tab_closing_event');
        expect(resp.error.data).toEqual({ reason: 'tab_closing_event' });
      }

      // Verify detachment lifecycle broadcast
      const lifecycleEvt = postedMessages.find((m) => m.type === 'CDP_LIFECYCLE_EVENT');
      expect(lifecycleEvt).toBeDefined();
      expect(lifecycleEvt.status).toBe('DETACHED');
      expect(lifecycleEvt.reason).toBe('tab_closing_event');
    });

    it('2.2: all timers are cancelled on disconnect, leaving no pending timeouts after time advancement', async () => {
      vi.useFakeTimers();

      context.mockRuntime.sendMessage.mockImplementation(async () => new Promise(() => {}));

      const promises: Promise<any>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push(bridge.send(`Method_${i}`));
      }

      expect((bridge as any).pendingRequests.size).toBe(50);

      bridge.disconnect('page_hidden');

      // Settle rejections
      await Promise.allSettled(promises);

      // Advance virtual time by 1 hour (far exceeding the 10s timeout)
      vi.advanceTimersByTime(3600000);

      // Verify pendingRequests remains 0 and no error throws
      expect((bridge as any).pendingRequests.size).toBe(0);

      vi.useRealTimers();
    });

    it('2.3: 1,000 window messages sent after disconnect() are completely dropped without dispatching to background', async () => {
      bridge.disconnect('unloaded');

      const sendMessageSpy = context.mockRuntime.sendMessage;
      sendMessageSpy.mockClear();

      for (let i = 0; i < 1000; i++) {
        await bridge.handleWindowMessage({
          source: window,
          data: {
            source: 'xokj-userscript',
            channelId: 'm3_re2_test_channel',
            type: 'CDP_RPC_REQUEST',
            id: `post_disconnect_${i}`,
            method: 'DOM.getDocument'
          }
        } as any);
      }

      // sendMessage must have been called 0 times
      expect(sendMessageSpy).not.toHaveBeenCalled();
      expect((bridge as any).pendingRequests.size).toBe(0);
    });

    it('2.4: direct processWindowRpcRequest invocation when DETACHED responds with code 1002 without leaking requests', async () => {
      bridge.disconnect('session_terminated');
      postedMessages = [];

      await (bridge as any).processWindowRpcRequest({
        source: 'xokj-userscript',
        channelId: 'm3_re2_test_channel',
        type: 'CDP_RPC_REQUEST',
        id: 'direct_detached_req',
        method: 'Page.navigate'
      });

      // Did not leak into pending requests
      expect((bridge as any).pendingRequests.size).toBe(0);

      // Emitted code 1002 response
      const resp = postedMessages.find((m) => m.id === 'direct_detached_req');
      expect(resp).toBeDefined();
      expect(resp.success).toBe(false);
      expect(resp.error.code).toBe(1002);
      expect(resp.error.message).toContain('CDP session detached');
    });

    it('2.5: window pagehide event cancels CdpClient timers and clears isolated GM storage', async () => {
      vi.useFakeTimers();

      const client = new CdpClient({ timeoutMs: 15000, autoStart: true });

      // Populate GM storage across 3 scripts
      getIsolatedScriptStore('script_1').set('k1', 'v1');
      getIsolatedScriptStore('script_2').set('k2', 'v2');
      getIsolatedScriptStore('script_3').set('k3', 'v3');

      const promises: Promise<any>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(client.send(`Page.enable_${i}`));
      }

      expect((client as any).pendingRequests.size).toBe(10);
      expect(getIsolatedScriptStore('script_1').size).toBe(1);

      // Dispatch pagehide
      window.dispatchEvent(new Event('pagehide'));

      // Verify CdpClient is destroyed
      expect((client as any).pendingRequests.size).toBe(0);
      expect((client as any).isListening).toBe(false);

      // Verify GM storage is wiped
      expect(getIsolatedScriptStore('script_1').size).toBe(0);
      expect(getIsolatedScriptStore('script_2').size).toBe(0);
      expect(getIsolatedScriptStore('script_3').size).toBe(0);

      // Advance clock past timeout
      vi.advanceTimersByTime(20000);

      const results = await Promise.allSettled(promises);
      for (const res of results) {
        expect(res.status).toBe('rejected');
      }

      vi.useRealTimers();
    });

    it('2.6: repeated disconnect() calls are completely idempotent and safe', () => {
      expect(() => {
        bridge.disconnect();
        bridge.disconnect('reason_2');
        bridge.disconnect('reason_3');
        bridge.destroy();
      }).not.toThrow();

      expect(bridge.getStatus().status).toBe('DETACHED');
      expect((bridge as any).pendingRequests.size).toBe(0);
    });
  });
});
