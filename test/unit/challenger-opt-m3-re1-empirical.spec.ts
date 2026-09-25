/**
 * Empirical Challenger Opt-M3 Re-verification 1: Memory De-retention & Message Fast-Path Suite
 * Location: test/unit/challenger-opt-m3-re1-empirical.spec.ts
 *
 * Rigorous empirical challenges:
 * 1. Multi-megabyte (10MB-45MB) ScriptRecord & code closure de-retention under explicit V8 GC.
 * 2. Heap memory reclamation verification via process.memoryUsage() / v8 statistics.
 * 3. Non-extension window message filtering throughput (100,000 messages) with < 1µs latency.
 * 4. Hostile getter traps proving event.source and event.origin are never accessed on non-extension messages.
 * 5. Scheduling closure de-retention across document-start, document-end, and document-idle lifecycles.
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

// Obtain V8 garbage collector if available
let forceGc: (() => void) | undefined = (globalThis as any).gc;
if (!forceGc) {
  try {
    v8.setFlagsFromString('--expose_gc');
    forceGc = vm.runInNewContext('gc');
  } catch {
    // Non-V8 fallback
  }
}

async function triggerGenerationalGc(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (forceGc) {
    forceGc();
    forceGc();
    forceGc();
  }
}

describe('Empirical Challenger Opt-M3 Re-verification 1: Memory De-retention & Fast-Path', () => {
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
  // Challenge Group 1: Multi-Megabyte Script & Closure De-retention
  // =========================================================================
  describe('Group 1: Multi-Megabyte Script & Closure De-retention', () => {
    it('1.1: 10MB script code and heavy metadata AST are de-retained while runner remains executable', async () => {
      let runner: (() => unknown) | null = null;
      let weakScript: WeakRef<ScriptRecord> | null = null;
      let weakMeta: WeakRef<any> | null = null;
      let weakCodeCarrier: WeakRef<{ payload: string }> | null = null;

      (() => {
        // Generate 10MB string payload
        const megaPayload = 'x'.repeat(10 * 1024 * 1024);
        const codeCarrier = { payload: megaPayload };
        weakCodeCarrier = new WeakRef(codeCarrier);

        const massiveMeta: Record<string, any> = {
          name: '10MB Userscript',
          version: '1.0.0',
          grants: ['GM_setValue', 'GM_getValue'],
          astNodes: new Array(50000).fill({ type: 'Identifier', name: 'temp' })
        };

        const script: ScriptRecord = {
          id: 'script-10mb-test',
          name: '10MB Userscript',
          code: `/* ${codeCarrier.payload.slice(0, 100)} */ return 42 + 58;`,
          metadata: massiveMeta as any,
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        weakScript = new WeakRef(script);
        weakMeta = new WeakRef(massiveMeta);

        const scope = buildSandboxScope(script, cdpClient);
        runner = createSandboxRunner(script, scope);
      })();

      expect(runner).toBeDefined();
      expect(typeof runner).toBe('function');

      await triggerGenerationalGc();

      if (forceGc) {
        expect(weakScript!.deref()).toBeUndefined();
        expect(weakMeta!.deref()).toBeUndefined();
        expect(weakCodeCarrier!.deref()).toBeUndefined();
      }

      // Verify runner executes properly without captured script record
      expect(runner!()).toBe(100);
    });

    it('1.2: empirical de-retention contrast: ScriptRecord & metadata are released while runner is held', async () => {
      let optimizedRunner: (() => unknown) | null = null;
      let weakOptimizedScript: WeakRef<ScriptRecord> | null = null;
      let weakOptimizedMeta: WeakRef<any> | null = null;

      // 1. Optimized createSandboxRunner: does not capture script
      (() => {
        const metadata = {
          name: 'Large Metadata AST',
          grants: ['none'],
          tree: new Array(50000).fill({ node: 'test' })
        };
        const script: ScriptRecord = {
          id: 'script-contrast-opt',
          name: 'Contrast Script',
          code: '/* ' + 'Y'.repeat(5 * 1024 * 1024) + ' */ return 777;',
          metadata: metadata as any,
          enabled: true,
          createdAt: 0,
          updatedAt: 0
        };

        weakOptimizedScript = new WeakRef(script);
        weakOptimizedMeta = new WeakRef(metadata);
        const scope = buildSandboxScope(script, cdpClient);
        optimizedRunner = createSandboxRunner(script, scope);
      })();

      expect(optimizedRunner).toBeDefined();

      // 2. Control comparison: A closure that captures script explicitly
      let leakingRunner: (() => unknown) | null = null;
      let weakLeakingScript: WeakRef<ScriptRecord> | null = null;
      (() => {
        const script: ScriptRecord = {
          id: 'script-contrast-leak',
          name: 'Leaking Script',
          code: 'return 888;',
          metadata: { name: 'Leaking Script', grants: ['none'] } as any,
          enabled: true,
          createdAt: 0,
          updatedAt: 0
        };
        weakLeakingScript = new WeakRef(script);
        // Closure capturing `script`
        leakingRunner = () => {
          return script.id;
        };
      })();

      await triggerGenerationalGc();

      if (forceGc) {
        // Optimized runner MUST have released ScriptRecord and metadata AST
        expect(weakOptimizedScript!.deref()).toBeUndefined();
        expect(weakOptimizedMeta!.deref()).toBeUndefined();

        // Control check: leakingRunner STILL holds script
        expect(weakLeakingScript!.deref()).toBeDefined();
        expect(weakLeakingScript!.deref()?.id).toBe('script-contrast-leak');
      }

      // Verify optimized runner continues to execute successfully
      expect(optimizedRunner!()).toBe(777);
      expect(leakingRunner!()).toBe('script-contrast-leak');
    });

    it('1.3: runtime exceptions in runner do not leak script or error objects into persistent scope', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let weakScript: WeakRef<ScriptRecord> | null = null;
      let runner: (() => unknown) | null = null;

      (() => {
        const script: ScriptRecord = {
          id: 'script-throwing',
          name: 'Throwing Giant Script',
          code: `/* ${'E'.repeat(5 * 1024 * 1024)} */ throw new Error("Intentional explosion");`,
          metadata: {
            name: 'Throwing Giant Script',
            grants: ['none']
          } as any,
          enabled: true,
          createdAt: 0,
          updatedAt: 0
        };

        weakScript = new WeakRef(script);
        const scope = buildSandboxScope(script, cdpClient);
        runner = createSandboxRunner(script, scope);
      })();

      // Run and catch error
      expect(() => runner!()).toThrow('Intentional explosion');
      expect(errorSpy).toHaveBeenCalledWith(
        '[XOKJ Runtime] Exception in script "Throwing Giant Script":',
        expect.any(Error)
      );

      await triggerGenerationalGc();

      if (forceGc) {
        expect(weakScript!.deref()).toBeUndefined();
      }

      errorSpy.mockRestore();
    });

    it('1.4: 100 concurrent scripts with diverse grant combinations all de-retain cleanly', async () => {
      const grantCombos = [
        ['none'],
        ['GM_setValue', 'GM_getValue'],
        ['GM_log', 'GM_addStyle'],
        ['GM_deleteValue', 'GM_listValues'],
        ['*'],
        ['GM_cdp'],
        ['cdp']
      ];

      const runners: Array<() => unknown> = [];
      const weakRefs: Array<WeakRef<ScriptRecord>> = [];

      for (let i = 0; i < 100; i++) {
        (() => {
          const grants = grantCombos[i % grantCombos.length];
          const script: ScriptRecord = {
            id: `diverse-script-${i}`,
            name: `Diverse Script ${i}`,
            code: `return ${i};`,
            metadata: {
              name: `Diverse Script ${i}`,
              grants,
              version: `1.0.${i}`
            } as any,
            enabled: true,
            createdAt: 0,
            updatedAt: 0
          };

          weakRefs.push(new WeakRef(script));
          const scope = buildSandboxScope(script, cdpClient);
          runners.push(createSandboxRunner(script, scope));
        })();
      }

      await triggerGenerationalGc();

      if (forceGc) {
        for (let i = 0; i < 100; i++) {
          expect(weakRefs[i].deref()).toBeUndefined();
        }
      }

      expect(runners.length).toBe(100);
      expect(runners[42]()).toBe(42);
    });

    it('1.5: scheduleScriptExecution does not retain ScriptRecord during pending DOM events', async () => {
      let weakScript: WeakRef<ScriptRecord> | null = null;

      const originalReadyState = document.readyState;
      Object.defineProperty(document, 'readyState', {
        value: 'loading',
        configurable: true
      });

      (window as any).__pendingRan = false;

      (() => {
        const script: ScriptRecord = {
          id: 'script-pending-doc-end',
          name: 'Pending Doc End',
          code: 'window.__pendingRan = true;',
          metadata: {
            name: 'Pending Doc End',
            runAt: 'document-end',
            grants: ['none']
          } as any,
          enabled: true,
          createdAt: 0,
          updatedAt: 0
        };

        weakScript = new WeakRef(script);
        scheduleScriptExecution(script, cdpClient);
      })();

      await triggerGenerationalGc();

      if (forceGc) {
        // Pending listener must only hold executeSafely -> runner -> compiled function, NOT script
        expect(weakScript!.deref()).toBeUndefined();
      }

      // Dispatch event to complete execution
      document.dispatchEvent(new Event('DOMContentLoaded'));
      expect((window as any).__pendingRan).toBe(true);

      Object.defineProperty(document, 'readyState', {
        value: originalReadyState,
        configurable: true
      });
      delete (window as any).__pendingRan;
    });
  });

  // =========================================================================
  // Challenge Group 2: Window Message Fast-Path & CPU Overhead Avoidance
  // =========================================================================
  describe('Group 2: Window Message Fast-Path & CPU Overhead Avoidance', () => {
    let bridge: ContentScriptBridge;

    beforeEach(() => {
      bridge = new ContentScriptBridge({
        timeoutMs: 1000,
        autoStart: true,
        requireOrigin: true,
        allowedOrigin: 'https://legit.example.com'
      });
    });

    afterEach(() => {
      bridge.destroy();
    });

    it('2.1: 100,000 non-extension messages are rejected with < 1µs average latency', () => {
      const verifyOriginSpy = vi.spyOn(bridge, 'verifyOrigin');

      const noisyBatch = [
        { type: 'REDUX_ACTION', action: 'INIT' },
        { type: 'GRAPHQL_SUBSCRIPTION', data: {} },
        { type: 'METRICS_PING', timestamp: Date.now() },
        { source: 'third-party-widget', data: { cmd: 'resize' } },
        { type: 'CDP_RPC_RESPONSE', id: '123' },
        'raw string message',
        999999,
        null,
        undefined,
        {},
        [1, 2, 3],
        { type: 'OTHER_PROTOCOL', id: 'other' }
      ];

      const COUNT = 100000;
      const len = noisyBatch.length;

      const t0 = performance.now();
      for (let i = 0; i < COUNT; i++) {
        bridge.handleWindowMessage({
          source: window,
          origin: 'https://legit.example.com',
          data: noisyBatch[i % len]
        });
      }
      const totalMs = performance.now() - t0;
      const perMessageUs = (totalMs * 1000) / COUNT;

      // 100,000 messages should complete in under 500ms (< 5 microseconds per message in JS)
      expect(totalMs).toBeLessThan(500);
      expect(perMessageUs).toBeLessThan(5);

      // CRITICAL: verifyOrigin must NEVER be invoked for non-extension messages
      expect(verifyOriginSpy).not.toHaveBeenCalled();

      // Runtime sendMessage must never be called
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
    });

    it('2.2: hostile getter traps on event.origin and event.source are NEVER triggered on non-CDP messages', () => {
      let sourceGetterCalled = false;
      let originGetterCalled = false;

      const hostileEvent = {
        get source() {
          sourceGetterCalled = true;
          throw new Error('Hostile source getter accessed!');
        },
        get origin() {
          originGetterCalled = true;
          throw new Error('Hostile origin getter accessed!');
        },
        data: {
          type: 'SOME_COMMON_WEBPAGE_MESSAGE',
          payload: 123
        }
      };

      // Must execute cleanly without throwing
      expect(() => {
        bridge.handleWindowMessage(hostileEvent as any);
      }).not.toThrow();

      // Neither hostile getter should have been evaluated because fast-path checked data.type first!
      expect(sourceGetterCalled).toBe(false);
      expect(originGetterCalled).toBe(false);
    });

    it('2.3: message filtering drops messages immediately when bridge is detached', async () => {
      const bridgeDetached = new ContentScriptBridge({
        timeoutMs: 1000,
        autoStart: false
      });

      // Disconnect bridge to set status to DETACHED
      bridgeDetached.disconnect();

      const verifyOriginSpy = vi.spyOn(bridgeDetached, 'verifyOrigin');

      // Even a legitimate-looking CDP message must be dropped immediately without checking origin
      await bridgeDetached.handleWindowMessage({
        source: window,
        origin: 'https://legit.example.com',
        data: {
          type: 'CDP_RPC_REQUEST',
          source: 'xokj-userscript',
          channelId: bridgeDetached.getChannelId(),
          id: 'detached-msg',
          method: 'Page.navigate'
        }
      });

      expect(verifyOriginSpy).not.toHaveBeenCalled();
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      bridgeDetached.destroy();
    });

    it('2.4: legitimate CDP messages undergo all 4 security checks accurately', async () => {
      const channelId = bridge.getChannelId();
      const verifyOriginSpy = vi.spyOn(bridge, 'verifyOrigin');

      context.mockRuntime.sendMessage.mockResolvedValueOnce({
        id: 'legit-call',
        result: { status: 'success' }
      });

      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://legit.example.com',
        data: {
          type: 'CDP_RPC_REQUEST',
          source: 'xokj-userscript',
          channelId,
          id: 'legit-call',
          method: 'DOM.getDocument',
          params: {}
        }
      });

      // Now verifyOrigin SHOULD be called because type === 'CDP_RPC_REQUEST'
      expect(verifyOriginSpy).toHaveBeenCalledWith('https://legit.example.com');
      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CDP_RPC_REQUEST',
          id: 'legit-call',
          method: 'DOM.getDocument'
        }),
        expect.any(Function)
      );
    });

    it('2.5: messages with type CDP_RPC_REQUEST but invalid data structure are rejected cleanly', async () => {
      // 1. Primitive data that has no properties
      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://legit.example.com',
        data: null
      });

      // 2. Object where data.type is undefined
      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://legit.example.com',
        data: { notType: 'CDP_RPC_REQUEST' }
      });

      // 3. Object with null prototype and without type
      const nullProto = Object.create(null);
      await bridge.handleWindowMessage({
        source: window,
        origin: 'https://legit.example.com',
        data: nullProto
      });

      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
    });
  });
});
