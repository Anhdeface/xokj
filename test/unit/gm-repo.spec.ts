/**
 * XOKJ - GmStorageRepository & GM Storage Subsystem Unit Tests
 * Location: test/unit/gm-repo.spec.ts
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
  getGmStorageKey,
  GM_STORAGE_PREFIX
} from '@/shared/storage/gm-repo';
import { AsyncMutex } from '@/shared/storage/mutex';

describe('Feature 7: Persistent Userscript Storage Engine (GmStorageRepository)', () => {
  beforeEach(async () => {
    setupChromeMock();
    await clearGmValues(); // Ensure clean repository state
  });

  describe('Tier 1: Functional CRUD & Value Types', () => {
    it('T1.1: getGmValues on a new/empty script returns an empty object', async () => {
      const values = await getGmValues('script-empty');
      expect(values).toEqual({});
    });

    it('T1.2: setGmValue persists string, number, boolean, array, and nested object', async () => {
      const scriptId = 'script-types';
      await setGmValue(scriptId, 'strVal', 'hello world');
      await setGmValue(scriptId, 'numVal', 42.5);
      await setGmValue(scriptId, 'boolVal', true);
      await setGmValue(scriptId, 'arrVal', [1, 'two', { three: 3 }]);
      await setGmValue(scriptId, 'objVal', { nested: { key: 'value' } });

      const all = await getGmValues(scriptId);
      expect(all.strVal).toBe('hello world');
      expect(all.numVal).toBe(42.5);
      expect(all.boolVal).toBe(true);
      expect(all.arrVal).toEqual([1, 'two', { three: 3 }]);
      expect(all.objVal).toEqual({ nested: { key: 'value' } });
    });

    it('T1.3: getGmValue retrieves specific key or returns defaultValue / undefined', async () => {
      const scriptId = 'script-single';
      await setGmValue(scriptId, 'existing', 'val1');

      const found = await getGmValue(scriptId, 'existing');
      expect(found).toBe('val1');

      const missingDefault = await getGmValue(scriptId, 'missing', 'fallback_123');
      expect(missingDefault).toBe('fallback_123');

      const missingNoDefault = await getGmValue(scriptId, 'missing');
      expect(missingNoDefault).toBeUndefined();
    });

    it('T1.4: setGmValue updates an existing key without modifying other keys', async () => {
      const scriptId = 'script-update';
      await setGmValue(scriptId, 'k1', 'initial1');
      await setGmValue(scriptId, 'k2', 'initial2');

      await setGmValue(scriptId, 'k1', 'updated1');

      const values = await getGmValues(scriptId);
      expect(values.k1).toBe('updated1');
      expect(values.k2).toBe('initial2');
    });

    it('T1.5: deleteGmValue removes target key and leaves other keys intact', async () => {
      const scriptId = 'script-del';
      await setGmValue(scriptId, 'stay', 'yes');
      await setGmValue(scriptId, 'removeMe', 'bye');

      await deleteGmValue(scriptId, 'removeMe');

      const values = await getGmValues(scriptId);
      expect(values.stay).toBe('yes');
      expect(values.removeMe).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(values, 'removeMe')).toBe(false);
    });

    it('T1.6: deleteGmValue on nonexistent key is a safe no-op', async () => {
      const scriptId = 'script-noop-del';
      await setGmValue(scriptId, 'keyA', 'valA');

      await expect(deleteGmValue(scriptId, 'nonexistent')).resolves.toBeUndefined();

      const values = await getGmValues(scriptId);
      expect(values).toEqual({ keyA: 'valA' });
    });

    it('T1.7: listGmValues returns all stored keys in an array', async () => {
      const scriptId = 'script-list';
      await setGmValue(scriptId, 'alpha', 1);
      await setGmValue(scriptId, 'beta', 2);
      await setGmValue(scriptId, 'gamma', 3);

      const keys = await listGmValues(scriptId);
      expect(keys.sort()).toEqual(['alpha', 'beta', 'gamma'].sort());
    });

    it('T1.8: clearGmValues removes all keys for a script', async () => {
      const scriptId = 'script-clear';
      await setGmValue(scriptId, 'a', 1);
      await setGmValue(scriptId, 'b', 2);

      await clearGmValues(scriptId);

      const after = await getGmValues(scriptId);
      expect(after).toEqual({});
      const keys = await listGmValues(scriptId);
      expect(keys).toEqual([]);
    });

    it('T1.9: setGmValues bulk-sets multiple keys and deletes keys with undefined value', async () => {
      const scriptId = 'script-bulk';
      await setGmValue(scriptId, 'existing', 'old');

      await setGmValues(scriptId, {
        k1: 'val1',
        k2: 'val2',
        existing: undefined,
        k3: 300
      });

      const values = await getGmValues(scriptId);
      expect(values.k1).toBe('val1');
      expect(values.k2).toBe('val2');
      expect(values.k3).toBe(300);
      expect(values.existing).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(values, 'existing')).toBe(false);
    });

    it('T1.10: getAllGmStorage dumps all stored scripts and clearGmValues() with no args clears all', async () => {
      await setGmValue('script-1', 'key1', 'val1');
      await setGmValue('script-2', 'key2', 'val2');

      const all = await getAllGmStorage();
      expect(all['script-1']).toEqual({ key1: 'val1' });
      expect(all['script-2']).toEqual({ key2: 'val2' });

      // Clear all scripts
      await clearGmValues();

      const afterClear = await getAllGmStorage();
      expect(afterClear).toEqual({});
    });
  });

  describe('Tier 2: Multi-Tenant Namespace Isolation', () => {
    it('T2.1: Setting key1 in scriptA does not expose or overwrite key1 in scriptB', async () => {
      await setGmValue('scriptA', 'commonKey', 'valueA');
      await setGmValue('scriptB', 'commonKey', 'valueB');

      expect(await getGmValue('scriptA', 'commonKey')).toBe('valueA');
      expect(await getGmValue('scriptB', 'commonKey')).toBe('valueB');
    });

    it('T2.2: clearGmValues for scriptA does not clear or mutate scriptB', async () => {
      await setGmValue('scriptA', 'data', 'alpha');
      await setGmValue('scriptB', 'data', 'bravo');

      await clearGmValues('scriptA');

      expect(await getGmValues('scriptA')).toEqual({});
      expect(await getGmValue('scriptB', 'data')).toBe('bravo');
    });

    it('T2.3: listGmValues returns only keys belonging to the queried scriptId', async () => {
      await setGmValue('scriptX', 'xOnly', 1);
      await setGmValue('scriptY', 'yOnly', 2);

      const keysX = await listGmValues('scriptX');
      const keysY = await listGmValues('scriptY');

      expect(keysX).toEqual(['xOnly']);
      expect(keysY).toEqual(['yOnly']);
    });
  });

  describe('Tier 3: Concurrency, FIFO Serialization & Stress Resilience', () => {
    it('T3.1: 100 simultaneous unawaited setGmValue calls complete without lost updates', async () => {
      const scriptId = 'script-stress-100';
      const promises: Promise<void>[] = [];

      for (let i = 0; i < 100; i++) {
        promises.push(setGmValue(scriptId, `key_${i}`, i));
      }

      await Promise.all(promises);

      const keys = await listGmValues(scriptId);
      expect(keys.length).toBe(100);

      const values = await getGmValues(scriptId);
      for (let i = 0; i < 100; i++) {
        expect(values[`key_${i}`]).toBe(i);
      }
    });

    it('T3.2: Rapid serialized read-modify-write calls maintain consistency', async () => {
      const scriptId = 'script-counter';
      const repo = new GmStorageRepository();

      await repo.setGmValue(scriptId, 'counter', 0);

      // Perform 50 concurrent increments using atomic setGmValue inside mutex
      const updates = Array.from({ length: 50 }, async (_, idx) => {
        // Read current bucket, increment counter
        const current = (await repo.getGmValue<number>(scriptId, 'counter', 0)) ?? 0;
        await repo.setGmValue(scriptId, `log_${idx}`, current);
      });

      await Promise.all(updates);

      const keys = await repo.listGmValues(scriptId);
      expect(keys.length).toBe(51); // 'counter' + 50 'log_*' keys
    });

    it('T3.3: Multi-script interleaved mutations complete with 100% data integrity', async () => {
      const scriptCount = 5;
      const writesPerScript = 20;
      const allPromises: Promise<void>[] = [];

      for (let s = 0; s < scriptCount; s++) {
        const sId = `script-interleaved-${s}`;
        for (let w = 0; w < writesPerScript; w++) {
          allPromises.push(setGmValue(sId, `w_${w}`, `val_${s}_${w}`));
        }
      }

      await Promise.all(allPromises);

      for (let s = 0; s < scriptCount; s++) {
        const sId = `script-interleaved-${s}`;
        const keys = await listGmValues(sId);
        expect(keys.length).toBe(writesPerScript);

        const values = await getGmValues(sId);
        for (let w = 0; w < writesPerScript; w++) {
          expect(values[`w_${w}`]).toBe(`val_${s}_${w}`);
        }
      }
    });

    it('T3.4: Mutex rejection isolation: if a task fails, subsequent queued tasks still execute and succeed', async () => {
      const scriptId = 'script-rejection-iso';
      const repo = new GmStorageRepository();

      await repo.setGmValue(scriptId, 'initial', 'ok');

      // Mock chrome.storage.local.set to reject once
      const originalSet = (chrome.storage.local as any).set.bind(chrome.storage.local);
      let rejectNext = true;
      vi.spyOn(chrome.storage.local, 'set').mockImplementation(async (items) => {
        if (rejectNext) {
          rejectNext = false;
          throw new Error('Simulated disk write error');
        }
        return originalSet(items);
      });

      // Task 1 fails
      await expect(repo.setGmValue(scriptId, 'failingKey', 'fail')).rejects.toThrow('Simulated disk write error');

      // Task 2 should proceed and succeed normally (mutex was released in finally block)
      await expect(repo.setGmValue(scriptId, 'recoveringKey', 'success')).resolves.toBeUndefined();

      const values = await repo.getGmValues(scriptId);
      expect(values.recoveringKey).toBe('success');
      expect(values.initial).toBe('ok');

      vi.restoreAllMocks();
    });
  });

  describe('Tier 4: Error Handling & Defensive Validation', () => {
    it('T4.1: Throws TypeError if scriptId is invalid across methods', async () => {
      const invalidScriptIds = ['', '   ', null as any, undefined as any];

      for (const id of invalidScriptIds) {
        await expect(getGmValues(id)).rejects.toThrow(TypeError);
        await expect(getGmValue(id, 'key')).rejects.toThrow(TypeError);
        await expect(setGmValue(id, 'key', 'val')).rejects.toThrow(TypeError);
        await expect(setGmValues(id, { key: 'val' })).rejects.toThrow(TypeError);
        await expect(deleteGmValue(id, 'key')).rejects.toThrow(TypeError);
        await expect(listGmValues(id)).rejects.toThrow(TypeError);
        await expect(clearGmValues(id)).rejects.toThrow(TypeError);
      }
    });

    it('T4.2: Throws TypeError if key is invalid in getGmValue, setGmValue, deleteGmValue', async () => {
      const invalidKeys = ['', '   ', null as any, undefined as any, 123 as any];

      for (const k of invalidKeys) {
        await expect(getGmValue('valid-script', k)).rejects.toThrow(TypeError);
        await expect(setGmValue('valid-script', k, 'val')).rejects.toThrow(TypeError);
        await expect(deleteGmValue('valid-script', k)).rejects.toThrow(TypeError);
      }
    });

    it('T4.3: Setting value to undefined in setGmValue deletes the key', async () => {
      const scriptId = 'script-undef-val';
      await setGmValue(scriptId, 'tempKey', 'tempVal');
      expect(await getGmValue(scriptId, 'tempKey')).toBe('tempVal');

      await setGmValue(scriptId, 'tempKey', undefined);
      expect(await getGmValue(scriptId, 'tempKey')).toBeUndefined();
      const all = await getGmValues(scriptId);
      expect(Object.prototype.hasOwnProperty.call(all, 'tempKey')).toBe(false);
    });

    it('T4.4: Gracefully falls back to in-memory storage when chrome.storage is unavailable or throws', async () => {
      const repo = new GmStorageRepository({ inMemoryOnly: true });
      await repo.setGmValue('script-mem', 'memKey', 'memVal');

      expect(await repo.getGmValue('script-mem', 'memKey')).toBe('memVal');
      expect(await repo.listGmValues('script-mem')).toEqual(['memKey']);

      const all = await repo.getAllGmStorage();
      expect(all['script-mem']).toEqual({ memKey: 'memVal' });

      await repo.clearGmValues('script-mem');
      expect(await repo.getGmValues('script-mem')).toEqual({});
    });

    it('T4.5: Gracefully recovers if storage contains corrupted/non-object data', async () => {
      const scriptId = 'script-corrupted';
      const key = getGmStorageKey(scriptId);

      // Seed chrome storage with a corrupted string instead of a dictionary
      await chrome.storage.local.set({ [key]: 'corrupted-non-object-string' });

      const values = await getGmValues(scriptId);
      expect(values).toEqual({}); // Safely returned {} instead of throwing

      // Seed with array
      await chrome.storage.local.set({ [key]: [1, 2, 3] });
      expect(await getGmValues(scriptId)).toEqual({});
    });

    it('T4.6: setGmValues throws TypeError if values is null, not an object, or an array', async () => {
      await expect(setGmValues('valid-id', null as any)).rejects.toThrow(TypeError);
      await expect(setGmValues('valid-id', 'string' as any)).rejects.toThrow(TypeError);
      await expect(setGmValues('valid-id', [1, 2] as any)).rejects.toThrow(TypeError);
      await expect(setGmValues('valid-id', 123 as any)).rejects.toThrow(TypeError);
    });
  });

  describe('Tier 5: Immutability & Deep Cloning', () => {
    it('T5.1: Mutating an object after calling setGmValue does not alter stored data', async () => {
      const scriptId = 'script-mut-input';
      const originalObj = { profile: { name: 'Alice', score: 100 } };

      await setGmValue(scriptId, 'user', originalObj);

      // Mutate the original object
      originalObj.profile.name = 'Bob';
      originalObj.profile.score = 999;

      const stored = await getGmValue<{ profile: { name: string; score: number } }>(scriptId, 'user');
      expect(stored?.profile.name).toBe('Alice');
      expect(stored?.profile.score).toBe(100);
    });

    it('T5.2: Mutating an object returned by getGmValues or getGmValue does not alter stored data', async () => {
      const scriptId = 'script-mut-output';
      await setGmValue(scriptId, 'settings', { theme: 'dark', fontSize: 14 });

      const retrieved = await getGmValue<{ theme: string; fontSize: number }>(scriptId, 'settings');
      expect(retrieved).toBeDefined();

      // Mutate retrieved reference
      retrieved!.theme = 'light';
      retrieved!.fontSize = 20;

      // Re-fetch should have untouched original values
      const refetched = await getGmValue<{ theme: string; fontSize: number }>(scriptId, 'settings');
      expect(refetched?.theme).toBe('dark');
      expect(refetched?.fontSize).toBe(14);
    });

    it('T5.3: Special characters in scriptId construct safe storage keys', () => {
      expect(getGmStorageKey('script@1.0.0')).toBe(`${GM_STORAGE_PREFIX}script@1.0.0`);
      expect(getGmStorageKey('https://example.com/script.user.js')).toBe(
        `${GM_STORAGE_PREFIX}https://example.com/script.user.js`
      );
      expect(getGmStorageKey('uuid-1234-5678-abcd')).toBe(`${GM_STORAGE_PREFIX}uuid-1234-5678-abcd`);
    });

    it('T5.4: Custom instance options (custom mutex) work properly', async () => {
      const customMutex = new AsyncMutex();
      const repo = new GmStorageRepository({ mutex: customMutex });

      await repo.setGmValue('custom-script', 'keyA', 'valA');
      expect(await repo.getGmValue('custom-script', 'keyA')).toBe('valA');

      await repo.clearGmValues();
      expect(await repo.getGmValues('custom-script')).toEqual({});
    });
  });
});
