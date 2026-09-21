/**
 * Unit Test Suite: Userscript CDP SDK & Greasemonkey Compatibility Layer
 * Location: test/unit/cdp-sdk.spec.ts
 *
 * Tests cdp.send, cdp.on, cdp.off, GM_cdp, getStatus, DevToolsConflictError (code 1001), and GM stubs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CdpClient, CdpClientSdk, createGmCdp, createGmApi } from '@/content/cdp-sdk';
import { buildSandboxScope, createSandboxRunner } from '@/content/sandbox';
import { DevToolsConflictError } from '@/shared/types';
import type { ScriptRecord } from '@/shared/types';

describe('Feature 15: Userscript Runtime SDK (cdp-sdk.ts)', () => {
  let sdk: CdpClient;
  let postedMessages: any[] = [];

  beforeEach(() => {
    postedMessages = [];
    vi.stubGlobal('postMessage', (msg: any) => {
      postedMessages.push(msg);
    });

    sdk = new CdpClient({ timeoutMs: 1000 });
    sdk.init();
  });

  afterEach(() => {
    sdk.destroy();
    vi.restoreAllMocks();
  });

  describe('Tier 1: cdp.send & Request Correlation', () => {
    it('T1.1: posts CDP_RPC_REQUEST to window and resolves when matching CDP_RPC_RESPONSE arrives', async () => {
      const promise = sdk.send('Page.navigate', { url: 'https://example.com' });

      expect(postedMessages.length).toBe(1);
      const req = postedMessages[0];
      expect(req.type).toBe('CDP_RPC_REQUEST');
      expect(req.method).toBe('Page.navigate');
      expect(req.params).toEqual({ url: 'https://example.com' });
      expect(req.id).toBeDefined();

      // Simulate content bridge response
      sdk.handleWindowMessage({
        source: window,
        data: {
          type: 'CDP_RPC_RESPONSE',
          id: req.id,
          success: true,
          result: { frameId: '12345' }
        }
      } as any);

      const result = await promise;
      expect(result).toEqual({ frameId: '12345' });
    });

    it('T1.2: rejects promise when CDP_RPC_RESPONSE indicates failure', async () => {
      const promise = sdk.send('Invalid.method');
      const req = postedMessages[0];

      sdk.handleWindowMessage({
        source: window,
        data: {
          type: 'CDP_RPC_RESPONSE',
          id: req.id,
          success: false,
          error: { code: -32601, message: 'Method not found' }
        }
      } as any);

      await expect(promise).rejects.toThrow('Method not found');
    });

    it('T1.3: handles multiple concurrent send calls independently via distinct correlation IDs', async () => {
      const p1 = sdk.send('Network.enable');
      const p2 = sdk.send('Page.enable');

      expect(postedMessages.length).toBe(2);
      const [req1, req2] = postedMessages;
      expect(req1.id).not.toBe(req2.id);

      // Reply in reverse order
      sdk.handleWindowMessage({
        source: window,
        data: { type: 'CDP_RPC_RESPONSE', id: req2.id, success: true, result: { page: true } }
      } as any);

      sdk.handleWindowMessage({
        source: window,
        data: { type: 'CDP_RPC_RESPONSE', id: req1.id, success: true, result: { network: true } }
      } as any);

      expect(await p2).toEqual({ page: true });
      expect(await p1).toEqual({ network: true });
    });

    it('T1.4: rejects with timeout error when bridge does not reply within timeout window', async () => {
      vi.useFakeTimers();
      const promise = sdk.send('Slow.method');

      vi.advanceTimersByTime(1100);

      await expect(promise).rejects.toThrow(/timed out/i);
      vi.useRealTimers();
    });

    it('T1.5: rejects when called with empty or invalid method name', async () => {
      await expect(sdk.send('')).rejects.toThrow(/Invalid CDP command/);
      await expect(sdk.send('   ')).rejects.toThrow(/Invalid CDP command/);
    });
  });

  describe('Tier 2: Event Multiplexing (cdp.on / cdp.off)', () => {
    it('T2.1: registers listener and dispatches event params on matching CDP_RPC_EVENT', () => {
      const handler = vi.fn();
      sdk.on('Network.requestWillBeSent', handler);

      sdk.handleWindowMessage({
        source: window,
        data: {
          type: 'CDP_RPC_EVENT',
          method: 'Network.requestWillBeSent',
          params: { requestId: 'net-1', request: { url: 'https://test.com' } }
        }
      } as any);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        requestId: 'net-1',
        request: { url: 'https://test.com' }
      });
    });

    it('T2.2: does not invoke listener for unmatching event methods', () => {
      const handler = vi.fn();
      sdk.on('Page.loadEventFired', handler);

      sdk.handleWindowMessage({
        source: window,
        data: {
          type: 'CDP_RPC_EVENT',
          method: 'Network.requestWillBeSent',
          params: {}
        }
      } as any);

      expect(handler).not.toHaveBeenCalled();
    });

    it('T2.3: unsubscribes listener via cdp.off and returned unsubscribe callback', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsub1 = sdk.on('Page.domContentEventFired', handler1);
      sdk.on('Page.domContentEventFired', handler2);

      unsub1(); // Unsubscribe handler1
      sdk.off('Page.domContentEventFired', handler2); // Unsubscribe handler2

      sdk.handleWindowMessage({
        source: window,
        data: {
          type: 'CDP_RPC_EVENT',
          method: 'Page.domContentEventFired',
          params: { timestamp: 123 }
        }
      } as any);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('Tier 3: DevTools Conflict & Error Propagation', () => {
    it('T3.1: rejects with DevToolsConflictError when error code is 1001', async () => {
      const promise = sdk.send('Page.reload');
      const req = postedMessages[0];

      sdk.handleWindowMessage({
        source: window,
        data: {
          type: 'CDP_RPC_RESPONSE',
          id: req.id,
          success: false,
          error: {
            code: 1001,
            message: 'DevTools conflict: native developer tools opened on tab'
          }
        }
      } as any);

      await expect(promise).rejects.toThrow(DevToolsConflictError);
      await expect(promise).rejects.toMatchObject({
        code: 1001,
        message: expect.stringContaining('DevTools conflict')
      });
    });

    it('T3.2: immediately cancels pending requests when CDP_LIFECYCLE_EVENT CONFLICT arrives', async () => {
      const p1 = sdk.send('Network.getCookies');

      sdk.handleWindowMessage({
        source: window,
        data: {
          type: 'CDP_LIFECYCLE_EVENT',
          status: 'CONFLICT',
          reason: 'canceled_by_user'
        }
      } as any);

      await expect(p1).rejects.toThrow(DevToolsConflictError);
      const status = await sdk.getStatus();
      expect(status).toBe('CONFLICT');
      expect(await sdk.isAttached()).toBe(false);
    });

    it('T3.3: pre-flight fast-rejects subsequent calls immediately when status is CONFLICT', async () => {
      sdk.handleLifecycleChange('CONFLICT', 'canceled_by_user');
      expect(await sdk.getStatus()).toBe('CONFLICT');

      await expect(sdk.send('DOM.getDocument')).rejects.toThrow(DevToolsConflictError);
    });

    it('T3.4: reconnects when status changes back to ATTACHED', async () => {
      sdk.handleLifecycleChange('CONFLICT', 'canceled_by_user');
      expect(await sdk.getStatus()).toBe('CONFLICT');

      // Reconnected
      sdk.handleLifecycleChange('ATTACHED');
      expect(await sdk.getStatus()).toBe('ATTACHED');
      expect(await sdk.isAttached()).toBe(true);

      const promise = sdk.send('DOM.getDocument');
      const req = postedMessages[postedMessages.length - 1];

      sdk.handleWindowMessage({
        source: window,
        data: {
          type: 'CDP_RPC_RESPONSE',
          id: req.id,
          success: true,
          result: { root: {} }
        }
      } as any);

      const res = await promise;
      expect(res).toEqual({ root: {} });
    });
  });

  describe('Tier 4: Compatibility Aliases & Standard GM_* APIs', () => {
    it('T4.1: GM_cdp delegates to cdp.send and returns Promise', async () => {
      const gmCdp = createGmCdp(sdk);
      const promise = gmCdp('DOM.getDocument');
      const req = postedMessages[0];

      sdk.handleWindowMessage({
        source: window,
        data: {
          type: 'CDP_RPC_RESPONSE',
          id: req.id,
          success: true,
          result: { root: { nodeId: 1 } }
        }
      } as any);

      const res = await promise;
      expect(res).toEqual({ root: { nodeId: 1 } });
    });

    it('T4.2: GM_setValue, GM_getValue, GM_deleteValue, GM_listValues provide per-script isolated storage', () => {
      const script1: ScriptRecord = {
        id: 'script-1',
        name: 'Script One',
        code: '',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const script2: ScriptRecord = {
        id: 'script-2',
        name: 'Script Two',
        code: '',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api1 = createGmApi(script1, sdk) as any;
      const api2 = createGmApi(script2, sdk) as any;

      api1.GM_setValue('theme', 'dark');
      api1.GM_setValue('counter', 42);
      api2.GM_setValue('theme', 'light');

      expect(api1.GM_getValue('theme')).toBe('dark');
      expect(api1.GM_getValue('counter')).toBe(42);
      expect(api2.GM_getValue('theme')).toBe('light');
      expect(api2.GM_getValue('counter', 0)).toBe(0);

      expect(api1.GM_listValues()).toEqual(expect.arrayContaining(['theme', 'counter']));
      expect(api2.GM_listValues()).toEqual(['theme']);

      api1.GM_deleteValue('counter');
      expect(api1.GM_getValue('counter')).toBeUndefined();
      expect(api1.GM_listValues()).toEqual(['theme']);
    });

    it('T4.3: GM_addStyle injects style element into document', () => {
      const script: ScriptRecord = {
        id: 'style-script',
        name: 'Style Script',
        code: '',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, sdk) as any;
      const el = api.GM_addStyle('body { background: red; }');

      expect(el).toBeDefined();
      expect(el.tagName.toLowerCase()).toBe('style');
      expect(el.textContent).toBe('body { background: red; }');
      expect(el.getAttribute('data-xokj-script')).toBe('style-script');
    });

    it('T4.4: GM_info contains script and engine metadata', () => {
      const script: ScriptRecord = {
        id: 'info-script',
        name: 'Info Script',
        code: '',
        metadata: {
          name: 'Info Script',
          version: '3.1.4',
          description: 'A test script',
          matches: ['*://*/*']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, sdk) as any;
      expect(api.GM_info.script.name).toBe('Info Script');
      expect(api.GM_info.script.version).toBe('3.1.4');
      expect(api.GM_info.scriptHandler).toBe('XOKJ');
    });
  });

  describe('Tier 5: Sandbox Scope & Execution Runner', () => {
    it('T5.1: @grant none scopes contain only standard globals', () => {
      const script: ScriptRecord = {
        id: 'grant-none-script',
        name: 'Grant None',
        code: 'return typeof GM_setValue;',
        metadata: {
          grants: ['none']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, sdk);
      expect(scope.window).toBeDefined();
      expect(scope.GM_setValue).toBeUndefined();
      expect(scope.GM_cdp).toBeUndefined();
      expect(scope.cdp).toBeUndefined();
    });

    it('T5.2: createSandboxRunner executes userscript safely with parameters bound', () => {
      const script: ScriptRecord = {
        id: 'runner-test',
        name: 'Runner Test',
        code: 'return a + b;',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = { a: 10, b: 25 };
      const runner = createSandboxRunner(script, scope);
      const result = runner();
      expect(result).toBe(35);
    });
  });
});
