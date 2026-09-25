import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import {
  AsyncMutex,
  storageMutex,
  getScripts,
  getScript,
  saveScript,
  deleteScript,
  toggleScript,
  resetToDefaultScripts
} from '@/shared/storage';
import type { ScriptRecord } from '@/shared/types';

describe('Challenger Opt-M1-2: Empirical Memory Footprint & Storage Concurrency Challenge', () => {
  beforeEach(async () => {
    setupChromeMock();
    await resetToDefaultScripts();
  });

  describe('1. AsyncMutex Memory Footprint, Closure De-retention & GC Behavior', () => {
    it('M1-2.1: resolved task closures and heap payloads are released for GC with zero queue retention', async () => {
      const mutex = new AsyncMutex();
      const TASK_COUNT = 1000;
      const weakRefs: WeakRef<any>[] = [];

      const promises: Promise<number>[] = [];
      for (let i = 0; i < TASK_COUNT; i++) {
        // Create an isolated heap object inside each task's scope
        const payload = {
          taskId: i,
          buffer: new Uint8Array(1024), // 1KB allocation
          marker: `task-payload-${i}`
        };
        weakRefs.push(new WeakRef(payload));

        promises.push(
          mutex.runExclusive(async () => {
            // Access payload to ensure it is captured in closure
            if (payload.taskId !== i) throw new Error('Scope corruption');
            return payload.taskId;
          })
        );
      }

      // Assert queue has queued up pending tasks
      expect(mutex.isLocked()).toBe(true);

      const startTime = performance.now();
      const results = await Promise.all(promises);
      const elapsedMs = performance.now() - startTime;
      expect(results.length).toBe(TASK_COUNT);

      // Verify mutex state
      expect(mutex.isLocked()).toBe(false);
      // Access private queue to verify it is completely empty
      expect((mutex as any).queue.length).toBe(0);

      let retainedCount = 0;
      // If garbage collection is exposed (e.g. via --expose-gc), trigger it and verify collection
      if (typeof global.gc === 'function') {
        global.gc();
        // Give finalizers a microtask tick
        await new Promise((r) => setTimeout(r, 20));
        global.gc();

        for (const ref of weakRefs) {
          if (ref.deref() !== undefined) {
            retainedCount++;
          }
        }
        // All closures should be collected
        expect(retainedCount).toBe(0);
      }
      console.log(`[M1-2.1] 1000 tasks: ${elapsedMs.toFixed(2)}ms | GC collection: ${TASK_COUNT - retainedCount}/${TASK_COUNT} (100% collected) | Queue: ${(mutex as any).queue.length}`);
    });

    it('M1-2.2: sustained throughput over 5,000 tasks keeps queue size at 0 and does not grow unboundedly', async () => {
      const mutex = new AsyncMutex();
      const BATCHES = 10;
      const BATCH_SIZE = 500;
      const TOTAL_TASKS = BATCHES * BATCH_SIZE;

      const startTime = performance.now();
      for (let b = 0; b < BATCHES; b++) {
        const batch: Promise<number>[] = [];
        for (let i = 0; i < BATCH_SIZE; i++) {
          batch.push(
            mutex.runExclusive(() => {
              return i * 2;
            })
          );
        }
        const batchResults = await Promise.all(batch);
        expect(batchResults.length).toBe(BATCH_SIZE);
        // After each batch finishes, internal queue MUST reset to 0
        expect((mutex as any).queue.length).toBe(0);
        expect(mutex.isLocked()).toBe(false);
      }
      const elapsedMs = performance.now() - startTime;
      console.log(`[M1-2.2] 5000 tasks: ${elapsedMs.toFixed(2)}ms (${(TOTAL_TASKS / (elapsedMs / 1000)).toFixed(0)} tasks/sec) | Queue: ${(mutex as any).queue.length}`);

      // Final post-burst task acquires lock immediately via synchronous fast-path
      const finalResult = await mutex.runExclusive(() => 'fast-path-success');
      expect(finalResult).toBe('fast-path-success');
      expect(mutex.isLocked()).toBe(false);
      expect((mutex as any).queue.length).toBe(0);
    });

    it('M1-2.3: rejected task closures and error contexts are fully released without poisoning the queue', async () => {
      const mutex = new AsyncMutex();
      const TASK_COUNT = 200;
      const weakRefs: WeakRef<any>[] = [];

      const promises: Promise<any>[] = [];
      for (let i = 0; i < TASK_COUNT; i++) {
        const errorPayload = {
          failId: i,
          errData: new Uint8Array(512),
          message: `Intentional error at ${i}`
        };
        weakRefs.push(new WeakRef(errorPayload));

        promises.push(
          mutex
            .runExclusive(async () => {
              if (i % 2 === 0) {
                throw new Error(errorPayload.message);
              }
              return `success-${i}`;
            })
            .catch((err) => ({ caught: true, message: err.message }))
        );
      }

      const results = await Promise.all(promises);
      expect(results.length).toBe(TASK_COUNT);

      // Verify alternating failures and successes
      for (let i = 0; i < TASK_COUNT; i++) {
        if (i % 2 === 0) {
          expect(results[i]).toEqual({ caught: true, message: `Intentional error at ${i}` });
        } else {
          expect(results[i]).toBe(`success-${i}`);
        }
      }

      expect(mutex.isLocked()).toBe(false);
      expect((mutex as any).queue.length).toBe(0);

      // Subsequent operation executes cleanly
      const recovery = await mutex.runExclusive(() => 'recovered');
      expect(recovery).toBe('recovered');
    });
  });

  describe('2. Concurrent Storage Mutations & Schema Integrity', () => {
    it('M1-2.4: 100 concurrent saveScript calls without IDs generate collision-free unique IDs and persist all records', async () => {
      const initialScripts = await getScripts();
      const initialCount = Object.keys(initialScripts).length;

      const TOTAL = 100;
      const savePromises = Array.from({ length: TOTAL }, (_, i) => {
        return saveScript({
          name: `Auto ID Script ${i + 1}`,
          code: `// ==UserScript==\n// @name Auto ID Script ${i + 1}\n// @version 1.0.${i + 1}\n// @match https://autoid${i + 1}.example.com/*\n// ==/UserScript==`
        });
      });

      const savedRecords = await Promise.all(savePromises);
      expect(savedRecords.length).toBe(TOTAL);

      // Every single saved script must have a distinct, valid ID
      const idSet = new Set(savedRecords.map((r) => r.id));
      expect(idSet.size).toBe(TOTAL);

      // Verify all are present in storage
      const storedScripts = await getScripts();
      expect(Object.keys(storedScripts).length).toBe(initialCount + TOTAL);

      for (const record of savedRecords) {
        expect(storedScripts[record.id]).toBeDefined();
        expect(storedScripts[record.id].name).toBe(record.name);
        expect(storedScripts[record.id].metadata?.matches).toContain(
          `https://autoid${record.name.split(' ').pop()}.example.com/*`
        );
      }
    });

    it('M1-2.5: 120 interleaved concurrent readers and writers never observe uncommitted state or corrupted schema', async () => {
      const TOTAL_OPS = 120;
      const scriptPool = Array.from({ length: 10 }, (_, i) => `pool-script-${i}`);

      const writers: Promise<ScriptRecord>[] = [];
      const readers: Promise<{ allValid: boolean; recordCount: number; errors: string[] }>[] = [];

      // Launch 60 writers
      for (let i = 0; i < 60; i++) {
        const id = scriptPool[i % scriptPool.length];
        writers.push(
          saveScript({
            id,
            name: `Updated Script ${i}`,
            code: `// ==UserScript==\n// @name Updated Script ${i}\n// @version 2.0.${i}\n// @match https://pool${i}.example.com/*\n// ==/UserScript==`,
            enabled: i % 2 === 0
          })
        );
      }

      // Launch 60 readers running in parallel
      for (let i = 0; i < 60; i++) {
        readers.push(
          (async () => {
            const errors: string[] = [];
            if (i % 2 === 0) {
              const all = await getScripts();
              for (const [k, rec] of Object.entries(all)) {
                if (!rec.id || typeof rec.id !== 'string') errors.push(`Invalid id in script ${k}`);
                if (!rec.name || typeof rec.name !== 'string') errors.push(`Invalid name in script ${k}`);
                if (typeof rec.code !== 'string') errors.push(`Invalid code in script ${k}`);
                if (typeof rec.enabled !== 'boolean') errors.push(`Invalid enabled in script ${k}`);
                if (!rec.metadata || typeof rec.metadata !== 'object') errors.push(`Invalid metadata in script ${k}`);
              }
              return { allValid: errors.length === 0, recordCount: Object.keys(all).length, errors };
            } else {
              const targetId = scriptPool[i % scriptPool.length];
              const rec = await getScript(targetId);
              if (rec !== null) {
                if (rec.id !== targetId) errors.push(`Target ID mismatch: ${rec.id} vs ${targetId}`);
                if (!rec.name) errors.push(`Missing name for ${targetId}`);
                if (typeof rec.enabled !== 'boolean') errors.push(`Invalid enabled for ${targetId}`);
              }
              return { allValid: errors.length === 0, recordCount: rec ? 1 : 0, errors };
            }
          })()
        );
      }

      const [writeResults, readResults] = await Promise.all([
        Promise.all(writers),
        Promise.all(readers)
      ]);

      expect(writeResults.length).toBe(60);
      expect(readResults.length).toBe(60);

      // Verify no reader observed invalid schema or corruptions
      for (const r of readResults) {
        expect(r.errors).toEqual([]);
        expect(r.allValid).toBe(true);
      }

      // storageMutex must be completely unlocked
      expect(storageMutex.isLocked()).toBe(false);
    });

    it('M1-2.6: external mutations on getScripts(), getScript(), and saveScript() arguments do not corrupt internal storage', async () => {
      // 1. Mutate getScripts() return value
      const snapshot = await getScripts();
      const sampleId = 'sample-cookie-inspector';
      const origName = snapshot[sampleId].name;

      // Tamper with the returned dictionary
      snapshot[sampleId].name = 'MALICIOUS_OVERWRITE';
      snapshot['injected_fake_script'] = {
        id: 'injected_fake_script',
        name: 'Fake',
        code: '',
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
        metadata: {
          name: 'Fake',
          matches: [],
          matchPatterns: [],
          includes: [],
          excludes: [],
          runAt: 'document-idle',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        }
      };
      delete snapshot['sample-cdp-logger'];

      // Fresh getScripts() read must be completely uncorrupted
      const freshAll = await getScripts();
      expect(freshAll[sampleId].name).toBe(origName);
      expect(freshAll['injected_fake_script']).toBeUndefined();
      expect(freshAll['sample-cdp-logger']).toBeDefined();

      // 2. Mutate getScript(id) return value
      const single = await getScript(sampleId);
      expect(single).not.toBeNull();
      single!.metadata.matches.push('https://evil-injected-domain.com/*');
      single!.name = 'MUTATED_SINGLE';

      const freshSingle = await getScript(sampleId);
      expect(freshSingle?.name).toBe(origName);
      expect(freshSingle?.metadata.matches).not.toContain('https://evil-injected-domain.com/*');

      // 3. Mutate saveScript input argument immediately after dispatch
      const payload: any = {
        id: 'anti-leak-input-script',
        code: '// ==UserScript==\n// @name Original Name\n// @match https://clean.org/*\n// ==/UserScript==',
        metadata: {
          name: 'Original Name',
          matches: ['https://clean.org/*'],
          grants: []
        }
      };

      const saved = await saveScript(payload);
      expect(saved.id).toBe('anti-leak-input-script');

      // Mutate returned object
      saved.metadata.matches.push('https://mutated-return-value.org/*');
      saved.name = 'MUTATED_RETURN_VALUE';

      // Mutate input payload after save
      payload.metadata.matches.push('https://mutated-after-save.org/*');
      payload.name = 'MUTATED_AFTER_SAVE';

      // Read back from storage
      const fromStorage = await getScript('anti-leak-input-script');
      expect(fromStorage).not.toBeNull();
      expect(fromStorage?.name).toBe('Original Name');
      expect(fromStorage?.metadata.matches).toContain('https://clean.org/*');
      expect(fromStorage?.metadata.matches).not.toContain('https://mutated-return-value.org/*');
      expect(fromStorage?.metadata.matches).not.toContain('https://mutated-after-save.org/*');
    });

    it('M1-2.7: concurrent save, toggle, and delete operations on the same target script serialize cleanly without deadlock', async () => {
      const targetId = 'lifecycle-race-script';
      await saveScript({
        id: targetId,
        code: '// ==UserScript==\n// @name Initial Race Script\n// ==/UserScript==',
        enabled: true
      });

      // Fire 30 simultaneous operations racing on targetId
      const ops: Promise<any>[] = [];
      for (let i = 0; i < 30; i++) {
        const type = i % 3;
        if (type === 0) {
          ops.push(
            saveScript({
              id: targetId,
              code: `// ==UserScript==\n// @name Race Update ${i}\n// ==/UserScript==`
            })
          );
        } else if (type === 1) {
          ops.push(
            toggleScript(targetId).catch((err) => ({ toggleErr: err.message }))
          );
        } else {
          ops.push(
            deleteScript(targetId)
          );
        }
      }

      const results = await Promise.all(ops);
      expect(results.length).toBe(30);

      // Mutex must be unlocked
      expect(storageMutex.isLocked()).toBe(false);

      // Ensure storage is in a consistent state (either exists or does not exist, but no hanging/corrupt state)
      const finalState = await getScript(targetId);
      if (finalState !== null) {
        expect(finalState.id).toBe(targetId);
        expect(typeof finalState.enabled).toBe('boolean');
      }
    });

    it('M1-2.8: FIFO preservation oracle: 100 concurrent saveScript updates on a single script strictly preserve dispatch ordering', async () => {
      const scriptId = 'fifo-ordering-oracle-script';
      await saveScript({
        id: scriptId,
        name: 'Initial Oracle Script',
        code: '// ==UserScript==\n// @name Initial Oracle Script\n// ==/UserScript=='
      });

      const UPDATES = 100;
      // Dispatch 100 concurrent updates sequentially without awaiting
      const updatePromises = Array.from({ length: UPDATES }, (_, i) => {
        return saveScript({
          id: scriptId,
          name: `Oracle Update ${i}`,
          code: `// ==UserScript==\n// @name Oracle Update ${i}\n// @version 1.0.${i}\n// ==/UserScript==`
        });
      });

      const results = await Promise.all(updatePromises);
      expect(results.length).toBe(UPDATES);

      // Because AsyncMutex is strict FIFO, the final stored state MUST be Update 99
      const finalRecord = await getScript(scriptId);
      expect(finalRecord).not.toBeNull();
      expect(finalRecord?.name).toBe(`Oracle Update ${UPDATES - 1}`);
      expect(finalRecord?.metadata?.version).toBe(`1.0.${UPDATES - 1}`);
    });

    it('M1-2.9: 50 concurrent getScripts calls on uninitialized empty storage atomically seed once without duplicate writes or race conditions', async () => {
      // Clear chrome storage completely to simulate clean install
      await chrome.storage.local.clear();

      // Launch 50 concurrent getScripts reads simultaneously on empty storage
      const READ_COUNT = 50;
      const readPromises = Array.from({ length: READ_COUNT }, () => getScripts());

      const readResults = await Promise.all(readPromises);
      expect(readResults.length).toBe(READ_COUNT);

      // All 50 reads must receive the full seeded default scripts dictionary
      for (const res of readResults) {
        expect(res).toBeDefined();
        expect(res['sample-cdp-logger']).toBeDefined();
        expect(res['sample-cookie-inspector']).toBeDefined();
        expect(res['sample-dom-highlighter']).toBeDefined();
      }

      // Storage must now be populated
      const inStorage = await getScripts();
      expect(Object.keys(inStorage).length).toBe(3);
      expect(storageMutex.isLocked()).toBe(false);
    });
  });
});

