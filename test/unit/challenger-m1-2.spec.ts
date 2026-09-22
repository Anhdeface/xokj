import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import {
  AsyncMutex,
  storageMutex,
  getScripts,
  getScript,
  saveScript,
  deleteScript,
  toggleScript,
  importScripts,
  exportScripts,
  STORAGE_KEYS
} from '@/shared/storage';
import type { ScriptRecord } from '@/shared/types';

describe('Challenger M1-2: Deadlock & Edge-Case Stress Suite', () => {
  beforeEach(() => {
    setupChromeMock();
  });

  describe('Subsystem 1: AsyncMutex Exception Handling & Deadlock Resistance', () => {
    it('C1.1: synchronous exception thrown in task rejects caller and leaves queue unlocked', async () => {
      const mutex = new AsyncMutex();
      expect(mutex.isLocked()).toBe(false);

      const syncError = new Error('Explicit synchronous failure');
      const failingTask = mutex.runExclusive(() => {
        throw syncError;
      });

      await expect(failingTask).rejects.toThrow('Explicit synchronous failure');
      expect(mutex.isLocked()).toBe(false);

      // Verify subsequent task runs immediately without deadlock
      const nextTask = await mutex.runExclusive(() => 'success-after-sync');
      expect(nextTask).toBe('success-after-sync');
      expect(mutex.isLocked()).toBe(false);
    });

    it('C1.2: asynchronous exception thrown in task rejects caller and leaves queue unlocked', async () => {
      const mutex = new AsyncMutex();
      expect(mutex.isLocked()).toBe(false);

      const asyncError = new Error('Explicit asynchronous failure');
      const failingTask = mutex.runExclusive(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw asyncError;
      });

      await expect(failingTask).rejects.toThrow('Explicit asynchronous failure');
      expect(mutex.isLocked()).toBe(false);

      // Verify subsequent task runs immediately without deadlock
      const nextTask = await mutex.runExclusive(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return 'success-after-async';
      });
      expect(nextTask).toBe('success-after-async');
      expect(mutex.isLocked()).toBe(false);
    });

    it('C1.3: interleaved pipeline of sync throws, async throws, and successes executes strictly FIFO without deadlocking', async () => {
      const mutex = new AsyncMutex();
      const executionLog: string[] = [];
      const taskCount = 30;
      const promises: Promise<any>[] = [];

      for (let i = 0; i < taskCount; i++) {
        const type = i % 4;
        if (type === 0) {
          // Sync throw
          promises.push(
            mutex
              .runExclusive(() => {
                executionLog.push(`sync-throw-${i}`);
                throw new Error(`Sync error ${i}`);
              })
              .catch((err) => ({ error: err.message, index: i }))
          );
        } else if (type === 1) {
          // Async throw
          promises.push(
            mutex
              .runExclusive(async () => {
                await new Promise((r) => setTimeout(r, 2));
                executionLog.push(`async-throw-${i}`);
                throw new Error(`Async error ${i}`);
              })
              .catch((err) => ({ error: err.message, index: i }))
          );
        } else if (type === 2) {
          // Sync success
          promises.push(
            mutex.runExclusive(() => {
              executionLog.push(`sync-success-${i}`);
              return `val-${i}`;
            })
          );
        } else {
          // Async success
          promises.push(
            mutex.runExclusive(async () => {
              await new Promise((r) => setTimeout(r, 3));
              executionLog.push(`async-success-${i}`);
              return `val-${i}`;
            })
          );
        }
      }

      const results = await Promise.all(promises);

      // Verify all 30 tasks executed in strict FIFO order
      expect(executionLog.length).toBe(taskCount);
      for (let i = 0; i < taskCount; i++) {
        const expectedPrefix =
          i % 4 === 0
            ? `sync-throw-${i}`
            : i % 4 === 1
              ? `async-throw-${i}`
              : i % 4 === 2
                ? `sync-success-${i}`
                : `async-success-${i}`;
        expect(executionLog[i]).toBe(expectedPrefix);
      }

      // Verify error vs value results
      for (let i = 0; i < taskCount; i++) {
        if (i % 4 === 0 || i % 4 === 1) {
          expect(results[i]).toHaveProperty('error');
        } else {
          expect(results[i]).toBe(`val-${i}`);
        }
      }

      // Mutex must be completely unlocked
      expect(mutex.isLocked()).toBe(false);

      // Follow-up task succeeds cleanly
      const trailing = await mutex.runExclusive(() => 'trailing-done');
      expect(trailing).toBe('trailing-done');
    });

    it('C1.4: non-function task argument rejects gracefully and does not hang the mutex', async () => {
      const mutex = new AsyncMutex();

      await expect(mutex.runExclusive(null as any)).rejects.toThrow();
      expect(mutex.isLocked()).toBe(false);

      await expect(mutex.runExclusive(undefined as any)).rejects.toThrow();
      expect(mutex.isLocked()).toBe(false);

      const recovered = await mutex.runExclusive(() => 'recovered');
      expect(recovered).toBe('recovered');
    });

    it('C1.5: massive concurrency load (200 parallel tasks with 50% failures) preserves FIFO state and zero leaks', async () => {
      const mutex = new AsyncMutex();
      let sharedCounter = 0;
      const observedCounters: number[] = [];
      const TOTAL = 200;

      const tasks = Array.from({ length: TOTAL }, (_, i) => {
        return mutex
          .runExclusive(async () => {
            const current = sharedCounter;
            await new Promise((r) => setTimeout(r, 1));
            sharedCounter = current + 1;
            observedCounters.push(sharedCounter);
            if (i % 2 === 0) {
              throw new Error(`Even error at ${i}`);
            }
            return sharedCounter;
          })
          .catch((err) => ({ failed: true, error: err.message }));
      });

      const results = await Promise.all(tasks);
      expect(results.length).toBe(TOTAL);
      expect(sharedCounter).toBe(TOTAL);

      // All 200 increments must have been strictly sequential
      for (let i = 0; i < TOTAL; i++) {
        expect(observedCounters[i]).toBe(i + 1);
      }

      expect(mutex.isLocked()).toBe(false);
    });
  });

  describe('Subsystem 2: Batch importScripts Edge Cases', () => {
    it('C2.1: empty string and whitespace-only strings are rejected without mutating storage', async () => {
      const initialScripts = await getScripts();
      const initialCount = Object.keys(initialScripts).length;

      // 1. Empty string
      const resEmpty = await importScripts('');
      expect(resEmpty.total).toBe(0);
      expect(resEmpty.imported).toBe(0);
      expect(resEmpty.failed).toBe(0);
      expect(resEmpty.errors?.length).toBeGreaterThan(0);
      expect(resEmpty.errors![0]).toContain('Import string is empty');

      // 2. Whitespace only string
      const resWhitespace = await importScripts('    \n\t  \r\n  ');
      expect(resWhitespace.total).toBe(0);
      expect(resWhitespace.imported).toBe(0);
      expect(resWhitespace.errors?.length).toBeGreaterThan(0);
      expect(resWhitespace.errors![0]).toContain('Import string is empty');

      // Storage untouched
      const afterScripts = await getScripts();
      expect(Object.keys(afterScripts).length).toBe(initialCount);
    });

    it('C2.2: malformed JSON inputs return structured errors without throwing or deadlocking', async () => {
      const initialScripts = await getScripts();
      const initialCount = Object.keys(initialScripts).length;

      // Syntax error JSON
      const resMalformed = await importScripts('{ not valid json');
      expect(resMalformed.total).toBe(0);
      expect(resMalformed.imported).toBe(0);
      expect(resMalformed.errors?.[0]).toContain('Parse error');

      // Valid JSON but non-script types
      const resNumber = await importScripts('12345');
      expect(resNumber.total).toBe(0);
      expect(resNumber.errors?.[0]).toContain('Unrecognized JSON format');

      const resEmptyObj = await importScripts('{}');
      expect(resEmptyObj.total).toBe(0);
      expect(resEmptyObj.errors?.[0]).toContain('Unrecognized JSON format');

      const resNullJson = await importScripts('null');
      expect(resNullJson.total).toBe(0);
      expect(resNullJson.errors?.[0]).toContain('Unrecognized JSON format');

      // Direct non-string, non-array inputs
      const resNull = await importScripts(null);
      expect(resNull.total).toBe(0);
      expect(resNull.errors?.[0]).toContain('Import data must be a JSON string');

      const resUndefined = await importScripts(undefined);
      expect(resUndefined.total).toBe(0);
      expect(resUndefined.errors?.[0]).toContain('Import data must be a JSON string');

      const resBoolean = await importScripts(true as any);
      expect(resBoolean.total).toBe(0);
      expect(resBoolean.errors?.[0]).toContain('Import data must be a JSON string');

      // Storage untouched
      const afterScripts = await getScripts();
      expect(Object.keys(afterScripts).length).toBe(initialCount);
    });

    it('C2.3: array with malformed and non-script items skips bad items and imports valid items', async () => {
      const malformedBatch = [
        null,
        undefined,
        42,
        'random-string-without-header',
        {},
        { code: 12345 }, // code is not a string
        { notCode: 'missing code property' },
        {
          id: 'valid-item-in-dirty-batch',
          name: 'Clean Script In Dirty Batch',
          code: '// ==UserScript==\n// @name Clean Script In Dirty Batch\n// @match https://example.com/*\n// ==/UserScript=='
        }
      ];

      const res = await importScripts(malformedBatch as any);
      expect(res.total).toBe(8);
      expect(res.failed).toBe(7);
      expect(res.skipped).toBe(7);
      expect(res.imported).toBe(1);
      expect(res.scripts?.length).toBe(1);
      expect(res.scripts![0].id).toBe('valid-item-in-dirty-batch');
      expect(res.errors?.length).toBe(7);

      // Verify the valid script is stored
      const stored = await getScript('valid-item-in-dirty-batch');
      expect(stored).not.toBeNull();
      expect(stored?.name).toBe('Clean Script In Dirty Batch');
    });

    it('C2.4: duplicate IDs within a single batch with overwrite=false assigns distinct IDs and prevents data loss', async () => {
      const duplicateBatch = [
        {
          id: 'colliding-id',
          name: 'First Colliding Script',
          code: '// ==UserScript==\n// @name First Colliding Script\n// @match https://site-a.com/*\n// ==/UserScript=='
        },
        {
          id: 'colliding-id',
          name: 'Second Colliding Script',
          code: '// ==UserScript==\n// @name Second Colliding Script\n// @match https://site-b.com/*\n// ==/UserScript=='
        },
        {
          id: 'colliding-id',
          name: 'Third Colliding Script',
          code: '// ==UserScript==\n// @name Third Colliding Script\n// @match https://site-c.com/*\n// ==/UserScript=='
        }
      ];

      // Import with default overwrite=false
      const res = await importScripts(duplicateBatch, { overwrite: false });
      expect(res.total).toBe(3);
      expect(res.imported).toBe(3);
      expect(res.updated).toBe(0);
      expect(res.failed).toBe(0);
      expect(res.scripts?.length).toBe(3);

      const ids = res.scripts!.map((s) => s.id);
      const uniqueIds = new Set(ids);
      // All 3 scripts must have unique IDs
      expect(uniqueIds.size).toBe(3);

      // Verify all 3 scripts exist in storage
      const stored = await getScripts();
      for (const id of ids) {
        expect(stored[id]).toBeDefined();
      }

      // Check their names to ensure all 3 distinct contents were preserved
      const storedNames = ids.map((id) => stored[id].name);
      expect(storedNames).toContain('First Colliding Script');
      expect(storedNames).toContain('Second Colliding Script');
      expect(storedNames).toContain('Third Colliding Script');
    });

    it('C2.5: duplicate IDs within a single batch with overwrite=true updates existing record', async () => {
      const duplicateBatch = [
        {
          id: 'overwrite-colliding-id',
          name: 'Version 1 in Batch',
          code: '// ==UserScript==\n// @name Version 1 in Batch\n// @version 1.0.0\n// @match https://site.com/*\n// ==/UserScript=='
        },
        {
          id: 'overwrite-colliding-id',
          name: 'Version 2 in Batch',
          code: '// ==UserScript==\n// @name Version 2 in Batch\n// @version 2.0.0\n// @match https://site.com/*\n// ==/UserScript=='
        }
      ];

      const res = await importScripts(duplicateBatch, { overwrite: true });
      expect(res.total).toBe(2);
      expect(res.imported).toBe(1);
      expect(res.updated).toBe(1);
      expect(res.failed).toBe(0);

      const finalRecord = await getScript('overwrite-colliding-id');
      expect(finalRecord).not.toBeNull();
      expect(finalRecord?.name).toBe('Version 2 in Batch');
      expect(finalRecord?.metadata?.version).toBe('2.0.0');
    });

    it('C2.6: batch import collision against pre-existing storage with overwrite=false preserves original', async () => {
      await saveScript({
        id: 'pre-existing-target',
        name: 'Pre-existing Original',
        code: '// ==UserScript==\n// @name Pre-existing Original\n// @match https://original.com/*\n// ==/UserScript=='
      });

      const batch = [
        {
          id: 'pre-existing-target',
          name: 'Batch Colliding Script 1',
          code: '// ==UserScript==\n// @name Batch Colliding Script 1\n// @match https://new1.com/*\n// ==/UserScript=='
        },
        {
          id: 'pre-existing-target',
          name: 'Batch Colliding Script 2',
          code: '// ==UserScript==\n// @name Batch Colliding Script 2\n// @match https://new2.com/*\n// ==/UserScript=='
        }
      ];

      const res = await importScripts(batch, { overwrite: false });
      expect(res.imported).toBe(2);
      expect(res.updated).toBe(0);

      const stored = await getScripts();
      // Original script MUST be intact
      expect(stored['pre-existing-target'].name).toBe('Pre-existing Original');

      // Two newly generated scripts exist
      const generatedIds = res.scripts!.map((s) => s.id);
      expect(generatedIds).not.toContain('pre-existing-target');
      expect(stored[generatedIds[0]].name).toBe('Batch Colliding Script 1');
      expect(stored[generatedIds[1]].name).toBe('Batch Colliding Script 2');
    });

    it('C2.7: large array batch import (200 scripts) processes with O(1) storage write and rapid turnaround', async () => {
      const COUNT = 200;
      const largeBatch = Array.from({ length: COUNT }, (_, i) => ({
        id: `large-batch-${i}`,
        name: `Large Batch Script ${i}`,
        code: `// ==UserScript==\n// @name Large Batch Script ${i}\n// @version 1.0.${i}\n// @match https://site${i}.example.com/*\n// ==/UserScript==`
      }));

      // Pre-initialize storage so clean-install seeding is not counted in the batch spy
      await getScripts();

      // Spy on chrome.storage.local.set to verify write batching
      const setSpy = vi.spyOn(chrome.storage.local, 'set');
      const startTime = performance.now();

      const res = await importScripts(largeBatch, { overwrite: true });

      const durationMs = performance.now() - startTime;

      expect(res.total).toBe(COUNT);
      expect(res.imported).toBe(COUNT);
      expect(res.failed).toBe(0);
      expect(res.scripts?.length).toBe(COUNT);

      // Exactly 1 storage write occurred despite 200 scripts
      expect(setSpy).toHaveBeenCalledTimes(1);

      // Must complete well within 500ms
      expect(durationMs).toBeLessThan(500);

      // Verify all 200 exist in storage
      const stored = await getScripts();
      for (let i = 0; i < COUNT; i++) {
        expect(stored[`large-batch-${i}`]).toBeDefined();
        expect(stored[`large-batch-${i}`].name).toBe(`Large Batch Script ${i}`);
      }

      setSpy.mockRestore();
    });

    it('C2.8: storage write failure inside importScripts propagates error and leaves storageMutex unlocked', async () => {
      // Mock chrome.storage.local.set to throw (simulating quota exhaustion)
      const setSpy = vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('QUOTA_BYTES exceeded'));

      const batch = [
        {
          code: '// ==UserScript==\n// @name Quota Test\n// @match https://example.com/*\n// ==/UserScript=='
        }
      ];

      await expect(importScripts(batch)).rejects.toThrow('QUOTA_BYTES exceeded');

      // storageMutex must NOT be deadlocked
      expect(storageMutex.isLocked()).toBe(false);

      setSpy.mockRestore();

      // Subsequent operation must succeed immediately
      const saved = await saveScript({
        id: 'post-quota-script',
        code: '// ==UserScript==\n// @name Post Quota\n// @match https://example.com/*\n// ==/UserScript=='
      });
      expect(saved.id).toBe('post-quota-script');
    });

    it('C2.9: UUID collision during ID generation inside batch import is resolved by while loop', async () => {
      await getScripts();

      let callCount = 0;
      const uuidSpy = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
        callCount++;
        // Force the first two calls to return the exact same UUID
        if (callCount <= 2) {
          return 'colliding-uuid-1234' as `${string}-${string}-${string}-${string}-${string}`;
        }
        return `unique-uuid-${callCount}` as `${string}-${string}-${string}-${string}-${string}`;
      });

      const batchWithoutIds = [
        {
          name: 'Script Without ID 1',
          code: '// ==UserScript==\n// @name Script Without ID 1\n// ==/UserScript=='
        },
        {
          name: 'Script Without ID 2',
          code: '// ==UserScript==\n// @name Script Without ID 2\n// ==/UserScript=='
        }
      ];

      const res = await importScripts(batchWithoutIds);
      expect(res.imported).toBe(2);
      expect(res.scripts?.length).toBe(2);

      const id1 = res.scripts![0].id;
      const id2 = res.scripts![1].id;
      expect(id1).not.toBe(id2);
      expect(id1).toBe('colliding-uuid-1234');
      expect(id2).toBe('unique-uuid-3');

      uuidSpy.mockRestore();
    });

    it('C2.10: raw userscript string with leading whitespace and comment banners parses and imports cleanly', async () => {
      await getScripts();

      const rawScript = `
        
        // ==UserScript==
        // @name Indented Raw Script
        // @version 3.1.4
        // @match https://indented.example.com/*
        // ==/UserScript==
        console.log("hello indented");
      `;

      const res = await importScripts(rawScript);
      expect(res.total).toBe(1);
      expect(res.imported).toBe(1);
      expect(res.errors?.length).toBe(0);

      const importedScript = res.scripts![0];
      expect(importedScript.name).toBe('Indented Raw Script');
      expect(importedScript.metadata?.version).toBe('3.1.4');
    });

    it('C2.11: high-contention mixed operations (importScripts, saveScript, deleteScript, saveSettings) race without corruption', async () => {
      await getScripts();

      const operations = [
        importScripts([
          { id: 'mixed-1', code: '// ==UserScript==\n// @name Mixed 1\n// ==/UserScript==' },
          { id: 'mixed-2', code: '// ==UserScript==\n// @name Mixed 2\n// ==/UserScript==' }
        ]),
        saveScript({
          id: 'mixed-3',
          code: '// ==UserScript==\n// @name Mixed 3\n// ==/UserScript=='
        }),
        deleteScript('sample-cdp-logger'),
        importScripts([
          { id: 'mixed-4', code: '// ==UserScript==\n// @name Mixed 4\n// ==/UserScript==' }
        ]),
        saveScript({
          id: 'mixed-5',
          code: '// ==UserScript==\n// @name Mixed 5\n// ==/UserScript=='
        })
      ];

      const results = await Promise.all(operations);
      expect(results.length).toBe(5);

      const all = await getScripts();
      expect(all['mixed-1']).toBeDefined();
      expect(all['mixed-2']).toBeDefined();
      expect(all['mixed-3']).toBeDefined();
      expect(all['mixed-4']).toBeDefined();
      expect(all['mixed-5']).toBeDefined();
      expect(all['sample-cdp-logger']).toBeUndefined();
    });
  });
});
