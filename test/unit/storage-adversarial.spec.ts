/**
 * XOKJ Storage Subsystem - Adversarial Challenger Test Suite
 * Location: test/unit/storage-adversarial.spec.ts
 *
 * Comprehensive adversarial verification of:
 * - Malformed / malicious script inputs (invalid metadata, null bytes, special characters in IDs)
 * - Edge case values (null, undefined, NaN, deep recursion, circular references, >2MB payloads, prototype pollution)
 * - Chrome storage failure simulation (get/set/remove rejection, mutex fault tolerance, unhandled rejections guard)
 * - Import bundle fuzzing (corrupt JSON, non-array inputs, missing fields, mixed batch robustness)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  prepareScriptRecord,
  validateScriptRecord,
  isScriptRecord
} from '@/shared/storage/script-record';
import {
  deepClone,
  deepFreeze,
  STORAGE_KEYS
} from '@/shared/storage/defaults';
import { storageMutex } from '@/shared/storage/mutex';
import type { ScriptRecord } from '@/shared/types';

describe('Adversarial Storage Challenge Suite (m2_challenger_2_gen3)', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
    await clearGmValues();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Group 1: Malformed & Malicious Script Inputs
  // =========================================================================
  describe('Group 1: Malformed & Malicious Script Inputs', () => {
    it('G1.1: Script with no metadata block saves safely and defaults to "Unnamed Script"', async () => {
      const bareScript = {
        code: 'console.log("No metadata header at all");'
      };

      const saved = await saveScript(bareScript);
      expect(saved.id).toBeDefined();
      expect(saved.name).toBe('Unnamed Script');
      expect(saved.code).toBe(bareScript.code);
      expect(saved.enabled).toBe(true);
      expect(saved.metadata).toBeDefined();
      expect(saved.metadata.matches).toEqual([]);
      expect(saved.metadata.name).toBe('Unnamed Script');

      const fetched = await getScript(saved.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('Unnamed Script');
    });

    it('G1.2: Script with unclosed/corrupted // ==UserScript== header saves safely and records parseErrors', async () => {
      const corruptedCode = `// ==UserScript==
// @name Corrupted Header Script
// @match *://*.example.com/*
// Missing closing tag
console.log("Corrupted");`;

      const saved = await saveScript({ code: corruptedCode });
      expect(saved.name).toBe('Corrupted Header Script');
      expect(saved.parseErrors).toBeDefined();
      expect(saved.parseErrors!.length).toBeGreaterThan(0);
      expect(saved.parseErrors![0]).toMatch(/unclosed/i);

      // Verify it can be retrieved and retains parseErrors
      const fetched = await getScript(saved.id);
      expect(fetched?.parseErrors).toEqual(saved.parseErrors);
    });

    it('G1.3: Script with malformed @cdp directives and invalid JSON params handles gracefully', async () => {
      const codeWithBadCdp = `// ==UserScript==
// @name Bad CDP Script
// @match *://*/*
// @grant GM_cdp
// @cdp Network.enable { invalid json here: ???
// @cdp
// @cdp 12345.badDomain
// ==/UserScript==
console.log("bad cdp");`;

      const saved = await saveScript({ code: codeWithBadCdp });
      expect(saved.name).toBe('Bad CDP Script');
      expect(saved.parseErrors).toBeDefined();
      expect(saved.parseErrors!.length).toBeGreaterThanOrEqual(1);

      // Verify storage integrity remains intact
      const all = await getScriptList();
      expect(all.some((s) => s.id === saved.id)).toBe(true);
    });

    it('G1.4: Script with empty name ("") falls back to metadata name or "Unnamed Script"', async () => {
      // Case A: empty name, valid metadata name
      const scriptWithMetaName = {
        name: '',
        code: '// ==UserScript==\n// @name Real Meta Name\n// ==/UserScript=='
      };
      const savedA = await saveScript(scriptWithMetaName);
      expect(savedA.name).toBe('Real Meta Name');

      // Case B: empty name, empty metadata
      const scriptNoMeta = {
        name: '',
        code: 'const x = 1;'
      };
      const savedB = await saveScript(scriptNoMeta);
      expect(savedB.name).toBe('Unnamed Script');
    });

    it('G1.5: Script name, code, and metadata with embedded null bytes (\\0) persist accurately', async () => {
      const nullByteId = 'script\u0000with\u0000nulls';
      const nullByteName = 'Malicious\u0000Script\u0000Name';
      const nullByteCode = '// ==UserScript==\n// @name NullByte\n// ==/UserScript==\nconst secret = "\u0000secret\u0000";';

      const saved = await saveScript({
        id: nullByteId,
        name: nullByteName,
        code: nullByteCode
      });

      expect(saved.id).toBe(nullByteId);
      expect(saved.name).toBe(nullByteName);
      expect(saved.code).toBe(nullByteCode);

      const retrieved = await getScript(nullByteId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(nullByteId);
      expect(retrieved!.name).toBe(nullByteName);
      expect(retrieved!.code).toBe(nullByteCode);
    });

    it('G1.6: Special characters in script ID (path traversal, HTML tags, SQL injection, unicode, emojis)', async () => {
      const specialIds = [
        '../../../../etc/passwd',
        '..\\..\\windows\\system32',
        '<script>alert("xss")</script>',
        'DROP TABLE scripts; --',
        '🚀🔥userscript_emoji_🎉',
        'script:with:colons/and/slashes?query=1&arg=2#hash',
        '   spaces-in-id-test   '
      ];

      for (const id of specialIds) {
        const saved = await saveScript({
          id,
          name: `Test for ${id}`,
          code: `// ==UserScript==\n// @match *://*/*\n// ==/UserScript==\nconsole.log("${id}");`
        });
        expect(saved.id).toBe(id);

        const fetched = await getScript(id);
        expect(fetched).not.toBeNull();
        expect(fetched!.id).toBe(id);

        const deleted = await deleteScript(id);
        const afterDelete = await getScript(id);
        expect(afterDelete).toBeNull();
      }
    });

    it('G1.7: Prototype property names as script ID ("constructor", "prototype")', async () => {
      // Save script with ID 'constructor'
      const constructorScript = await saveScript({
        id: 'constructor',
        name: 'Constructor Script',
        code: '// ==UserScript==\n// @match *://*/*\n// ==/UserScript=='
      });
      expect(constructorScript.id).toBe('constructor');

      const fetchedConstructor = await getScript('constructor');
      expect(fetchedConstructor).not.toBeNull();
      expect(fetchedConstructor?.name).toBe('Constructor Script');

      // Save script with ID 'prototype'
      const prototypeScript = await saveScript({
        id: 'prototype',
        name: 'Prototype Script',
        code: '// ==UserScript==\n// @match *://*/*\n// ==/UserScript=='
      });
      expect(prototypeScript.id).toBe('prototype');

      const fetchedPrototype = await getScript('prototype');
      expect(fetchedPrototype).not.toBeNull();
      expect(fetchedPrototype?.name).toBe('Prototype Script');

      // Clean up
      await deleteScript('constructor');
      await deleteScript('prototype');
    });

    it('G1.8: scripts-repo safely returns null when queried with unpersisted prototype property keys', async () => {
      // Querying an unpersisted ID that matches an Object.prototype method returns null
      // because getScript() uses Object.prototype.hasOwnProperty.call(scripts, id) and disallows __proto__
      expect(await getScript('toString')).toBeNull();
      expect(await getScript('valueOf')).toBeNull();
      expect(await getScript('__proto__')).toBeNull();
    });

    it('G1.9: toggleScript on unpersisted prototype property name throws without mutating prototype', async () => {
      // toggleScript('toString') throws "Script with ID toString not found"
      // without mutating Object.prototype.toString
      await expect(toggleScript('toString')).rejects.toThrow('Script with ID "toString" not found');
      expect((Object.prototype.toString as any).enabled).toBeUndefined();
      expect((Object.prototype.toString as any).updatedAt).toBeUndefined();

      await expect(toggleScript('__proto__')).rejects.toThrow('Script with ID "__proto__" not found');
    });

    it('G1.10: Saving a script with id "__proto__" throws and rejects prototype pollution', async () => {
      await expect(
        saveScript({
          id: '__proto__',
          name: 'Exploit',
          code: 'console.log(1)'
        })
      ).rejects.toThrow('Invalid script ID: "__proto__" is reserved');

      const allScripts = await getScriptList();
      expect(allScripts.some((s) => s.id === '__proto__')).toBe(false);
      expect(await getScript('__proto__')).toBeNull();
    });
  });

  // =========================================================================
  // Group 2: Edge Case Values, Large Payload Stress & Prototype Pollution
  // =========================================================================
  describe('Group 2: Edge Case Values, Large Payload Stress & Prototype Pollution', () => {
    it('G2.1: Storage of primitive boundary values: null, undefined, NaN, Infinity', async () => {
      const scriptId = 'script-edge-primitives';

      // 1. null
      await setGmValue(scriptId, 'nullVal', null);
      expect(await getGmValue(scriptId, 'nullVal')).toBeNull();

      // 2. undefined deletes the key
      await setGmValue(scriptId, 'tempKey', 'to-be-deleted');
      expect(await getGmValue(scriptId, 'tempKey')).toBe('to-be-deleted');
      await setGmValue(scriptId, 'tempKey', undefined);
      expect(await getGmValue(scriptId, 'tempKey')).toBeUndefined();
      expect(await getGmValue(scriptId, 'tempKey', 'default-val')).toBe('default-val');

      // 3. NaN and Infinity
      await setGmValue(scriptId, 'nanVal', NaN);
      const nanRes = await getGmValue(scriptId, 'nanVal');
      expect(Number.isNaN(nanRes as number)).toBe(true);

      await setGmValue(scriptId, 'infVal', Infinity);
      expect(await getGmValue(scriptId, 'infVal')).toBe(Infinity);

      await setGmValue(scriptId, 'negInfVal', -Infinity);
      expect(await getGmValue(scriptId, 'negInfVal')).toBe(-Infinity);
    });

    it('G2.2: Deeply nested objects (depth = 30 and depth = 50) persist without stack overflow', async () => {
      const scriptId = 'script-deep-nesting';

      // Construct object with nesting depth of 50
      let deepObj: any = { value: 'deep-core', level: 50 };
      for (let i = 49; i >= 1; i--) {
        deepObj = { child: deepObj, level: i };
      }

      await setGmValue(scriptId, 'deepKey', deepObj);

      const retrieved: any = await getGmValue(scriptId, 'deepKey');
      expect(retrieved).toBeDefined();
      expect(retrieved.level).toBe(1);

      // Traverse down to 50
      let curr = retrieved;
      for (let i = 1; i <= 49; i++) {
        expect(curr.level).toBe(i);
        curr = curr.child;
      }
      expect(curr.level).toBe(50);
      expect(curr.value).toBe('deep-core');
    });

    it('G2.3: Circular references in setGmValue handle via structuredClone without crash', async () => {
      const scriptId = 'script-circular-ref';
      const circularObj: any = { name: 'cycle', count: 1 };
      circularObj.self = circularObj;

      // structuredClone handles cyclic references natively
      await setGmValue(scriptId, 'cycleKey', circularObj);

      const retrieved: any = await getGmValue(scriptId, 'cycleKey');
      expect(retrieved).toBeDefined();
      expect(retrieved.name).toBe('cycle');
      expect(retrieved.self).toBe(retrieved); // Self-referential graph preserved
    });

    it('G2.4: Huge string payloads (>2MB) in setGmValue and script source code', async () => {
      const scriptId = 'script-huge-payload';
      // 2MB string payload
      const hugeString = 'X'.repeat(2 * 1024 * 1024);

      await setGmValue(scriptId, 'hugeStringKey', hugeString);
      const retrieved = await getGmValue<string>(scriptId, 'hugeStringKey');
      expect(retrieved).toBeDefined();
      expect(retrieved!.length).toBe(2 * 1024 * 1024);
      expect(retrieved!.charAt(0)).toBe('X');
      expect(retrieved!.charAt(2 * 1024 * 1024 - 1)).toBe('X');

      // Huge script source code (1MB)
      const hugeCode = `// ==UserScript==\n// @name Huge Code Script\n// @match *://*/*\n// ==/UserScript==\n/* ${'A'.repeat(1024 * 1024)} */`;
      const savedScript = await saveScript({
        id: 'huge-code-script',
        code: hugeCode
      });
      expect(savedScript.code.length).toBeGreaterThan(1024 * 1024);

      const fetchedScript = await getScript('huge-code-script');
      expect(fetchedScript?.code.length).toBe(savedScript.code.length);
    });

    it('G2.5: Prototype pollution keys ("__proto__", "constructor", "prototype") do NOT pollute Object.prototype', async () => {
      const scriptId = 'script-proto-pollution';

      // 1. setGmValue with '__proto__'
      await setGmValue(scriptId, '__proto__', { injected: 'malicious-proto' });

      // Check global Object.prototype is unpolluted
      expect((Object.prototype as any).injected).toBeUndefined();
      expect(({} as any).injected).toBeUndefined();

      // 2. setGmValues with payload containing '__proto__' and 'constructor'
      const maliciousPayload = {
        '__proto__': { admin: true },
        'constructor': { prototype: { pwned: true } },
        'prototype': { compromised: true },
        'regularKey': 'safe-value'
      };

      await setGmValues(scriptId, maliciousPayload as any);

      // Verify absolute protection of JavaScript prototype chain
      expect((Object.prototype as any).admin).toBeUndefined();
      expect((Object.prototype as any).pwned).toBeUndefined();
      expect((Object.prototype as any).compromised).toBeUndefined();
      expect(({} as any).admin).toBeUndefined();
      expect(({} as any).pwned).toBeUndefined();
      expect(({} as any).compromised).toBeUndefined();

      // Verify legitimate keys persist correctly
      const safe = await getGmValue(scriptId, 'regularKey');
      expect(safe).toBe('safe-value');
    });

    it('G2.6: Accessing non-existent prototype properties via getGmValue returns defaultValue', async () => {
      const scriptId = 'script-prototype-methods';

      // Querying built-in Object prototype names that were never set
      const protoMethods = ['toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'constructor'];

      for (const method of protoMethods) {
        const result = await getGmValue(scriptId, method, 'safe-default');
        expect(result).toBe('safe-default');

        const noDefault = await getGmValue(scriptId, method);
        expect(noDefault).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // Group 3: Chrome Storage Failure Simulation & Mutex Fault Tolerance
  // =========================================================================
  describe('Group 3: Chrome Storage Failure Simulation & Mutex Fault Tolerance', () => {
    it('G3.1: chrome.storage.local.set rejection throws error but does NOT deadlock mutex', async () => {
      const scriptId = 'script-set-failure';

      // Mock storage.set to reject
      const origSet = chrome.storage.local.set;
      (chrome.storage.local.set as any) = vi.fn().mockRejectedValueOnce(
        new Error('Simulated QuotaExceededError (disk full)')
      );

      // Call setGmValue: should reject with error
      await expect(setGmValue(scriptId, 'key1', 'val1')).rejects.toThrow(
        /Simulated QuotaExceededError/
      );

      // Restore set implementation
      (chrome.storage.local.set as any) = origSet;

      // Mutex must NOT be permanently locked; subsequent calls must succeed
      await setGmValue(scriptId, 'key2', 'val2');
      const val2 = await getGmValue(scriptId, 'key2');
      expect(val2).toBe('val2');
    });

    it('G3.2: chrome.storage.local.get failure in readBucket falls back to in-memory store', async () => {
      const scriptId = 'script-get-failure';

      // First successfully write to storage
      await setGmValue(scriptId, 'k1', 'persisted-value');

      // Now mock storage.get to reject
      const origGet = chrome.storage.local.get;
      (chrome.storage.local.get as any) = vi.fn().mockRejectedValue(
        new Error('Simulated chrome.storage.local read I/O error')
      );

      // getGmValues should catch the error and return the in-memory fallback without throwing
      const values = await getGmValues(scriptId);
      expect(values.k1).toBe('persisted-value');

      // getGmValue should also gracefully read without throwing
      const single = await getGmValue(scriptId, 'k1');
      expect(single).toBe('persisted-value');

      // Restore
      (chrome.storage.local.get as any) = origGet;
    });

    it('G3.3: chrome.storage.local.remove rejection during clearGmValues throws and cleans mutex', async () => {
      const scriptId = 'script-remove-failure';
      await setGmValue(scriptId, 'k1', 'val');

      const origRemove = chrome.storage.local.remove;
      (chrome.storage.local.remove as any) = vi.fn().mockRejectedValueOnce(
        new Error('Simulated remove failure')
      );

      await expect(clearGmValues(scriptId)).rejects.toThrow(/Simulated remove failure/);

      // Restore
      (chrome.storage.local.remove as any) = origRemove;

      // Mutex is unpoisoned: subsequent clear succeeds
      await expect(clearGmValues(scriptId)).resolves.not.toThrow();
    });

    it('G3.4: saveScript releases storageMutex when chrome.storage.local.set fails', async () => {
      const origSet = chrome.storage.local.set;
      (chrome.storage.local.set as any) = vi.fn().mockRejectedValueOnce(
        new Error('Storage disk I/O write failure')
      );

      await expect(
        saveScript({
          id: 'failing-script',
          code: 'console.log("fail");'
        })
      ).rejects.toThrow('Storage disk I/O write failure');

      // Verify storageMutex is unlocked
      expect(storageMutex.isLocked()).toBe(false);

      // Restore
      (chrome.storage.local.set as any) = origSet;

      // Next saveScript succeeds normally
      const recovered = await saveScript({
        id: 'failing-script',
        code: 'console.log("recovered");'
      });
      expect(recovered.id).toBe('failing-script');
    });

    it('G3.5: No unhandled rejections during simulated asynchronous storage latency spikes', async () => {
      const unhandledRejections: any[] = [];
      const onUnhandled = (event: any) => {
        unhandledRejections.push(event);
      };
      process.on('unhandledRejection', onUnhandled);

      try {
        const scriptId = 'script-latency-spike';

        // Simulate 20 concurrent operations with random latencies and intermittent errors
        const tasks: Promise<any>[] = [];
        for (let i = 0; i < 20; i++) {
          tasks.push(
            (async () => {
              if (i % 7 === 0) {
                // Deliberately trigger input validation failure
                try {
                  await setGmValue('', 'k', 'v');
                } catch {
                  // expected handled error
                }
              } else {
                await setGmValue(scriptId, `key_${i}`, i);
              }
            })()
          );
        }

        await Promise.all(tasks);
        expect(unhandledRejections.length).toBe(0);
      } finally {
        process.removeListener('unhandledRejection', onUnhandled);
      }
    });
  });

  // =========================================================================
  // Group 4: Import Bundle Fuzzing & Corrupt Data Ingestion
  // =========================================================================
  describe('Group 4: Import Bundle Fuzzing & Corrupt Data Ingestion', () => {
    it('G4.1: Corrupted or truncated JSON strings in importScripts report parse errors gracefully', async () => {
      const invalidJsonPayloads = [
        '{ truncated json:',
        '{"scripts": [{"code": "unclosed',
        '{"version": 1, scripts: [bad]}',
        '<<< XML NOT JSON >>>',
        'undefined',
        'NaN',
        '{"__proto__": 123'
      ];

      for (const payload of invalidJsonPayloads) {
        const res = await importScripts(payload);
        expect(res.total).toBe(0);
        expect(res.imported).toBe(0);
        expect(res.errors).toBeDefined();
        expect(res.errors!.length).toBeGreaterThan(0);
        expect(res.errors![0]).toMatch(/parse error/i);
      }
    });

    it('G4.2: Empty strings, whitespace, and non-script primitives fail safely', async () => {
      const nonScriptPayloads = [
        '',
        '    ',
        '\n\t\r',
        '12345',
        '"just a plain string"',
        'true',
        'false',
        'null'
      ];

      for (const payload of nonScriptPayloads) {
        const res = await importScripts(payload);
        expect(res.total).toBe(0);
        expect(res.imported).toBe(0);
        expect(res.errors!.length).toBeGreaterThan(0);
      }
    });

    it('G4.3: Non-string, non-array inputs (numbers, booleans, null, undefined) reject safely', async () => {
      const nonInputs = [null, undefined, 42, true, false, Symbol('test')];

      for (const input of nonInputs) {
        const res = await importScripts(input);
        expect(res.total).toBe(0);
        expect(res.imported).toBe(0);
        expect(res.errors!.length).toBeGreaterThan(0);
        expect(res.errors![0]).toMatch(/must be a JSON string, a script object, or an array/i);
      }
    });

    it('G4.4: Incomplete script objects (missing "code", null items) are reported and skipped', async () => {
      const corruptArray = [
        null,
        undefined,
        {},
        { name: 'Missing Code' },
        { code: 12345 }, // invalid type
        { code: null }
      ];

      const res = await importScripts(corruptArray as any);
      expect(res.total).toBe(6);
      expect(res.imported).toBe(0);
      expect(res.failed).toBe(6);
      expect(res.errors!.length).toBe(6);
      expect(res.scripts).toEqual([]);
    });

    it('G4.5: Mixed batch import (valid, null, invalid code, unclosed header) processes all valid scripts', async () => {
      const mixedBatch = [
        // Item 1: Valid script with custom metadata
        {
          code: '// ==UserScript==\n// @name Valid Script 1\n// @match *://*.valid1.com/*\n// ==/UserScript=='
        },
        // Item 2: Corrupt null item
        null,
        // Item 3: Missing code property
        { name: 'Missing Code Item', enabled: true },
        // Item 4: Script with unclosed header (valid source, records parse error)
        {
          code: '// ==UserScript==\n// @name Valid Script 2 (unclosed)\nconsole.log("runs");'
        },
        // Item 5: Valid minimal script without header
        {
          code: 'console.log("Minimal script without header");'
        }
      ];

      const res = await importScripts(mixedBatch as any);
      expect(res.total).toBe(5);
      expect(res.imported).toBe(3); // Items 1, 4, 5
      expect(res.failed).toBe(2);   // Items 2, 3
      expect(res.errors!.length).toBe(2);
      expect(res.scripts!.length).toBe(3);

      // Verify scripts actually persisted into storage
      const scriptList = await getScriptList();
      expect(scriptList.some((s) => s.name === 'Valid Script 1')).toBe(true);
      expect(scriptList.some((s) => s.name === 'Valid Script 2 (unclosed)')).toBe(true);
      expect(scriptList.some((s) => s.name === 'Unnamed Script')).toBe(true);
    });

    it('G4.6: Overwrite behavior: overwrite: false resolves ID collisions; overwrite: true updates existing', async () => {
      const initialScript = await saveScript({
        id: 'collision-test-id',
        name: 'Initial Script',
        code: '// ==UserScript==\n// @name Initial\n// ==/UserScript=='
      });

      // 1. Import with same ID and overwrite = false
      const nonOverwriteRes = await importScripts(
        [
          {
            id: 'collision-test-id',
            name: 'Attempted Duplicate',
            code: '// ==UserScript==\n// @name Duplicate Code\n// ==/UserScript=='
          }
        ],
        { overwrite: false }
      );

      expect(nonOverwriteRes.imported).toBe(1);
      expect(nonOverwriteRes.updated).toBe(0);
      // New script must have been assigned an auto-generated unique ID
      const newScriptId = nonOverwriteRes.scripts![0].id;
      expect(newScriptId).not.toBe('collision-test-id');

      // Original script remains unchanged
      const orig = await getScript('collision-test-id');
      expect(orig?.name).toBe('Initial Script');

      // 2. Import with same ID and overwrite = true
      const overwriteRes = await importScripts(
        [
          {
            id: 'collision-test-id',
            name: 'Overwritten Script',
            code: '// ==UserScript==\n// @name Overwritten\n// ==/UserScript=='
          }
        ],
        { overwrite: true }
      );

      expect(overwriteRes.updated).toBe(1);
      expect(overwriteRes.imported).toBe(0);

      // Original script now has updated name and code
      const updated = await getScript('collision-test-id');
      expect(updated?.name).toBe('Overwritten Script');
    });

    it('G4.7: Single userscript raw string format (// ==UserScript==...) imports directly', async () => {
      const rawUserScriptText = `// ==UserScript==
// @name Single Raw Import
// @namespace https://xokj.dev
// @version 2.0.0
// @match *://example.com/*
// @grant none
// ==/UserScript==

(function() {
  console.log("Raw userscript imported cleanly");
})();`;

      const res = await importScripts(rawUserScriptText);
      expect(res.total).toBe(1);
      expect(res.imported).toBe(1);
      expect(res.failed).toBe(0);
      expect(res.scripts![0].name).toBe('Single Raw Import');
      expect(res.scripts![0].metadata.version).toBe('2.0.0');

      const retrieved = await getScript(res.scripts![0].id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.metadata.matches).toContain('*://example.com/*');
    });

    it('G4.8: importScripts with id "__proto__" sanitizes ID and generates safe UUID without prototype pollution', async () => {
      const res = await importScripts(
        [
          {
            id: '__proto__',
            name: 'Malicious Proto Import',
            code: '// ==UserScript==\n// @name Malicious Proto\n// ==/UserScript=='
          }
        ],
        { overwrite: true }
      );

      expect(res.total).toBe(1);
      expect(res.imported).toBe(1);
      expect(res.scripts![0].id).not.toBe('__proto__');
      expect((Object.prototype as any).name).toBeUndefined();
      expect(await getScript('__proto__')).toBeNull();
    });

    it('G4.9: importScripts with unpersisted prototype key ("toString") is treated as new import, not update', async () => {
      const res = await importScripts(
        [
          {
            id: 'toString',
            name: 'ToString Script',
            code: '// ==UserScript==\n// @name ToString Script\n// ==/UserScript=='
          }
        ],
        { overwrite: false }
      );

      expect(res.total).toBe(1);
      expect(res.imported).toBe(1);
      expect(res.updated).toBe(0);
      expect(res.scripts![0].id).toBe('toString');

      const fetched = await getScript('toString');
      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe('ToString Script');

      // Clean up
      await deleteScript('toString');
      expect(await getScript('toString')).toBeNull();
    });
  });
});
