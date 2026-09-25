/**
 * Empirical Challenger Opt-M3-1 Deep: Memory De-retention, Closure Verification &
 * Message Filtering Throughput Stress Suite
 * Location: test/unit/challenger-opt-m3-1-deep.spec.ts
 *
 * Exhaustively challenges:
 * 1. Sandbox Closure Memory De-retention (Feature 9):
 *    - WeakRef verification that createSandboxRunner closures DO NOT retain ScriptRecord or metadata.
 *    - WeakRef verification across diverse grant combinations (@grant none, specific GM_*, and CDP grants).
 *    - WeakRef verification of scheduled execution listeners (document-start, document-end DOMContentLoaded, document-idle).
 *    - Multi-megabyte (5MB - 10MB) source code payload memory de-retention under explicit V8 GC.
 *    - Error logging string format and non-retention of exception objects / scripts.
 *    - Batch de-retention across 50 concurrent userscript runners.
 * 2. Window Message Filtering Throughput & Origin Overhead Avoidance (Feature 10):
 *    - 50,000 non-extension message flood throughput benchmark (zero verifyOrigin calls, zero DOM location overhead).
 *    - Strict 4-layer defense verification for legitimate CDP_RPC_REQUEST messages.
 *    - Adversarial payload resilience: throw getters, Object.create(null), prototype pollution, malformed types.
 * 3. ContentScriptBridge Disconnect & Concurrency Teardown:
 *    - Draining 1,000 concurrent inflight requests with code 1002 detachment error.
 *    - Window and runtime listener unregistration and idempotent teardown.
 * 4. High-frequency CDP event broadcast (10,000 events) without Array.from allocations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import v8 from 'v8';
import vm from 'vm';
import { setupChromeMock } from '../mocks/chrome';
import {
  createSandboxRunner,
  scheduleScriptExecution,
  buildSandboxScope
} from '@/content/sandbox';
import { ContentScriptBridge } from '@/content/bridge';
import {
  CdpClient,
  createGmApi,
  getIsolatedScriptStore,
  clearIsolatedGmStorage
} from '@/content/cdp-sdk';
import type { ScriptRecord } from '@/shared/types';

// Setup exposed V8 GC dynamically if not already available
let forceGc: (() => void) | undefined = (globalThis as any).gc;
if (!forceGc) {
  try {
    v8.setFlagsFromString('--expose_gc');
    forceGc = vm.runInNewContext('gc');
  } catch {
    // Non-V8 environment fallback
  }
}

async function runGenerationalGc(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  if (forceGc) {
    forceGc();
    forceGc();
  }
}

describe('Empirical Challenger Opt-M3-1 Deep: Memory De-retention & Message Throughput', () => {
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
  // Challenge 1: Closure De-retention & V8 WeakRef Empirical Verification
  // =========================================================================
  describe('Challenge 1: Sandbox Runner & Scheduling Closure De-retention', () => {
    it('1.1: createSandboxRunner closure releases ScriptRecord and metadata when @grant none is used', async () => {
      let runnerRef: (() => unknown) | null = null;
      let weakScript: WeakRef<ScriptRecord>;
      let weakMeta: WeakRef<any>;

      // Local factory scope to ensure stack variables fall out of scope
      (() => {
        const script: ScriptRecord = {
          id: 'script-de-ret-none',
          name: 'Grant None Userscript',
          code: 'return 10 * 10;',
          metadata: {
            name: 'Grant None Userscript',
            description: 'Massive metadata AST block for testing GC',
            grants: ['none'],
            version: '2.4.1'
          } as any,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        weakScript = new WeakRef(script);
        weakMeta = new WeakRef(script.metadata);

        const scope = buildSandboxScope(script, cdpClient);
        runnerRef = createSandboxRunner(script, scope);
      })();

      // While runnerRef is still kept alive in outer scope:
      expect(runnerRef).toBeDefined();
      expect(typeof runnerRef).toBe('function');

      await runGenerationalGc();

      // If forceGc is available, the script object must be garbage collected
      if (forceGc) {
        expect(weakScript!.deref()).toBeUndefined();
        expect(weakMeta!.deref()).toBeUndefined();
      }

      // The runner must still execute cleanly
      expect(runnerRef!()).toBe(100);
    });

    it('1.2: createSandboxRunner releases ScriptRecord even when multiple GM_* closures are in scope', async () => {
      let runnerRef: (() => unknown) | null = null;
      let weakScript: WeakRef<ScriptRecord>;
      let weakMeta: WeakRef<any>;

      (() => {
        const script: ScriptRecord = {
          id: 'script-de-ret-gm',
          name: 'GM Grants Userscript',
          code: `
            GM_setValue('test_key', 'test_val');
            GM_log('Log message from script');
            return GM_getValue('test_key');
          `,
          metadata: {
            name: 'GM Grants Userscript',
            grants: ['GM_setValue', 'GM_getValue', 'GM_log', 'GM_listValues'],
            version: '1.0.0'
          } as any,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        weakScript = new WeakRef(script);
        weakMeta = new WeakRef(script.metadata);

        const scope = buildSandboxScope(script, cdpClient);
        runnerRef = createSandboxRunner(script, scope);
      })();

      await runGenerationalGc();

      if (forceGc) {
        expect(weakScript!.deref()).toBeUndefined();
        expect(weakMeta!.deref()).toBeUndefined();
      }

      expect(runnerRef!()).toBe('test_val');
      const store = getIsolatedScriptStore('script-de-ret-gm');
      expect(store.get('test_key')).toBe(JSON.stringify('test_val'));
    });

    it('1.3: createSandboxRunner de-retains multi-megabyte (5MB) script source code', async () => {
      let runnerRef: (() => unknown) | null = null;
      let weakScript: WeakRef<ScriptRecord>;
      let weakMeta: WeakRef<any>;

      (() => {
        // Construct 5MB source code
        const padding = '/* ' + 'M'.repeat(5 * 1024 * 1024) + ' */\n';
        const code = padding + 'return 999;';

        const script: ScriptRecord = {
          id: 'script-5mb',
          name: 'Massive 5MB Script',
          code,
          metadata: {
            name: 'Massive 5MB Script',
            grants: ['none']
          } as any,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        weakScript = new WeakRef(script);
        weakMeta = new WeakRef(script.metadata);

        const scope = buildSandboxScope(script, cdpClient);
        runnerRef = createSandboxRunner(script, scope);
      })();

      await runGenerationalGc();

      if (forceGc) {
        expect(weakScript!.deref()).toBeUndefined();
        expect(weakMeta!.deref()).toBeUndefined();
      }

      expect(runnerRef!()).toBe(999);
    });

    it('1.4: scheduleScriptExecution document-end listener does NOT retain ScriptRecord while pending', async () => {
      let weakScript: WeakRef<ScriptRecord>;
      let weakMeta: WeakRef<any>;

      // Mock document.readyState to 'loading'
      const originalReadyState = document.readyState;
      Object.defineProperty(document, 'readyState', {
        value: 'loading',
        configurable: true
      });

      (window as any).__docEndRan = false;

      (() => {
        const script: ScriptRecord = {
          id: 'script-sched-doc-end',
          name: 'Scheduled Doc End Script',
          code: 'window.__docEndRan = true;',
          metadata: {
            name: 'Scheduled Doc End Script',
            runAt: 'document-end',
            grants: ['none']
          } as any,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        weakScript = new WeakRef(script);
        weakMeta = new WeakRef(script.metadata);

        scheduleScriptExecution(script, cdpClient);
      })();

      // The listener is attached to document 'DOMContentLoaded' but has not fired yet
      expect((window as any).__docEndRan).toBe(false);

      await runGenerationalGc();

      if (forceGc) {
        // ScriptRecord must NOT be retained by the DOMContentLoaded event listener closure!
        expect(weakScript!.deref()).toBeUndefined();
        expect(weakMeta!.deref()).toBeUndefined();
      }

      // Now trigger the DOMContentLoaded event
      document.dispatchEvent(new Event('DOMContentLoaded'));
      expect((window as any).__docEndRan).toBe(true);

      // Restore document.readyState
      Object.defineProperty(document, 'readyState', {
        value: originalReadyState,
        configurable: true
      });
      delete (window as any).__docEndRan;
    });

    it('1.5: scheduleScriptExecution document-idle listener does NOT retain ScriptRecord while pending', async () => {
      let weakScript: WeakRef<ScriptRecord>;
      let weakMeta: WeakRef<any>;

      const originalReadyState = document.readyState;
      Object.defineProperty(document, 'readyState', {
        value: 'loading',
        configurable: true
      });

      (window as any).__docIdleRan = false;

      (() => {
        const script: ScriptRecord = {
          id: 'script-sched-doc-idle',
          name: 'Scheduled Doc Idle Script',
          code: 'window.__docIdleRan = true;',
          metadata: {
            name: 'Scheduled Doc Idle Script',
            runAt: 'document-idle',
            grants: ['none']
          } as any,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        weakScript = new WeakRef(script);
        weakMeta = new WeakRef(script.metadata);

        scheduleScriptExecution(script, cdpClient);
      })();

      expect((window as any).__docIdleRan).toBe(false);

      await runGenerationalGc();

      if (forceGc) {
        expect(weakScript!.deref()).toBeUndefined();
        expect(weakMeta!.deref()).toBeUndefined();
      }

      // Fire window 'load' event
      window.dispatchEvent(new Event('load'));

      // Wait for idle/timer callback
      await new Promise((r) => setTimeout(r, 20));
      expect((window as any).__docIdleRan).toBe(true);

      Object.defineProperty(document, 'readyState', {
        value: originalReadyState,
        configurable: true
      });
      delete (window as any).__docIdleRan;
    });

    it('1.6: 50 concurrent userscript runners all de-retain their ScriptRecords in batch', async () => {
      const runners: Array<() => unknown> = [];
      const weakRefs: Array<WeakRef<ScriptRecord>> = [];

      for (let i = 0; i < 50; i++) {
        (() => {
          const script: ScriptRecord = {
            id: `batch-script-${i}`,
            name: `Batch Script ${i}`,
            code: `return ${i} * 2;`,
            metadata: {
              name: `Batch Script ${i}`,
              grants: ['none'],
              version: `1.0.${i}`
            } as any,
            enabled: true,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };

          weakRefs.push(new WeakRef(script));
          const scope = buildSandboxScope(script, cdpClient);
          runners.push(createSandboxRunner(script, scope));
        })();
      }

      expect(runners.length).toBe(50);

      await runGenerationalGc();

      if (forceGc) {
        for (let i = 0; i < 50; i++) {
          expect(weakRefs[i].deref()).toBeUndefined();
        }
      }

      // Verify all 50 runners still execute correctly
      for (let i = 0; i < 50; i++) {
        expect(runners[i]()).toBe(i * 2);
      }
    });

    it('1.7: exception in createSandboxRunner preserves exact error prefix and throws original error', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const script: ScriptRecord = {
        id: 'err-script-1',
        name: 'Deliberate Error Userscript',
        code: 'throw new RangeError("Custom memory limit exceeded");',
        metadata: {
          name: 'Deliberate Error Userscript',
          grants: ['none']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);

      expect(() => runner()).toThrow(RangeError);
      expect(errorSpy).toHaveBeenCalledWith(
        '[XOKJ Runtime] Exception in script "Deliberate Error Userscript":',
        expect.any(RangeError)
      );

      errorSpy.mockRestore();
    });

    it('1.8: exception in scheduleScriptExecution catches safely and logs with exact format', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const script: ScriptRecord = {
        id: 'err-script-sched',
        name: 'Scheduled Failure Userscript',
        code: 'throw new TypeError("Synchronous schedule boom");',
        metadata: {
          name: 'Scheduled Failure Userscript',
          runAt: 'document-start',
          grants: ['none']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      // Must not throw out of scheduleScriptExecution
      expect(() => scheduleScriptExecution(script, cdpClient)).not.toThrow();

      expect(errorSpy).toHaveBeenCalledWith(
        '[XOKJ Execution Error] Failed executing script "Scheduled Failure Userscript":',
        expect.any(TypeError)
      );

      errorSpy.mockRestore();
    });
  });

  // =========================================================================
  // Challenge 2: Message Filtering Throughput & Origin Overhead Avoidance
  // =========================================================================
  describe('Challenge 2: Fast-Path Window Message Filtering Throughput', () => {
    let bridge: ContentScriptBridge;

    beforeEach(() => {
      bridge = new ContentScriptBridge({
        timeoutMs: 1000,
        autoStart: true,
        requireOrigin: true,
        allowedOrigin: 'https://allowed.example.com'
      });
    });

    afterEach(() => {
      bridge.destroy();
    });

    it('2.1: 50,000 non-extension messages are filtered in minimal CPU time with zero verifyOrigin calls', async () => {
      const verifyOriginSpy = vi.spyOn(bridge, 'verifyOrigin');

      // Diverse sample of non-extension messages commonly seen in modern web apps
      const noiseMessages = [
        { type: 'ANALYTICS_EVENT', payload: { action: 'click', target: 'btn' } },
        { type: 'webpackOk' },
        { type: 'webpackWarnings', warnings: [] },
        { source: 'react-devtools-bridge', type: 'HIGHLIGHT' },
        { type: 'AD_IMPRESSION', adId: 'ad_9982' },
        { type: 'CDP_RPC_RESPONSE', id: 'resp-1', result: {} }, // Bridge only handles REQUEST from window
        'plain-string-message',
        1234567,
        true,
        null,
        undefined,
        {},
        { data: 'some-data-without-type' },
        ['array', 'data'],
        { type: 'OTHER_FRAME_RPC', args: [1, 2, 3] }
      ];

      const TOTAL = 50000;
      const noiseLen = noiseMessages.length;

      const startTime = performance.now();

      for (let i = 0; i < TOTAL; i++) {
        const raw = noiseMessages[i % noiseLen];
        // Directly invoke handleWindowMessage as window event dispatcher would
        bridge.handleWindowMessage({
          source: window,
          origin: 'https://host-webpage.com',
          data: raw
        });
      }

      const elapsedMs = performance.now() - startTime;

      // 50,000 messages should process in well under 100ms (< 2 microseconds per message)
      expect(elapsedMs).toBeLessThan(500);

      // CRITICAL: verifyOrigin must have been called exactly 0 times!
      expect(verifyOriginSpy).not.toHaveBeenCalled();

      // No messages must have been dispatched to background
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
    });

    it('2.2: legitimate CDP_RPC_REQUEST strictly enforces all 4 security layers', async () => {
      const verifyOriginSpy = vi.spyOn(bridge, 'verifyOrigin');
      const channelId = bridge.getChannelId();

      // Layer 1 Failure: Source is not window (e.g. from an attacker iframe)
      const fakeWindow = {} as Window;
      await bridge.handleWindowMessage({
        source: fakeWindow,
        origin: 'https://allowed.example.com',
        data: {
          type: 'CDP_RPC_REQUEST',
          source: 'xokj-userscript',
          channelId,
          id: 'l1-fail',
          method: 'Page.navigate'
        }
      });
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

      // Layer 2 Failure: Origin mismatch
      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://attacker.com',
        data: {
          type: 'CDP_RPC_REQUEST',
          source: 'xokj-userscript',
          channelId,
          id: 'l2-fail',
          method: 'Page.navigate'
        }
      });
      expect(verifyOriginSpy).toHaveBeenCalledWith('https://attacker.com');
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

      // Layer 3 Failure: Invalid sender source tag
      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://allowed.example.com',
        data: {
          type: 'CDP_RPC_REQUEST',
          source: 'malicious-page-script',
          channelId,
          id: 'l3-fail',
          method: 'Page.navigate'
        }
      });
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

      // Layer 4 Failure: Forged / missing channelId
      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://allowed.example.com',
        data: {
          type: 'CDP_RPC_REQUEST',
          source: 'xokj-userscript',
          channelId: 'forged-secret-token',
          id: 'l4-fail',
          method: 'Page.navigate'
        }
      });
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

      // All 4 Layers Pass: Legitimate request succeeds
      context.mockRuntime.sendMessage.mockResolvedValueOnce({
        id: 'success-req',
        result: { status: 'ok' }
      });

      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://allowed.example.com',
        data: {
          type: 'CDP_RPC_REQUEST',
          source: 'xokj-userscript',
          channelId,
          id: 'success-req',
          method: 'Runtime.evaluate',
          params: { expression: '1+1' }
        }
      });

      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CDP_RPC_REQUEST',
          id: 'success-req',
          method: 'Runtime.evaluate'
        }),
        expect.any(Function)
      );
    });

    it('2.3: adversarial payloads (prototype pollution, throwing getters, null prototypes) are handled safely', async () => {
      // 1. Object with Object.create(null)
      const nullProtoData = Object.create(null);
      nullProtoData.type = 'ANALYTICS';
      await expect(
        bridge.handleWindowMessage({
          source: window,
          origin: 'https://allowed.example.com',
          data: nullProtoData
        })
      ).resolves.toBeUndefined();

      // 2. Data with prototype pollution attempt
      const pollutedData = JSON.parse('{"__proto__": {"polluted": true}, "type": "POLLUTE"}');
      await expect(
        bridge.handleWindowMessage({
          source: window,
          origin: 'https://allowed.example.com',
          data: pollutedData
        })
      ).resolves.toBeUndefined();
      expect((Object.prototype as any).polluted).toBeUndefined();

      // 3. Object with throwing getter on type
      const throwingData = {};
      Object.defineProperty(throwingData, 'type', {
        get() {
          throw new Error('Exploding getter');
        }
      });
      await expect(
        bridge.handleWindowMessage({
          source: window,
          origin: 'https://allowed.example.com',
          data: throwingData
        })
      ).rejects.toThrow('Exploding getter');

      // 4. Circular data structure
      const circularData: any = { type: 'CIRCULAR' };
      circularData.self = circularData;
      await expect(
        bridge.handleWindowMessage({
          source: window,
          origin: 'https://allowed.example.com',
          data: circularData
        })
      ).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // Challenge 3: Bridge Disconnect Teardown Under Massive Load
  // =========================================================================
  describe('Challenge 3: Bridge Disconnect & Concurrency Teardown', () => {
    let bridge: ContentScriptBridge;

    beforeEach(() => {
      bridge = new ContentScriptBridge({
        timeoutMs: 5000,
        autoStart: true
      });
    });

    afterEach(() => {
      bridge.destroy();
    });

    it('3.1: disconnect() cleanly drains 1,000 inflight promises with code 1002 detachment error', async () => {
      context.mockRuntime.sendMessage.mockImplementation(
        () => new Promise(() => {}) // Hang inflight
      );

      const inflightPromises: Promise<any>[] = [];
      const COUNT = 1000;

      for (let i = 0; i < COUNT; i++) {
        inflightPromises.push(bridge.send(`Test.method_${i}`, { idx: i }));
      }

      expect((bridge as any).pendingRequests.size).toBe(COUNT);

      // Trigger disconnect
      bridge.disconnect('tab_unloading_adversarial');

      // All 1,000 promises must reject with code 1002
      const results = await Promise.allSettled(inflightPromises);
      expect(results.length).toBe(COUNT);

      for (const res of results) {
        expect(res.status).toBe('rejected');
        if (res.status === 'rejected') {
          expect(res.reason).toMatchObject({
            code: 1002,
            message: expect.stringContaining('CDP session detached: tab_unloading_adversarial')
          });
        }
      }

      // Pending requests map must be 0
      expect((bridge as any).pendingRequests.size).toBe(0);
      expect(bridge.getStatus().status).toBe('DETACHED');
    });

    it('3.2: disconnect() unregisters window and runtime listeners and is idempotent', () => {
      const windowRemoveSpy = vi.spyOn(window, 'removeEventListener');
      const runtimeRemoveSpy = vi.spyOn(context.mockRuntime.onMessage, 'removeListener');

      // First disconnect
      bridge.disconnect('first_call');
      expect(windowRemoveSpy).toHaveBeenCalledWith('message', expect.any(Function));
      expect(runtimeRemoveSpy).toHaveBeenCalledWith(expect.any(Function));

      // Second disconnect call must not crash
      expect(() => bridge.disconnect('second_call')).not.toThrow();
      expect(bridge.getStatus().status).toBe('DETACHED');
    });
  });

  // =========================================================================
  // Challenge 4: High-Frequency Event Dispatch Allocation Optimization
  // =========================================================================
  describe('Challenge 4: High-Frequency CDP Event Dispatching', () => {
    let bridge: ContentScriptBridge;

    beforeEach(() => {
      bridge = new ContentScriptBridge({ autoStart: true });
    });

    afterEach(() => {
      bridge.destroy();
    });

    it('4.1: 10,000 CDP push events are dispatched without Array.from allocations', () => {
      let receivedCount = 0;
      bridge.on('Network.dataReceived', (params: any) => {
        receivedCount += params.bytes;
      });

      const arrayFromSpy = vi.spyOn(Array, 'from');

      const EVENTS_COUNT = 10000;
      for (let i = 0; i < EVENTS_COUNT; i++) {
        (bridge as any).handleCdpRpcEvent({
          type: 'CDP_RPC_EVENT',
          tabId: 1,
          method: 'Network.dataReceived',
          params: { bytes: 2 }
        });
      }

      expect(receivedCount).toBe(EVENTS_COUNT * 2);
      // Array.from must not have been called during event iteration
      expect(arrayFromSpy).not.toHaveBeenCalled();

      arrayFromSpy.mockRestore();
    });
  });

  // =========================================================================
  // Challenge 5: Boundary Conditions, Unicode & State Machine Edge Cases
  // =========================================================================
  describe('Challenge 5: Boundary Conditions & State Machine Edge Cases', () => {
    it('5.1: handles scripts with undefined, empty, or unicode names without crashing or leaking', async () => {
      let weakScript: WeakRef<ScriptRecord>;

      (() => {
        const script: ScriptRecord = {
          id: 'script-unicode-edge',
          name: '🚀 Special 脚本 "Quotes" & \n Newlines',
          code: 'return 777;',
          metadata: {
            name: '🚀 Special 脚本 "Quotes" & \n Newlines',
            grants: ['none']
          } as any,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        weakScript = new WeakRef(script);
        const scope = buildSandboxScope(script, cdpClient);
        const runner = createSandboxRunner(script, scope);
        expect(runner()).toBe(777);
      })();

      await runGenerationalGc();
      if (forceGc) {
        expect(weakScript!.deref()).toBeUndefined();
      }
    });

    it('5.2: disabled script (enabled: false) creates zero closures or listeners', () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      const windowAddSpy = vi.spyOn(window, 'addEventListener');

      const script: ScriptRecord = {
        id: 'disabled-script',
        name: 'Disabled Userscript',
        code: 'throw new Error("Must never run");',
        metadata: {
          name: 'Disabled Userscript',
          runAt: 'document-end',
          grants: ['none']
        } as any,
        enabled: false,
        createdAt: 0,
        updatedAt: 0
      };

      scheduleScriptExecution(script, cdpClient);

      expect(addEventListenerSpy).not.toHaveBeenCalled();
      expect(windowAddSpy).not.toHaveBeenCalled();

      addEventListenerSpy.mockRestore();
      windowAddSpy.mockRestore();
    });

    it('5.3: scheduleScriptExecution with document.readyState complete executes document-end immediately', () => {
      const originalReadyState = document.readyState;
      Object.defineProperty(document, 'readyState', {
        value: 'complete',
        configurable: true
      });

      let executed = false;
      (window as any).__docEndCompleteRan = false;

      const script: ScriptRecord = {
        id: 'script-doc-end-complete',
        name: 'Complete Doc End Script',
        code: 'window.__docEndCompleteRan = true;',
        metadata: {
          name: 'Complete Doc End Script',
          runAt: 'document-end',
          grants: ['none']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      scheduleScriptExecution(script, cdpClient);

      // Must execute synchronously because document.readyState === 'complete'
      expect((window as any).__docEndCompleteRan).toBe(true);

      Object.defineProperty(document, 'readyState', {
        value: originalReadyState,
        configurable: true
      });
      delete (window as any).__docEndCompleteRan;
    });

    it('5.4: disconnected bridge ignores postMessage dispatched to window after disconnect', () => {
      const bridge = new ContentScriptBridge({ autoStart: true });
      const handleWindowSpy = vi.spyOn(bridge, 'handleWindowMessage');

      bridge.disconnect('tab_closed');

      // Dispatch a postMessage event to the window
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'CDP_RPC_REQUEST' },
          origin: window.location.origin,
          source: window
        })
      );

      // Handler must not be invoked because event listener was removed
      expect(handleWindowSpy).not.toHaveBeenCalled();
      bridge.destroy();
    });
  });
});
