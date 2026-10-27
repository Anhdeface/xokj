/**
 * Empirical Challenger M2-2 Verification Suite
 * Target: Milestone 2 (Storage, Mutex Concurrency, Privilege Security & Lifecycle Cleanup)
 * 
 * Verifies:
 * 1. Sender authentication & privilege escalation guards in gm-handler.ts
 * 2. In-memory cache isolation in scripts-repo.ts
 * 3. Lifecycle cleanup & mutex release on deleteScript(id)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { GmStorageMessageHandler } from '@/background/gm-handler';
import {
  gmStorageRepo,
  getGmStorageKey,
  getGmValues,
  getGmValue,
  setGmValue,
  getAllGmStorage,
  clearGmValues
} from '@/shared/storage/gm-repo';
import {
  saveScript,
  getScript,
  getScripts,
  getScriptList,
  deleteScript,
  resetToDefaultScripts
} from '@/shared/storage/scripts-repo';
import type { ScriptRecord } from '@/shared/types';

describe('Empirical Challenger M2-2: Storage, Concurrency, Privilege Security & Lifecycle Verification', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let handler: GmStorageMessageHandler;

  beforeEach(async () => {
    context = setupChromeMock();
    (chrome.runtime as any).id = 'mock-extension-id-12345';
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
  // OBJECTIVE 1: Sender Authentication & Privilege Escalation Guards
  // =========================================================================
  describe('Objective 1: Sender Authentication & Privilege Escalation Guards (gm-handler.ts)', () => {
    let testScript: ScriptRecord;

    beforeEach(async () => {
      testScript = await saveScript({
        name: 'Target Userscript',
        code: `// ==UserScript==
// @name         Target Userscript
// @match        https://example.com/app/*
// @match        https://trusted.org/*
// @exclude      https://example.com/app/blocked
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==`,
        enabled: true
      });
    });

    describe('1.1 Forged Tab Messages Lacking Tab Context', () => {
      it('rejects sender with URL but no tab object', async () => {
        const res = await handler.processMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: testScript.id,
            key: 'token',
            value: 'stolen'
          },
          { url: 'https://evil.com' } as chrome.runtime.MessageSender
        );

        expect(res.success).toBe(false);
        expect(res.error).toBe('Unauthorized: Sender has no associated tab context');
      });

      it('rejects sender with empty tab object (tab without tab.id)', async () => {
        const res = await handler.processMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: testScript.id,
            key: 'token',
            value: 'stolen'
          },
          { tab: {} as any, url: 'https://example.com/app/home' } as chrome.runtime.MessageSender
        );

        expect(res.success).toBe(false);
        expect(res.error).toBe('Unauthorized: Sender has no associated tab context');
      });

      it('rejects sender with tab.id=0 (falsy tab id)', async () => {
        const res = await handler.processMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: testScript.id,
            key: 'token',
            value: 'stolen'
          },
          { tab: { id: 0, url: 'https://example.com/app/home' } as any, url: 'https://example.com/app/home' } as chrome.runtime.MessageSender
        );

        expect(res.success).toBe(false);
        expect(res.error).toBe('Unauthorized: Sender has no associated tab context');
      });

      it('rejects sender with tab.id present but no sender url or tab url', async () => {
        const res = await handler.processMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: testScript.id,
            key: 'token',
            value: 'stolen'
          },
          { tab: { id: 101 } as any } as chrome.runtime.MessageSender
        );

        expect(res.success).toBe(false);
        expect(res.error).toBe('Unauthorized: Sender has no associated tab context');
      });
    });

    describe('1.2 Forged Tab Messages with Mismatched or Unauthorized Origins', () => {
      it('rejects sender tab from an untrusted origin not in @match', async () => {
        const res = await handler.processMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: testScript.id,
            key: 'secret',
            value: 'compromised'
          },
          {
            tab: { id: 102, url: 'https://attacker.evil.com/exploit' } as any,
            url: 'https://attacker.evil.com/exploit'
          } as chrome.runtime.MessageSender
        );

        expect(res.success).toBe(false);
        expect(res.error).toContain('Unauthorized: Sender URL');
        expect(res.error).toContain('not matched');
      });

      it('rejects sender tab matching script @exclude pattern', async () => {
        const res = await handler.processMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: testScript.id,
            key: 'secret',
            value: 'compromised'
          },
          {
            tab: { id: 103, url: 'https://example.com/app/blocked' } as any,
            url: 'https://example.com/app/blocked'
          } as chrome.runtime.MessageSender
        );

        expect(res.success).toBe(false);
        expect(res.error).toContain('Unauthorized: Sender URL');
        expect(res.error).toContain('is excluded');
      });

      it('rejects sender targeting a non-existent script ID', async () => {
        const res = await handler.processMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: 'non-existent-script-id',
            key: 'key',
            value: 'val'
          },
          {
            tab: { id: 104, url: 'https://example.com/app/home' } as any,
            url: 'https://example.com/app/home'
          } as chrome.runtime.MessageSender
        );

        expect(res.success).toBe(false);
        expect(res.error).toBe('Script "non-existent-script-id" not found');
      });

      it('rejects sender targeting a disabled script', async () => {
        testScript.enabled = false;
        await saveScript(testScript);

        const res = await handler.processMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: testScript.id,
            key: 'key',
            value: 'val'
          },
          {
            tab: { id: 105, url: 'https://example.com/app/home' } as any,
            url: 'https://example.com/app/home'
          } as chrome.runtime.MessageSender
        );

        expect(res.success).toBe(false);
        expect(res.error).toBe(`Script "${testScript.id}" is disabled`);
      });
    });

    describe('1.3 Privilege Escalation via Grants Enforcement', () => {
      it('strictly rejects when script declared @grant none', async () => {
        const grantNoneScript = await saveScript({
          name: 'Grant None Script',
          code: `// ==UserScript==
// @name   Grant None Script
// @match  https://grant-none.com/*
// @grant  none
// ==/UserScript==`,
          enabled: true
        });

        const sender: chrome.runtime.MessageSender = {
          tab: { id: 201, url: 'https://grant-none.com/page' } as any,
          url: 'https://grant-none.com/page'
        };

        const setRes = await handler.processMessage(
          { type: 'GM_STORAGE_SET', scriptId: grantNoneScript.id, key: 'k', value: 'v' },
          sender
        );
        expect(setRes.success).toBe(false);
        expect(setRes.error).toBe('Script declared @grant none');

        const delRes = await handler.processMessage(
          { type: 'GM_STORAGE_DELETE', scriptId: grantNoneScript.id, key: 'k' },
          sender
        );
        expect(delRes.success).toBe(false);
        expect(delRes.error).toBe('Script declared @grant none');
      });

      it('strictly rejects GM_STORAGE_SET when script only has @grant GM_getValue', async () => {
        const readOnlyScript = await saveScript({
          name: 'Read Only Script',
          code: `// ==UserScript==
// @name   Read Only Script
// @match  https://read-only.com/*
// @grant  GM_getValue
// ==/UserScript==`,
          enabled: true
        });

        const sender: chrome.runtime.MessageSender = {
          tab: { id: 202, url: 'https://read-only.com/page' } as any,
          url: 'https://read-only.com/page'
        };

        const setRes = await handler.processMessage(
          { type: 'GM_STORAGE_SET', scriptId: readOnlyScript.id, key: 'k', value: 'v' },
          sender
        );
        expect(setRes.success).toBe(false);
        expect(setRes.error).toBe('Script lacks grant for GM_STORAGE_SET');
      });

      it('allows GM_STORAGE_SET but rejects GM_STORAGE_DELETE when script only has @grant GM_setValue', async () => {
        const setOnlyScript = await saveScript({
          name: 'Set Only Script',
          code: `// ==UserScript==
// @name   Set Only Script
// @match  https://set-only.com/*
// @grant  GM_setValue
// ==/UserScript==`,
          enabled: true
        });

        const sender: chrome.runtime.MessageSender = {
          tab: { id: 203, url: 'https://set-only.com/page' } as any,
          url: 'https://set-only.com/page'
        };

        const setRes = await handler.processMessage(
          { type: 'GM_STORAGE_SET', scriptId: setOnlyScript.id, key: 'auth', value: 'granted' },
          sender
        );
        expect(setRes.success).toBe(true);

        const delRes = await handler.processMessage(
          { type: 'GM_STORAGE_DELETE', scriptId: setOnlyScript.id, key: 'auth' },
          sender
        );
        expect(delRes.success).toBe(false);
        expect(delRes.error).toBe('Script lacks grant for GM_STORAGE_DELETE');
      });

      it('allows both SET and DELETE when script has @grant * (wildcard)', async () => {
        const wildcardScript = await saveScript({
          name: 'Wildcard Script',
          code: `// ==UserScript==
// @name   Wildcard Script
// @match  https://wildcard.com/*
// @grant  *
// ==/UserScript==`,
          enabled: true
        });

        const sender: chrome.runtime.MessageSender = {
          tab: { id: 204, url: 'https://wildcard.com/app' } as any,
          url: 'https://wildcard.com/app'
        };

        const setRes = await handler.processMessage(
          { type: 'GM_STORAGE_SET', scriptId: wildcardScript.id, key: 'temp', value: 999 },
          sender
        );
        expect(setRes.success).toBe(true);
        expect(await getGmValue(wildcardScript.id, 'temp')).toBe(999);

        const delRes = await handler.processMessage(
          { type: 'GM_STORAGE_DELETE', scriptId: wildcardScript.id, key: 'temp' },
          sender
        );
        expect(delRes.success).toBe(true);
        expect(await getGmValue(wildcardScript.id, 'temp')).toBeUndefined();
      });
    });

    describe('1.4 External Extension & Cross-Extension Protection', () => {
      it('rejects external extension sender trying to manipulate userscript storage', async () => {
        const externalSender: chrome.runtime.MessageSender = {
          id: 'foreign-extension-id-12345',
          url: 'chrome-extension://foreign-extension-id-12345/options.html'
        };

        const res = await handler.processMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: testScript.id,
            key: 'exploit',
            value: 'injected'
          },
          externalSender
        );

        expect(res.success).toBe(false);
        expect(res.error).toBe('Unauthorized: Sender has no associated tab context');
      });
    });

    describe('1.5 Valid Internal Extension & Legitimate Userscript Handlers', () => {
      it('handles valid internal extension message (background/popup with chrome.runtime.id)', async () => {
        const internalSender: chrome.runtime.MessageSender = {
          id: chrome.runtime.id,
          url: `chrome-extension://${chrome.runtime.id}/popup/index.html`
        };

        const setRes = await handler.processMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: testScript.id,
            key: 'internal_pref',
            value: { theme: 'dark', zoom: 1.2 }
          },
          internalSender
        );
        expect(setRes.success).toBe(true);
        expect(await getGmValue(testScript.id, 'internal_pref')).toEqual({ theme: 'dark', zoom: 1.2 });

        const delRes = await handler.processMessage(
          {
            type: 'GM_STORAGE_DELETE',
            scriptId: testScript.id,
            key: 'internal_pref'
          },
          internalSender
        );
        expect(delRes.success).toBe(true);
        expect(await getGmValue(testScript.id, 'internal_pref')).toBeUndefined();
      });

      it('handles valid userscript tab request with matching origin and granted permissions', async () => {
        const validTabSender: chrome.runtime.MessageSender = {
          tab: { id: 301, url: 'https://example.com/app/dashboard' } as any,
          url: 'https://example.com/app/dashboard'
        };

        const setRes = await handler.processMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: testScript.id,
            key: 'user_state',
            value: { loggedIn: true, lastVisit: 123456789 }
          },
          validTabSender
        );
        expect(setRes.success).toBe(true);
        expect(await getGmValue(testScript.id, 'user_state')).toEqual({
          loggedIn: true,
          lastVisit: 123456789
        });

        const delRes = await handler.processMessage(
          {
            type: 'GM_STORAGE_DELETE',
            scriptId: testScript.id,
            key: 'user_state'
          },
          validTabSender
        );
        expect(delRes.success).toBe(true);
        expect(await getGmValue(testScript.id, 'user_state')).toBeUndefined();
      });
    });
  });

  // =========================================================================
  // OBJECTIVE 2: In-Memory Cache Isolation
  // =========================================================================
  describe('Objective 2: In-Memory Cache Isolation (scripts-repo.ts)', () => {
    it('mutating an object returned from getScripts() does NOT mutate the internal storage dictionary', async () => {
      const s1 = await saveScript({
        name: 'Original S1',
        code: '// ==UserScript==\n// @name Original S1\n// @grant GM_setValue\n// ==/UserScript==',
        enabled: true
      });

      // 1. Get scripts snapshot
      const scriptsRecord = await getScripts();
      expect(scriptsRecord[s1.id]).toBeDefined();
      expect(scriptsRecord[s1.id].name).toBe('Original S1');
      expect(scriptsRecord[s1.id].enabled).toBe(true);
      expect(scriptsRecord[s1.id].metadata?.grants).toEqual(['GM_setValue']);

      // 2. Perform deep in-memory mutations on the returned record
      scriptsRecord[s1.id].name = 'POISONED_NAME';
      scriptsRecord[s1.id].enabled = false;
      scriptsRecord[s1.id].code = '// CORRUPTED CODE';
      scriptsRecord[s1.id].metadata!.grants!.push('GM_xmlhttpRequest');
      (scriptsRecord as any)['INJECTED_KEY'] = { id: 'INJECTED_KEY', name: 'Malicious' };
      delete scriptsRecord[s1.id];

      // 3. Re-read storage via getScripts()
      const freshScripts = await getScripts();
      expect(freshScripts[s1.id]).toBeDefined();
      expect(freshScripts[s1.id].name).toBe('Original S1');
      expect(freshScripts[s1.id].enabled).toBe(true);
      expect(freshScripts[s1.id].code).toContain('Original S1');
      expect(freshScripts[s1.id].metadata?.grants).toEqual(['GM_setValue']);
      expect((freshScripts as any)['INJECTED_KEY']).toBeUndefined();

      // 4. Re-read storage via getScript(id)
      const freshSingle = await getScript(s1.id);
      expect(freshSingle).not.toBeNull();
      expect(freshSingle!.name).toBe('Original S1');
      expect(freshSingle!.enabled).toBe(true);
      expect(freshSingle!.metadata?.grants).toEqual(['GM_setValue']);
    });

    it('mutating array or items returned from getScriptList() does NOT mutate internal storage', async () => {
      const list1 = await getScriptList();
      const initialCount = list1.length;
      expect(initialCount).toBeGreaterThan(0);

      // Mutate list and its elements
      list1[0].name = 'MUTATED_IN_LIST';
      list1.pop();
      list1.push({ id: 'phantom', name: 'Phantom' } as any);

      const list2 = await getScriptList();
      expect(list2.length).toBe(initialCount);
      expect(list2[0].name).not.toBe('MUTATED_IN_LIST');
      expect(list2.find((s) => s.id === 'phantom')).toBeUndefined();
    });

    it('mutating object returned from getScript(id) does NOT mutate subsequent reads', async () => {
      const s = await saveScript({
        name: 'Single Script Test',
        code: '// ==UserScript==\n// @name Single Script Test\n// ==/UserScript==',
        enabled: true
      });

      const scriptCopy1 = await getScript(s.id);
      expect(scriptCopy1).not.toBeNull();
      scriptCopy1!.name = 'CHANGED_IN_COPY1';
      scriptCopy1!.metadata = { name: 'MUTATED' } as any;

      const scriptCopy2 = await getScript(s.id);
      expect(scriptCopy2!.name).toBe('Single Script Test');
      expect(scriptCopy2!.metadata?.name).toBe('Single Script Test');
    });
  });

  // =========================================================================
  // OBJECTIVE 3: deleteScript(id) Storage Bucket Purge and Mutex Release
  // =========================================================================
  describe('Objective 3: deleteScript(id) Bucket Purge & Mutex Release', () => {
    it('deleteScript(id) purges corresponding gm_values_${id} bucket and releases mutex', async () => {
      const script = await saveScript({
        name: 'Script For Deletion',
        code: '// ==UserScript==\n// @name Script For Deletion\n// @grant GM_setValue\n// ==/UserScript==',
        enabled: true
      });

      const scriptId = script.id;
      const bucketKey = getGmStorageKey(scriptId);

      // Persist multiple values into script's GM storage
      await setGmValue(scriptId, 'pref1', 'value1');
      await setGmValue(scriptId, 'pref2', { complex: [1, 2, 3] });
      await setGmValue(scriptId, 'counter', 100);

      // Verify bucket exists and values are readable
      const valuesBefore = await getGmValues(scriptId);
      expect(valuesBefore['pref1']).toBe('value1');
      expect(valuesBefore['pref2']).toEqual({ complex: [1, 2, 3] });
      expect(valuesBefore['counter']).toBe(100);

      // Verify chrome.storage.local contains the bucket key
      const localBefore = await chrome.storage.local.get(bucketKey);
      expect(localBefore[bucketKey]).toBeDefined();
      expect(localBefore[bucketKey]['pref1']).toBe('value1');

      // Verify script mutex was allocated and tracked in gmStorageRepo
      const mutexMap = (gmStorageRepo as any).scriptMutexes as Map<string, any>;
      expect(mutexMap.has(scriptId)).toBe(true);

      // Execute deleteScript(id)
      await deleteScript(scriptId);

      // 1. Verify script is removed from scripts repository
      expect(await getScript(scriptId)).toBeNull();
      const allScripts = await getScripts();
      expect(allScripts[scriptId]).toBeUndefined();

      // 2. Verify GM values bucket is completely purged
      const valuesAfter = await getGmValues(scriptId);
      expect(valuesAfter).toEqual({});
      expect(await getGmValue(scriptId, 'pref1')).toBeUndefined();

      // 3. Verify chrome.storage.local no longer contains bucketKey
      const localAfter = await chrome.storage.local.get(bucketKey);
      expect(localAfter[bucketKey]).toBeUndefined();

      // 4. Verify getAllGmStorage() no longer contains scriptId
      const allGm = await getAllGmStorage();
      expect(allGm[scriptId]).toBeUndefined();

      // 5. Verify script mutex is purged from memory
      expect(mutexMap.has(scriptId)).toBe(false);
    });

    it('deleting one script does not affect sibling scripts storage buckets or mutexes', async () => {
      const s1 = await saveScript({
        name: 'Script Sibling 1',
        code: '// ==UserScript==\n// @name Script Sibling 1\n// ==/UserScript==',
        enabled: true
      });
      const s2 = await saveScript({
        name: 'Script Sibling 2',
        code: '// ==UserScript==\n// @name Script Sibling 2\n// ==/UserScript==',
        enabled: true
      });

      await setGmValue(s1.id, 's1_key', 's1_value');
      await setGmValue(s2.id, 's2_key', 's2_value');

      const mutexMap = (gmStorageRepo as any).scriptMutexes as Map<string, any>;
      expect(mutexMap.has(s1.id)).toBe(true);
      expect(mutexMap.has(s2.id)).toBe(true);

      // Delete S1
      await deleteScript(s1.id);

      // Verify S1 is gone
      expect(await getScript(s1.id)).toBeNull();
      expect(await getGmValue(s1.id, 's1_key')).toBeUndefined();
      expect(mutexMap.has(s1.id)).toBe(false);

      // Verify S2 is completely intact
      expect(await getScript(s2.id)).not.toBeNull();
      expect(await getGmValue(s2.id, 's2_key')).toBe('s2_value');
      expect(mutexMap.has(s2.id)).toBe(true);
    });

    it('concurrent writes interleaved with deleteScript do not deadlock or leave orphaned state', async () => {
      const script = await saveScript({
        name: 'Concurrent Delete Script',
        code: '// ==UserScript==\n// @name Concurrent Delete Script\n// ==/UserScript==',
        enabled: true
      });

      const writePromises = Array.from({ length: 25 }, (_, i) =>
        setGmValue(script.id, `key_${i}`, `val_${i}`)
      );

      // Trigger deletion mid-flight
      const deletePromise = deleteScript(script.id);

      // Await all operations
      await Promise.allSettled([...writePromises, deletePromise]);

      // Ensure script record is deleted
      expect(await getScript(script.id)).toBeNull();

      // Ensure mutex cleanup
      const mutexMap = (gmStorageRepo as any).scriptMutexes as Map<string, any>;
      // If mutex exists due to a trailing write that settled after delete, clearGmValues safely frees it
      await clearGmValues(script.id);
      expect(mutexMap.has(script.id)).toBe(false);
    });

    it('deleteScript handles non-existent IDs, empty IDs, and reserved IDs gracefully', async () => {
      await expect(deleteScript('')).resolves.toBeUndefined();
      await expect(deleteScript(null as any)).resolves.toBeUndefined();
      await expect(deleteScript(undefined as any)).resolves.toBeUndefined();
      await expect(deleteScript('__proto__')).resolves.toBeUndefined();
      await expect(deleteScript('non-existent-script-id')).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // OBJECTIVE 4: Prototype Pollution & Hostile Concurrency Stress
  // =========================================================================
  describe('Objective 4: Adversarial Prototype Hardening & Multi-Reader Concurrency', () => {
    it('storing reserved keys (__proto__, constructor, prototype) via gm-handler never pollutes Object.prototype', async () => {
      const script = await saveScript({
        name: 'Proto Test Script',
        code: `// ==UserScript==
// @name Proto Test Script
// @match https://proto-test.com/*
// @grant GM_setValue
// @grant GM_deleteValue
// ==/UserScript==`,
        enabled: true
      });

      const sender: chrome.runtime.MessageSender = {
        tab: { id: 401, url: 'https://proto-test.com/app' } as any,
        url: 'https://proto-test.com/app'
      };

      // 1. Attempt to store payload into __proto__
      const protoRes = await handler.processMessage(
        {
          type: 'GM_STORAGE_SET',
          scriptId: script.id,
          key: '__proto__',
          value: { exploit: 'PROTO_POLLUTED' }
        },
        sender
      );
      expect(protoRes.success).toBe(true);

      // Verify Object.prototype is NOT polluted
      expect((Object.prototype as any).exploit).toBeUndefined();
      expect((Object.prototype as any)['exploit']).toBeUndefined();

      // Verify retrieval returns the stored value as an own property
      const retrieved = await getGmValue(script.id, '__proto__');
      expect(retrieved).toEqual({ exploit: 'PROTO_POLLUTED' });
      expect((Object.prototype as any).exploit).toBeUndefined();

      // 2. Attempt to store payload into constructor
      const ctorRes = await handler.processMessage(
        {
          type: 'GM_STORAGE_SET',
          scriptId: script.id,
          key: 'constructor',
          value: 'OVERWRITTEN_CONSTRUCTOR'
        },
        sender
      );
      expect(ctorRes.success).toBe(true);
      expect(typeof Object.prototype.constructor).toBe('function');
      expect(await getGmValue(script.id, 'constructor')).toBe('OVERWRITTEN_CONSTRUCTOR');

      // 3. Attempt to store payload into prototype
      const protoPropRes = await handler.processMessage(
        {
          type: 'GM_STORAGE_SET',
          scriptId: script.id,
          key: 'prototype',
          value: { hijacked: true }
        },
        sender
      );
      expect(protoPropRes.success).toBe(true);
      expect((Object.prototype as any).hijacked).toBeUndefined();
      expect(await getGmValue(script.id, 'prototype')).toEqual({ hijacked: true });

      // Clean up bucket keys
      await handler.processMessage({ type: 'GM_STORAGE_DELETE', scriptId: script.id, key: '__proto__' }, sender);
      await handler.processMessage({ type: 'GM_STORAGE_DELETE', scriptId: script.id, key: 'constructor' }, sender);
      await handler.processMessage({ type: 'GM_STORAGE_DELETE', scriptId: script.id, key: 'prototype' }, sender);
    });

    it('50 parallel readers of getScripts() concurrently mutating results observe zero cross-contamination', async () => {
      const readerCount = 50;
      const results = await Promise.all(
        Array.from({ length: readerCount }, async (_, i) => {
          const scripts = await getScripts();
          const firstKey = Object.keys(scripts)[0];

          // Mutate this reader's local copy with a unique marker
          scripts[firstKey].name = `MUTATION_READER_${i}`;
          (scripts as any)[`unique_reader_${i}`] = true;

          return { i, name: scripts[firstKey].name };
        })
      );

      // Verify each reader saw its own mutation
      for (const res of results) {
        expect(res.name).toBe(`MUTATION_READER_${res.i}`);
      }

      // Verify storage dictionary is pristine
      const pristine = await getScripts();
      const firstKey = Object.keys(pristine)[0];
      expect(pristine[firstKey].name).not.toContain('MUTATION_READER_');
      for (let i = 0; i < readerCount; i++) {
        expect((pristine as any)[`unique_reader_${i}`]).toBeUndefined();
      }
    });
  });
});
