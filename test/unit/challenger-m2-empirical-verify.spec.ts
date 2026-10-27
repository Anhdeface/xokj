/**
 * Challenger M2 Empirical Verification Suite
 * Location: test/unit/challenger-m2-empirical-verify.spec.ts
 *
 * EMPIRICAL ADVERSARIAL CHALLENGER SUITE:
 * 1. Prototype pollution attacks on gm-repo.ts and bundle.ts
 * 2. Concurrency stress and mutex serialization
 * 3. Lifecycle cleanup and orphaned storage prevention in scripts-repo.ts
 * 4. Sender authentication and @grant authorization in gm-handler.ts
 * 5. Error boundary and unhandled rejection elimination in ui-ipc.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import {
  GmStorageRepository,
  gmStorageRepo,
  getGmValue,
  getGmValues,
  setGmValue,
  setGmValues,
  deleteGmValue,
  listGmValues,
  clearGmValues,
  getAllGmStorage
} from '@/shared/storage/gm-repo';
import {
  importScripts,
  exportScripts,
  FORBIDDEN_BUNDLE_KEYS
} from '@/shared/storage/bundle';
import {
  saveScript,
  getScript,
  getScripts,
  getScriptList,
  deleteScript,
  toggleScript,
  resetToDefaultScripts
} from '@/shared/storage/scripts-repo';
import { gmStorageHandler } from '@/background/gm-handler';
import { UiIpcServer } from '@/background/ui-ipc';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import type { ScriptRecord } from '@/shared/types';

describe('Challenger M2 Empirical Verification Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
    await clearGmValues();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (Object.prototype as any).pollutedKey;
    delete (Object.prototype as any).injected;
    delete (Object.prototype as any).isAdmin;
    delete (Object.prototype as any).pwned;
    delete (Object.prototype as any).compromised;
    delete (Object.prototype as any).hacked;
  });

  // =========================================================================
  // 1. Prototype Pollution Resistance in gm-repo.ts
  // =========================================================================
  describe('1. Empirical Prototype Pollution Attack on gm-repo.ts', () => {
    it('1.1: Injecting __proto__, constructor, and prototype via setGmValue leaves Object.prototype clean', async () => {
      const scriptId = 'script-proto-target-1';

      // Attack: set __proto__
      await setGmValue(scriptId, '__proto__', { pollutedKey: 'attacker-value', isAdmin: true });
      expect((Object.prototype as any).pollutedKey).toBeUndefined();
      expect((Object.prototype as any).isAdmin).toBeUndefined();
      expect(({} as any).pollutedKey).toBeUndefined();
      expect(({} as any).isAdmin).toBeUndefined();

      // Attack: set constructor
      await setGmValue(scriptId, 'constructor', { pollutedKey: 'constructor-attack' });
      expect((Object.prototype as any).pollutedKey).toBeUndefined();
      expect(Object.prototype.constructor).toBe(Object);

      // Attack: set prototype
      await setGmValue(scriptId, 'prototype', { pollutedKey: 'prototype-attack' });
      expect((Object.prototype as any).pollutedKey).toBeUndefined();

      // Verify bucket itself is prototype-free
      const bucket = await getGmValues(scriptId);
      expect(Object.getPrototypeOf(bucket)).toBeNull();
      expect(bucket['__proto__']).toEqual({ pollutedKey: 'attacker-value', isAdmin: true });
      expect(bucket['constructor']).toEqual({ pollutedKey: 'constructor-attack' });
      expect(bucket['prototype']).toEqual({ pollutedKey: 'prototype-attack' });

      // Verify getGmValue safely retrieves keys without polluting Object.prototype
      const valProto = await getGmValue(scriptId, '__proto__');
      expect(valProto).toEqual({ pollutedKey: 'attacker-value', isAdmin: true });
      expect((Object.prototype as any).pollutedKey).toBeUndefined();

      // Verify deletion of prototype property keys
      await deleteGmValue(scriptId, '__proto__');
      expect(await getGmValue(scriptId, '__proto__')).toBeUndefined();
      await deleteGmValue(scriptId, 'constructor');
      expect(await getGmValue(scriptId, 'constructor')).toBeUndefined();
      await deleteGmValue(scriptId, 'prototype');
      expect(await getGmValue(scriptId, 'prototype')).toBeUndefined();
    });

    it('1.2: Batch setGmValues with __proto__, constructor, prototype never escapes clean bucket', async () => {
      const scriptId = 'script-proto-target-2';

      const maliciousBatch: Record<string, unknown> = JSON.parse(
        '{"__proto__": {"injected": "malicious-1"}, "constructor": {"injected": "malicious-2"}, "prototype": {"injected": "malicious-3"}, "safeKey": "harmless"}'
      );

      await setGmValues(scriptId, maliciousBatch);

      // Verify Object.prototype purity
      expect((Object.prototype as any).injected).toBeUndefined();
      expect(({} as any).injected).toBeUndefined();
      expect(Object.prototype.constructor).toBe(Object);
      expect(typeof Object.prototype.toString).toBe('function');

      const all = await getAllGmStorage();
      expect(all[scriptId]).toBeDefined();
      expect(Object.getPrototypeOf(all[scriptId])).toBeNull();
      expect(all[scriptId].safeKey).toBe('harmless');

      const keys = await listGmValues(scriptId);
      expect(keys).toContain('safeKey');
      expect(keys).toContain('__proto__');
      expect(keys).toContain('constructor');
      expect(keys).toContain('prototype');
    });

    it('1.3: inMemoryOnly GmStorageRepository maintains prototype isolation', async () => {
      const memRepo = new GmStorageRepository({ inMemoryOnly: true });
      const scriptId = 'mem-script-attack';

      await memRepo.setGmValue(scriptId, '__proto__', { pwned: true });
      await memRepo.setGmValues(
        scriptId,
        JSON.parse('{"constructor": {"pwned": true}, "prototype": {"pwned": true}}')
      );

      expect((Object.prototype as any).pwned).toBeUndefined();
      expect(({} as any).pwned).toBeUndefined();

      const bucket = await memRepo.getGmValues(scriptId);
      expect(Object.getPrototypeOf(bucket)).toBeNull();
      expect(bucket['__proto__']).toEqual({ pwned: true });

      await memRepo.clearGmValues(scriptId);
      const afterClear = await memRepo.getGmValues(scriptId);
      expect(Object.keys(afterClear).length).toBe(0);
    });
  });

  // =========================================================================
  // 2. Prototype Pollution Resistance in bundle.ts
  // =========================================================================
  describe('2. Empirical Prototype Pollution Attack on bundle.ts', () => {
    it('2.1: FORBIDDEN_BUNDLE_KEYS defines __proto__, constructor, and prototype', () => {
      expect(FORBIDDEN_BUNDLE_KEYS.has('__proto__')).toBe(true);
      expect(FORBIDDEN_BUNDLE_KEYS.has('constructor')).toBe(true);
      expect(FORBIDDEN_BUNDLE_KEYS.has('prototype')).toBe(true);
    });

    it('2.2: exportScripts excludes forbidden keys from exported bundle', async () => {
      const exportedJson = await exportScripts(['__proto__', 'constructor', 'prototype']);
      const parsed = JSON.parse(exportedJson);
      expect(parsed.scripts.length).toBe(0);
    });

    it('2.3: importScripts prevents prototype pollution when malicious bundle injects forbidden keys', async () => {
      const maliciousPayload = [
        {
          id: '__proto__',
          name: 'Exploit Proto',
          code: '// ==UserScript==\n// @name Exploit Proto\n// ==/UserScript=='
        },
        {
          id: 'constructor',
          name: 'Exploit Constructor',
          code: '// ==UserScript==\n// @name Exploit Constructor\n// ==/UserScript=='
        },
        {
          id: 'prototype',
          name: 'Exploit Prototype',
          code: '// ==UserScript==\n// @name Exploit Prototype\n// ==/UserScript=='
        }
      ];

      const res = await importScripts(maliciousPayload, { overwrite: true });

      // All 3 scripts must be imported with sanitized, non-forbidden UUIDs
      expect(res.total).toBe(3);
      expect(res.imported).toBe(3);
      expect(res.scripts).toBeDefined();

      for (const imported of res.scripts!) {
        expect(FORBIDDEN_BUNDLE_KEYS.has(imported.id)).toBe(false);
        expect(imported.id).not.toBe('__proto__');
        expect(imported.id).not.toBe('constructor');
        expect(imported.id).not.toBe('prototype');
      }

      // Verify Object.prototype is unpolluted
      expect((Object.prototype as any).name).toBeUndefined();
      expect((Object.prototype as any).code).toBeUndefined();
    });

    it('2.4: importScripts with JSON string containing forbidden keys sanitizes correctly', async () => {
      const jsonBundle = JSON.stringify({
        version: 1,
        scripts: [
          {
            id: '__proto__',
            name: 'JSON Attack',
            code: '// ==UserScript==\n// @name JSON Attack\n// ==/UserScript=='
          }
        ]
      });

      const res = await importScripts(jsonBundle, { overwrite: true });
      expect(res.imported).toBe(1);
      expect(res.scripts![0].id).not.toBe('__proto__');
      expect((Object.prototype as any).name).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. Storage Concurrency & Mutex Serialization
  // =========================================================================
  describe('3. Concurrency Stress & Mutex Serialization', () => {
    it('3.1: 50 concurrent setGmValue operations on the same script serialize without corruption', async () => {
      const scriptId = 'concurrency-script-1';
      const count = 50;

      const tasks = Array.from({ length: count }, (_, i) =>
        setGmValue(scriptId, `key_${i}`, `value_${i}`)
      );

      await Promise.all(tasks);

      const allValues = await getGmValues(scriptId);
      expect(Object.keys(allValues).length).toBe(count);

      for (let i = 0; i < count; i++) {
        expect(allValues[`key_${i}`]).toBe(`value_${i}`);
      }
    });

    it('3.2: Concurrent setGmValue and clearGmValues do not crash or leave deadlocked mutex', async () => {
      const scriptId = 'concurrency-race-script';

      // Pre-seed some values
      await setGmValue(scriptId, 'initKey', 'initVal');

      const operations = [
        setGmValue(scriptId, 'k1', 'v1'),
        setGmValue(scriptId, 'k2', 'v2'),
        clearGmValues(scriptId),
        setGmValue(scriptId, 'k3', 'v3')
      ];

      // Run in parallel
      await Promise.allSettled(operations);

      // Verify subsequent operation completes cleanly
      await setGmValue(scriptId, 'postKey', 'postVal');
      const val = await getGmValue(scriptId, 'postKey');
      expect(val).toBe('postVal');
    });

    it('3.3: deleteScript cascades to purge persistent GM storage and mutex entry', async () => {
      const scriptId = 'cascade-delete-script';

      await saveScript({
        id: scriptId,
        name: 'Cascade Script',
        code: '// ==UserScript==\n// @name Cascade\n// ==/UserScript=='
      });

      await setGmValue(scriptId, 'persistedToken', 'SECRET_XYZ');
      expect(await getGmValue(scriptId, 'persistedToken')).toBe('SECRET_XYZ');

      // Delete the script
      await deleteScript(scriptId);

      // Verify script record is deleted
      expect(await getScript(scriptId)).toBeNull();

      // Verify GM storage for the script was purged
      const remainingGm = await getGmValues(scriptId);
      expect(Object.keys(remainingGm).length).toBe(0);
    });

    it('3.4: getScripts and getScriptList return defensive deep clones preventing in-memory cache poisoning', async () => {
      const list = await getScriptList();
      expect(list.length).toBeGreaterThan(0);

      // Attempt to mutate returned object in memory
      const targetScript = list[0];
      const originalName = targetScript.name;
      (targetScript as any).name = 'MUTATED_IN_MEMORY';

      // Fetch fresh list from repo
      const freshList = await getScriptList();
      const freshScript = freshList.find((s) => s.id === targetScript.id);
      expect(freshScript?.name).toBe(originalName);
      expect(freshScript?.name).not.toBe('MUTATED_IN_MEMORY');
    });
  });

  // =========================================================================
  // 4. Sender Authentication & Privilege Security in gm-handler.ts
  // =========================================================================
  describe('4. Sender Authentication & Privilege Security in gm-handler.ts', () => {
    const validScriptId = 'auth-test-script';

    beforeEach(async () => {
      await saveScript({
        id: validScriptId,
        name: 'Auth Test Script',
        code: `// ==UserScript==
// @name Auth Test Script
// @match https://allowed.example.com/*
// @exclude https://allowed.example.com/blocked/*
// @grant GM_setValue
// @grant GM_deleteValue
// ==/UserScript==`,
        enabled: true
      });
    });

    it('4.1: Rejects message if untrusted sender has no tab context', async () => {
      const sender = { tab: undefined, url: 'https://allowed.example.com/page' } as any;
      const res = await gmStorageHandler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: validScriptId, key: 'k', value: 'v' },
        sender
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/no associated tab context/i);
    });

    it('4.2: Rejects message if script does not exist', async () => {
      const sender = { tab: { id: 101 }, url: 'https://allowed.example.com/page' } as any;
      const res = await gmStorageHandler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: 'non-existent-id', key: 'k', value: 'v' },
        sender
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/not found/i);
    });

    it('4.3: Rejects message if script is disabled', async () => {
      await toggleScript(validScriptId, false);

      const sender = { tab: { id: 101 }, url: 'https://allowed.example.com/page' } as any;
      const res = await gmStorageHandler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: validScriptId, key: 'k', value: 'v' },
        sender
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/is disabled/i);
    });

    it('4.4: Rejects message if script has @grant none', async () => {
      const noGrantScriptId = 'no-grant-script';
      await saveScript({
        id: noGrantScriptId,
        name: 'No Grant Script',
        code: '// ==UserScript==\n// @match https://allowed.example.com/*\n// @grant none\n// ==/UserScript==',
        enabled: true
      });

      const sender = { tab: { id: 101 }, url: 'https://allowed.example.com/page' } as any;
      const res = await gmStorageHandler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: noGrantScriptId, key: 'k', value: 'v' },
        sender
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/declared @grant none/i);
    });

    it('4.5: Rejects message if script lacks required grant (e.g. lacks GM_setValue)', async () => {
      const deleteOnlyScriptId = 'delete-only-script';
      await saveScript({
        id: deleteOnlyScriptId,
        name: 'Delete Only Script',
        code: '// ==UserScript==\n// @match https://allowed.example.com/*\n// @grant GM_deleteValue\n// ==/UserScript==',
        enabled: true
      });

      const sender = { tab: { id: 101 }, url: 'https://allowed.example.com/page' } as any;
      const res = await gmStorageHandler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: deleteOnlyScriptId, key: 'k', value: 'v' },
        sender
      );

      expect(res.success).toBe(false);
      expect(res.error).toMatch(/lacks grant for GM_STORAGE_SET/i);
    });

    it('4.6: Rejects message if sender URL does not match script @match or hits @exclude', async () => {
      // Excluded URL
      const excludedSender = { tab: { id: 101 }, url: 'https://allowed.example.com/blocked/secret' } as any;
      const resEx = await gmStorageHandler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: validScriptId, key: 'k', value: 'v' },
        excludedSender
      );
      expect(resEx.success).toBe(false);
      expect(resEx.error).toMatch(/is excluded/i);

      // Unmatched URL
      const unmatchedSender = { tab: { id: 101 }, url: 'https://evil.attacker.com/page' } as any;
      const resUn = await gmStorageHandler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: validScriptId, key: 'k', value: 'v' },
        unmatchedSender
      );
      expect(resUn.success).toBe(false);
      expect(resUn.error).toMatch(/not matched/i);
    });

    it('4.7: Allows authorized sender matching tab, URL, and grant', async () => {
      const sender = { tab: { id: 101 }, url: 'https://allowed.example.com/dashboard' } as any;
      const res = await gmStorageHandler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: validScriptId, key: 'authToken', value: 'secure-token-123' },
        sender
      );

      expect(res.success).toBe(true);
      expect(await getGmValue(validScriptId, 'authToken')).toBe('secure-token-123');

      // Now delete via authorized sender
      const delRes = await gmStorageHandler.processMessage(
        { type: 'GM_STORAGE_DELETE', scriptId: validScriptId, key: 'authToken' },
        sender
      );
      expect(delRes.success).toBe(true);
      expect(await getGmValue(validScriptId, 'authToken')).toBeUndefined();
    });

    it('4.8: Allows internal extension caller without tab', async () => {
      const internalSender = {
        tab: undefined,
        url: undefined,
        id: chrome.runtime?.id || 'mock-extension-id'
      } as any;

      const res = await gmStorageHandler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: validScriptId, key: 'internalKey', value: 'internalVal' },
        internalSender
      );

      expect(res.success).toBe(true);
      expect(await getGmValue(validScriptId, 'internalKey')).toBe('internalVal');
    });
  });

  // =========================================================================
  // 5. Error Boundary in ui-ipc.ts
  // =========================================================================
  describe('5. Error Boundary in ui-ipc.ts', () => {
    it('5.1: GET_CDP_STATUS safely handles storage error without unhandled rejection', async () => {
      const debuggerMgr = new TabDebuggerManager();
      const uiIpc = new UiIpcServer(debuggerMgr);

      // Mock storage.get to reject
      const origGet = chrome.storage.local.get;
      (chrome.storage.local.get as any) = vi.fn().mockRejectedValueOnce(
        new Error('Simulated storage failure during GET_CDP_STATUS')
      );

      let responseResult: any = null;
      const sendResponse = (res: any) => {
        responseResult = res;
      };

      const handled = uiIpc.handleMessage(
        { type: 'GET_CDP_STATUS', tabId: 999 },
        {} as any,
        sendResponse
      );

      expect(handled).toBe(true); // Asynchronous channel kept open

      await vi.waitFor(() => {
        expect(responseResult).not.toBeNull();
      });

      expect(responseResult.status).toBe('IDLE');
      expect(responseResult.reason).toMatch(/Simulated storage failure/i);

      (chrome.storage.local.get as any) = origGet;
    });
  });
});
