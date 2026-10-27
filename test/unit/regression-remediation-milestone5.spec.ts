/**
 * Comprehensive Milestone 5 Regression Test Suite
 * Location: test/unit/regression-remediation-milestone5.spec.ts
 *
 * Verifies all bug remediations, security hardening, and performance optimizations
 * implemented across Milestones 1 through 4:
 *
 * 1. M2 Storage & Security:
 *    - Prototype pollution hardening in GmStorageRepository (Object.create(null) buckets)
 *    - Bundle prototype poisoning defense (FORBIDDEN_BUNDLE_KEYS)
 *    - Orphan storage & mutex purging on deleteScript
 *    - In-memory cache mutation defense (deepClone)
 *    - Sender tab authentication and @grant security enforcement in gm-handler.ts
 *    - Unhandled rejection boundary in ui-ipc.ts GET_CDP_STATUS
 *
 * 2. M3 CDP Bridge & Injection:
 *    - Service Worker wake-up session rehydration in TabDebuggerManager
 *    - Elimination of false CONFLICT on SW wake-up (reconcileTargets)
 *    - Channel token validation and sender source enforcement in validator.ts
 *    - PostMessage origin confinement (window.location.origin) in page-runner.ts
 *    - Double settlement guard in ContentScriptBridge.forwardToServiceWorker
 *    - Fallback userscript execution handling (EXECUTE_USERSCRIPT)
 *    - Deterministic matching script sorting in StageScheduler
 *    - SPA route navigation injection in ScriptInjector (handleTabsUpdated)
 *
 * 3. M4 UI Reactivity, Performance & Pruning:
 *    - Elimination of double storage writes in usePopupState
 *    - Optimistic toggle state race protection in usePopupState
 *    - Reconnect timer tracking and cleanup on unmount in usePopupState
 *    - Metadata-only search performance in useDashboardState
 *    - Delegation of hasCdpNeeds to scriptRequiresCdp
 *    - Verification of pruned dead code symbols
 *
 * 4. Strict Scope Boundary Integrity:
 *    - Verification that packages/xobrow/ is 100% untouched
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { setupChromeMock } from '../mocks/chrome';
import {
  gmStorageRepo,
  saveScript,
  getScripts,
  getScriptList,
  deleteScript,
  resetToDefaultScripts,
  exportScripts,
  importScripts,
  FORBIDDEN_BUNDLE_KEYS,
  saveTabSession
} from '@/shared/storage';
import { GmStorageMessageHandler } from '@/background/gm-handler';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { UiIpcServer } from '@/background/ui-ipc';
import { ContentScriptBridge } from '@/content/bridge';
import { verifySenderSource, verifyChannelId } from '@/content/bridge/validator';
import { pageSandboxRunner } from '@/background/injector/page-runner';
import { ScriptInjector } from '@/background/injector';
import { StageScheduler } from '@/background/injector/stage-scheduler';
import { ScriptRecord } from '@/shared/types';
import { usePopupState } from '@/popup/composables/usePopupState';
import { useDashboardState } from '@/dashboard/composables/useDashboardState';

describe('Milestone 5 Regression Test Suite: Comprehensive Bug Remediation Verification', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: Milestone 2 Storage & Security Regressions
  // =========================================================================
  describe('1. M2 Storage & Security Remediations', () => {
    it('1.1: GmStorageRepository creates prototype-free buckets and prevents prototype pollution on Object.prototype', async () => {
      const scriptId = 'proto-pollution-test-script';
      await gmStorageRepo.clearGmValues(scriptId);

      // Attempt prototype pollution via reserved property names
      await gmStorageRepo.setGmValue(scriptId, '__proto__', { evil: 'polluted' });
      await gmStorageRepo.setGmValue(scriptId, 'constructor', { evil: 'polluted' });
      await gmStorageRepo.setGmValue(scriptId, 'prototype', { evil: 'polluted' });

      // Verify Object.prototype remains clean
      expect((Object.prototype as any).evil).toBeUndefined();
      expect(({} as any).evil).toBeUndefined();

      // Verify stored values are retrieved without error
      const protoVal = await gmStorageRepo.getGmValue(scriptId, '__proto__');
      expect(protoVal).toEqual({ evil: 'polluted' });

      const constructorVal = await gmStorageRepo.getGmValue(scriptId, 'constructor');
      expect(constructorVal).toEqual({ evil: 'polluted' });

      // Verify bucket returned has null prototype
      const allVals = await gmStorageRepo.getGmValues(scriptId);
      expect(Object.getPrototypeOf(allVals)).toBeNull();

      // Test batch write with reserved keys
      await gmStorageRepo.setGmValues(scriptId, {
        polluted_flag: true,
        toString: 'custom_to_string'
      });
      expect((Object.prototype as any).polluted_flag).toBeUndefined();

      // Cleanup
      await gmStorageRepo.clearGmValues(scriptId);
    });

    it('1.2: bundle.ts guards against forbidden keys (__proto__, constructor, prototype) in export and import', async () => {
      expect(FORBIDDEN_BUNDLE_KEYS.has('__proto__')).toBe(true);
      expect(FORBIDDEN_BUNDLE_KEYS.has('constructor')).toBe(true);
      expect(FORBIDDEN_BUNDLE_KEYS.has('prototype')).toBe(true);

      // Save a valid script and manually craft malicious bundle payload
      await saveScript({
        id: 'safe-script-m5',
        name: 'Safe Script',
        code: '// ==UserScript==\n// @name Safe\n// ==/UserScript==',
        enabled: true
      });

      const exportedJson = await exportScripts();
      const parsed = JSON.parse(exportedJson);
      expect(parsed.scripts.some((s: any) => FORBIDDEN_BUNDLE_KEYS.has(s.id))).toBe(false);

      // Malicious import containing forbidden IDs
      const maliciousJson = JSON.stringify({
        version: 1,
        scripts: [
          {
            id: '__proto__',
            name: 'Malicious Proto Script',
            code: '// ==UserScript==\n// @name Malicious Proto\n// ==/UserScript=='
          },
          {
            id: 'constructor',
            name: 'Malicious Constructor Script',
            code: '// ==UserScript==\n// @name Malicious Constructor\n// ==/UserScript=='
          }
        ]
      });

      const importResult = await importScripts(maliciousJson);
      expect(importResult.imported).toBe(2);

      // Verify scripts in storage do NOT have forbidden IDs
      const currentScripts = await getScripts();
      expect(Object.prototype.hasOwnProperty.call(currentScripts, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(currentScripts, 'constructor')).toBe(false);
      expect((Object.prototype as any).name).toBeUndefined();
    });

    it('1.3: deleteScript purges both persistent GM storage and allocated script mutexes', async () => {
      const scriptId = 'script-orphan-purge-target';
      await saveScript({
        id: scriptId,
        name: 'Orphan Purge Script',
        code: '// ==UserScript==\n// @name Purge Target\n// ==/UserScript==',
        enabled: true
      });

      await gmStorageRepo.setGmValue(scriptId, 'session_token', 'xyz-999');
      await gmStorageRepo.setGmValue(scriptId, 'preferences', { theme: 'cyberpunk' });

      expect(await gmStorageRepo.getGmValue(scriptId, 'session_token')).toBe('xyz-999');

      // Check that mutex was instantiated for this script
      const mutexesMap: Map<string, any> = (gmStorageRepo as any).scriptMutexes;
      expect(mutexesMap.has(scriptId)).toBe(true);

      // Call deleteScript
      await deleteScript(scriptId);

      // Verify script record is removed
      const scripts = await getScripts();
      expect(scripts[scriptId]).toBeUndefined();

      // Verify GM storage bucket is wiped
      const val = await gmStorageRepo.getGmValue(scriptId, 'session_token');
      expect(val).toBeUndefined();

      // Verify script mutex is purged from memory
      expect(mutexesMap.has(scriptId)).toBe(false);
    });

    it('1.4: getScripts and getScriptList return deep clones preventing in-memory cache corruption', async () => {
      const scriptId = 'cache-immutability-script';
      await saveScript({
        id: scriptId,
        name: 'Original Immutable Name',
        code: '// ==UserScript==\n// @name Immutability Test\n// ==/UserScript==',
        enabled: true
      });

      const fetchedList = await getScriptList();
      const targetInList = fetchedList.find((s) => s.id === scriptId);
      expect(targetInList).toBeDefined();

      // Direct in-memory property mutation on returned object
      targetInList!.name = 'MUTATED_IN_MEMORY';

      // Re-fetch scripts from repository
      const freshScripts = await getScripts();
      expect(freshScripts[scriptId].name).toBe('Original Immutable Name');
      expect(freshScripts[scriptId].name).not.toBe('MUTATED_IN_MEMORY');
    });

    it('1.5: GmStorageMessageHandler strictly authenticates sender tab context, enabled state, @grant, and @match URLs', async () => {
      const handler = new GmStorageMessageHandler(gmStorageRepo);
      handler.init();

      const scriptId = 'secured-gm-script';
      await saveScript({
        id: scriptId,
        name: 'Secured Script',
        code: `// ==UserScript==
// @name         Secured Script
// @match        https://app.example.com/*
// @exclude      https://app.example.com/restricted/*
// @grant        GM_setValue
// @grant        GM_deleteValue
// ==/UserScript==`,
        enabled: true
      });

      // Case A: Missing sender tab context
      const untrustedSenderNoTab: any = {
        id: 'foreign-extension-id',
        url: 'https://untrusted-webpage.com'
      };
      const resA = await handler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId, key: 'token', value: 'secret' },
        untrustedSenderNoTab
      );
      expect(resA.success).toBe(false);
      expect(resA.error).toContain('Unauthorized: Sender has no associated tab context');

      // Case B: Non-existent script ID
      const validSenderTab: any = {
        tab: { id: 101, url: 'https://app.example.com/dashboard' },
        url: 'https://app.example.com/dashboard'
      };
      const resB = await handler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: 'nonexistent-id', key: 'token', value: 'secret' },
        validSenderTab
      );
      expect(resB.success).toBe(false);
      expect(resB.error).toContain('not found');

      // Case C: Script is disabled
      await saveScript({
        id: 'disabled-script',
        name: 'Disabled Script',
        code: `// ==UserScript==
// @name         Disabled Script
// @match        https://app.example.com/*
// @grant        GM_setValue
// ==/UserScript==`,
        enabled: false
      });
      const resC = await handler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: 'disabled-script', key: 'token', value: 'secret' },
        validSenderTab
      );
      expect(resC.success).toBe(false);
      expect(resC.error).toContain('is disabled');

      // Case D: Script declared @grant none
      await saveScript({
        id: 'no-grant-script',
        name: 'No Grant Script',
        code: `// ==UserScript==
// @name         No Grant Script
// @match        https://app.example.com/*
// @grant        none
// ==/UserScript==`,
        enabled: true
      });
      const resD = await handler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: 'no-grant-script', key: 'token', value: 'secret' },
        validSenderTab
      );
      expect(resD.success).toBe(false);
      expect(resD.error).toContain('declared @grant none');

      // Case E: Script lacks GM_setValue grant
      await saveScript({
        id: 'logger-only-script',
        name: 'Logger Only',
        code: `// ==UserScript==
// @name         Logger Only
// @match        https://app.example.com/*
// @grant        GM_log
// ==/UserScript==`,
        enabled: true
      });
      const resE = await handler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: 'logger-only-script', key: 'token', value: 'secret' },
        validSenderTab
      );
      expect(resE.success).toBe(false);
      expect(resE.error).toContain('Script lacks grant for GM_STORAGE_SET');

      // Case F: Sender URL not matched by @match
      const mismatchedSenderTab: any = {
        tab: { id: 101, url: 'https://evil.attacker.com/steal' },
        url: 'https://evil.attacker.com/steal'
      };
      const resF = await handler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId, key: 'token', value: 'secret' },
        mismatchedSenderTab
      );
      expect(resF.success).toBe(false);
      expect(resF.error).toContain('Unauthorized: Sender URL');

      // Case G: Sender URL matched by @exclude
      const excludedSenderTab: any = {
        tab: { id: 101, url: 'https://app.example.com/restricted/admin' },
        url: 'https://app.example.com/restricted/admin'
      };
      const resG = await handler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId, key: 'token', value: 'secret' },
        excludedSenderTab
      );
      expect(resG.success).toBe(false);
      expect(resG.error).toContain('is excluded');

      // Case H: Fully authorized sender matching all rules
      const resH = await handler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId, key: 'token', value: 'authentic-token' },
        validSenderTab
      );
      expect(resH.success).toBe(true);

      const storedValue = await gmStorageRepo.getGmValue(scriptId, 'token');
      expect(storedValue).toBe('authentic-token');

      handler.destroy();
      await gmStorageRepo.clearGmValues(scriptId);
    });

    it('1.6: ui-ipc.ts handles storage failures in GET_CDP_STATUS gracefully without unhandled rejection', async () => {
      const debuggerMgr = new TabDebuggerManager();
      const uiIpc = new UiIpcServer(debuggerMgr);
      uiIpc.init();

      // Mock chrome.storage.local.get to simulate I/O exception
      vi.spyOn(chrome.storage.local, 'get').mockRejectedValueOnce(
        new Error('Disk read failure during status probe')
      );

      const response = await new Promise<any>((resolve) => {
        uiIpc.handleMessage(
          { type: 'GET_CDP_STATUS', tabId: 999 },
          {} as any,
          resolve
        );
      });

      expect(response).toBeDefined();
      expect(response.status).toBe('IDLE');
      expect(response.reason).toContain('Disk read failure');

      uiIpc.destroy();
      debuggerMgr.destroy();
    });
  });

  // =========================================================================
  // SECTION 2: Milestone 3 CDP Bridge & Injection Regressions
  // =========================================================================
  describe('2. M3 CDP Bridge & Injection Remediations', () => {
    it('2.1: TabDebuggerManager rehydrates persisted tab sessions on SW startup without data loss', async () => {
      const persistedTabId = 555;
      await saveTabSession({
        tabId: persistedTabId,
        status: 'ATTACHED',
        attached: true,
        activeDomains: ['Network', 'Page'],
        conflictDetected: false,
        updatedAt: Date.now() - 1000
      } as any);

      // Browser ground truth confirms tab 555 is attached
      context.mockDebugger.getTargets.mockResolvedValue([
        { tabId: persistedTabId, attached: true, url: 'https://persistent-app.org' } as any
      ]);

      const debuggerMgr = new TabDebuggerManager();
      expect(debuggerMgr.getSession(persistedTabId)).toBeUndefined();

      await debuggerMgr.init();

      const rehydrated = debuggerMgr.getSession(persistedTabId);
      expect(rehydrated).toBeDefined();
      expect(rehydrated?.status).toBe('ATTACHED');
      expect(rehydrated?.attached).toBe(true);
      expect(rehydrated?.activeDomains).toContain('Network');
      expect(rehydrated?.activeDomains).toContain('Page');
      expect(rehydrated?.conflictDetected).toBe(false);

      debuggerMgr.destroy();
    });

    it('2.2: reconcileTargets synchronizes browser-attached targets and eliminates false CONFLICT on SW wake-up', async () => {
      const attachedTabId = 777;

      // Mock browser targets reporting tab 777 as already attached in Chrome
      context.mockDebugger.getTargets.mockResolvedValue([
        { tabId: attachedTabId, attached: true, url: 'https://attached-target.com' } as any
      ]);

      const debuggerMgr = new TabDebuggerManager();
      await debuggerMgr.init();

      const session = debuggerMgr.getSession(attachedTabId);
      expect(session).toBeDefined();
      expect(session?.status).toBe('ATTACHED');
      expect(session?.attached).toBe(true);
      expect(session?.conflictDetected).toBe(false);

      // Now attempt attachTab(attachedTabId)
      const attachSpy = vi.spyOn(chrome.debugger, 'attach');
      await debuggerMgr.attachTab(attachedTabId);

      // Should succeed as a clean no-op without re-calling chrome.debugger.attach
      expect(attachSpy).not.toHaveBeenCalled();
      expect(debuggerMgr.getTabStatus(attachedTabId)).toBe('ATTACHED');
      expect(debuggerMgr.getTabStatus(attachedTabId)).not.toBe('CONFLICT');

      debuggerMgr.destroy();
    });

    it('2.3: validator.ts strictly enforces sender source and cryptographic channel tokens', () => {
      // Layer 3: verifySenderSource
      expect(verifySenderSource('xokj-userscript', false)).toBe(true);
      expect(verifySenderSource('untrusted-attacker', false)).toBe(false);
      expect(verifySenderSource(undefined, false)).toBe(false);
      expect(verifySenderSource(null, false)).toBe(false);
      expect(verifySenderSource(undefined, true)).toBe(true); // allowed when unspecified explicitly permitted

      // Layer 4: verifyChannelId
      const expectedToken = 'crypto-chan-token-12345';

      // When requireChannelId is true:
      expect(verifyChannelId(expectedToken, expectedToken, true)).toBe(true);
      expect(verifyChannelId('wrong-token', expectedToken, true)).toBe(false);
      expect(verifyChannelId(undefined, expectedToken, true)).toBe(false);
      expect(verifyChannelId('', expectedToken, true)).toBe(false);

      // When requireChannelId is false (fallback mode):
      expect(verifyChannelId(expectedToken, expectedToken, false)).toBe(true);
      expect(verifyChannelId('wrong-token', expectedToken, false)).toBe(false);
      expect(verifyChannelId(undefined, expectedToken, false)).toBe(true);
    });

    it('2.4: pageSandboxRunner confines window.postMessage targetOrigin to window.location.origin', () => {
      const postedCalls: Array<{ payload: any; targetOrigin: string }> = [];
      const origPostMessage = window.postMessage;

      vi.stubGlobal('postMessage', (payload: any, targetOrigin: string) => {
        postedCalls.push({ payload, targetOrigin });
      });

      // Test valid web origin
      delete (window as any).location;
      (window as any).location = { origin: 'https://secure-banking.net', href: 'https://secure-banking.net/portal' };

      pageSandboxRunner(
        `GM_setValue('secretKey', 'superSecret123');`,
        'Origin Test Script',
        'script-origin-1',
        { grants: ['GM_setValue'] } as any,
        'chan-tok-888'
      );

      expect(postedCalls.length).toBeGreaterThan(0);
      expect(postedCalls[0].targetOrigin).toBe('https://secure-banking.net');
      expect(postedCalls[0].targetOrigin).not.toBe('*');
      expect(postedCalls[0].payload.channelId).toBe('chan-tok-888');

      // Test null/sandboxed origin fallback
      postedCalls.length = 0;
      (window as any).location = { origin: 'null', href: 'about:blank' };

      pageSandboxRunner(
        `GM_setValue('count', 1);`,
        'Sandboxed Script',
        'script-origin-2',
        { grants: ['GM_setValue'] } as any,
        'chan-tok-null'
      );

      expect(postedCalls.length).toBeGreaterThan(0);
      expect(postedCalls[0].targetOrigin).toBe('*');

      window.postMessage = origPostMessage;
    });

    it('2.5: ContentScriptBridge forwardToServiceWorker guards against double promise settlement', async () => {
      const bridge = new ContentScriptBridge({ autoStart: false });

      // Mock sendMessage that invokes both callback AND resolves promise simultaneously
      let callCount = 0;
      context.mockRuntime.sendMessage.mockImplementation((req: any, cb?: (res: any) => void) => {
        callCount++;
        const dummyResponse = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true, result: {} };
        // Trigger callback
        cb?.(dummyResponse);
        // Also return promise resolving same response
        return Promise.resolve(dummyResponse);
      });

      const forwardMethod = (bridge as any).forwardToServiceWorker.bind(bridge);
      const res = await forwardMethod({
        type: 'CDP_RPC_REQUEST',
        id: 'settle-req-1',
        method: 'Runtime.evaluate',
        params: { expression: '1+1' }
      });

      expect(res).toBeDefined();
      expect(res.id).toBe('settle-req-1');
      expect(callCount).toBe(1);

      bridge.destroy();
    });

    it('2.6: ContentScriptBridge handles EXECUTE_USERSCRIPT runtime message via fallback scheduling', async () => {
      const bridge = new ContentScriptBridge({ autoStart: false });
      const testScript = {
        id: 'fallback-exec-script',
        name: 'Fallback Exec',
        code: 'console.log("fallback executed");',
        enabled: true,
        metadata: { name: 'Fallback Exec', runAt: 'document-idle' }
      } as any as ScriptRecord;

      const sendResponseSpy = vi.fn();
      const handled = bridge.handleRuntimeMessage(
        { type: 'EXECUTE_USERSCRIPT', script: testScript, runAt: 'document-idle' },
        {} as any,
        sendResponseSpy
      );

      expect(handled).toBe(true);
      expect(sendResponseSpy).toHaveBeenCalledWith({ acknowledged: true, success: true });

      bridge.destroy();
    });

    it('2.7: StageScheduler deterministically sorts matching scripts by createdAt, name, and id', async () => {
      const scheduler = new StageScheduler({} as any, {} as any);

      const scriptA = {
        id: 'script-z',
        name: 'Script Zeta',
        code: `// ==UserScript==
// @name Script Zeta
// @match https://app.com/*
// ==/UserScript==`,
        createdAt: 2000,
        enabled: true
      };

      const scriptB = {
        id: 'script-a',
        name: 'Script Alpha',
        code: `// ==UserScript==
// @name Script Alpha
// @match https://app.com/*
// ==/UserScript==`,
        createdAt: 1000,
        enabled: true
      };

      const scriptC = {
        id: 'script-b',
        name: 'Script Beta',
        code: `// ==UserScript==
// @name Script Beta
// @match https://app.com/*
// ==/UserScript==`,
        createdAt: 1000,
        enabled: true
      };

      await saveScript(scriptA);
      await saveScript(scriptB);
      await saveScript(scriptC);

      const matching = await scheduler.getMatchingScripts('https://app.com/page');
      const testMatching = matching.filter((s) => ['script-z', 'script-a', 'script-b'].includes(s.id));

      // scriptB and scriptC have createdAt: 1000, scriptA has 2000
      // Between scriptB ('Script Alpha') and scriptC ('Script Beta'), Alpha comes first
      expect(testMatching[0].id).toBe('script-a');
      expect(testMatching[1].id).toBe('script-b');
      expect(testMatching[2].id).toBe('script-z');
    });

    it('2.8: ScriptInjector triggers stage processing upon dynamic in-page SPA route navigation', async () => {
      const debuggerMgr = new TabDebuggerManager();
      await debuggerMgr.init();

      const injector = new ScriptInjector({
        debuggerManager: debuggerMgr,
        autoStart: false
      });

      const tabId = 444;
      // Pre-set tab initial URL
      (injector as any).guard.tabUrls.set(tabId, 'https://spa.domain.com/route-initial');

      const processStageSpy = vi.spyOn(injector, 'processStage').mockResolvedValue();

      // Trigger SPA in-page pushState / route update (status !== 'complete')
      await injector.handleTabsUpdated(
        tabId,
        { url: 'https://spa.domain.com/route-next' },
        { id: tabId, url: 'https://spa.domain.com/route-next' } as any
      );

      expect(processStageSpy).toHaveBeenCalledWith(
        tabId,
        0,
        'https://spa.domain.com/route-next',
        'document-idle'
      );

      injector.destroy();
      debuggerMgr.destroy();
    });
  });

  // =========================================================================
  // SECTION 3: Milestone 4 UI Reactivity, Optimization & Pruning Regressions
  // =========================================================================
  describe('3. M4 UI Reactivity, Performance & Pruning Remediations', () => {
    it('3.1: usePopupState dispatches runtime message and does NOT execute duplicate direct storage writes', async () => {
      const sendMessageSpy = context.mockRuntime.sendMessage;
      const storageSetSpy = vi.spyOn(chrome.storage.local, 'set');

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

      storageSetSpy.mockClear();

      // Toggle global
      await wrapper.vm.toggleGlobal(false);
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'TOGGLE_GLOBAL', enabled: false });
      // Direct local storage set must NOT have been called directly by popup
      expect(storageSetSpy).not.toHaveBeenCalled();

      // Toggle script
      await wrapper.vm.toggleScript('script-m5-test', false);
      expect(sendMessageSpy).toHaveBeenCalledWith({
        type: 'TOGGLE_SCRIPT',
        scriptId: 'script-m5-test',
        enabled: false
      });
      expect(storageSetSpy).not.toHaveBeenCalled();

      wrapper.unmount();
    });

    it('3.2: usePopupState protects against optimistic state races when stale storage events arrive', async () => {
      const scriptId = 'script-race-protection';
      await saveScript({
        id: scriptId,
        name: 'Race Target',
        code: '// ==UserScript==\n// @match *://*/*\n// ==/UserScript==',
        enabled: true
      });

      // Keep sendMessage unresolved to keep toggle in-flight
      let resolveIpc: any;
      context.mockRuntime.sendMessage.mockImplementation(async (msg: any) => {
        if (msg.type === 'TOGGLE_SCRIPT' && msg.scriptId === scriptId) {
          return new Promise((res) => {
            resolveIpc = res;
          });
        }
        return { success: true };
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

      // Trigger user toggle to false (in-flight)
      const togglePromise = wrapper.vm.toggleScript(scriptId, false);

      // Verify immediate optimistic local state
      const scriptRef = wrapper.vm.scripts.find((s: any) => s.id === scriptId);
      expect(scriptRef?.enabled).toBe(false);

      // Simulate an incoming STALE storage change event broadcasting enabled: true
      const storageListener = Array.from(context.storageOnChanged.listeners)[0];
      expect(storageListener).toBeDefined();

      storageListener(
        {
          scripts: {
            oldValue: {},
            newValue: {
              [scriptId]: {
                id: scriptId,
                name: 'Race Target',
                code: '',
                enabled: true // STALE VALUE!
              }
            }
          }
        },
        'local'
      );
      await nextTick();

      // Assert optimistic state remains authoritative (still false)
      const scriptAfterStaleEvent = wrapper.vm.scripts.find((s: any) => s.id === scriptId);
      expect(scriptAfterStaleEvent?.enabled).toBe(false);

      // Now resolve background IPC
      resolveIpc?.({ success: true });
      await togglePromise;
      await flushPromises();

      wrapper.unmount();
    });

    it('3.3: usePopupState tracks reconnect timers and clears all handles on unmount', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const Component = defineComponent({
        setup() {
          return usePopupState();
        },
        render() {
          return h('div');
        }
      });

      context.mockTabs.query.mockResolvedValue([{ id: 10, url: 'https://app.dev' } as any]);

      const wrapper = mount(Component);
      await flushPromises();

      // Trigger successful reconnect which sets reconnectSuccess reset timer
      await wrapper.vm.reconnectCdp();
      expect(wrapper.vm.reconnectSuccess).toBe(true);

      // Unmount component
      wrapper.unmount();

      // Verify that clearTimeout was called to eliminate timer leaks
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('3.4: useDashboardState performs metadata-only search avoiding full-text scanning on large script code', async () => {
      const largeScriptId = 'massive-script-perf';
      // Create a 50,000 character userscript body containing a unique secret token
      const massiveCode = `
// ==UserScript==
// @name         Performance Benchmark Script
// @description  High efficiency metadata tester
// @match        https://speed.org/*
// ==/UserScript==
// ` + 'X'.repeat(50000) + `
// EMBEDDED_SECRET_CODE_BODY_TOKEN_XYZ
`;

      await saveScript({
        id: largeScriptId,
        name: 'Performance Benchmark Script',
        code: massiveCode,
        enabled: true
      });

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

      // Search for code-body token: must NOT match (metadata-only search optimization)
      wrapper.vm.searchQuery = 'EMBEDDED_SECRET_CODE_BODY_TOKEN_XYZ';
      await nextTick();
      expect(wrapper.vm.filteredScripts.some((s: any) => s.id === largeScriptId)).toBe(false);

      // Search for metadata name: MUST match
      wrapper.vm.searchQuery = 'Benchmark';
      await nextTick();
      expect(wrapper.vm.filteredScripts.some((s: any) => s.id === largeScriptId)).toBe(true);

      // Search for metadata description: MUST match
      wrapper.vm.searchQuery = 'High efficiency';
      await nextTick();
      expect(wrapper.vm.filteredScripts.some((s: any) => s.id === largeScriptId)).toBe(true);

      // Search for @match pattern: MUST match
      wrapper.vm.searchQuery = 'speed.org';
      await nextTick();
      expect(wrapper.vm.filteredScripts.some((s: any) => s.id === largeScriptId)).toBe(true);

      wrapper.unmount();
    });

    it('3.5: StageScheduler hasCdpNeeds delegates cleanly to scriptRequiresCdp', () => {
      const scheduler = new StageScheduler({} as any, {} as any);

      const nonCdpScript = {
        id: 'plain-script',
        name: 'Plain',
        code: '// ==UserScript==\n// @match *://*/*\n// ==/UserScript==',
        enabled: true,
        metadata: { grants: ['none'] }
      } as any as ScriptRecord;

      const cdpScript = {
        id: 'cdp-script',
        name: 'CDP Active',
        code: '// ==UserScript==\n// @grant GM_cdp\n// ==/UserScript==',
        enabled: true,
        metadata: { grants: ['GM_cdp'], cdpDomains: ['Network'] }
      } as any as ScriptRecord;

      expect(scheduler.hasCdpNeeds([nonCdpScript])).toBe(false);
      expect(scheduler.hasCdpNeeds([cdpScript])).toBe(true);
      expect(scheduler.hasCdpNeeds([nonCdpScript, cdpScript])).toBe(true);
    });

    it('3.6: Dead code symbols remain cleanly pruned across src/', () => {
      const rpcRouterFile = readFileSync(resolve(__dirname, '../../src/background/cdp/rpc-router.ts'), 'utf-8');
      expect(rpcRouterFile).not.toContain('classifyCdpCommandError');

      const defaultsFile = readFileSync(resolve(__dirname, '../../src/shared/storage/defaults.ts'), 'utf-8');
      expect(defaultsFile).not.toContain('removeStorageItem');

      const typesFile = readFileSync(resolve(__dirname, '../../src/shared/types.ts'), 'utf-8');
      expect(typesFile).not.toContain('ConflictEvent');
      expect(typesFile).not.toContain('CdpRpcWindowRequest');
      expect(typesFile).not.toContain('CdpRpcWindowResponse');
      expect(typesFile).not.toContain('ExtensionMessage');
    });
  });

  // =========================================================================
  // SECTION 4: Milestone Scope Boundary Integrity
  // =========================================================================
  describe('4. Strict Scope Boundary Integrity', () => {
    it('4.1: packages/xobrow/ is 100% untouched and clean', () => {
      const statusOutput = execSync('git status --porcelain packages/xobrow/', {
        cwd: resolve(__dirname, '../..'),
        encoding: 'utf-8'
      }).trim();

      expect(statusOutput).toBe('');
    });
  });
});
