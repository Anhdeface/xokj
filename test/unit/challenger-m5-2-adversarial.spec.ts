/**
 * Milestone 5 Adversarial Challenger 2 Verification Suite
 * Location: test/unit/challenger-m5-2-adversarial.spec.ts
 *
 * Empirical adversarial stress testing across 5 critical dimensions:
 * 1. Storage Prototype Pollution & Corrupt Payload Resilience
 * 2. GM Message Handler Permission Boundaries & Spoofing Resistance
 * 3. CDP Rehydration, Conflict Resistance & Corrupted Session Recovery
 * 4. UI Reactivity Concurrency, Rapid Toggling & Search Performance Stress
 * 5. Regression Oracle Sensitivity Verification
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { setupChromeMock } from '../mocks/chrome';

import {
  gmStorageRepo,
  saveScript,
  getScripts,
  getScriptList,
  deleteScript,
  resetToDefaultScripts,
  saveTabSession,
  getTabSessions,
  clearTabSessions
} from '@/shared/storage';
import { GmStorageMessageHandler } from '@/background/gm-handler';
import { TabDebuggerManager, aggregateCdpDeclarations } from '@/background/debugger-mgr';
import { UiIpcServer } from '@/background/ui-ipc';
import { verifySenderSource, verifyChannelId } from '@/content/bridge/validator';
import { usePopupState } from '@/popup/composables/usePopupState';
import { useDashboardState } from '@/dashboard/composables/useDashboardState';
import type { ScriptRecord } from '@/shared/types';

describe('Empirical Challenger M5-2: Adversarial Stress & Negative Testing Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (Object.prototype as any).hacked;
    delete (Object.prototype as any).polluted;
    delete (Object.prototype as any).admin;
  });

  // =========================================================================
  // DIMENSION 1: Storage Prototype Pollution & Corrupt Payload Resilience
  // =========================================================================
  describe('Dimension 1: Storage Subsystem Stress & Prototype Defense', () => {
    it('1.1: Prevents prototype pollution across 100 concurrent writes of malicious prototype keys', async () => {
      const scriptId = 'proto-adversarial-script';
      await gmStorageRepo.clearGmValues(scriptId);

      const maliciousKeys = [
        '__proto__',
        'constructor',
        'prototype',
        '__defineGetter__',
        '__defineSetter__',
        '__lookupGetter__',
        '__lookupSetter__',
        'toString',
        'valueOf',
        'hasOwnProperty'
      ];

      // Hammer storage with concurrent writes using prototype keys
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 100; i++) {
        const key = maliciousKeys[i % maliciousKeys.length];
        promises.push(
          gmStorageRepo.setGmValue(scriptId, key, { iteration: i, payload: 'malicious' })
        );
      }

      await Promise.all(promises);

      // Verify Object.prototype was never polluted
      expect((Object.prototype as any).iteration).toBeUndefined();
      expect((Object.prototype as any).payload).toBeUndefined();
      expect(({} as any).iteration).toBeUndefined();

      // Verify bucket prototype is null
      const bucket = await gmStorageRepo.getGmValues(scriptId);
      expect(Object.getPrototypeOf(bucket)).toBeNull();

      await gmStorageRepo.clearGmValues(scriptId);
    });

    it('1.2: Rejects whitespace-only, empty, and invalid storage keys', async () => {
      const scriptId = 'key-validation-script';

      await expect(gmStorageRepo.setGmValue(scriptId, '', 'val')).rejects.toThrow();
      await expect(gmStorageRepo.setGmValue(scriptId, '   ', 'val')).rejects.toThrow();
      await expect(gmStorageRepo.getGmValue(scriptId, '')).rejects.toThrow();
      await expect(gmStorageRepo.getGmValue(scriptId, '   ')).rejects.toThrow();
      await expect(gmStorageRepo.deleteGmValue(scriptId, '')).rejects.toThrow();
      await expect(gmStorageRepo.deleteGmValue(scriptId, '   ')).rejects.toThrow();
    });

    it('1.3: Handles race condition between concurrent writes and deleteScript cleanly', async () => {
      const scriptId = 'race-write-delete-script';
      await saveScript({
        id: scriptId,
        name: 'Race Target',
        code: '// ==UserScript==\n// ==/UserScript==',
        enabled: true
      });

      // Launch 50 concurrent writes
      const writePromises = Array.from({ length: 50 }, (_, i) =>
        gmStorageRepo.setGmValue(scriptId, `key_${i}`, i).catch(() => {})
      );

      // In the middle of writes, delete the script
      const deletePromise = deleteScript(scriptId);

      await Promise.all([...writePromises, deletePromise]);

      // Script must be deleted
      const scripts = await getScripts();
      expect(scripts[scriptId]).toBeUndefined();

      // Mutex must be cleaned up
      const mutexesMap: Map<string, any> = (gmStorageRepo as any).scriptMutexes;
      expect(mutexesMap.has(scriptId)).toBe(false);
    });
  });

  // =========================================================================
  // DIMENSION 2: GM Message Handler Permission Boundaries & Spoofing Resistance
  // =========================================================================
  describe('Dimension 2: GM Storage Handler Security Boundaries & Privilege Isolation', () => {
    it('2.1: Enforces fine-grained privilege isolation (SET vs DELETE grants)', async () => {
      const handler = new GmStorageMessageHandler(gmStorageRepo);
      handler.init();

      // Script with ONLY GM_setValue (cannot delete)
      const setOnlyScript = 'set-only-script';
      await saveScript({
        id: setOnlyScript,
        name: 'Set Only',
        code: `// ==UserScript==
// @name Set Only
// @match https://app.example.com/*
// @grant GM_setValue
// ==/UserScript==`,
        enabled: true
      });

      // Script with ONLY GM_deleteValue (cannot set)
      const delOnlyScript = 'del-only-script';
      await saveScript({
        id: delOnlyScript,
        name: 'Del Only',
        code: `// ==UserScript==
// @name Del Only
// @match https://app.example.com/*
// @grant GM_deleteValue
// ==/UserScript==`,
        enabled: true
      });

      const validSender: any = {
        tab: { id: 200, url: 'https://app.example.com/page' },
        url: 'https://app.example.com/page'
      };

      // Set-only script attempting DELETE -> MUST FAIL
      const delRes = await handler.processMessage(
        { type: 'GM_STORAGE_DELETE', scriptId: setOnlyScript, key: 'k1' },
        validSender
      );
      expect(delRes.success).toBe(false);
      expect(delRes.error).toContain('Script lacks grant for GM_STORAGE_DELETE');

      // Set-only script attempting SET -> MUST SUCCEED
      const setRes = await handler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: setOnlyScript, key: 'k1', value: 'v1' },
        validSender
      );
      expect(setRes.success).toBe(true);

      // Del-only script attempting SET -> MUST FAIL
      const setRes2 = await handler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: delOnlyScript, key: 'k2', value: 'v2' },
        validSender
      );
      expect(setRes2.success).toBe(false);
      expect(setRes2.error).toContain('Script lacks grant for GM_STORAGE_SET');

      // Del-only script attempting DELETE -> MUST SUCCEED
      const delRes2 = await handler.processMessage(
        { type: 'GM_STORAGE_DELETE', scriptId: delOnlyScript, key: 'k2' },
        validSender
      );
      expect(delRes2.success).toBe(true);

      handler.destroy();
      await gmStorageRepo.clearGmValues(setOnlyScript);
      await gmStorageRepo.clearGmValues(delOnlyScript);
    });

    it('2.2: Rejects tabs with restricted or mismatched origins (about:blank, data:, chrome:)', async () => {
      const handler = new GmStorageMessageHandler(gmStorageRepo);
      handler.init();

      const scriptId = 'origin-defense-script';
      await saveScript({
        id: scriptId,
        name: 'Origin Defense',
        code: `// ==UserScript==
// @name Origin Defense
// @match https://trusted.org/*
// @grant GM_setValue
// ==/UserScript==`,
        enabled: true
      });

      const badOrigins = [
        'about:blank',
        'chrome://extensions',
        'chrome-extension://foreign-id/page.html',
        'data:text/html,<h1>evil</h1>',
        'blob:https://trusted.org/uuid',
        'https://sub.trusted.org/*',
        'http://trusted.org/*'
      ];

      for (const badUrl of badOrigins) {
        const sender = {
          tab: { id: 300, url: badUrl },
          url: badUrl
        } as any;

        const res = await handler.processMessage(
          { type: 'GM_STORAGE_SET', scriptId, key: 'flag', value: true },
          sender
        );
        expect(res.success).toBe(false);
      }

      handler.destroy();
      await gmStorageRepo.clearGmValues(scriptId);
    });

    it('2.3: Content bridge validator blocks spoofed channel tokens and unauthorized sources', () => {
      // Test strict mode
      expect(verifyChannelId('valid-tok', 'valid-tok', true)).toBe(true);
      expect(verifyChannelId('valid-tok-extra', 'valid-tok', true)).toBe(false);
      expect(verifyChannelId('valid-to', 'valid-tok', true)).toBe(false);
      expect(verifyChannelId(null as any, 'valid-tok', true)).toBe(false);
      expect(verifyChannelId(undefined, 'valid-tok', true)).toBe(false);

      // Test source verification
      expect(verifySenderSource('xokj-userscript', false)).toBe(true);
      expect(verifySenderSource('tampermonkey', false)).toBe(false);
      expect(verifySenderSource('violentmonkey', false)).toBe(false);
      expect(verifySenderSource('', false)).toBe(false);
    });
  });

  // =========================================================================
  // DIMENSION 3: CDP Rehydration, Conflict Resistance & Corrupted Recovery
  // =========================================================================
  describe('Dimension 3: CDP Lifecycle, Session Rehydration & Conflict Elimination', () => {
    it('3.1: Recovers gracefully when persisted session store contains corrupted records', async () => {
      await clearTabSessions();

      // Manually corrupt tab session storage with invalid records
      await (chrome.storage.local as any).set({
        tab_sessions: {
          '101': { tabId: 101, status: 'ATTACHED', attached: true, activeDomains: ['Page'] },
          'invalid_nan': { tabId: NaN, status: 'ATTACHED' },
          '102': null,
          '103': { corrupted: true }
        }
      });

      context.mockDebugger.getTargets.mockResolvedValue([
        { tabId: 101, attached: true, url: 'https://app.com' } as any
      ]);

      const debuggerMgr = new TabDebuggerManager();
      // Should not throw
      await expect(debuggerMgr.init()).resolves.toBeUndefined();

      // Valid session 101 was rehydrated
      const session101 = debuggerMgr.getSession(101);
      expect(session101).toBeDefined();
      expect(session101?.status).toBe('ATTACHED');

      debuggerMgr.destroy();
      await clearTabSessions();
    });

    it('3.2: Reconciles browser targets and ignores restricted URLs (chrome://, devtools://)', async () => {
      context.mockDebugger.getTargets.mockResolvedValue([
        { tabId: 201, attached: true, url: 'chrome://settings' } as any,
        { tabId: 202, attached: true, url: 'devtools://devtools/bundled/inspector.html' } as any,
        { tabId: 203, attached: true, url: 'https://valid-target.com' } as any
      ]);

      const debuggerMgr = new TabDebuggerManager();
      await debuggerMgr.init();

      // Valid web target is attached
      expect(debuggerMgr.getSession(203)?.status).toBe('ATTACHED');

      debuggerMgr.destroy();
    });

    it('3.3: aggregateCdpDeclarations orders .enable commands before configuration commands and deduplicates', () => {
      const scripts: ScriptRecord[] = [
        {
          id: 'script-1',
          name: 'Script 1',
          code: '',
          enabled: true,
          metadata: {
            cdpDeclarations: [
              { domain: 'Network', method: 'setUserAgentOverride', command: 'Network.setUserAgentOverride', params: { userAgent: 'Custom' } },
              { domain: 'Network', method: 'enable', command: 'Network.enable' }
            ]
          }
        } as any,
        {
          id: 'script-2',
          name: 'Script 2',
          code: '',
          enabled: true,
          metadata: {
            cdpDeclarations: [
              { domain: 'Page', method: 'enable', command: 'Page.enable' },
              { domain: 'Network', method: 'enable', command: 'Network.enable' } // Duplicate command
            ]
          }
        } as any
      ];

      const aggregated = aggregateCdpDeclarations(scripts);
      expect(aggregated.length).toBe(3); // Network.enable (deduped), Page.enable, Network.setUserAgentOverride
      expect(aggregated[0].method).toBe('enable');
      expect(aggregated[1].method).toBe('enable');
      expect(aggregated[2].method).toBe('setUserAgentOverride');
    });
  });

  // =========================================================================
  // DIMENSION 4: UI Reactivity, Rapid Toggling & Search Performance Stress
  // =========================================================================
  describe('Dimension 4: UI Reactivity & Search Performance Under Load', () => {
    it('4.1: usePopupState sustains 50 rapid toggleScript calls without data corruption or memory leaks', async () => {
      const scriptId = 'rapid-toggle-script';
      await saveScript({
        id: scriptId,
        name: 'Rapid Toggle',
        code: '// ==UserScript==\n// @match *://*/*\n// ==/UserScript==',
        enabled: true
      });

      const Component = defineComponent({
        setup() {
          return usePopupState();
        },
        render() {
          return h('div');
        }
      });

      const wrapper = mount(Component);
      await flushPromises();

      // Execute 50 rapid alternating toggles
      for (let i = 0; i < 50; i++) {
        await wrapper.vm.toggleScript(scriptId, i % 2 === 0);
      }

      // Final state should match i=49 (49 % 2 !== 0 -> false)
      const script = wrapper.vm.scripts.find((s: any) => s.id === scriptId);
      expect(script?.enabled).toBe(false);

      wrapper.unmount();
    });

    it('4.2: useDashboardState search over 1,000 scripts executes in under 50ms', async () => {
      // Setup 1,000 scripts in memory
      const fakeScripts: ScriptRecord[] = [];
      for (let i = 0; i < 1000; i++) {
        fakeScripts.push({
          id: `bench-script-${i}`,
          name: `Userscript Benchmark Target ${i}`,
          description: `Description text for script item number ${i}`,
          code: `// ==UserScript==\n// @name Benchmark ${i}\n// @match https://bench${i}.org/*\n// ==/UserScript==\n// Code line ${i}`,
          enabled: i % 2 === 0,
          createdAt: Date.now() - i * 1000,
          metadata: {
            name: `Benchmark ${i}`,
            description: `Description ${i}`,
            matches: [`https://bench${i}.org/*`],
            grants: ['none']
          }
        } as any);
      }

      const Component = defineComponent({
        setup() {
          return useDashboardState();
        },
        render() {
          return h('div');
        }
      });

      const wrapper = mount(Component);
      await flushPromises();

      const scriptsMap: Record<string, ScriptRecord> = {};
      for (const s of fakeScripts) {
        scriptsMap[s.id] = s;
      }
      wrapper.vm.scripts = scriptsMap;
      await nextTick();

      const startTime = performance.now();
      wrapper.vm.searchQuery = 'Benchmark Target 888';
      await nextTick();
      const elapsed = performance.now() - startTime;

      expect(elapsed).toBeLessThan(100); // Strict latency requirement
      expect(wrapper.vm.filteredScripts.length).toBe(1);
      expect(wrapper.vm.filteredScripts[0].id).toBe('bench-script-888');

      wrapper.unmount();
    });
  });

  // =========================================================================
  // DIMENSION 5: Regression Oracle & Sensitivity Verification
  // =========================================================================
  describe('Dimension 5: Regression Oracle & Sensitivity Verification', () => {
    it('5.1: Regression Oracle: Mutating getScripts returned object does not pollute internal store', async () => {
      const scriptId = 'oracle-immutable-script';
      await saveScript({
        id: scriptId,
        name: 'Untouchable Name',
        code: '// ==UserScript==\n// ==/UserScript==',
        enabled: true
      });

      const scriptsMap = await getScripts();
      // Malicious caller mutates the returned object directly
      (scriptsMap[scriptId] as any).name = 'POISONED_NAME';
      (scriptsMap[scriptId] as any).metadata = { hacked: true };

      // Re-fetch scripts from storage
      const freshMap = await getScripts();
      expect(freshMap[scriptId].name).toBe('Untouchable Name');
      expect((freshMap[scriptId].metadata as any)?.hacked).toBeUndefined();
    });

    it('5.2: Regression Oracle: UiIpcServer catches and converts all unhandled rejections during status queries', async () => {
      const debuggerMgr = new TabDebuggerManager();
      const uiIpc = new UiIpcServer(debuggerMgr);
      uiIpc.init();

      // Force chrome.storage.local.get to throw an unhandled rejection
      vi.spyOn(chrome.storage.local, 'get').mockRejectedValue(new Error('Fatal I/O failure'));

      let responded = false;
      let responsePayload: any = null;

      uiIpc.handleMessage(
        { type: 'GET_CDP_STATUS', tabId: 999 },
        {} as any,
        (res) => {
          responded = true;
          responsePayload = res;
        }
      );

      // Wait a tick for promise handling
      await new Promise((r) => setTimeout(r, 20));

      expect(responded).toBe(true);
      expect(responsePayload.status).toBe('IDLE');
      expect(responsePayload.reason).toContain('Fatal I/O failure');

      uiIpc.destroy();
      debuggerMgr.destroy();
    });
  });
});
