/**
 * Empirical Challenger M6-2 Gen5: Storage Subsystem & Persistent GM Engine Stress Suite
 * Location: test/unit/challenger-m6-2-storage-stress.spec.ts
 *
 * White-box adversarial testing for Milestone 6 Phase 2:
 * 1. Concurrent GM_setValue / GM_deleteValue write-through under heavy simulated page reloads and cross-script bursts.
 * 2. AsyncMutex FIFO ordering under concurrent burst mutations and simulated storage errors.
 * 3. Storage deep cloning, prototype pollution immunity (__proto__, constructor), and circular structure protection.
 * 4. Corrupt JSON storage recovery and fallback resilience.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { setupChromeMock } from '../mocks/chrome';
import { AsyncMutex, storageMutex } from '@/shared/storage/mutex';
import {
  GmStorageRepository,
  gmStorageRepo,
  getGmValues,
  getGmValue,
  setGmValue,
  setGmValues,
  deleteGmValue,
  listGmValues,
  clearGmValues,
  getAllGmStorage,
  getGmStorageKey,
  GM_STORAGE_PREFIX
} from '@/shared/storage/gm-repo';
import { GmStorageMessageHandler } from '@/background/gm-handler';
import { pageSandboxRunner } from '@/background/injector/page-runner';
import { useDashboardState } from '@/dashboard/composables/useDashboardState';
import {
  saveScript,
  getScript,
  getScripts,
  deleteScript,
  resetToDefaultScripts,
  importScripts,
  deepClone,
  STORAGE_KEYS
} from '@/shared/storage';
import type { ScriptRecord, GmStorageResponse } from '@/shared/types';

describe('Empirical Challenger M6-2 Gen5: Storage Subsystem & Persistent GM Engine Stress', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let handler: GmStorageMessageHandler;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
    await clearGmValues();
    handler = new GmStorageMessageHandler(gmStorageRepo);
    handler.init();
  });

  afterEach(async () => {
    handler.destroy();
    await clearGmValues();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // DIMENSION 1: Concurrent Write-Through Under Simulated Page Reloads & Bursts
  // =========================================================================

  describe('Dimension 1: Concurrent GM_setValue/deleteValue Write-Through Under Page Reloads', () => {
    it('1.1: Full write-through pipeline across 50 simulated rapid page reloads preserves state accumulation', async () => {
      const scriptId = 'reload-accumulator-script';
      const channelId = 'chan-reload-test';
      const RELOAD_COUNT = 50;

      // Intercept window postMessage to relay write-through messages directly to background handler
      const messageHandler = async (event: MessageEvent) => {
        const data = event.data;
        if (data && data.source === 'xokj-userscript' && (data.type === 'GM_STORAGE_SET' || data.type === 'GM_STORAGE_DELETE')) {
          await handler.processMessage(data);
        }
      };
      window.addEventListener('message', messageHandler);

      try {
        // Sequentially simulate 50 page reloads
        for (let reload = 1; reload <= RELOAD_COUNT; reload++) {
          // Pre-hydrate storage from persistent repository
          const preloaded = await getGmValues(scriptId);

          const scriptCode = `
            const currentVisits = Number(GM_getValue('visitCount', 0)) + 1;
            GM_setValue('visitCount', currentVisits);
            GM_setValue('lastReloadIndex', ${reload});
            GM_setValue('reloadLog_' + ${reload}, 'status_ok');
            if (${reload} > 10 && ${reload} % 10 === 0) {
              // Delete an earlier transient key
              GM_deleteValue('reloadLog_' + (${reload} - 5));
            }
          `;

          const runnerResult = pageSandboxRunner(
            scriptCode,
            'Reload Accumulator Script',
            scriptId,
            { grants: ['GM_getValue', 'GM_setValue', 'GM_deleteValue'] },
            channelId,
            preloaded
          );

          expect(runnerResult.success).toBe(true);

          // Allow postMessage microtasks to settle
          await new Promise((resolve) => setTimeout(resolve, 5));
        }

        // Verify final state in persistent repository
        const finalValues = await getGmValues(scriptId);
        expect(finalValues.visitCount).toBe(RELOAD_COUNT);
        expect(finalValues.lastReloadIndex).toBe(RELOAD_COUNT);
        expect(finalValues.reloadLog_50).toBe('status_ok');

        // Check that deleted transient keys are absent
        // When reload=20, reloadLog_15 was deleted. When reload=30, reloadLog_25 deleted.
        expect(finalValues.reloadLog_15).toBeUndefined();
        expect(finalValues.reloadLog_25).toBeUndefined();
        expect(finalValues.reloadLog_35).toBeUndefined();
        expect(finalValues.reloadLog_45).toBeUndefined();
      } finally {
        window.removeEventListener('message', messageHandler);
      }
    });

    it('1.2: 10 parallel scripts in concurrent MAIN-world sandboxes execute cross-script write-through with zero cross-tenant contamination', async () => {
      const SCRIPT_COUNT = 10;
      const WRITES_PER_SCRIPT = 15;
      const channelId = 'chan-multi-tenant-burst';
      const postMessages: any[] = [];

      const messageHandler = (event: MessageEvent) => {
        const data = event.data;
        if (data && data.source === 'xokj-userscript' && (data.type === 'GM_STORAGE_SET' || data.type === 'GM_STORAGE_DELETE')) {
          postMessages.push(data);
        }
      };
      window.addEventListener('message', messageHandler);

      try {
        // Concurrently run 10 scripts
        const scriptRuns: Promise<void>[] = [];

        for (let s = 0; s < SCRIPT_COUNT; s++) {
          const scriptId = `parallel-tenant-${s}`;
          const code = `
            for (let w = 0; w < ${WRITES_PER_SCRIPT}; w++) {
              GM_setValue('key_' + w, 'tenant_${s}_val_' + w);
              if (w % 3 === 0) {
                GM_setValue('mod3_' + w, true);
              }
            }
            GM_deleteValue('key_1'); // Deletes key_1
          `;

          const p = (async () => {
            const res = pageSandboxRunner(
              code,
              `Tenant Script ${s}`,
              scriptId,
              { grants: ['GM_setValue', 'GM_deleteValue', 'GM_getValue'] },
              channelId,
              {}
            );
            expect(res.success).toBe(true);
          })();

          scriptRuns.push(p);
        }

        await Promise.all(scriptRuns);

        // Wait for all 210 postMessage events to arrive in the happy-dom event loop
        const EXPECTED_MESSAGES = SCRIPT_COUNT * (WRITES_PER_SCRIPT + 5 + 1); // 15 keys + 5 mod3 + 1 delete = 21 per script
        await vi.waitFor(() => {
          expect(postMessages.length).toBe(EXPECTED_MESSAGES);
        });

        // Process all generated write-through messages concurrently via background handler
        const handlerPromises = postMessages.map((msg) => handler.processMessage(msg));
        const responses = await Promise.all(handlerPromises);

        for (const resp of responses) {
          expect(resp.success).toBe(true);
        }

        // Verify isolation across all 10 scripts in storage
        for (let s = 0; s < SCRIPT_COUNT; s++) {
          const scriptId = `parallel-tenant-${s}`;
          const stored = await getGmValues(scriptId);

          // key_1 was deleted
          expect(stored.key_1).toBeUndefined();
          expect(stored.key_0).toBe(`tenant_${s}_val_0`);
          expect(stored.key_2).toBe(`tenant_${s}_val_2`);
          expect(stored.key_14).toBe(`tenant_${s}_val_14`);
          expect(stored.mod3_0).toBe(true);
          expect(stored.mod3_3).toBe(true);

          // Verify no cross-tenant keys or values leaked from other script indices
          for (let otherS = 0; otherS < SCRIPT_COUNT; otherS++) {
            if (otherS !== s) {
              expect(stored.key_0).not.toBe(`tenant_${otherS}_val_0`);
            }
          }
        }
      } finally {
        window.removeEventListener('message', messageHandler);
      }
    });

    it('1.3: Sandbox lifecycle: pagehide event cleanly drains pending CDP state while GM write-through settles safely', async () => {
      const scriptId = 'lifecycle-pagehide-script';
      const channelId = 'chan-lifecycle-test';
      let postMessageCallCount = 0;

      const messageListener = (event: MessageEvent) => {
        if (event.data?.type === 'GM_STORAGE_SET') {
          postMessageCallCount++;
          handler.processMessage(event.data);
        }
      };
      window.addEventListener('message', messageListener);

      try {
        const code = `
          GM_setValue('startupKey', 'ready');
          
          if (typeof cdp !== 'undefined') {
            cdp.send('Page.captureScreenshot').catch(() => {});
          }

          GM_setValue('finalKey', 'finished');
        `;

        const res = pageSandboxRunner(
          code,
          'Pagehide Lifecycle Script',
          scriptId,
          { grants: ['GM_setValue', 'GM_getValue', 'GM_cdp'] },
          channelId,
          {}
        );
        expect(res.success).toBe(true);

        // Dispatch pagehide event simulating user navigating away
        window.dispatchEvent(new Event('pagehide'));

        await vi.waitFor(() => {
          expect(postMessageCallCount).toBe(2);
        });

        // Ensure postMessage storage writes succeeded and persisted
        const stored = await getGmValues(scriptId);
        expect(stored.startupKey).toBe('ready');
        expect(stored.finalKey).toBe('finished');
      } finally {
        window.removeEventListener('message', messageListener);
      }
    });
  });

  // =========================================================================
  // DIMENSION 2: AsyncMutex FIFO Ordering & Error Isolation Stress
  // =========================================================================

  describe('Dimension 2: AsyncMutex FIFO Ordering & Rejection Isolation', () => {
    it('2.1: 200 concurrent tasks execute in strictly monotonic FIFO queue order under artificial jitter', async () => {
      const mutex = new AsyncMutex();
      const executionOrder: number[] = [];
      const TOTAL_TASKS = 200;

      const tasks: Promise<void>[] = [];

      for (let i = 0; i < TOTAL_TASKS; i++) {
        const taskIndex = i;
        tasks.push(
          mutex.runExclusive(async () => {
            // Introduce artificial microtask/timer jitter
            if (taskIndex % 5 === 0) {
              await new Promise((r) => setTimeout(r, Math.random() * 2));
            } else {
              await Promise.resolve();
            }
            executionOrder.push(taskIndex);
          })
        );
      }

      await Promise.all(tasks);

      // Verify that execution order strictly matches 0..199 monotonically
      expect(executionOrder.length).toBe(TOTAL_TASKS);
      for (let i = 0; i < TOTAL_TASKS; i++) {
        expect(executionOrder[i]).toBe(i);
      }
      expect(mutex.isLocked()).toBe(false);
    });

    it('2.2: 100 alternating tasks (50% throws, 50% successes) guarantee rejection isolation and zero stalled resolvers', async () => {
      const mutex = new AsyncMutex();
      const TOTAL_OPS = 100;
      const completedSuccesses: number[] = [];
      const caughtFailures: number[] = [];

      const promises: Promise<unknown>[] = [];

      for (let i = 0; i < TOTAL_OPS; i++) {
        const index = i;
        const shouldFail = index % 2 === 1;

        const p = mutex
          .runExclusive(async () => {
            if (shouldFail) {
              throw new Error(`Deliberate failure in task #${index}`);
            }
            completedSuccesses.push(index);
          })
          .catch((err) => {
            expect(err.message).toBe(`Deliberate failure in task #${index}`);
            caughtFailures.push(index);
          });

        promises.push(p);
      }

      await Promise.all(promises);

      expect(completedSuccesses.length).toBe(50);
      expect(caughtFailures.length).toBe(50);

      // Verify mutex is fully unlocked and ready for new tasks
      expect(mutex.isLocked()).toBe(false);

      const probe = await mutex.runExclusive(async () => 'mutex-fully-healthy');
      expect(probe).toBe('mutex-fully-healthy');
    });

    it('2.3: Storage write contention with random disk I/O latencies resolves to the exact final queued value', async () => {
      const scriptId = 'latency-stress-script';
      const repo = new GmStorageRepository();
      const WRITE_COUNT = 50;

      // Wrap chrome.storage.local.set with randomized delay to simulate varying I/O latency
      const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
      vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
        const delayMs = Math.floor(Math.random() * 8);
        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
        return originalSet(items);
      });

      const writePromises: Promise<void>[] = [];
      for (let i = 0; i < WRITE_COUNT; i++) {
        writePromises.push(repo.setGmValue(scriptId, 'racingCounter', i));
      }

      await Promise.all(writePromises);

      // In strict FIFO serialization, write #49 must win and be the final value
      const finalValue = await repo.getGmValue<number>(scriptId, 'racingCounter');
      expect(finalValue).toBe(WRITE_COUNT - 1);
    });

    it('2.4: Non-function argument passed to AsyncMutex throws TypeError immediately without locking', async () => {
      const mutex = new AsyncMutex();

      await expect(mutex.runExclusive(null as any)).rejects.toThrow(TypeError);
      await expect(mutex.runExclusive(undefined as any)).rejects.toThrow(TypeError);
      await expect(mutex.runExclusive(12345 as any)).rejects.toThrow(TypeError);
      await expect(mutex.runExclusive('not-a-fn' as any)).rejects.toThrow(TypeError);

      expect(mutex.isLocked()).toBe(false);

      // Verify normal execution proceeds
      const res = await mutex.runExclusive(() => 42);
      expect(res).toBe(42);
    });
  });

  // =========================================================================
  // DIMENSION 3: Deep Cloning, Prototype Pollution Immunity & Circular Data
  // =========================================================================

  describe('Dimension 3: Deep Cloning, Prototype Pollution & Circular Structures', () => {
    it('3.1: Hostile prototype pollution keys (__proto__, constructor, prototype) across the storage stack do NOT pollute Object or Array prototypes', async () => {
      const scriptId = 'proto-defense-script';

      const hostileEntries = [
        { key: '__proto__', val: { injectedProto: 'danger_proto' } },
        { key: 'constructor', val: { prototype: { injectedCtor: 'danger_ctor' } } },
        { key: 'prototype', val: { injectedProp: 'danger_prop' } },
        { key: '__defineGetter__', val: 'fake_getter_value' },
        { key: 'toString', val: 'fake_toString' },
        { key: 'valueOf', val: 'fake_valueOf' }
      ];

      for (const entry of hostileEntries) {
        await setGmValue(scriptId, entry.key, entry.val);
      }

      // 1. Verify global prototypes remain pristine
      expect((Object.prototype as any).injectedProto).toBeUndefined();
      expect((Object.prototype as any).injectedCtor).toBeUndefined();
      expect((Object.prototype as any).injectedProp).toBeUndefined();
      expect((Array.prototype as any).injectedProto).toBeUndefined();
      expect(({} as any).injectedProto).toBeUndefined();

      // 2. Querying stored keys
      const allKeys = await listGmValues(scriptId);
      expect(allKeys.includes('constructor')).toBe(true);
      expect(allKeys.includes('prototype')).toBe(true);

      // 3. Test prototype pollution attack via GmStorageMessageHandler
      const attackRes = await handler.processMessage({
        type: 'GM_STORAGE_SET',
        scriptId,
        key: '__proto__',
        value: { pollutedKey: 'exploit_val' }
      } as any);
      expect(attackRes.success).toBe(true);
      expect((Object.prototype as any).pollutedKey).toBeUndefined();
      expect(({} as any).pollutedKey).toBeUndefined();

      // 4. Test pageSandboxRunner isolation with hostile keys
      let capturedResult: any = null;
      (window as any).__protoTestCapture = (v: any) => {
        capturedResult = v;
      };

      const runnerRes = pageSandboxRunner(
        `
          GM_setValue('__proto__', { payload: 'in-sandbox' });
          GM_setValue('constructor', 'custom-constructor');
          const pVal = GM_getValue('__proto__');
          const cVal = GM_getValue('constructor');
          window.__protoTestCapture({ pVal, cVal });
        `,
        'Proto Sandbox Test',
        scriptId,
        { grants: ['GM_setValue', 'GM_getValue'] },
        'chan-proto',
        {}
      );
      expect(runnerRes.success).toBe(true);
      expect((Object.prototype as any).payload).toBeUndefined();
      expect(capturedResult).toEqual({
        pVal: { payload: 'in-sandbox' },
        cVal: 'custom-constructor'
      });

      delete (window as any).__protoTestCapture;
    });

    it('3.2: Storage deep cloning prevents reference leakage on both write and read paths', async () => {
      const scriptId = 'clone-integrity-script';

      const originalData = {
        meta: { tag: 'initial', nested: [1, 2, 3] },
        counters: { visits: 10 }
      };

      // 1. Write-path deep cloning
      await setGmValue(scriptId, 'profile', originalData);

      // Mutate originalData immediately after write
      originalData.meta.tag = 'MUTATED_AFTER_WRITE';
      originalData.meta.nested.push(999);
      originalData.counters.visits = 99999;

      // Stored data must reflect original unmutated state
      const retrieved = await getGmValue<typeof originalData>(scriptId, 'profile');
      expect(retrieved?.meta.tag).toBe('initial');
      expect(retrieved?.meta.nested).toEqual([1, 2, 3]);
      expect(retrieved?.counters.visits).toBe(10);

      // 2. Read-path deep cloning: mutating retrieved object must not mutate repository state
      retrieved!.meta.tag = 'MUTATED_AFTER_READ';
      retrieved!.meta.nested.pop();

      const refetched = await getGmValue<typeof originalData>(scriptId, 'profile');
      expect(refetched?.meta.tag).toBe('initial');
      expect(refetched?.meta.nested).toEqual([1, 2, 3]);
    });

    it('3.3: Self-referential and circular structures do not cause unhandled crashes in pageSandboxRunner or repository', async () => {
      const scriptId = 'circular-structure-script';

      // 1. Circular structure in pageSandboxRunner GM_setValue
      let probeValue: any = null;
      (window as any).__probeCircular = (v: any) => {
        probeValue = v;
      };

      const code = `
        const cycle = { name: 'cyclic_node' };
        cycle.self = cycle;
        GM_setValue('cycleKey', cycle);
        const stored = GM_getValue('cycleKey');
        window.__probeCircular(stored);
      `;

      const result = pageSandboxRunner(
        code,
        'Circular Test',
        scriptId,
        { grants: ['GM_setValue', 'GM_getValue'] },
        'chan-cycle',
        {}
      );

      // Must succeed cleanly without throwing TypeError: Converting circular structure to JSON
      expect(result.success).toBe(true);
      expect(probeValue).toBeDefined();

      delete (window as any).__probeCircular;

      // 2. Circular structure in GmStorageRepository (structuredClone handles graphs natively)
      const graphNode: any = { id: 'root', items: [] };
      graphNode.items.push(graphNode);

      await setGmValue(scriptId, 'graphKey', graphNode);
      const fetchedGraph: any = await getGmValue(scriptId, 'graphKey');
      expect(fetchedGraph).toBeDefined();
      expect(fetchedGraph.id).toBe('root');
      expect(fetchedGraph.items[0]).toBe(fetchedGraph);
    });
  });

  // =========================================================================
  // DIMENSION 4: Corrupt JSON Storage Recovery and Fallback Resilience
  // =========================================================================

  describe('Dimension 4: Corrupt JSON Storage Recovery & Fallback Resilience', () => {
    it('4.1: Direct bucket corruption in chrome.storage.local recovers cleanly and self-heals on write', async () => {
      const scriptId = 'corrupted-bucket-script';
      const storageKey = getGmStorageKey(scriptId);

      // 1. Corrupt with raw string
      await chrome.storage.local.set({ [storageKey]: 'CORRUPTED_RAW_NON_OBJECT' });
      let readVal = await getGmValues(scriptId);
      expect(readVal).toEqual({});

      // 2. Corrupt with array
      await chrome.storage.local.set({ [storageKey]: ['corrupt', 'array'] });
      readVal = await getGmValues(scriptId);
      expect(readVal).toEqual({});

      // 3. Corrupt with primitive numbers
      await chrome.storage.local.set({ [storageKey]: 99999 });
      readVal = await getGmValues(scriptId);
      expect(readVal).toEqual({});

      // 4. Self-healing: subsequent setGmValue overwrites corruption and restores a valid bucket
      await setGmValue(scriptId, 'healedKey', 'healedValue');
      const healedBucket = await getGmValues(scriptId);
      expect(healedBucket).toEqual({ healedKey: 'healedValue' });

      const rawInStorage = (await chrome.storage.local.get(storageKey))[storageKey];
      expect(rawInStorage).toEqual({ healedKey: 'healedValue' });
    });

    it('4.2: Malformed initialValues in pageSandboxRunner (non-serializable types, throwing getters) initialize safely', () => {
      let captureResult: any = null;
      (window as any).__captureRunnerInit = (val: any) => {
        captureResult = val;
      };

      const hostileInitialValues = {
        validKey: 'good_value',
        bigIntKey: BigInt(9007199254740991), // JSON.stringify throws TypeError on BigInt
        get throwingKey() {
          throw new Error('Hostile getter in initialValues!');
        }
      };

      const code = `
        const good = GM_getValue('validKey');
        const bad = GM_getValue('throwingKey', 'fallback');
        const list = GM_listValues();
        window.__captureRunnerInit({ good, bad, list });
      `;

      const res = pageSandboxRunner(
        code,
        'Hostile Initial Values',
        'script-hostile-init',
        { grants: ['GM_getValue', 'GM_listValues'] },
        'chan-init-test',
        hostileInitialValues as any
      );

      // Runner initializes safely without throwing
      expect(res.success).toBe(true);
      expect(captureResult).toEqual({
        good: 'good_value',
        bad: 'fallback',
        list: ['validKey']
      });

      delete (window as any).__captureRunnerInit;
    });

    it('4.3: useDashboardState composable handles corrupted scripts in storage and external changes without crashing', async () => {
      // Mount a test component using useDashboardState
      const TestComponent = defineComponent({
        setup() {
          return useDashboardState();
        },
        template: '<div id="test-dashboard">{{ Object.keys(scripts).length }}</div>'
      });

      const wrapper = mount(TestComponent);
      await flushPromises();

      // Verify initial loading loaded the 3 default scripts
      expect(wrapper.text()).toBe('3');

      // Simulate external storage event emitting corrupted newValue (null / non-object)
      await context.storageOnChanged._emit(
        {
          scripts: {
            newValue: null as any,
            oldValue: {}
          }
        },
        'local'
      );
      await flushPromises();

      // Dashboard state should handle null newValue without throwing
      expect(wrapper.exists()).toBe(true);

      // Simulate storage event with corrupted script record
      const corruptedScriptsRecord = {
        'corrupt-1': {
          id: 'corrupt-1',
          name: 'Corrupt',
          // missing code / metadata
        } as any
      };

      await context.storageOnChanged._emit(
        {
          scripts: {
            newValue: corruptedScriptsRecord,
            oldValue: {}
          }
        },
        'local'
      );
      await flushPromises();

      expect(wrapper.exists()).toBe(true);

      // Reset to defaults via composable
      await wrapper.vm.confirmResetDefaults();
      await flushPromises();

      expect(Object.keys(wrapper.vm.scripts).length).toBe(3);
      expect(wrapper.vm.scripts['sample-cdp-logger']).toBeDefined();

      wrapper.unmount();
    });

    it('4.4: Corrupt bundle import via importScripts isolates bad entries and saves valid scripts', async () => {
      const corruptBatch = [
        '{ not json }',
        null,
        { id: 'missing-code', name: 'No Code' },
        {
          id: 'valid-recovered',
          name: 'Valid Recovered Script',
          code: '// ==UserScript==\n// @name Valid Recovered Script\n// @match *://*/*\n// ==/UserScript=='
        }
      ];

      const res = await importScripts(corruptBatch as any);
      expect(res.total).toBe(4);
      expect(res.imported).toBe(1);
      expect(res.failed).toBe(3);
      expect(res.errors?.length).toBe(3);

      const saved = await getScript('valid-recovered');
      expect(saved).not.toBeNull();
      expect(saved?.name).toBe('Valid Recovered Script');
    });
  });
});
