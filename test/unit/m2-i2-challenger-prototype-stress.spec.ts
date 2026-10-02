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
  importScripts
} from '@/shared/storage/bundle';
import {
  getStorageItem,
  STORAGE_KEYS
} from '@/shared/storage/defaults';
import {
  getTabSession,
  deleteTabSession
} from '@/shared/storage/tab-repo';
import {
  getGmValue,
  setGmValue,
  clearGmValues
} from '@/shared/storage/gm-repo';

const PROTOTYPE_PROPERTIES = [
  'toString',
  'valueOf',
  'toLocaleString',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'constructor',
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__'
];

describe('M2 Iteration 2 Challenger: Prototype Pollution & Reflection Stress Harness', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
    await clearGmValues();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Adversarial Check 1: Prototype Property Reflection Guard in getScript', () => {
    it('returns null for all Object.prototype property names when unpersisted', async () => {
      for (const prop of PROTOTYPE_PROPERTIES) {
        const result = await getScript(prop);
        expect(result, `getScript("${prop}") must return null`).toBeNull();
      }
    });

    it('returns null for empty strings, null, undefined, and non-string types', async () => {
      expect(await getScript('')).toBeNull();
      expect(await getScript(null as any)).toBeNull();
      expect(await getScript(undefined as any)).toBeNull();
      expect(await getScript(123 as any)).toBeNull();
      expect(await getScript({} as any)).toBeNull();
    });
  });

  describe('Adversarial Check 2: Prototype Property Mutation Guard in toggleScript', () => {
    it('rejects all Object.prototype property names without mutating Object.prototype', async () => {
      const originalProtoSnapshot = Object.getOwnPropertyDescriptors(Object.prototype);

      for (const prop of PROTOTYPE_PROPERTIES) {
        await expect(
          toggleScript(prop),
          `toggleScript("${prop}") should reject with not found`
        ).rejects.toThrow(`Script with ID "${prop}" not found`);

        // Verify Object.prototype property was NOT modified
        if (prop !== '__proto__') {
          expect((Object.prototype as any)[prop]).toBe(
            originalProtoSnapshot[prop]?.value || (Object.prototype as any)[prop]
          );
          expect((Object.prototype as any)[`${prop}_enabled`]).toBeUndefined();
          expect(((Object.prototype as any)[prop] as any)?.enabled).toBeUndefined();
          expect(((Object.prototype as any)[prop] as any)?.updatedAt).toBeUndefined();
        }
      }
    });
  });

  describe('Adversarial Check 3: saveScript __proto__ rejection and reserved key protection', () => {
    it('rejects saveScript with id "__proto__"', async () => {
      await expect(
        saveScript({
          id: '__proto__',
          name: 'Malicious Script',
          code: 'console.log("pwned")'
        })
      ).rejects.toThrow('Invalid script ID: "__proto__" is reserved');

      expect(await getScript('__proto__')).toBeNull();
      expect((Object.prototype as any).code).toBeUndefined();
      expect((Object.prototype as any).name).toBeUndefined();
    });

    it('allows saving and managing legitimate scripts named after non-__proto__ prototype methods safely', async () => {
      const legitimateKeys = ['toString', 'valueOf', 'constructor'];

      for (const key of legitimateKeys) {
        const saved = await saveScript({
          id: key,
          name: `Custom ${key} Script`,
          code: `// ==UserScript==\n// @name Custom ${key}\n// ==/UserScript==\nconsole.log("${key}");`
        });

        expect(saved.id).toBe(key);
        expect(saved.name).toBe(`Custom ${key} Script`);

        // Ensure Object.prototype itself was not polluted or overwritten
        expect(typeof Object.prototype.toString).toBe('function');
        expect(typeof Object.prototype.valueOf).toBe('function');
        expect(Object.prototype.constructor).toBe(Object);

        // Fetch script by ID
        const fetched = await getScript(key);
        expect(fetched).not.toBeNull();
        expect(fetched?.id).toBe(key);
        expect(fetched?.name).toBe(`Custom ${key} Script`);

        // Toggle script
        const toggledStatus = await toggleScript(key);
        expect(toggledStatus).toBe(false);

        // Object.prototype remains clean
        expect(typeof Object.prototype.toString).toBe('function');
        expect((Object.prototype.toString as any).enabled).toBeUndefined();

        // Delete script
        await deleteScript(key);
        expect(await getScript(key)).toBeNull();

        // Object.prototype remains intact after deletion
        expect(typeof Object.prototype.toString).toBe('function');
        expect(typeof Object.prototype.valueOf).toBe('function');
      }
    });
  });

  describe('Adversarial Check 4: importScripts sanitization & prototype pollution prevention', () => {
    it('sanitizes id "__proto__" in import array and prevents prototype pollution with overwrite=true', async () => {
      const importPayload = [
        {
          id: '__proto__',
          name: 'Proto Attack',
          code: '// ==UserScript==\n// @name Proto Attack\n// ==/UserScript=='
        }
      ];

      const res = await importScripts(importPayload, { overwrite: true });
      expect(res.total).toBe(1);
      expect(res.imported).toBe(1);
      expect(res.scripts).toBeDefined();
      expect(res.scripts![0].id).not.toBe('__proto__');
      expect(res.scripts![0].id.length).toBeGreaterThan(0);

      expect((Object.prototype as any).name).toBeUndefined();
      expect((Object.prototype as any).code).toBeUndefined();
      expect(await getScript('__proto__')).toBeNull();
    });

    it('sanitizes id "__proto__" in raw JSON string import', async () => {
      const jsonString = JSON.stringify([
        {
          id: '__proto__',
          name: 'JSON Proto Attack',
          code: '// ==UserScript==\n// @name JSON Proto Attack\n// ==/UserScript=='
        }
      ]);

      const res = await importScripts(jsonString, { overwrite: true });
      expect(res.total).toBe(1);
      expect(res.imported).toBe(1);
      expect(res.scripts![0].id).not.toBe('__proto__');
      expect((Object.prototype as any).name).toBeUndefined();
      expect(await getScript('__proto__')).toBeNull();
    });

    it('imports unpersisted prototype keys (e.g. toString) without false collision', async () => {
      const payload = [
        {
          id: 'toString',
          name: 'Imported ToString',
          code: '// ==UserScript==\n// @name Imported ToString\n// ==/UserScript=='
        }
      ];

      const res = await importScripts(payload, { overwrite: false });
      expect(res.total).toBe(1);
      expect(res.imported).toBe(1);
      expect(res.updated).toBe(0);
      expect(res.scripts![0].id).toBe('toString');

      const fetched = await getScript('toString');
      expect(fetched?.name).toBe('Imported ToString');

      await deleteScript('toString');
    });
  });

  describe('Adversarial Check 5: Tab session & defaults prototype resistance', () => {
    it('getTabSession rejects prototype keys and non-numbers safely', async () => {
      expect(await getTabSession('__proto__' as any)).toBeUndefined();
      expect(await getTabSession(NaN)).toBeUndefined();
      expect(await getTabSession(null as any)).toBeUndefined();
      expect(await getTabSession(undefined as any)).toBeUndefined();
    });

    it('deleteTabSession handles prototype keys without mutation', async () => {
      await expect(deleteTabSession('__proto__' as any)).resolves.not.toThrow();
      expect((Object.prototype as any).tabId).toBeUndefined();
    });

    it('getStorageItem ignores __proto__ and empty keys on storage result', async () => {
      expect(await getStorageItem('__proto__')).toBeUndefined();
      expect(await getStorageItem('')).toBeUndefined();
      expect(await getStorageItem(null as any)).toBeUndefined();
      expect(await getStorageItem(undefined as any)).toBeUndefined();
    });
  });

  describe('Adversarial Check 6: Concurrent attack stress test', () => {
    it('handles 50 concurrent malicious calls without deadlocking or prototype corruption', async () => {
      const operations: Promise<any>[] = [];

      for (let i = 0; i < 50; i++) {
        const prop = PROTOTYPE_PROPERTIES[i % PROTOTYPE_PROPERTIES.length];
        if (i % 3 === 0) {
          // getScript prototype key
          operations.push(getScript(prop));
        } else if (i % 3 === 1) {
          // toggleScript prototype key (should reject)
          operations.push(
            toggleScript(prop).catch((err) => {
              expect(err.message).toMatch(/not found/i);
            })
          );
        } else {
          // saveScript with __proto__ (should reject)
          operations.push(
            saveScript({ id: '__proto__', code: 'x = 1;' }).catch((err) => {
              expect(err.message).toMatch(/reserved/i);
            })
          );
        }
      }

      await Promise.all(operations);

      // Verify Object.prototype integrity
      expect(typeof Object.prototype.toString).toBe('function');
      expect((Object.prototype as any).code).toBeUndefined();
      expect((Object.prototype as any).enabled).toBeUndefined();

      // Verify normal operations continue to succeed
      const normalScript = await saveScript({
        name: 'Post-Stress Normal Script',
        code: '// ==UserScript==\n// @name Normal\n// ==/UserScript=='
      });
      expect(normalScript.id).toBeDefined();
      const retrieved = await getScript(normalScript.id);
      expect(retrieved?.name).toBe('Post-Stress Normal Script');
    });
  });
});
