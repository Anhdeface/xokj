/**
 * Empirical Challenger Opt-M3-1: Content Script Bridge, Sandbox & SDK Memory Optimization Suite
 * Location: test/unit/challenger-opt-m3-1.spec.ts
 *
 * Validates:
 * 1. Sandbox script de-retention & exact error logging format (Feature 9).
 * 2. Bridge fast-path window message filtering & disconnect lifecycle teardown (Feature 10).
 * 3. Selective GM API closure instantiation based on @grant directives (Feature 11).
 * 4. Client and isolated storage pagehide teardown hooks (Feature 12).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import {
  createSandboxRunner,
  scheduleScriptExecution,
  buildSandboxScope
} from '@/content/sandbox';
import {
  ContentScriptBridge
} from '@/content/bridge';
import {
  CdpClient,
  createGmApi,
  getIsolatedScriptStore,
  clearIsolatedGmStorage
} from '@/content/cdp-sdk';
import type { ScriptRecord } from '@/shared/types';

describe('Empirical Challenger Opt-M3-1: Content Script Bridge, Sandbox & SDK Optimization Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let cdpClient: CdpClient;

  beforeEach(() => {
    context = setupChromeMock();
    cdpClient = new CdpClient({ timeoutMs: 1000 });
    clearIsolatedGmStorage();
  });

  afterEach(() => {
    cdpClient.destroy();
    clearIsolatedGmStorage();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Subsystem 1: Sandbox Memory De-retention & Execution Safety (sandbox.ts)
  // =========================================================================
  describe('Subsystem 1: Sandbox Memory De-retention & Execution Safety', () => {
    it('1.1: createSandboxRunner extracts scriptName and executes userscript without referencing ScriptRecord', () => {
      const script: ScriptRecord = {
        id: 'opt-script-1',
        name: 'De-Retention Script',
        code: 'return 42 * 2;',
        metadata: {
          name: 'De-Retention Script',
          grants: ['none']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);

      expect(typeof runner).toBe('function');
      expect(runner()).toBe(84);
    });

    it('1.2: createSandboxRunner logs error matching exact format [XOKJ Runtime] Exception in script "<name>":', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const script: ScriptRecord = {
        id: 'opt-script-err',
        name: 'Failing Script Alpha',
        code: 'throw new Error("Simulated failure in runner");',
        metadata: {
          name: 'Failing Script Alpha',
          grants: ['none']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);

      expect(() => runner()).toThrow('Simulated failure in runner');
      expect(errorSpy).toHaveBeenCalledWith(
        '[XOKJ Runtime] Exception in script "Failing Script Alpha":',
        expect.any(Error)
      );

      errorSpy.mockRestore();
    });

    it('1.3: scheduleScriptExecution logs error matching [XOKJ Execution Error] on failure', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const script: ScriptRecord = {
        id: 'opt-script-sched-err',
        name: 'Failing Scheduled Script',
        code: 'throw new Error("Immediate synchronous explosion");',
        metadata: {
          name: 'Failing Scheduled Script',
          runAt: 'document-start',
          grants: ['none']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      scheduleScriptExecution(script, cdpClient);

      expect(errorSpy).toHaveBeenCalledWith(
        '[XOKJ Execution Error] Failed executing script "Failing Scheduled Script":',
        expect.any(Error)
      );

      errorSpy.mockRestore();
    });

    it('1.4: buildSandboxScope passes effective grants to createGmApi selectively', () => {
      const script: ScriptRecord = {
        id: 'opt-script-grants',
        name: 'Selective Grants Script',
        code: 'return typeof GM_setValue;',
        metadata: {
          name: 'Selective Grants Script',
          grants: ['GM_setValue'],
          runAt: 'document-idle'
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      expect(typeof scope.GM_setValue).toBe('function');
      expect(scope.GM_addStyle).toBeUndefined();
      expect(scope.GM_deleteValue).toBeUndefined();
      expect(scope.GM_cdp).toBeUndefined();
      expect(scope.cdp).toBeUndefined();
    });
  });

  // =========================================================================
  // Subsystem 2: Fast-Path Window Message Filtering & Disconnect (bridge.ts)
  // =========================================================================
  describe('Subsystem 2: Fast-Path Window Message Filtering & Disconnect Teardown', () => {
    let bridge: ContentScriptBridge;
    let postedToWindow: any[] = [];

    beforeEach(() => {
      postedToWindow = [];
      vi.stubGlobal('postMessage', (msg: any) => {
        postedToWindow.push(msg);
      });

      bridge = new ContentScriptBridge({
        timeoutMs: 1000,
        autoStart: true,
        requireOrigin: true,
        allowedOrigin: 'https://example.com'
      });
    });

    afterEach(() => {
      bridge.destroy();
    });

    it('2.1: drops non-CDP messages immediately on fast-path without invoking verifyOrigin', async () => {
      const verifyOriginSpy = vi.spyOn(bridge, 'verifyOrigin');

      // 1. Host webpage analytics postMessage
      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://attacker.com', // Evil origin, but should not even be checked
        data: { type: 'ANALYTICS_EVENT', payload: { clicks: 10 } }
      } as any);

      // 2. Non-object data (strings, null, undefined)
      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://attacker.com',
        data: 'webpackWarnings'
      } as any);

      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://attacker.com',
        data: null
      } as any);

      // Fast-path returned before verifyOrigin
      expect(verifyOriginSpy).not.toHaveBeenCalled();
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
    });

    it('2.2: enforces origin and source verification when message has type CDP_RPC_REQUEST', async () => {
      const verifyOriginSpy = vi.spyOn(bridge, 'verifyOrigin');

      // Spoofed origin
      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://untrusted-foreign.com',
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'spoof-req',
          method: 'Page.navigate'
        }
      } as any);

      // verifyOrigin was invoked because data.type === 'CDP_RPC_REQUEST'
      expect(verifyOriginSpy).toHaveBeenCalledWith('https://untrusted-foreign.com');
      // But message was dropped due to origin mismatch
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
    });

    it('2.3: disconnect() cleanly drains pending requests with code 1002 detachment error', async () => {
      let pendingPromise: Promise<any>;

      context.mockRuntime.sendMessage.mockImplementation(async () => {
        // Background never replies (hangs)
        return new Promise(() => {});
      });

      pendingPromise = bridge.send('Runtime.evaluate', { expression: '1 + 1' });

      // Disconnect the bridge
      bridge.disconnect('navigation_unload');

      await expect(pendingPromise).rejects.toMatchObject({
        code: 1002,
        message: expect.stringContaining('CDP session detached: navigation_unload')
      });

      expect(bridge.getStatus().status).toBe('DETACHED');
    });

    it('2.4: disconnect() unregisters window message event listener', async () => {
      const removeListenerSpy = vi.spyOn(window, 'removeEventListener');

      bridge.disconnect('tab_closed');

      expect(removeListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('2.5: disconnect() posts CDP_LIFECYCLE_EVENT with DETACHED status to window', () => {
      bridge.disconnect('user_cancelled');

      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'CDP_LIFECYCLE_EVENT',
          status: 'DETACHED',
          reason: 'user_cancelled'
        })
      );
    });
  });

  // =========================================================================
  // Subsystem 3: Selective GM API Closures & Lifecycle Hooks (cdp-sdk.ts)
  // =========================================================================
  describe('Subsystem 3: Selective GM API Closures & Lifecycle Hooks', () => {
    it('3.1: createGmApi(scriptId, grants) instantiates ONLY requested GM closures', () => {
      const api = createGmApi('my-custom-script', ['GM_setValue', 'GM_getValue']);

      expect(typeof api.GM_setValue).toBe('function');
      expect(typeof api.GM_getValue).toBe('function');

      // Unrequested APIs must NOT be instantiated
      expect(api.GM_deleteValue).toBeUndefined();
      expect(api.GM_listValues).toBeUndefined();
      expect(api.GM_addStyle).toBeUndefined();
      expect(api.GM_log).toBeUndefined();
      expect(api.GM_cdp).toBeUndefined();
      expect(api.cdp).toBeUndefined();

      // Minimal stub GM_info is always provided
      expect(api.GM_info).toBeDefined();
    });

    it('3.2: createGmApi with null/undefined grants or @grant none instantiates ONLY minimal stubs', () => {
      // 1. null grants
      const apiNull = createGmApi('script-null', null);
      expect(apiNull.GM_info).toBeDefined();
      expect(apiNull.GM_setValue).toBeUndefined();
      expect(apiNull.GM_cdp).toBeUndefined();

      // 2. undefined grants
      const apiUndef = createGmApi('script-undef', undefined);
      expect(apiUndef.GM_info).toBeDefined();
      expect(apiUndef.GM_setValue).toBeUndefined();

      // 3. ['none'] grant
      const apiNone = createGmApi('script-none', ['none']);
      expect(apiNone.GM_info).toBeDefined();
      expect(apiNone.GM_setValue).toBeUndefined();
      expect(apiNone.GM_addStyle).toBeUndefined();
      expect(apiNone.GM_cdp).toBeUndefined();
    });

    it('3.3: createGmApi instantiates GM_cdp and cdp when requested with channelId', () => {
      const api = createGmApi('cdp-granted-script', ['GM_cdp'], 'xokj_secret_channel');

      expect(typeof api.GM_cdp).toBe('function');
      expect(api.cdp).toBeDefined();
      expect(typeof (api.cdp as CdpClient).send).toBe('function');
      expect(api.GM_setValue).toBeUndefined();
    });

    it('3.4: CdpClient pagehide event listener automatically calls destroy() and rejects pending requests', async () => {
      const client = new CdpClient({ timeoutMs: 5000, autoStart: true });

      const pending = client.send('Page.enable');

      // Simulate window pagehide event (e.g. tab navigation)
      window.dispatchEvent(new Event('pagehide'));

      await expect(pending).rejects.toThrow('CdpClient destroyed: request cancelled');
    });

    it('3.5: isolatedScriptStorage pagehide event listener automatically clears storage partition', () => {
      const store = getIsolatedScriptStore('nav-test-script');
      store.set('persistKey', 'persistValue');
      expect(store.get('persistKey')).toBe('persistValue');

      // Simulate window pagehide event
      window.dispatchEvent(new Event('pagehide'));

      // After pagehide, store must be cleared
      const freshStore = getIsolatedScriptStore('nav-test-script');
      expect(freshStore.get('persistKey')).toBeUndefined();
      expect(freshStore.size).toBe(0);
    });

    it('3.6: CdpClient disconnect() cleanly invokes destroy()', () => {
      const client = new CdpClient({ autoStart: true });
      const destroySpy = vi.spyOn(client, 'destroy');

      client.disconnect();

      expect(destroySpy).toHaveBeenCalled();
    });
  });
});
