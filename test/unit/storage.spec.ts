import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import {
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
  onScriptsChanged,
  DEFAULT_SCRIPTS
} from '@/shared/storage';
import type { ScriptRecord } from '@/shared/types';

describe('Feature 6: Storage Schema & Defaults', () => {
  beforeEach(() => {
    setupChromeMock();
  });

  describe('Tier 1: Initial Seeding & CRUD', () => {
    it('T1.1: automatically seeds storage with default sample scripts on first read', async () => {
      const scripts = await getScripts();
      expect(Object.keys(scripts).length).toBeGreaterThanOrEqual(2);
      expect(scripts['sample-cdp-logger']).toBeDefined();
      expect(scripts['sample-cdp-logger'].name).toBe('CDP Network & Page Logger');
      expect(scripts['sample-cdp-logger'].metadata.cdpDomains).toEqual(['Network', 'Page']);
    });

    it('T1.2: getScriptList returns an array of ScriptRecord objects', async () => {
      const list = await getScriptList();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list.some(s => s.id === 'sample-cdp-logger')).toBe(true);
    });

    it('T1.3: getScript retrieves a specific script by ID or null', async () => {
      const s = await getScript('sample-cdp-logger');
      expect(s).not.toBeNull();
      expect(s?.id).toBe('sample-cdp-logger');

      const nonExistent = await getScript('unknown-id');
      expect(nonExistent).toBeNull();
    });

    it('T1.4: saveScript inserts new script and assigns timestamps', async () => {
      const newScript: ScriptRecord = {
        id: 'custom-user-script',
        name: 'Custom Script',
        code: '// ==UserScript==\n// @name Custom Script\n// ==/UserScript==',
        metadata: {
          name: 'Custom Script',
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
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
        },
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const saved = await saveScript(newScript);
      expect(saved.id).toBe('custom-user-script');
      expect(saved.createdAt).toBeGreaterThan(0);
      expect(saved.updatedAt).toBeGreaterThan(0);

      const retrieved = await getScript('custom-user-script');
      expect(retrieved?.name).toBe('Custom Script');
    });

    it('T1.5: deleteScript removes script from storage', async () => {
      await deleteScript('sample-cdp-logger');
      const s = await getScript('sample-cdp-logger');
      expect(s).toBeNull();
    });
  });

  describe('Tier 2: Toggles & Settings', () => {
    it('T2.1: toggleScript inverts enabled boolean state', async () => {
      const current = (await getScript('sample-cdp-logger'))?.enabled;
      expect(current).toBe(true);

      const toggled = await toggleScript('sample-cdp-logger');
      expect(toggled).toBe(false);
      expect((await getScript('sample-cdp-logger'))?.enabled).toBe(false);

      const toggledBack = await toggleScript('sample-cdp-logger');
      expect(toggledBack).toBe(true);
      expect((await getScript('sample-cdp-logger'))?.enabled).toBe(true);
    });

    it('T2.2: toggleScript with explicit boolean sets desired state', async () => {
      await toggleScript('sample-cdp-logger', false);
      expect((await getScript('sample-cdp-logger'))?.enabled).toBe(false);

      await toggleScript('sample-cdp-logger', false); // idempotent
      expect((await getScript('sample-cdp-logger'))?.enabled).toBe(false);

      await toggleScript('sample-cdp-logger', true);
      expect((await getScript('sample-cdp-logger'))?.enabled).toBe(true);
    });

    it('T2.3: toggleScript throws error if script ID does not exist', async () => {
      await expect(toggleScript('non-existent-id')).rejects.toThrowError(/not found/);
    });

    it('T2.4: resetToDefaultScripts restores initial sample scripts', async () => {
      await deleteScript('sample-cdp-logger');
      expect(await getScript('sample-cdp-logger')).toBeNull();

      await resetToDefaultScripts();
      const restored = await getScript('sample-cdp-logger');
      expect(restored).not.toBeNull();
      expect(restored?.name).toBe('CDP Network & Page Logger');
    });

    it('T2.5: getSettings and saveSettings manage application settings', async () => {
      const settings = await getSettings();
      expect(settings.globalEnabled).toBe(true);

      const updated = await saveSettings({ globalEnabled: false, logLevel: 'debug' });
      expect(updated.globalEnabled).toBe(false);
      expect(updated.logLevel).toBe('debug');

      const reFetched = await getSettings();
      expect(reFetched.globalEnabled).toBe(false);
      expect(reFetched.logLevel).toBe('debug');
    });
  });

  describe('Tier 3: Storage Immutability & Sample Script Integrity', () => {
    it('T3.1: deleteScript does NOT mutate the module-level DEFAULT_SCRIPTS export', async () => {
      const initialKeys = Object.keys(DEFAULT_SCRIPTS);
      expect(initialKeys.length).toBe(3);
      expect(DEFAULT_SCRIPTS['sample-cdp-logger']).toBeDefined();

      await getScripts();
      await deleteScript('sample-cdp-logger');

      const retrieved = await getScript('sample-cdp-logger');
      expect(retrieved).toBeNull();

      // CRITICAL: Module export DEFAULT_SCRIPTS must remain completely intact
      expect(DEFAULT_SCRIPTS['sample-cdp-logger']).toBeDefined();
      expect(DEFAULT_SCRIPTS['sample-cdp-logger'].name).toBe('CDP Network & Page Logger');
      expect(Object.keys(DEFAULT_SCRIPTS).length).toBe(3);
    });

    it('T3.2: resetToDefaultScripts successfully restores all default scripts after all are deleted', async () => {
      const initialScripts = await getScripts();
      const allIds = Object.keys(initialScripts);

      // Delete all scripts
      for (const id of allIds) {
        await deleteScript(id);
      }

      const emptyList = await getScriptList();
      expect(emptyList.length).toBe(0);

      // Reset to defaults
      await resetToDefaultScripts();

      const restored = await getScriptList();
      expect(restored.length).toBe(3);
      expect(restored.some(s => s.id === 'sample-cdp-logger')).toBe(true);
      expect(restored.some(s => s.id === 'sample-cookie-inspector')).toBe(true);
      expect(restored.some(s => s.id === 'sample-dom-highlighter')).toBe(true);
    });

    it('T3.3: toggleScript does NOT mutate the module-level DEFAULT_SCRIPTS object', async () => {
      await getScripts();

      await toggleScript('sample-cookie-inspector', false);
      const stored = await getScript('sample-cookie-inspector');
      expect(stored?.enabled).toBe(false);

      // DEFAULT_SCRIPTS must remain true
      expect(DEFAULT_SCRIPTS['sample-cookie-inspector']?.enabled).toBe(true);
    });

    it('T3.4: external mutation of returned scripts object does not corrupt storage state', async () => {
      const scripts = await getScripts();
      const script = scripts['sample-dom-highlighter'];
      expect(script).toBeDefined();

      // Mutate returned object
      script.name = 'External Mutation Attempt';
      script.enabled = false;

      // Fresh fetch must remain uncorrupted
      const fresh = await getScript('sample-dom-highlighter');
      expect(fresh?.name).toBe('DOM Element Highlighter');
      expect(fresh?.enabled).toBe(true);
    });

    it('T3.5: resetToDefaultScripts returns independent clones with unique object references', async () => {
      const scripts1 = await resetToDefaultScripts();
      const scripts2 = await resetToDefaultScripts();

      expect(scripts1).not.toBe(DEFAULT_SCRIPTS);
      expect(scripts1['sample-cdp-logger']).not.toBe(DEFAULT_SCRIPTS['sample-cdp-logger']);
      expect(scripts1['sample-cdp-logger'].metadata).not.toBe(DEFAULT_SCRIPTS['sample-cdp-logger'].metadata);
      expect(scripts1).not.toBe(scripts2);
    });
  });

  describe('Tier 4: Milestone 3 - Querying & Metadata Auto-Parsing', () => {
    it('T4.1: getAllScripts supports filtering by enabled state', async () => {
      await toggleScript('sample-cookie-inspector', false);

      const all = await getAllScripts();
      expect(all.length).toBe(3);

      const enabledOnly = await getAllScripts({ enabled: true });
      expect(enabledOnly.length).toBe(2);
      expect(enabledOnly.every((s) => s.enabled)).toBe(true);

      const disabledOnly = await getAllScripts({ enabled: false });
      expect(disabledOnly.length).toBe(1);
      expect(disabledOnly[0].id).toBe('sample-cookie-inspector');
    });

    it('T4.2: getAllScripts supports URL match filtering with exclusion precedence', async () => {
      const matchingHttpbin = await getAllScripts({ url: 'https://httpbin.org/status/200' });
      expect(matchingHttpbin.some((s) => s.id === 'sample-cdp-logger')).toBe(true);

      const restricted = await getAllScripts({ url: 'chrome://extensions' });
      expect(restricted.length).toBe(0);
    });

    it('T4.3: getAllScripts supports filtering by runAt and search query', async () => {
      const docStart = await getAllScripts({ runAt: 'document-start' });
      expect(docStart.length).toBe(1);
      expect(docStart[0].id).toBe('sample-cdp-logger');

      const searchResult = await getAllScripts({ search: 'Inspector' });
      expect(searchResult.length).toBe(1);
      expect(searchResult[0].id).toBe('sample-cookie-inspector');
    });

    it('T4.4: saveScript auto-parses metadata and updates updatedAt timestamp', async () => {
      const code = `// ==UserScript==
// @name         Auto Parsed Userscript
// @namespace    https://xokj.dev
// @version      2.5.0
// @description  Tests automatic metadata parsing
// @match        https://example.org/*
// @run-at       document-end
// @grant        GM_setValue
// @grant        GM_getValue
// @cdp          DOM.enable
// ==/UserScript==

console.log("hello");`;

      const saved = await saveScript({ code });
      expect(saved.id).toBeDefined();
      expect(saved.name).toBe('Auto Parsed Userscript');
      expect(saved.metadata.name).toBe('Auto Parsed Userscript');
      expect(saved.metadata.version).toBe('2.5.0');
      expect(saved.metadata.runAt).toBe('document-end');
      expect(saved.metadata.grants).toEqual(['GM_setValue', 'GM_getValue']);
      expect(saved.metadata.cdpDomains).toEqual(['DOM']);
      expect(saved.createdAt).toBeGreaterThan(0);
      expect(saved.updatedAt).toBeGreaterThan(0);

      // Updating code reparses metadata
      const updatedCode = code.replace('@version      2.5.0', '@version      2.6.0');
      const updated = await saveScript({ id: saved.id, code: updatedCode });
      expect(updated.metadata.version).toBe('2.6.0');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(saved.updatedAt);
    });
  });

  describe('Tier 5: Milestone 3 - Import, Export & Change Listeners', () => {
    it('T5.1: exportScripts exports all or subset of scripts as valid JSON bundle', async () => {
      const allExportJson = await exportScripts();
      const allBundle = JSON.parse(allExportJson);
      expect(allBundle.version).toBe(1);
      expect(allBundle.generator).toBe('XOKJ Userscript Manager');
      expect(Array.isArray(allBundle.scripts)).toBe(true);
      expect(allBundle.scripts.length).toBe(3);

      const subsetJson = await exportScripts(['sample-cdp-logger']);
      const subsetBundle = JSON.parse(subsetJson);
      expect(subsetBundle.scripts.length).toBe(1);
      expect(subsetBundle.scripts[0].id).toBe('sample-cdp-logger');
    });

    it('T5.2: importScripts imports from JSON bundle and respects overwrite flag', async () => {
      const exportJson = await exportScripts(['sample-cdp-logger']);
      
      // Import without overwrite: creates new script with new ID
      const res1 = await importScripts(exportJson, { overwrite: false });
      expect(res1.imported).toBe(1);
      expect(res1.updated).toBe(0);
      expect(res1.failed).toBe(0);

      const allScripts = await getScriptList();
      expect(allScripts.length).toBe(4);

      // Import with overwrite: updates existing script
      const res2 = await importScripts(exportJson, { overwrite: true });
      expect(res2.imported).toBe(0);
      expect(res2.updated).toBe(1);
    });

    it('T5.3: importScripts handles raw userscript header string', async () => {
      const rawUserScript = `// ==UserScript==
// @name         Single String Script
// @match        *://*.single.com/*
// @run-at       document-idle
// ==/UserScript==
console.log('single');`;

      const res = await importScripts(rawUserScript);
      expect(res.imported).toBe(1);
      expect(res.scripts?.[0].name).toBe('Single String Script');
    });

    it('T5.4: onScriptsChanged receives callbacks when scripts are updated', async () => {
      const callback = vi.fn();
      const unsubscribe = onScriptsChanged(callback);

      await saveScript({
        id: 'listener-test-script',
        code: '// ==UserScript==\n// @name Listener Test\n// ==/UserScript=='
      });

      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          'listener-test-script': expect.objectContaining({ name: 'Listener Test' })
        })
      );

      unsubscribe();
      callback.mockClear();

      await deleteScript('listener-test-script');
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Tier 6: Concurrency & Mutex Serialization', () => {
    it('T6.1: 50 parallel saveScript calls serialize without lost records or corruptions', async () => {
      // Clear default scripts for a clean test baseline
      await resetToDefaultScripts();
      const initialScripts = await getScripts();
      const initialCount = Object.keys(initialScripts).length;

      const PARALLEL_COUNT = 50;
      const scriptPayloads = Array.from({ length: PARALLEL_COUNT }, (_, i) => ({
        id: `parallel-script-${i + 1}`,
        name: `Parallel Script ${i + 1}`,
        code: `// ==UserScript==\n// @name Parallel Script ${i + 1}\n// @match https://site${i + 1}.com/*\n// ==/UserScript==`,
        enabled: i % 2 === 0
      }));

      // Fire all 50 saveScript calls simultaneously
      await Promise.all(scriptPayloads.map((payload) => saveScript(payload)));

      const stored = await getScripts();
      expect(Object.keys(stored).length).toBe(initialCount + PARALLEL_COUNT);

      for (let i = 1; i <= PARALLEL_COUNT; i++) {
        const id = `parallel-script-${i}`;
        const record = stored[id];
        expect(record).toBeDefined();
        expect(record.name).toBe(`Parallel Script ${i}`);
        expect(record.enabled).toBe((i - 1) % 2 === 0);
        expect(record.createdAt).toBeGreaterThan(0);
        expect(record.updatedAt).toBeGreaterThan(0);
        expect(record.metadata?.matches).toContain(`https://site${i}.com/*`);
      }
    });

    it('T6.2: rapid concurrent updates to the same script serialize cleanly without field corruption', async () => {
      await saveScript({
        id: 'target-single-script',
        code: '// ==UserScript==\n// @name Target Script Initial\n// @version 1.0.0\n// @match https://example.com/*\n// ==/UserScript=='
      });

      const UPDATE_COUNT = 30;
      const updates = Array.from({ length: UPDATE_COUNT }, (_, i) => ({
        id: 'target-single-script',
        code: `// ==UserScript==\n// @name Target Script V${i + 1}\n// @version 1.0.${i + 1}\n// @match https://example.com/*\n// ==/UserScript==`
      }));

      // Dispatch 30 parallel updates to the same script ID
      await Promise.all(updates.map((u) => saveScript(u)));

      const finalRecord = await getScript('target-single-script');
      expect(finalRecord).not.toBeNull();
      // Must have valid metadata and a version between 1.0.1 and 1.0.30
      expect(finalRecord?.metadata?.version).toMatch(/^1\.0\.\d+$/);
      expect(finalRecord?.parseErrors).toBeUndefined();
    });

    it('T6.3: simultaneous toggleScript and deleteScript does not resurrect deleted script', async () => {
      const targetId = 'race-toggle-delete-script';
      await saveScript({
        id: targetId,
        code: '// ==UserScript==\n// @name Race Script\n// @match https://example.com/*\n// ==/UserScript==',
        enabled: true
      });

      // Concurrently run toggle and delete
      const togglePromise = toggleScript(targetId, false);
      const deletePromise = deleteScript(targetId);

      const [toggleResult, deleteResult] = await Promise.allSettled([togglePromise, deletePromise]);

      // deleteScript must always fulfill
      expect(deleteResult.status).toBe('fulfilled');

      // Regardless of which completed first, the script must be DELETED from storage
      const finalStored = await getScript(targetId);
      expect(finalStored).toBeNull();

      // If delete completed before toggle, toggle must reject with 'not found'
      if (toggleResult.status === 'rejected') {
        expect((toggleResult as PromiseRejectedResult).reason.message).toContain('not found');
      } else {
        expect(toggleResult.status).toBe('fulfilled');
      }
    });

    it('T6.4: rejected task in mutex queue does not poison queue for subsequent tasks', async () => {
      const validId1 = 'poison-test-task-1';
      const validId2 = 'poison-test-task-2';
      const failingId = 'non-existent-script-xyz';

      const task1 = saveScript({
        id: validId1,
        code: '// ==UserScript==\n// @name Task 1\n// @match https://example.com/*\n// ==/UserScript=='
      });

      // Task 2 will fail because the script does not exist
      const task2 = toggleScript(failingId, false);

      const task3 = saveScript({
        id: validId2,
        code: '// ==UserScript==\n// @name Task 2\n// @match https://example.com/*\n// ==/UserScript=='
      });

      const results = await Promise.allSettled([task1, task2, task3]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect((results[1] as PromiseRejectedResult).reason.message).toContain('not found');
      expect(results[2].status).toBe('fulfilled');

      // Subsequent independent mutation executes without deadlock
      const task4 = await saveScript({
        id: 'poison-test-task-3',
        code: '// ==UserScript==\n// @name Task 3\n// @match https://example.com/*\n// ==/UserScript=='
      });
      expect(task4.id).toBe('poison-test-task-3');

      // Verify storage contains task 1, 2, and 3
      const stored = await getScripts();
      expect(stored[validId1]).toBeDefined();
      expect(stored[validId2]).toBeDefined();
      expect(stored['poison-test-task-3']).toBeDefined();
      expect(stored[failingId]).toBeUndefined();
    });

    it('T6.5: concurrent saveSettings calls atomically merge disjoint settings properties', async () => {
      await saveSettings({
        globalEnabled: true,
        autoAttachDebugger: true,
        debuggerProtocolVersion: '1.3',
        logLevel: 'info'
      });

      // Three concurrent partial setting updates
      const p1 = saveSettings({ globalEnabled: false });
      const p2 = saveSettings({ logLevel: 'debug' });
      const p3 = saveSettings({ debuggerProtocolVersion: '1.4' });

      await Promise.all([p1, p2, p3]);

      const finalSettings = await getSettings();
      expect(finalSettings.globalEnabled).toBe(false);
      expect(finalSettings.logLevel).toBe('debug');
      expect(finalSettings.debuggerProtocolVersion).toBe('1.4');
      // Untouched setting remains preserved
      expect(finalSettings.autoAttachDebugger).toBe(true);
    });

    it('T6.6: concurrent batch importScripts does not deadlock with individual mutations', async () => {
      const bundle1 = JSON.stringify({
        version: 1,
        generator: 'test',
        scripts: [
          { id: 'batch-1-a', code: '// ==UserScript==\n// @name Batch 1A\n// ==/UserScript==' },
          { id: 'batch-1-b', code: '// ==UserScript==\n// @name Batch 1B\n// ==/UserScript==' }
        ]
      });

      const bundle2 = JSON.stringify({
        version: 1,
        generator: 'test',
        scripts: [
          { id: 'batch-2-a', code: '// ==UserScript==\n// @name Batch 2A\n// ==/UserScript==' },
          { id: 'batch-2-b', code: '// ==UserScript==\n// @name Batch 2B\n// ==/UserScript==' }
        ]
      });

      const singleSave = saveScript({
        id: 'solo-concurrent',
        code: '// ==UserScript==\n// @name Solo\n// ==/UserScript=='
      });

      const [res1, res2, solo] = await Promise.all([
        importScripts(bundle1, { overwrite: true }),
        importScripts(bundle2, { overwrite: true }),
        singleSave
      ]);

      expect(res1.imported + res1.updated).toBe(2);
      expect(res2.imported + res2.updated).toBe(2);
      expect(solo.id).toBe('solo-concurrent');

      const all = await getScripts();
      expect(all['batch-1-a']).toBeDefined();
      expect(all['batch-1-b']).toBeDefined();
      expect(all['batch-2-a']).toBeDefined();
      expect(all['batch-2-b']).toBeDefined();
      expect(all['solo-concurrent']).toBeDefined();
    });

    it('T6.7: high-frequency concurrent reads during mutations return consistent snapshots', async () => {
      const writers = Array.from({ length: 20 }, (_, i) =>
        saveScript({
          id: `read-write-race-${i}`,
          code: `// ==UserScript==\n// @name RW Script ${i}\n// ==/UserScript==`
        })
      );

      const readers = Array.from({ length: 20 }, () => getScripts());

      const results = await Promise.all([...writers, ...readers]);
      // All 20 readers must return valid Record<string, ScriptRecord> objects
      const readResults = results.slice(20) as Record<string, ScriptRecord>[];
      for (const snapshot of readResults) {
        expect(typeof snapshot).toBe('object');
        expect(snapshot).not.toBeNull();
        for (const [id, script] of Object.entries(snapshot)) {
          expect(script.id).toBe(id);
          expect(script.code).toBeDefined();
        }
      }
    });
  });
});

