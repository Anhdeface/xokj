/**
 * XOKJ - Empirical Challenger M2 Iteration 2: Storage Subsystem Concurrency & Reserved ID Stress Harness
 * Location: test/unit/challenger-m2-i2-stress.spec.ts
 *
 * Focus:
 * 1. Rapid concurrent attacks attempting to inject or abuse reserved IDs (__proto__, constructor, toString)
 * 2. Unawaited concurrent operations across scripts (rapid toggle/save/delete/import races)
 * 3. Atomic consistency under high-frequency interleaved mutations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import {
  saveScript,
  getScript,
  getScripts,
  getScriptList,
  deleteScript,
  toggleScript,
  resetToDefaultScripts
} from '@/shared/storage/scripts-repo';
import {
  importScripts,
  exportScripts
} from '@/shared/storage/bundle';
import {
  getStorageItem,
  setStorageItem,
  STORAGE_KEYS,
  DEFAULT_SCRIPTS
} from '@/shared/storage/defaults';
import {
  saveTabSession,
  getTabSession,
  getTabSessions,
  deleteTabSession,
  clearTabSessions
} from '@/shared/storage/tab-repo';
import {
  setGmValue,
  getGmValue,
  getGmValues,
  deleteGmValue,
  clearGmValues
} from '@/shared/storage/gm-repo';
import { storageMutex } from '@/shared/storage/mutex';

describe('Empirical Challenger M2 Iteration 2: Concurrency & Reserved ID Hardening Stress', () => {
  beforeEach(async () => {
    setupChromeMock();
    await resetToDefaultScripts();
    await clearGmValues();
    await clearTabSessions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUITE 1: Reserved IDs (__proto__, prototype, constructor, toString) Under Rapid Concurrency
  // =========================================================================
  describe('Suite 1: Reserved IDs Under Rapid Concurrency Attacks', () => {
    it('1.1: 100 concurrent unawaited saveScript calls with id="__proto__" all reject with reserved error and leave prototype untouched', async () => {
      const TOTAL = 100;
      const promises: Promise<unknown>[] = [];

      for (let i = 0; i < TOTAL; i++) {
        promises.push(
          saveScript({
            id: '__proto__',
            name: `Exploit Attempt ${i}`,
            code: `// ==UserScript==\n// @name Exploit ${i}\n// ==/UserScript==\nconsole.log(${i});`
          })
        );
      }

      const results = await Promise.allSettled(promises);
      expect(results.length).toBe(TOTAL);

      // 100% of the promises must be rejected
      for (let i = 0; i < TOTAL; i++) {
        expect(results[i].status).toBe('rejected');
        if (results[i].status === 'rejected') {
          expect((results[i] as PromiseRejectedResult).reason.message).toBe(
            'Invalid script ID: "__proto__" is reserved'
          );
        }
      }

      // Verify global prototype chain is completely intact
      expect((Object.prototype as any).name).toBeUndefined();
      expect((Object.prototype as any).code).toBeUndefined();
      expect(({} as any).name).toBeUndefined();

      // Verify scripts collection is intact and __proto__ is null
      expect(await getScript('__proto__')).toBeNull();
      const stored = await getScripts();
      expect(Object.prototype.hasOwnProperty.call(stored, '__proto__')).toBe(false);
      expect(storageMutex.isLocked()).toBe(false);
    });

    it('1.2: 120 interleaved concurrent operations mixing valid saves and __proto__ exploits preserve valid records and reject all exploits', async () => {
      const TOTAL = 120;
      const promises: Promise<unknown>[] = [];

      for (let i = 0; i < TOTAL; i++) {
        if (i % 2 === 0) {
          // Valid script save
          promises.push(
            saveScript({
              id: `valid-concurrency-${i}`,
              name: `Valid Script ${i}`,
              code: `// ==UserScript==\n// @name Valid ${i}\n// ==/UserScript==`
            })
          );
        } else {
          // Malicious reserved ID attempt
          promises.push(
            saveScript({
              id: '__proto__',
              name: `Malicious Exploit ${i}`,
              code: `// ==UserScript==\n// @name Evil ${i}\n// ==/UserScript==`
            })
          );
        }
      }

      const results = await Promise.allSettled(promises);
      expect(results.length).toBe(TOTAL);

      let successCount = 0;
      let rejectCount = 0;

      for (let i = 0; i < TOTAL; i++) {
        if (i % 2 === 0) {
          expect(results[i].status).toBe('fulfilled');
          successCount++;
        } else {
          expect(results[i].status).toBe('rejected');
          rejectCount++;
        }
      }

      expect(successCount).toBe(60);
      expect(rejectCount).toBe(60);

      // Check that all 60 valid scripts exist and are uncorrupted
      const allScripts = await getScripts();
      for (let i = 0; i < TOTAL; i += 2) {
        const id = `valid-concurrency-${i}`;
        expect(allScripts[id]).toBeDefined();
        expect(allScripts[id].name).toBe(`Valid Script ${i}`);
      }

      expect(await getScript('__proto__')).toBeNull();
      expect((Object.prototype as any).name).toBeUndefined();
    });

    it('1.3: 60 concurrent importScripts with __proto__ (both overwrite=true and overwrite=false) safely sanitize IDs without collision or pollution', async () => {
      const imports: Promise<unknown>[] = [];

      for (let i = 0; i < 60; i++) {
        const payload = [
          {
            id: '__proto__',
            name: `Imported Proto ${i}`,
            code: `// ==UserScript==\n// @name Proto ${i}\n// ==/UserScript==`
          },
          {
            id: `legit-import-${i}`,
            name: `Legit Import ${i}`,
            code: `// ==UserScript==\n// @name Legit ${i}\n// ==/UserScript==`
          }
        ];

        imports.push(importScripts(payload, { overwrite: i % 2 === 0 }));
      }

      const results = await Promise.all(imports);
      expect(results.length).toBe(60);

      for (const res of results as any[]) {
        expect(res.imported + res.updated).toBe(2);
        for (const script of res.scripts) {
          expect(script.id).not.toBe('__proto__');
          expect(typeof script.id).toBe('string');
        }
      }

      expect(await getScript('__proto__')).toBeNull();
      expect((Object.prototype as any).name).toBeUndefined();
    });

    it('1.4: 80 concurrent toggleScript calls targeting unpersisted prototype keys (__proto__, toString, valueOf, constructor) reject cleanly without prototype mutation', async () => {
      const targets = ['__proto__', 'toString', 'valueOf', 'constructor'];
      const promises: Promise<unknown>[] = [];

      for (let i = 0; i < 80; i++) {
        const target = targets[i % targets.length];
        promises.push(toggleScript(target));
      }

      const results = await Promise.allSettled(promises);
      expect(results.length).toBe(80);

      for (let i = 0; i < 80; i++) {
        expect(results[i].status).toBe('rejected');
        const err = (results[i] as PromiseRejectedResult).reason;
        expect(err.message).toMatch(/not found/);
      }

      // Check prototypes remain pure
      expect((Object.prototype.toString as any).enabled).toBeUndefined();
      expect((Object.prototype.valueOf as any).enabled).toBeUndefined();
      expect((Object.prototype.constructor as any).enabled).toBeUndefined();
      expect((Object.prototype as any).enabled).toBeUndefined();
    });

    it('1.5: Rapid concurrent deleteScript calls targeting prototype keys (__proto__, toString, valueOf) execute harmlessly without storage corruption', async () => {
      const targets = ['__proto__', 'toString', 'valueOf', 'constructor', 'hasOwnProperty'];
      const promises: Promise<void>[] = [];

      for (let i = 0; i < 60; i++) {
        promises.push(deleteScript(targets[i % targets.length]));
      }

      await Promise.all(promises);

      // Verify scripts collection remains valid and contains defaults
      const scripts = await getScripts();
      expect(Object.keys(scripts).length).toBe(Object.keys(DEFAULT_SCRIPTS).length);
      for (const target of targets) {
        expect(await getScript(target)).toBeNull();
      }
    });
  });

  // =========================================================================
  // SUITE 2: Unawaited Concurrent Operations Across Scripts (Race Resilience)
  // =========================================================================
  describe('Suite 2: High-Volume Concurrent Cross-Script Mutations', () => {
    it('2.1: 150 unawaited concurrent operations across 15 distinct scripts (saves, toggles, deletes, gets) maintain state consistency', async () => {
      const SCRIPT_COUNT = 15;
      const OPS_PER_SCRIPT = 10;
      const allOps: Promise<unknown>[] = [];

      // Pre-seed the 15 scripts
      for (let s = 0; s < SCRIPT_COUNT; s++) {
        await saveScript({
          id: `script-m2-${s}`,
          name: `Script M2 ${s}`,
          code: `// ==UserScript==\n// @name Script M2 ${s}\n// ==/UserScript==`,
          enabled: true
        });
      }

      // Fire interleaved operations across all scripts
      for (let op = 0; op < OPS_PER_SCRIPT; op++) {
        for (let s = 0; s < SCRIPT_COUNT; s++) {
          const id = `script-m2-${s}`;
          const opType = op % 4;

          if (opType === 0) {
            allOps.push(toggleScript(id));
          } else if (opType === 1) {
            allOps.push(
              saveScript({
                id,
                name: `Script M2 ${s} rev ${op}`,
                code: `// ==UserScript==\n// @name Script M2 ${s}\n// @version 1.${op}.0\n// ==/UserScript==`
              })
            );
          } else if (opType === 2) {
            allOps.push(getScript(id));
          } else {
            // Read all
            allOps.push(getScripts());
          }
        }
      }

      const results = await Promise.allSettled(allOps);
      expect(results.length).toBe(SCRIPT_COUNT * OPS_PER_SCRIPT);

      // No operation should have unexpectedly rejected
      const failures = results.filter((r) => r.status === 'rejected');
      expect(failures).toEqual([]);

      // Final scripts must all exist and have valid fields
      const finalScripts = await getScripts();
      for (let s = 0; s < SCRIPT_COUNT; s++) {
        const record = finalScripts[`script-m2-${s}`];
        expect(record).toBeDefined();
        expect(typeof record.enabled).toBe('boolean');
        expect(record.updatedAt).toBeGreaterThan(0);
      }
    });

    it('2.2: Rapid toggle hammer on single script while simultaneous update is in-flight does not lose toggles or corrupted state', async () => {
      const scriptId = 'toggle-hammer-target';
      await saveScript({
        id: scriptId,
        name: 'Toggle Target',
        code: '// ==UserScript==\n// @name Toggle Target\n// ==/UserScript==',
        enabled: true
      });

      const TOGGLE_COUNT = 60;
      const togglePromises: Promise<boolean>[] = [];

      // Interleave an update with toggles
      for (let i = 0; i < TOGGLE_COUNT; i++) {
        if (i === 30) {
          // Simultaneous code update midway through
          saveScript({
            id: scriptId,
            name: 'Toggle Target Updated Code',
            code: '// ==UserScript==\n// @name Updated Code\n// @version 3.0.0\n// ==/UserScript=='
          });
        }
        togglePromises.push(toggleScript(scriptId));
      }

      const toggleResults = await Promise.all(togglePromises);
      expect(toggleResults.length).toBe(TOGGLE_COUNT);

      // Verify toggles alternated cleanly
      for (let i = 0; i < TOGGLE_COUNT; i++) {
        const expected = i % 2 === 0 ? false : true;
        expect(toggleResults[i]).toBe(expected);
      }

      // Check final state
      const final = await getScript(scriptId);
      expect(final).not.toBeNull();
      // Even number of toggles (60) starting from true -> ends on true
      expect(final!.enabled).toBe(true);
      expect(final!.name).toBe('Toggle Target Updated Code');
      expect(final!.metadata.version).toBe('3.0.0');
    });

    it('2.3: Tab session storage concurrently handles 100 rapid sessions without race condition or prototype reflection', async () => {
      const promises: Promise<unknown>[] = [];

      for (let t = 1; t <= 100; t++) {
        promises.push(
          saveTabSession({
            tabId: t,
            status: t % 2 === 0 ? 'ATTACHED' : 'IDLE',
            attached: t % 2 === 0,
            attachedAt: Date.now(),
            activeDomains: ['Runtime', 'Page'],
            conflictDetected: false,
            updatedAt: Date.now()
          })
        );
      }

      await Promise.all(promises);

      const allSessions = await getTabSessions();
      expect(Object.keys(allSessions).length).toBe(100);

      // Verify safe handling of prototype lookups
      expect(await getTabSession(NaN)).toBeUndefined();
      expect(await getTabSession(undefined as any)).toBeUndefined();
      expect(await getTabSession(null as any)).toBeUndefined();

      // Delete 50 sessions concurrently
      const deletePromises: Promise<void>[] = [];
      for (let t = 1; t <= 50; t++) {
        deletePromises.push(deleteTabSession(t));
      }
      await Promise.all(deletePromises);

      const remainingSessions = await getTabSessions();
      expect(Object.keys(remainingSessions).length).toBe(50);
      for (let t = 1; t <= 50; t++) {
        expect(remainingSessions[t]).toBeUndefined();
      }
      for (let t = 51; t <= 100; t++) {
        expect(remainingSessions[t]).toBeDefined();
        expect(remainingSessions[t].tabId).toBe(t);
      }
    });
  });

  // =========================================================================
  // SUITE 3: Storage Defaults & Direct Storage Reflection Resistance
  // =========================================================================
  describe('Suite 3: Storage Defaults & Reflection Resistance', () => {
    it('3.1: getStorageItem rejects __proto__, empty keys, and isolates stored keys', async () => {
      // Empty and reserved key lookups must return undefined
      expect(await getStorageItem('__proto__')).toBeUndefined();
      expect(await getStorageItem('')).toBeUndefined();
      expect(await getStorageItem(null as any)).toBeUndefined();
      expect(await getStorageItem(undefined as any)).toBeUndefined();

      // Normal stored items persist and retrieve cleanly
      await setStorageItem('realKey', { hello: 'world' });
      expect(await getStorageItem('realKey')).toEqual({ hello: 'world' });
      expect(await getStorageItem('__proto__')).toBeUndefined();
    });
  });
});
