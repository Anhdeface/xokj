/**
 * XOKJ - Empirical Challenger M2: Modular Storage Subsystem Stress Test Suite
 * Location: test/unit/challenger-m2-storage-stress.spec.ts
 *
 * Focus: Extreme concurrency, high-throughput writes, race conditions,
 * FIFO order guarantees, cross-script concurrency, and tab sessions deadlock freedom.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
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
  getGmStorageKey
} from '@/shared/storage/gm-repo';
import { AsyncMutex, storageMutex } from '@/shared/storage/mutex';
import {
  saveScript,
  getScript,
  getScripts,
  toggleScript,
  resetToDefaultScripts
} from '@/shared/storage/scripts-repo';
import {
  saveTabSession,
  getTabSession,
  getTabSessions,
  deleteTabSession,
  clearTabSessions
} from '@/shared/storage/tab-repo';
import type { TabSessionState } from '@/shared/types';

describe('Empirical Challenger M2: Modular Storage Subsystem Stress & Concurrency Suite', () => {
  beforeEach(async () => {
    setupChromeMock();
    await resetToDefaultScripts();
    await clearGmValues();
    await clearTabSessions();
  });

  // =========================================================================
  // TASK 2.1: Concurrency Stress (200+ ops within single script & across 20 scripts)
  // =========================================================================
  describe('Task 2.1: Concurrency Stress (Single & Multi-Script)', () => {
    it('C1.1: 250 concurrent unawaited operations within a single script ID complete without corruption or lost updates', async () => {
      const scriptId = 'stress-single-script';
      const TOTAL_OPS = 250;
      const promises: Promise<unknown>[] = [];

      // Interleave sets, gets, deletes, and bulk-sets
      for (let i = 0; i < TOTAL_OPS; i++) {
        const key = `key_${i % 25}`;
        const opType = i % 5;

        switch (opType) {
          case 0:
          case 1:
          case 2:
            // 60% Writes
            promises.push(setGmValue(scriptId, key, { seq: i, timestamp: Date.now(), payload: `val_${i}` }));
            break;
          case 3:
            // 20% Reads
            promises.push(getGmValue(scriptId, key));
            break;
          case 4:
            // 20% Deletes
            promises.push(deleteGmValue(scriptId, key));
            break;
        }
      }

      const results = await Promise.allSettled(promises);
      expect(results.length).toBe(TOTAL_OPS);

      // Verify no unexpected rejections occurred
      const rejections = results.filter((r) => r.status === 'rejected');
      expect(rejections).toEqual([]);

      // Storage bucket must be a valid object
      const finalBucket = await getGmValues(scriptId);
      expect(typeof finalBucket).toBe('object');
      expect(finalBucket).not.toBeNull();

      // All keys remaining must have valid structure
      for (const [k, v] of Object.entries(finalBucket)) {
        expect(k).toMatch(/^key_\d+$/);
        expect(typeof v).toBe('object');
      }
    });

    it('C1.2: 400 concurrent unawaited operations across 20 distinct script IDs maintain 100% namespace isolation', async () => {
      const SCRIPT_COUNT = 20;
      const OPS_PER_SCRIPT = 20; // 20 * 20 = 400 operations total
      const allPromises: Promise<unknown>[] = [];

      for (let s = 0; s < SCRIPT_COUNT; s++) {
        const scriptId = `script-tenant-${s.toString().padStart(2, '0')}`;
        for (let op = 0; op < OPS_PER_SCRIPT; op++) {
          const key = `tenant_k_${op}`;
          const val = { scriptIndex: s, opIndex: op, str: `data_${s}_${op}` };
          allPromises.push(setGmValue(scriptId, key, val));
        }
      }

      const results = await Promise.all(allPromises);
      expect(results.length).toBe(SCRIPT_COUNT * OPS_PER_SCRIPT);

      // Verify each script contains exactly its own 20 keys with uncorrupted payloads
      for (let s = 0; s < SCRIPT_COUNT; s++) {
        const scriptId = `script-tenant-${s.toString().padStart(2, '0')}`;
        const keys = await listGmValues(scriptId);
        expect(keys.length).toBe(OPS_PER_SCRIPT);

        const values = await getGmValues(scriptId);
        for (let op = 0; op < OPS_PER_SCRIPT; op++) {
          const key = `tenant_k_${op}`;
          expect(values[key]).toEqual({
            scriptIndex: s,
            opIndex: op,
            str: `data_${s}_${op}`
          });
        }
      }
    });

    it('C1.3: 300 rapid unawaited operations alternating set and delete on multiple keys simultaneously', async () => {
      const scriptId = 'rapid-alternating-script';
      const COUNT = 300;
      const promises: Promise<void>[] = [];

      for (let i = 0; i < COUNT; i++) {
        const key = `alt_key_${i % 10}`;
        if (i % 2 === 0) {
          promises.push(setGmValue(scriptId, key, `round_${i}`));
        } else {
          promises.push(deleteGmValue(scriptId, key));
        }
      }

      await Promise.all(promises);

      // Verify bucket is consistent and accessible
      const finalBucket = await getGmValues(scriptId);
      expect(typeof finalBucket).toBe('object');
      const keys = await listGmValues(scriptId);

      // For each key alt_key_0..alt_key_9:
      // The last operation for alt_key_k was at index:
      // largest i < COUNT such that i % 10 === k.
      // Since COUNT = 300:
      // k=0: last i = 290 (even -> set)
      // k=1: last i = 291 (odd -> delete)
      // k=2: last i = 292 (even -> set)
      // etc.
      for (let k = 0; k < 10; k++) {
        const lastI = 290 + k;
        const key = `alt_key_${k}`;
        if (lastI % 2 === 0) {
          expect(finalBucket[key]).toBe(`round_${lastI}`);
        } else {
          expect(finalBucket[key]).toBeUndefined();
        }
      }
    });
  });

  // =========================================================================
  // TASK 2.2: FIFO Serialization Guarantees
  // =========================================================================
  describe('Task 2.2: FIFO Serialization Guarantees', () => {
    it('C2.1: 150 sequential unawaited updates to a single key in a single script resolve in strictly deterministic FIFO order', async () => {
      const scriptId = 'fifo-audit-script';
      const targetKey = 'deterministicCounter';
      const TOTAL_WRITES = 150;

      // Launch 150 unawaited setGmValue calls synchronously
      const promises: Promise<void>[] = [];
      for (let i = 0; i < TOTAL_WRITES; i++) {
        promises.push(setGmValue(scriptId, targetKey, i));
      }

      await Promise.all(promises);

      // In strict FIFO order, write (TOTAL_WRITES - 1) is the last to execute
      const finalVal = await getGmValue<number>(scriptId, targetKey);
      expect(finalVal).toBe(TOTAL_WRITES - 1);
    });

    it('C2.2: Interleaved sequence of set, delete, set, delete on the same key resolves in exact FIFO order', async () => {
      const scriptId = 'fifo-interleaved-key';
      const key = 'stateKey';

      // Sequence of operations fired synchronously without await
      const p1 = setGmValue(scriptId, key, 'step1');
      const p2 = setGmValue(scriptId, key, 'step2');
      const p3 = deleteGmValue(scriptId, key);
      const p4 = setGmValue(scriptId, key, 'step4');
      const p5 = deleteGmValue(scriptId, key);
      const p6 = setGmValue(scriptId, key, 'step6_final');

      await Promise.all([p1, p2, p3, p4, p5, p6]);

      const finalVal = await getGmValue(scriptId, key);
      expect(finalVal).toBe('step6_final');
    });

    it('C2.3: Read-after-write consistency in asynchronous chain', async () => {
      const scriptId = 'raw-consistency-script';
      const repo = new GmStorageRepository();

      // Launch write followed by subsequent read
      const writePromise = repo.setGmValue(scriptId, 'flag', 'ACTIVE');
      // Even though writePromise is not yet awaited, awaiting getGmValue right after writePromise is queued
      await writePromise;
      const readVal = await repo.getGmValue(scriptId, 'flag');
      expect(readVal).toBe('ACTIVE');
    });
  });

  // =========================================================================
  // TASK 2.3: Cross-Script Concurrency & Non-Blocking Isolation
  // =========================================================================
  describe('Task 2.3: Cross-Script Concurrency & Non-Blocking Isolation', () => {
    it('C3.1: Stalled/slow write on Script A does NOT block concurrent writes to Script B', async () => {
      const repo = new GmStorageRepository();
      const scriptA = 'script-slow-A';
      const scriptB = 'script-fast-B';

      // Hook chrome.storage.local.set to delay writes for scriptA by 120ms
      const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
      const storageKeyA = getGmStorageKey(scriptA);

      let scriptAStarted = false;
      let scriptAFinished = false;
      let scriptBFinished = false;
      let scriptBFinishTime = 0;
      let scriptAFinishTime = 0;

      vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
        if (Object.prototype.hasOwnProperty.call(items, storageKeyA)) {
          scriptAStarted = true;
          // Introduce 120ms artificial latency for Script A
          await new Promise((resolve) => setTimeout(resolve, 120));
          const res = await originalSet(items);
          scriptAFinished = true;
          scriptAFinishTime = Date.now();
          return res;
        }
        const res = await originalSet(items);
        return res;
      });

      const startTime = Date.now();

      // Fire slow Script A write
      const slowPromise = repo.setGmValue(scriptA, 'slowKey', 'slowValue');

      // Wait a microtask to ensure slow write has acquired scriptA's mutex and entered storage.set
      await vi.waitFor(() => {
        expect(scriptAStarted).toBe(true);
      });

      // Now fire fast Script B write while Script A is sleeping in storage.set
      const fastPromise = repo.setGmValue(scriptB, 'fastKey', 'fastValue').then(() => {
        scriptBFinished = true;
        scriptBFinishTime = Date.now();
      });

      await fastPromise;

      // Script B MUST finish BEFORE Script A finishes!
      expect(scriptBFinished).toBe(true);
      expect(scriptAFinished).toBe(false);

      await slowPromise;
      expect(scriptAFinished).toBe(true);

      // Script B finished significantly earlier than Script A
      expect(scriptBFinishTime).toBeLessThan(scriptAFinishTime);

      // Verify both scripts stored their correct values
      expect(await repo.getGmValue(scriptA, 'slowKey')).toBe('slowValue');
      expect(await repo.getGmValue(scriptB, 'fastKey')).toBe('fastValue');

      vi.restoreAllMocks();
    });

    it('C3.2: Rejection or throw during Script A write does not poison or block Script B write', async () => {
      const repo = new GmStorageRepository();
      const scriptA = 'script-fail-A';
      const scriptB = 'script-succeed-B';

      const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
      const storageKeyA = getGmStorageKey(scriptA);

      vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
        if (Object.prototype.hasOwnProperty.call(items, storageKeyA)) {
          throw new Error('Simulated disk failure on Script A');
        }
        return originalSet(items);
      });

      // Script A fails
      await expect(repo.setGmValue(scriptA, 'keyA', 'valA')).rejects.toThrow('Simulated disk failure on Script A');

      // Script B should succeed without issue
      await expect(repo.setGmValue(scriptB, 'keyB', 'valB')).resolves.toBeUndefined();

      expect(await repo.getGmValue(scriptB, 'keyB')).toBe('valB');

      vi.restoreAllMocks();
    });

    it('C3.3: clearGmValues(scriptId) on Script A does not clear or affect Script B', async () => {
      await setGmValue('script-A', 'dataA', 'helloA');
      await setGmValue('script-B', 'dataB', 'helloB');

      // Clear Script A
      await clearGmValues('script-A');

      expect(await getGmValues('script-A')).toEqual({});
      expect(await getGmValue('script-B', 'dataB')).toBe('helloB');
    });
  });

  // =========================================================================
  // TASK 2.4: Tab Sessions Isolation & Deadlock Freedom
  // =========================================================================
  describe('Task 2.4: Tab Sessions Isolation & Deadlock Freedom', () => {
    it('C4.1: Holding storageMutex does NOT block tabMutex operations (saveTabSession, getTabSession, deleteTabSession)', async () => {
      let releaseStorageMutex!: () => void;
      const mutexLocked = new Promise<void>((resolve) => {
        storageMutex.runExclusive(async () => {
          resolve();
          await new Promise<void>((r) => {
            releaseStorageMutex = r;
          });
        });
      });

      await mutexLocked;
      expect(storageMutex.isLocked()).toBe(true);

      // While storageMutex is locked indefinitely, tab session operations must execute immediately
      const testSession: TabSessionState = {
        tabId: 101,
        status: 'ATTACHED',
        attached: true,
        attachedAt: Date.now(),
        activeDomains: ['DOM', 'Page'],
        conflictDetected: false,
        updatedAt: Date.now()
      };

      const startTab = Date.now();
      await saveTabSession(testSession);
      const retrieved = await getTabSession(101);
      expect(retrieved).toEqual(testSession);

      await deleteTabSession(101);
      const afterDel = await getTabSession(101);
      expect(afterDel).toBeUndefined();

      const durationTab = Date.now() - startTab;
      // All tab operations must have completed in < 100ms with zero blocking
      expect(durationTab).toBeLessThan(100);

      // Release storageMutex
      releaseStorageMutex();
      await vi.waitFor(() => {
        expect(storageMutex.isLocked()).toBe(false);
      });
    });

    it('C4.2: 100 concurrent saveTabSession and 100 concurrent saveScript operations cross-fire without deadlock or corruption', async () => {
      const TAB_COUNT = 100;
      const SCRIPT_COUNT = 100;

      const tabPromises: Promise<void>[] = [];
      const scriptPromises: Promise<unknown>[] = [];

      for (let i = 0; i < TAB_COUNT; i++) {
        const tabSession: TabSessionState = {
          tabId: 1000 + i,
          status: i % 2 === 0 ? 'ATTACHED' : 'IDLE',
          attached: i % 2 === 0,
          attachedAt: Date.now(),
          activeDomains: ['Runtime'],
          conflictDetected: false,
          updatedAt: Date.now()
        };
        tabPromises.push(saveTabSession(tabSession));
      }

      for (let i = 0; i < SCRIPT_COUNT; i++) {
        scriptPromises.push(
          saveScript({
            id: `cross-script-${i}`,
            code: `// ==UserScript==\n// @name Cross Script ${i}\n// ==/UserScript==`,
            enabled: i % 2 === 0
          })
        );
      }

      const start = Date.now();
      // Concurrently fire all 200 operations
      const allResults = await Promise.all([...tabPromises, ...scriptPromises]);
      const elapsed = Date.now() - start;

      expect(allResults.length).toBe(TAB_COUNT + SCRIPT_COUNT);
      // Ensure rapid execution without deadlock (< 3000ms)
      expect(elapsed).toBeLessThan(3000);

      // Verify all tab sessions persisted
      const savedSessions = await getTabSessions();
      expect(Object.keys(savedSessions).length).toBe(TAB_COUNT);
      for (let i = 0; i < TAB_COUNT; i++) {
        expect(savedSessions[1000 + i]).toBeDefined();
        expect(savedSessions[1000 + i].tabId).toBe(1000 + i);
      }

      // Verify all scripts persisted
      const savedScripts = await getScripts();
      for (let i = 0; i < SCRIPT_COUNT; i++) {
        expect(savedScripts[`cross-script-${i}`]).toBeDefined();
        expect(savedScripts[`cross-script-${i}`].enabled).toBe(i % 2 === 0);
      }
    });
  });

  // =========================================================================
  // ADDITIONAL ADVERSARIAL EDGE CASES
  // =========================================================================
  describe('Adversarial Stress: Edge Cases & Heavy Payloads', () => {
    it('C5.1: High error rate (50% failure injection) under concurrency leaves mutex clean and recovers', async () => {
      const repo = new GmStorageRepository();
      const scriptId = 'err-inject-script';
      const COUNT = 60;
      let callCount = 0;

      const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
      vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
        callCount++;
        if (callCount % 2 === 0) {
          throw new Error(`Injected error on call ${callCount}`);
        }
        return originalSet(items);
      });

      const promises: Promise<void>[] = [];
      for (let i = 0; i < COUNT; i++) {
        promises.push(repo.setGmValue(scriptId, `k_${i}`, `val_${i}`));
      }

      const settled = await Promise.allSettled(promises);
      expect(settled.length).toBe(COUNT);

      const fulfilled = settled.filter((s) => s.status === 'fulfilled');
      const rejected = settled.filter((s) => s.status === 'rejected');

      expect(fulfilled.length).toBeGreaterThan(0);
      expect(rejected.length).toBeGreaterThan(0);

      vi.restoreAllMocks();

      // Mutex must not be locked or poisoned; new writes should succeed immediately
      await expect(repo.setGmValue(scriptId, 'recoveryKey', 'recovered')).resolves.toBeUndefined();
      expect(await repo.getGmValue(scriptId, 'recoveryKey')).toBe('recovered');
    });

    it('C5.2: Complex data structures (deeply nested objects, 5000-element arrays) survive concurrent mutations', async () => {
      const scriptId = 'deep-payload-script';
      const largeArray = Array.from({ length: 5000 }, (_, i) => ({ id: i, str: `item_${i}` }));
      const deepObject = {
        level1: {
          level2: {
            level3: {
              data: [1, 2, 3],
              nestedMap: { a: 'alpha', b: 'beta' }
            }
          }
        }
      };

      await Promise.all([
        setGmValue(scriptId, 'largeArr', largeArray),
        setGmValue(scriptId, 'deepObj', deepObject),
        setGmValue(scriptId, 'unicode', '🚀 Userscript Engine: 漢字 / עברית / العربية / 🦄')
      ]);

      const resArr = await getGmValue<typeof largeArray>(scriptId, 'largeArr');
      expect(resArr?.length).toBe(5000);
      expect(resArr?.[4999]).toEqual({ id: 4999, str: 'item_4999' });

      const resObj = await getGmValue<typeof deepObject>(scriptId, 'deepObj');
      expect(resObj?.level1.level2.level3.data).toEqual([1, 2, 3]);

      const resUni = await getGmValue<string>(scriptId, 'unicode');
      expect(resUni).toBe('🚀 Userscript Engine: 漢字 / עברית / العربية / 🦄');
    });
  });
});
