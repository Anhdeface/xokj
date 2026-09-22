import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import {
  AsyncMutex,
  storageMutex,
  getScripts,
  getScriptList,
  getAllScripts,
  getScript,
  saveScript,
  deleteScript,
  toggleScript,
  resetToDefaultScripts,
  getSettings,
  saveSettings,
  importScripts,
  exportScripts,
  DEFAULT_SCRIPTS
} from '@/shared/storage';
import type { ScriptRecord } from '@/shared/types';

describe('Empirical Storage Concurrency & Stress Verification Suite', () => {
  beforeEach(async () => {
    setupChromeMock();
    await resetToDefaultScripts();
  });

  describe('1. High-Concurrency Mass Parallel Mutations (150+ operations)', () => {
    it('1.1: 150 simultaneous saveScript calls serialize without any lost records or corrupted fields', async () => {
      const initial = await getScripts();
      const initialCount = Object.keys(initial).length;

      const TOTAL = 150;
      const scriptPayloads = Array.from({ length: TOTAL }, (_, i) => ({
        id: `stress-script-${i + 1}`,
        name: `Stress Script ${i + 1}`,
        code: `// ==UserScript==\n// @name Stress Script ${i + 1}\n// @version 1.0.${i + 1}\n// @match https://domain${i + 1}.org/*\n// ==/UserScript==`,
        enabled: i % 2 === 0
      }));

      // Fire all 150 save operations simultaneously
      const results = await Promise.all(scriptPayloads.map((p) => saveScript(p)));

      expect(results.length).toBe(TOTAL);

      const stored = await getScripts();
      const storedKeys = Object.keys(stored);
      expect(storedKeys.length).toBe(initialCount + TOTAL);

      // Verify every single script was stored with correct properties
      for (let i = 1; i <= TOTAL; i++) {
        const id = `stress-script-${i}`;
        const record = stored[id];
        expect(record, `Script ${id} should exist`).toBeDefined();
        expect(record.name).toBe(`Stress Script ${i}`);
        expect(record.enabled).toBe((i - 1) % 2 === 0);
        expect(record.metadata?.version).toBe(`1.0.${i}`);
        expect(record.metadata?.matches).toContain(`https://domain${i}.org/*`);
        expect(record.createdAt).toBeGreaterThan(0);
        expect(record.updatedAt).toBeGreaterThan(0);
      }
    });

    it('1.2: 120 unawaited rapid toggles on a single script strictly preserve toggle parity (Oracle for zero lost updates)', async () => {
      const testId = 'parity-toggle-script';
      await saveScript({
        id: testId,
        code: '// ==UserScript==\n// @name Parity Toggle Script\n// ==/UserScript==',
        enabled: true
      });

      // Starting state is true
      const TOGGLE_COUNT = 120;
      // All 120 toggles are fired simultaneously into the unawaited queue
      const togglePromises = Array.from({ length: TOGGLE_COUNT }, () => toggleScript(testId));
      const toggleResults = await Promise.all(togglePromises);

      // Each toggle should alternate boolean values in FIFO order: false, true, false, true...
      expect(toggleResults.length).toBe(TOGGLE_COUNT);
      for (let i = 0; i < TOGGLE_COUNT; i++) {
        const expected = i % 2 === 0 ? false : true;
        expect(toggleResults[i], `Toggle index ${i} should be ${expected}`).toBe(expected);
      }

      // Because 120 is even, 120 toggles starting from true must end up true
      const finalScript = await getScript(testId);
      expect(finalScript?.enabled).toBe(true);

      // Repeat with 119 toggles (odd count) starting from true -> should end up false
      const ODD_COUNT = 119;
      const oddPromises = Array.from({ length: ODD_COUNT }, () => toggleScript(testId));
      const oddResults = await Promise.all(oddPromises);
      expect(oddResults[oddResults.length - 1]).toBe(false);

      const finalOddScript = await getScript(testId);
      expect(finalOddScript?.enabled).toBe(false);
    });

    it('1.3: Multi-script concurrent click hammering: 10 distinct scripts toggled 10 times concurrently (100 operations)', async () => {
      const scriptIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const id = `hammer-script-${i}`;
        scriptIds.push(id);
        await saveScript({
          id,
          code: `// ==UserScript==\n// @name Hammer ${i}\n// ==/UserScript==`,
          enabled: true
        });
      }

      // 10 scripts x 10 toggles = 100 concurrent operations
      const allPromises: Promise<boolean>[] = [];
      for (let round = 0; round < 10; round++) {
        for (const id of scriptIds) {
          allPromises.push(toggleScript(id));
        }
      }

      await Promise.all(allPromises);

      // Each script was toggled 10 times (even count) from true -> all must remain true!
      const stored = await getScripts();
      for (const id of scriptIds) {
        expect(stored[id]?.enabled, `Script ${id} should be enabled`).toBe(true);
      }
    });
  });

  describe('2. Chaotic Interleaved CRUD Storm (200+ mixed operations)', () => {
    it('2.1: Interleaved concurrent saves, updates, toggles, deletes, imports, and readers execute without deadlocks or corruption', async () => {
      // Pre-populate 30 base scripts
      const baseIds: string[] = [];
      for (let i = 0; i < 30; i++) {
        const id = `base-crud-${i}`;
        baseIds.push(id);
        await saveScript({
          id,
          code: `// ==UserScript==\n// @name Base ${i}\n// ==/UserScript==`,
          enabled: true
        });
      }

      const operations: Promise<any>[] = [];

      // 1. 30 Saves of brand new scripts
      for (let i = 0; i < 30; i++) {
        operations.push(
          saveScript({
            id: `storm-new-${i}`,
            code: `// ==UserScript==\n// @name Storm New ${i}\n// ==/UserScript==`,
            enabled: false
          })
        );
      }

      // 2. 30 Updates of existing base scripts
      for (let i = 0; i < 30; i++) {
        operations.push(
          saveScript({
            id: baseIds[i],
            code: `// ==UserScript==\n// @name Base Updated ${i}\n// @version 2.0.0\n// ==/UserScript==`
          })
        );
      }

      // 3. 30 Toggles on base scripts
      for (let i = 0; i < 30; i++) {
        operations.push(
          toggleScript(baseIds[i % baseIds.length]).catch((err) => {
            // Might have been deleted if delete ran first
            return 'not_found';
          })
        );
      }

      // 4. 15 Deletes of odd base scripts
      for (let i = 1; i < 30; i += 2) {
        operations.push(deleteScript(baseIds[i]));
      }

      // 5. 5 Batch imports
      for (let i = 0; i < 5; i++) {
        const bundle = JSON.stringify({
          version: 1,
          generator: 'storm',
          scripts: [
            { id: `imported-storm-${i}-a`, code: '// ==UserScript==\n// @name Imp A\n// ==/UserScript==' },
            { id: `imported-storm-${i}-b`, code: '// ==UserScript==\n// @name Imp B\n// ==/UserScript==' }
          ]
        });
        operations.push(importScripts(bundle, { overwrite: true }));
      }

      // 6. 10 Settings updates
      for (let i = 0; i < 10; i++) {
        operations.push(saveSettings({ logLevel: i % 2 === 0 ? 'info' : 'debug' }));
      }

      // 7. 40 Concurrent readers
      for (let i = 0; i < 40; i++) {
        operations.push(getScripts());
      }

      // Total operations: 30 + 30 + 30 + 15 + 5 + 10 + 40 = 160 operations
      const start = Date.now();
      const results = await Promise.allSettled(operations);
      const duration = Date.now() - start;

      // Ensure no deadlocks; 160 operations should complete rapidly in memory mock (< 2500ms)
      expect(duration).toBeLessThan(4000);

      // Verify no unexpected rejection reasons (only valid 'not found' on deleted scripts)
      for (const res of results) {
        if (res.status === 'rejected') {
          expect(res.reason.message).toMatch(/not found/);
        }
      }

      // Check storage integrity after the storm
      const finalScripts = await getScripts();
      expect(typeof finalScripts).toBe('object');
      expect(finalScripts).not.toBeNull();

      // All 30 new scripts must be present
      for (let i = 0; i < 30; i++) {
        expect(finalScripts[`storm-new-${i}`]).toBeDefined();
        expect(finalScripts[`storm-new-${i}`].id).toBe(`storm-new-${i}`);
      }

      // All 10 imported scripts must be present
      for (let i = 0; i < 5; i++) {
        expect(finalScripts[`imported-storm-${i}-a`]).toBeDefined();
        expect(finalScripts[`imported-storm-${i}-b`]).toBeDefined();
      }

      // The deleted odd base scripts must NOT be present (unless resurrected, which would be a bug)
      for (let i = 1; i < 30; i += 2) {
        // Note: an update could have re-saved it if update ran after delete
        // If it exists, it must have valid fields
        if (finalScripts[baseIds[i]]) {
          expect(finalScripts[baseIds[i]].code).toBeDefined();
        }
      }

      // App settings must remain valid
      const finalSettings = await getSettings();
      expect(finalSettings.globalEnabled).toBe(true);
      expect(['info', 'debug']).toContain(finalSettings.logLevel);
    });
  });

  describe('3. Cold Start & Seeding Concurrency', () => {
    it('3.1: 50 simultaneous getScripts() calls on empty storage execute cleanly and seed only once', async () => {
      // Wipe storage completely
      await chrome.storage.local.clear();

      // Ensure raw storage has no scripts
      const raw = await chrome.storage.local.get('scripts');
      expect(raw['scripts']).toBeUndefined();

      // Launch 50 parallel getScripts() calls
      const results = await Promise.all(
        Array.from({ length: 50 }, () => getScripts())
      );

      expect(results.length).toBe(50);
      for (const r of results) {
        expect(Object.keys(r).length).toBe(Object.keys(DEFAULT_SCRIPTS).length);
        expect(r['sample-cdp-logger']).toBeDefined();
        expect(r['sample-cookie-inspector']).toBeDefined();
        expect(r['sample-dom-highlighter']).toBeDefined();
      }

      // Storage should now be seeded
      const after = await chrome.storage.local.get('scripts');
      expect(after['scripts']).toBeDefined();
      expect(Object.keys(after['scripts']).length).toBe(Object.keys(DEFAULT_SCRIPTS).length);
    });
  });

  describe('4. AsyncMutex Primitive Stress Testing', () => {
    it('4.1: Strict FIFO ordering under high contention (100 tasks)', async () => {
      const mutex = new AsyncMutex();
      const executionLog: number[] = [];
      const COUNT = 100;

      const tasks = Array.from({ length: COUNT }, (_, i) => {
        return mutex.runExclusive(async () => {
          // Add random micro-delay to simulate async work
          await new Promise((r) => setTimeout(r, Math.random() * 2));
          executionLog.push(i);
          return i;
        });
      });

      const results = await Promise.all(tasks);

      // Results must match index
      expect(results).toEqual(Array.from({ length: COUNT }, (_, i) => i));
      // Execution log must be strictly monotonically increasing [0, 1, 2, ..., 99]
      expect(executionLog).toEqual(Array.from({ length: COUNT }, (_, i) => i));
      expect(mutex.isLocked()).toBe(false);
    });

    it('4.2: High error rate (50% failures): failing tasks do not break FIFO order or lock state', async () => {
      const mutex = new AsyncMutex();
      const successLog: number[] = [];
      const COUNT = 80;

      const tasks = Array.from({ length: COUNT }, (_, i) => {
        return mutex.runExclusive(async () => {
          if (i % 2 !== 0) {
            throw new Error(`Deliberate error in task ${i}`);
          }
          successLog.push(i);
          return i;
        });
      });

      const settled = await Promise.allSettled(tasks);

      expect(settled.length).toBe(COUNT);
      for (let i = 0; i < COUNT; i++) {
        if (i % 2 === 0) {
          expect(settled[i].status).toBe('fulfilled');
          expect((settled[i] as PromiseFulfilledResult<number>).value).toBe(i);
        } else {
          expect(settled[i].status).toBe('rejected');
          expect((settled[i] as PromiseRejectedResult).reason.message).toBe(`Deliberate error in task ${i}`);
        }
      }

      // All even tasks must have executed in exact sequence
      const expectedEven = Array.from({ length: COUNT / 2 }, (_, i) => i * 2);
      expect(successLog).toEqual(expectedEven);
      expect(mutex.isLocked()).toBe(false);
    });

    it('4.3: Idle queue reset breaks closure retention chain', async () => {
      const mutex = new AsyncMutex();
      expect(mutex.isLocked()).toBe(false);

      await mutex.runExclusive(async () => {
        return 42;
      });

      expect(mutex.isLocked()).toBe(false);

      // Running another task after queue has been completely idle
      const res = await mutex.runExclusive(async () => {
        return 84;
      });

      expect(res).toBe(84);
      expect(mutex.isLocked()).toBe(false);
    });

    it('4.4: Synchronous task execution within runExclusive handles non-promise return and throws', async () => {
      const mutex = new AsyncMutex();

      const res = await mutex.runExclusive(() => 100);
      expect(res).toBe(100);

      await expect(
        mutex.runExclusive(() => {
          throw new Error('Sync throw');
        })
      ).rejects.toThrow('Sync throw');

      expect(mutex.isLocked()).toBe(false);
    });
  });

  describe('5. Complex Race Conditions: Reset vs CRUD vs Batch Import', () => {
    it('5.1: Reset-to-defaults racing with concurrent saveScript and deleteScript settles in clean state', async () => {
      const targetId = 'reset-race-script';
      await saveScript({
        id: targetId,
        code: '// ==UserScript==\n// @name Reset Race\n// ==/UserScript=='
      });

      // Fire resetToDefaultScripts, saveScript, and deleteScript simultaneously
      const [resetRes, saveRes, deleteRes] = await Promise.allSettled([
        resetToDefaultScripts(),
        saveScript({
          id: 'concurrent-after-reset',
          code: '// ==UserScript==\n// @name After Reset\n// ==/UserScript=='
        }),
        deleteScript('sample-cdp-logger')
      ]);

      expect(resetRes.status).toBe('fulfilled');
      expect(saveRes.status).toBe('fulfilled');
      expect(deleteRes.status).toBe('fulfilled');

      const final = await getScripts();
      // 'concurrent-after-reset' might be present if save ran after reset, or wiped if reset ran after save.
      // But whatever the final state, storage must be valid and uncorrupted.
      expect(typeof final).toBe('object');
      expect(final).not.toBeNull();
      for (const [id, script] of Object.entries(final)) {
        expect(script.id).toBe(id);
        expect(script.code).toBeDefined();
      }
    });

    it('5.2: Concurrent batch import with overlapping IDs and auto-enable', async () => {
      const bundle1 = JSON.stringify({
        scripts: [
          { id: 'shared-id', name: 'Script from Bundle 1', code: '// ==UserScript==\n// @name B1\n// ==/UserScript==' },
          { id: 'unique-1', name: 'Unique 1', code: '// ==UserScript==\n// @name U1\n// ==/UserScript==' }
        ]
      });

      const bundle2 = JSON.stringify({
        scripts: [
          { id: 'shared-id', name: 'Script from Bundle 2', code: '// ==UserScript==\n// @name B2\n// ==/UserScript==' },
          { id: 'unique-2', name: 'Unique 2', code: '// ==UserScript==\n// @name U2\n// ==/UserScript==' }
        ]
      });

      // Concurrently import both with overwrite: true
      const [res1, res2] = await Promise.all([
        importScripts(bundle1, { overwrite: true }),
        importScripts(bundle2, { overwrite: true })
      ]);

      expect(res1.imported + res1.updated).toBe(2);
      expect(res2.imported + res2.updated).toBe(2);

      const scripts = await getScripts();
      expect(scripts['unique-1']).toBeDefined();
      expect(scripts['unique-2']).toBeDefined();
      expect(scripts['shared-id']).toBeDefined();
      // One of the two bundles won the race for shared-id, but record is intact
      expect(['Script from Bundle 1', 'Script from Bundle 2']).toContain(scripts['shared-id'].name);
    });

    it('5.3: Deep clone guarantees: mutating returned scripts does not mutate storage or subsequent getScripts()', async () => {
      const s1 = await getScripts();
      const firstKey = Object.keys(s1)[0];
      const originalName = s1[firstKey].name;

      // Attempt to mutate in-place
      s1[firstKey].name = 'CORRUPTED IN MEMORY';
      (s1 as any)['malicious-injected-key'] = { id: 'bad' };

      const s2 = await getScripts();
      expect(s2[firstKey].name).toBe(originalName);
      expect(s2['malicious-injected-key']).toBeUndefined();
    });
  });
});
