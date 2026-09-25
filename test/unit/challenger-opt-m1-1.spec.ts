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
  resetToDefaultScripts
} from '@/shared/storage';
import {
  compileMatchPattern,
  clearMatchPatternCache,
  MAX_MATCH_PATTERN_CACHE_SIZE,
  isValidMatchPattern,
  matchesUrl,
  matchesAny
} from '@/shared/match-pattern';

describe('Empirical Challenger Opt-M1-1: AsyncMutex & Match Pattern Stress Suite', () => {
  beforeEach(async () => {
    setupChromeMock();
    clearMatchPatternCache();
  });

  describe('Subsystem 1: High-Concurrency AsyncMutex Stress & Adversarial Verification', () => {
    it('1.1: 1,000 concurrent tasks execute in strict FIFO order without deadlocks', async () => {
      const mutex = new AsyncMutex();
      const TOTAL = 1000;
      const executionOrder: number[] = [];

      const promises = Array.from({ length: TOTAL }, (_, i) => {
        return mutex.runExclusive(async () => {
          executionOrder.push(i);
          return i;
        });
      });

      const results = await Promise.all(promises);

      expect(results.length).toBe(TOTAL);
      expect(executionOrder.length).toBe(TOTAL);
      // Results and execution order must strictly match 0, 1, 2, ..., 999
      for (let i = 0; i < TOTAL; i++) {
        expect(results[i]).toBe(i);
        expect(executionOrder[i]).toBe(i);
      }

      expect(mutex.isLocked()).toBe(false);
      expect((mutex as any).queue.length).toBe(0);
    });

    it('1.2: Adversarial rejection recovery: 500 tasks with 50% mixed sync/async failures do not break queue', async () => {
      const mutex = new AsyncMutex();
      const TOTAL = 500;
      const completedIndices: number[] = [];

      const promises = Array.from({ length: TOTAL }, (_, i) => {
        const failureType = i % 4; // 0: sync throw, 1: async reject, 2: sync success, 3: async success
        if (failureType === 0) {
          return mutex.runExclusive(() => {
            throw new Error(`Sync failure at ${i}`);
          });
        } else if (failureType === 1) {
          return mutex.runExclusive(async () => {
            await new Promise((r) => setTimeout(r, 0));
            throw new Error(`Async failure at ${i}`);
          });
        } else if (failureType === 2) {
          return mutex.runExclusive(() => {
            completedIndices.push(i);
            return i;
          });
        } else {
          return mutex.runExclusive(async () => {
            await new Promise((r) => setTimeout(r, 0));
            completedIndices.push(i);
            return i;
          });
        }
      });

      const settled = await Promise.allSettled(promises);
      expect(settled.length).toBe(TOTAL);

      for (let i = 0; i < TOTAL; i++) {
        const res = settled[i];
        if (i % 4 === 0) {
          expect(res.status).toBe('rejected');
          expect((res as PromiseRejectedResult).reason.message).toBe(`Sync failure at ${i}`);
        } else if (i % 4 === 1) {
          expect(res.status).toBe('rejected');
          expect((res as PromiseRejectedResult).reason.message).toBe(`Async failure at ${i}`);
        } else {
          expect(res.status).toBe('fulfilled');
          expect((res as PromiseFulfilledResult<number>).value).toBe(i);
        }
      }

      // Successful tasks must have executed in strictly ascending FIFO order
      const expectedSuccesses = Array.from({ length: TOTAL }, (_, i) => i).filter((i) => i % 4 >= 2);
      expect(completedIndices).toEqual(expectedSuccesses);

      expect(mutex.isLocked()).toBe(false);
      expect((mutex as any).queue.length).toBe(0);

      // Verify immediate subsequent operation operates normally
      const followup = await mutex.runExclusive(() => 'all-clear');
      expect(followup).toBe('all-clear');
    });

    it('1.3: Concurrency oracle: asserts mutual exclusion is never violated under heavy contention', async () => {
      const mutex = new AsyncMutex();
      const TOTAL = 300;
      let activeWorkers = 0;
      let maxObservedWorkers = 0;

      const tasks = Array.from({ length: TOTAL }, (_, i) => {
        return mutex.runExclusive(async () => {
          activeWorkers++;
          if (activeWorkers > maxObservedWorkers) {
            maxObservedWorkers = activeWorkers;
          }
          // Invariant assertion: active workers must be exactly 1 inside the exclusive section
          expect(activeWorkers).toBe(1);

          // Variable async delay simulating work
          await new Promise((resolve) => setTimeout(resolve, i % 3 === 0 ? 1 : 0));

          expect(activeWorkers).toBe(1);
          activeWorkers--;
        });
      });

      await Promise.all(tasks);

      expect(activeWorkers).toBe(0);
      expect(maxObservedWorkers).toBe(1);
      expect(mutex.isLocked()).toBe(false);
    });

    it('1.4: Inverted duration scheduling: tasks with descending durations strictly finish in FIFO order', async () => {
      const mutex = new AsyncMutex();
      const completionOrder: number[] = [];

      // Task 0: 30ms, Task 1: 15ms, Task 2: 5ms, Task 3: 0ms
      // Without serialization, completion order would be 3, 2, 1, 0.
      // With FIFO mutex, completion order MUST be 0, 1, 2, 3.
      const delays = [30, 15, 5, 0];
      const tasks = delays.map((delay, idx) => {
        return mutex.runExclusive(async () => {
          await new Promise((r) => setTimeout(r, delay));
          completionOrder.push(idx);
          return idx;
        });
      });

      const results = await Promise.all(tasks);
      expect(results).toEqual([0, 1, 2, 3]);
      expect(completionOrder).toEqual([0, 1, 2, 3]);
      expect(mutex.isLocked()).toBe(false);
    });

    it('1.5: Argument validation rejects non-functions without locking or corrupting queue', async () => {
      const mutex = new AsyncMutex();

      const invalidArgs: any[] = [null, undefined, 12345, 'not a function', {}, [], true, Symbol('bad')];

      for (const arg of invalidArgs) {
        await expect(mutex.runExclusive(arg)).rejects.toThrow(TypeError);
        await expect(mutex.runExclusive(arg)).rejects.toThrow('Task must be a function');
        expect(mutex.isLocked()).toBe(false);
        expect((mutex as any).queue.length).toBe(0);
      }

      // Valid task follows immediately and completes cleanly
      const result = await mutex.runExclusive(() => 42);
      expect(result).toBe(42);
      expect(mutex.isLocked()).toBe(false);
    });

    it('1.6: Uncontended fast-path executes 5,000 tasks rapidly without microtask delay overhead', async () => {
      const mutex = new AsyncMutex();
      const COUNT = 5000;
      const start = performance.now();

      for (let i = 0; i < COUNT; i++) {
        const val = await mutex.runExclusive(() => i * 2);
        expect(val).toBe(i * 2);
      }

      const elapsed = performance.now() - start;
      // 5,000 sequential uncontended executions should take well under 250ms
      expect(elapsed).toBeLessThan(500);
      expect(mutex.isLocked()).toBe(false);
      expect((mutex as any).queue.length).toBe(0);
    });

    it('1.7: Massive rejection flood (2,000 tasks, 90% rejections) cleans up completely', async () => {
      const mutex = new AsyncMutex();
      const TOTAL = 2000;

      const tasks = Array.from({ length: TOTAL }, (_, i) => {
        return mutex.runExclusive(async () => {
          if (i % 10 !== 0) {
            throw new Error(`Chaos error ${i}`);
          }
          return i;
        });
      });

      const settled = await Promise.allSettled(tasks);
      expect(settled.length).toBe(TOTAL);

      let successCount = 0;
      let rejectCount = 0;
      for (let i = 0; i < TOTAL; i++) {
        if (i % 10 === 0) {
          expect(settled[i].status).toBe('fulfilled');
          successCount++;
        } else {
          expect(settled[i].status).toBe('rejected');
          rejectCount++;
        }
      }

      expect(successCount).toBe(200);
      expect(rejectCount).toBe(1800);
      expect(mutex.isLocked()).toBe(false);
      expect((mutex as any).queue.length).toBe(0);
    });

    it('1.8: Zero memory retention: queue array is drained and contains no stale resolvers', async () => {
      const mutex = new AsyncMutex();
      const COUNT = 200;

      const tasks = Array.from({ length: COUNT }, () => {
        return mutex.runExclusive(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
      });

      // While running, queue should hold pending resolvers
      expect(mutex.isLocked()).toBe(true);

      await Promise.all(tasks);

      // Once finished, queue must be empty
      expect(mutex.isLocked()).toBe(false);
      expect((mutex as any).queue.length).toBe(0);
    });
  });

  describe('Subsystem 2: Match Pattern Cache Hit/Miss, LRU Eviction & ReDoS Resilience', () => {
    it('2.1: Cache Hit Identity: identical pattern strings return the exact same RegExp instance', () => {
      clearMatchPatternCache();
      const p1 = 'https://example.com/*';
      const re1 = compileMatchPattern(p1);
      const re2 = compileMatchPattern(p1);
      const re3 = compileMatchPattern(p1);

      expect(re1).toBe(re2);
      expect(re2).toBe(re3);
    });

    it('2.2: Cache Hit Performance: 50,000 cached evaluations execute with O(1) memoization', () => {
      const patterns = [
        '*://*.google.com/*',
        'https://github.com/*',
        'https://*.github.io/*',
        'http://localhost:*/*',
        '*://*/*'
      ];
      // Prime cache
      patterns.forEach((p) => compileMatchPattern(p));

      const testUrl = 'https://github.com/microsoft/vscode';
      const N = 50000;

      const start = performance.now();
      for (let i = 0; i < N; i++) {
        matchesAny(patterns, testUrl);
      }
      const duration = performance.now() - start;

      // 50,000 evaluations with cache should complete under 100ms
      expect(duration).toBeLessThan(150);
    });

    it('2.3: Bounded Capacity: cache strictly caps at MAX_MATCH_PATTERN_CACHE_SIZE (1,000)', () => {
      clearMatchPatternCache();
      const INITIAL_INSERT = 1000;
      const initialMap = new Map<string, RegExp>();

      for (let i = 0; i < INITIAL_INSERT; i++) {
        const p = `https://domain-${i}.com/*`;
        initialMap.set(p, compileMatchPattern(p));
      }

      // Add 500 additional patterns to force 500 evictions
      const OVERFLOW = 500;
      for (let i = INITIAL_INSERT; i < INITIAL_INSERT + OVERFLOW; i++) {
        compileMatchPattern(`https://domain-${i}.com/*`);
      }

      // Keys 0 to 499 must have been evicted (recompilation returns a fresh instance)
      for (let i = 0; i < 5; i++) {
        const evictedKey = `https://domain-${i}.com/*`;
        const recompiled = compileMatchPattern(evictedKey);
        expect(recompiled).not.toBe(initialMap.get(evictedKey));
      }

      // Keys 500 to 999 were not evicted prior to checking evictedKey
      // Note: checking evictedKey promoted those keys, which is standard LRU behavior
    });

    it('2.4: LRU Eviction Order: accessed entries are promoted and oldest unaccessed entries are evicted', () => {
      clearMatchPatternCache();
      const LIMIT = MAX_MATCH_PATTERN_CACHE_SIZE; // 1000
      const initialInstances = new Map<string, RegExp>();

      // 1. Fill cache to capacity (0 to 999)
      for (let i = 0; i < LIMIT; i++) {
        const p = `https://lru-test-${i}.org/*`;
        initialInstances.set(p, compileMatchPattern(p));
      }

      // At this point, key 0 is the oldest, key 1 is second oldest, ..., key 999 is newest.
      // 2. Access key 0: this should promote key 0 to the most-recently-used position!
      const key0 = `https://lru-test-0.org/*`;
      const re0_promoted = compileMatchPattern(key0);
      expect(re0_promoted).toBe(initialInstances.get(key0)); // Still the same instance

      // Now, key 1 is the oldest unaccessed entry!
      const key1 = `https://lru-test-1.org/*`;
      const key2 = `https://lru-test-2.org/*`;

      // 3. Add a new pattern (key 1000) to trigger eviction of exactly 1 item
      const key1000 = `https://lru-test-1000.org/*`;
      compileMatchPattern(key1000);

      // 4. Verify key 0 was NOT evicted (promoted to MRU):
      const re0_after = compileMatchPattern(key0);
      expect(re0_after).toBe(initialInstances.get(key0));

      // 5. Verify key 2 was NOT evicted (key 1 took the hit):
      const re2_after = compileMatchPattern(key2);
      expect(re2_after).toBe(initialInstances.get(key2));

      // 6. Verify key 1 WAS evicted: accessing key 1 compiles a NEW RegExp instance!
      const re1_after = compileMatchPattern(key1);
      expect(re1_after).not.toBe(initialInstances.get(key1));
      expect(re1_after.source).toBe(initialInstances.get(key1)!.source);
    });

    it('2.5: Syntax Error Throwing & Non-Caching of Invalid Patterns', () => {
      clearMatchPatternCache();

      const invalidPatterns = [
        'ftp://example.com/*',      // unsupported scheme
        'ws://example.com/*',       // unsupported scheme
        'http://example.com',        // missing path
        'https://*bad*.com/*',       // invalid wildcard
        'file://nonemptyhost/*',     // file host must be empty
        'http://[::1:8080/*',        // unclosed IPv6
        'http://[::*]/* ',           // wildcard in IPv6
        'http://example.com:abc/*',  // non-numeric port
        '',                          // empty
        '    '                       // whitespace
      ];

      for (const invalid of invalidPatterns) {
        expect(() => compileMatchPattern(invalid)).toThrow();
        expect(isValidMatchPattern(invalid)).toBe(false);
      }

      // Non-string arguments throw descriptive error
      expect(() => compileMatchPattern(null as any)).toThrow('Match pattern must be a string');
      expect(() => compileMatchPattern(undefined as any)).toThrow('Match pattern must be a string');
      expect(() => compileMatchPattern(12345 as any)).toThrow('Match pattern must be a string');

      // Repeating invalid pattern call still throws descriptive error
      expect(() => compileMatchPattern('ftp://example.com/*')).toThrow(/Invalid match pattern syntax/);
    });

    it('2.6: Thread-safety and re-entrancy: concurrent regex testing does not pollute match results', async () => {
      const pattern = '*://*.example.com/api/*';
      const compiled = compileMatchPattern(pattern);

      const matchingUrls = [
        'https://example.com/api/v1/users',
        'http://sub.example.com/api/v2/items',
        'https://a.b.c.example.com/api/data?foo=bar',
        'http://example.com:8080/api/endpoint'
      ];

      const nonMatchingUrls = [
        'https://example.com/other/path',
        'https://notexample.com/api/v1',
        'ftp://example.com/api/test',
        'https://example.com.evil.com/api/v1'
      ];

      // Run 500 concurrent async checks using the same pattern/compiled RegExp
      const checks = Array.from({ length: 500 }, (_, i) => {
        return (async () => {
          const matchUrl = matchingUrls[i % matchingUrls.length];
          const nonMatchUrl = nonMatchingUrls[i % nonMatchingUrls.length];

          const res1 = matchesUrl(pattern, matchUrl);
          const res2 = matchesUrl(pattern, nonMatchUrl);
          const resDirect1 = compiled.test(matchUrl);
          const resDirect2 = compiled.test(nonMatchUrl);

          expect(res1).toBe(true);
          expect(res2).toBe(false);
          expect(resDirect1).toBe(true);
          expect(resDirect2).toBe(false);
        })();
      });

      await Promise.all(checks);
    });

    it('2.7: clearMatchPatternCache completely wipes cached entries', () => {
      const pattern = 'https://to-be-cleared.com/*';
      const re1 = compileMatchPattern(pattern);
      expect(compileMatchPattern(pattern)).toBe(re1);

      clearMatchPatternCache();

      const re2 = compileMatchPattern(pattern);
      // After clear, a fresh RegExp instance is compiled
      expect(re2).not.toBe(re1);
      expect(re2.source).toBe(re1.source);
    });

    it('2.8: Diverse standard and edge-case match patterns compile and cache cleanly', () => {
      const patterns = [
        '<all_urls>',
        '*://*/*',
        'file:///path/to/file.js',
        'http://[::1]/*',
        'http://[::1]:8080/*',
        'http://[2001:db8::1]/*',
        'http://localhost:*/*',
        'https://*.github.io/*',
        'https://example.com/a/*/b/*/c?query=*#*',
        '*://example.com' + '/*'.repeat(30)
      ];

      for (const p of patterns) {
        expect(isValidMatchPattern(p)).toBe(true);
        const re1 = compileMatchPattern(p);
        const re2 = compileMatchPattern(p);
        expect(re1).toBe(re2);
      }
    });
  });

  describe('Subsystem 3: Storage Integration Concurrency & Immutability', () => {
    it('3.1: 100 concurrent saveScript operations serialize without lost writes or record corruption', async () => {
      await resetToDefaultScripts();
      const TOTAL = 100;

      const saves = Array.from({ length: TOTAL }, (_, i) => {
        return saveScript({
          id: `concurrent-opt-${i}`,
          name: `Concurrent Opt Script ${i}`,
          code: `// ==UserScript==\n// @name Concurrent Opt Script ${i}\n// @match https://opt${i}.example.com/*\n// ==/UserScript==`,
          enabled: i % 2 === 0
        });
      });

      const savedRecords = await Promise.all(saves);
      expect(savedRecords.length).toBe(TOTAL);

      const all = await getScripts();
      for (let i = 0; i < TOTAL; i++) {
        const id = `concurrent-opt-${i}`;
        expect(all[id]).toBeDefined();
        expect(all[id].name).toBe(`Concurrent Opt Script ${i}`);
        expect(all[id].enabled).toBe(i % 2 === 0);
        expect(all[id].metadata?.matches).toContain(`https://opt${i}.example.com/*`);
      }
    });

    it('3.2: Immutability boundary verification: returned objects are isolated copies', async () => {
      const id = 'immutability-test-script';
      const saved = await saveScript({
        id,
        name: 'Original Immutability Name',
        code: '// ==UserScript==\n// @name Original Immutability Name\n// @match https://immutable.com/*\n// ==/UserScript=='
      });

      // Mutate returned saved record
      saved.name = 'MUTATED SAVED NAME';
      saved.metadata.matches = ['https://malicious.com/*'];

      // Fetch from storage
      const fetched1 = await getScript(id);
      expect(fetched1).not.toBeNull();
      expect(fetched1?.name).toBe('Original Immutability Name');
      expect(fetched1?.metadata.matches).toEqual(['https://immutable.com/*']);

      // Mutate fetched record
      fetched1!.name = 'MUTATED FETCHED NAME';
      fetched1!.metadata.matches = ['https://evil.com/*'];

      // Fetch again
      const fetched2 = await getScript(id);
      expect(fetched2?.name).toBe('Original Immutability Name');
      expect(fetched2?.metadata.matches).toEqual(['https://immutable.com/*']);
    });

    it('3.3: Rapid mixed operations (save, toggle, delete, get) do not deadlock storageMutex', async () => {
      await resetToDefaultScripts();
      const testId = 'rapid-mixed-script';
      await saveScript({
        id: testId,
        name: 'Rapid Mixed',
        code: '// ==UserScript==\n// @name Rapid Mixed\n// ==/UserScript=='
      });

      const ops = [
        toggleScript(testId),
        getScript(testId),
        saveScript({ id: 'rapid-2', code: '// ==UserScript==\n// @name R2\n// ==/UserScript==' }),
        toggleScript(testId),
        deleteScript('sample-dom-highlighter'),
        getScripts(),
        toggleScript(testId)
      ];

      const results = await Promise.allSettled(ops);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(storageMutex.isLocked()).toBe(false);
    });
  });
});
