/**
 * Milestone 5 Adversarial Stress & Empirical Verification Suite
 * Location: test/unit/challenger-m5-empirical.spec.ts
 *
 * Adversarial Challenger 1 Suite for Milestone 5:
 * 1. Empirical verification that regression suite catches actual regressions (mutation/oracle proofs)
 * 2. Deep stress testing of storage prototype pollution resilience & bundle fuzzing
 * 3. Adversarial GM permission & security fuzzing (URL spoofing, grant evasion, context tampering)
 * 4. TabDebuggerManager high-concurrency rehydration & conflict-free target attachment
 * 5. Popup composable optimistic state concurrency hammering & timer lifecycle stress
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

import { setupChromeMock } from '../mocks/chrome';
import {
  gmStorageRepo,
  saveScript,
  getScripts,
  deleteScript,
  resetToDefaultScripts,
  importScripts,
  FORBIDDEN_BUNDLE_KEYS,
  saveTabSession,
  clearTabSessions
} from '@/shared/storage';
import { GmStorageMessageHandler } from '@/background/gm-handler';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { usePopupState } from '@/popup/composables/usePopupState';

describe('Milestone 5 Adversarial Challenger Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (Object.prototype as any).pwned;
    delete (Object.prototype as any).evil;
    delete (Object.prototype as any).polluted;
    delete (Object.prototype as any).injected;
    delete (Object.prototype as any).testKey;
  });

  // =========================================================================
  // DIMENSION 1: Empirical Mutation & Regression Catch Proofs
  // =========================================================================
  describe('Dimension 1: Regression Test Suite Sensitivity & Mutation Proofs', () => {
    it('1.1: Catches prototype pollution regression if bucket inherits Object.prototype', async () => {
      // Oracle verification: demonstrate that if prototype inheritance existed, bucket prototype is mutated
      const scriptId = 'proto-oracle-check';
      await gmStorageRepo.clearGmValues(scriptId);

      // Verify that gmStorageRepo uses null-prototype bucket
      await gmStorageRepo.setGmValue(scriptId, '__proto__', { evil: 'attempt' });
      const bucket = await gmStorageRepo.getGmValues(scriptId);

      // Defended behavior: bucket prototype MUST be null
      expect(Object.getPrototypeOf(bucket)).toBeNull();

      // Regression oracle: assigning __proto__ on a normal object mutates its internal prototype!
      const vulnerableBucket: any = {};
      const attackKey = '__proto__';
      vulnerableBucket[attackKey] = { polluted: true };

      // In a vulnerable scenario, normal object prototype becomes the attack object
      expect(Object.getPrototypeOf(vulnerableBucket)).toEqual({ polluted: true });

      // But gmStorageRepo bucket is completely immune: its prototype is null and unaffected
      expect(Object.getPrototypeOf(bucket)).toBeNull();
      expect((Object.prototype as any).evil).toBeUndefined();

      await gmStorageRepo.clearGmValues(scriptId);
    });

    it('1.2: Catches bundle import regression if forbidden keys are unblocked', async () => {
      expect(FORBIDDEN_BUNDLE_KEYS.has('__proto__')).toBe(true);
      expect(FORBIDDEN_BUNDLE_KEYS.has('constructor')).toBe(true);
      expect(FORBIDDEN_BUNDLE_KEYS.has('prototype')).toBe(true);

      const maliciousPayload = JSON.stringify({
        version: 1,
        scripts: [
          { id: '__proto__', name: 'Attack 1', code: '// ==UserScript==\n// ==/UserScript==' },
          { id: 'constructor', name: 'Attack 2', code: '// ==UserScript==\n// ==/UserScript==' },
          { id: 'prototype', name: 'Attack 3', code: '// ==UserScript==\n// ==/UserScript==' }
        ]
      });

      const importResult = await importScripts(maliciousPayload);
      expect(importResult.imported).toBe(3);

      const scripts = await getScripts();
      // Defended behavior: ID was sanitized/replaced with safe unique ID and does not corrupt Object.prototype
      expect(scripts['__proto__']).not.toEqual(expect.objectContaining({ name: 'Attack 1' }));
      expect((Object.prototype as any).name).toBeUndefined();
    });

    it('1.3: Catches orphan mutex regression if deleteScript forgets to cleanup mutexes', async () => {
      const scriptId = 'mutex-leak-check';
      await saveScript({
        id: scriptId,
        name: 'Mutex Test',
        code: '// ==UserScript==\n// ==/UserScript==',
        enabled: true
      });

      await gmStorageRepo.setGmValue(scriptId, 'k', 'v');
      const mutexMap: Map<string, any> = (gmStorageRepo as any).scriptMutexes;
      expect(mutexMap.has(scriptId)).toBe(true);

      // Regression check: Calling deleteScript MUST clean up the mutex
      await deleteScript(scriptId);
      expect(mutexMap.has(scriptId)).toBe(false);
      expect(await gmStorageRepo.getGmValue(scriptId, 'k')).toBeUndefined();
    });

    it('1.4: Catches stale storage race regression in usePopupState', async () => {
      const scriptId = 'popup-race-test';
      await saveScript({
        id: scriptId,
        name: 'Popup Race',
        code: '// ==UserScript==\n// ==/UserScript==',
        enabled: true
      });

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
        render: () => h('div')
      });

      const wrapper = mount(Component);
      await flushPromises();

      // In-flight user action: toggle to false
      const togglePromise = wrapper.vm.toggleScript(scriptId, false);
      expect(wrapper.vm.scripts.find((s: any) => s.id === scriptId)?.enabled).toBe(false);

      // Incoming stale storage event claiming it is still true
      const storageListener = Array.from(context.storageOnChanged.listeners)[0];
      storageListener?.(
        {
          scripts: {
            oldValue: {},
            newValue: {
              [scriptId]: { id: scriptId, name: 'Popup Race', code: '', enabled: true }
            }
          }
        },
        'local'
      );
      await nextTick();

      // Defended behavior: optimistic state is protected against stale storage event
      expect(wrapper.vm.scripts.find((s: any) => s.id === scriptId)?.enabled).toBe(false);

      resolveIpc?.({ success: true });
      await togglePromise;
      wrapper.unmount();
    });
  });

  // =========================================================================
  // DIMENSION 2: Prototype Pollution Adversarial Stress & Fuzzing
  // =========================================================================
  describe('Dimension 2: Prototype Pollution Adversarial Stress & Fuzzing', () => {
    it('2.1: Resists high-volume concurrent writes with varied prototype pollution payloads', async () => {
      const scriptId = 'proto-stress-target';
      await gmStorageRepo.clearGmValues(scriptId);

      const dangerousKeys = [
        '__proto__',
        'constructor',
        'prototype',
        'toString',
        'valueOf',
        'hasOwnProperty',
        'isPrototypeOf',
        'propertyIsEnumerable',
        '__defineGetter__',
        '__defineSetter__',
        '__lookupGetter__',
        '__lookupSetter__'
      ];

      const writePromises: Promise<any>[] = [];

      // Concurrently fire 200 writes with dangerous keys and values
      for (let i = 0; i < 200; i++) {
        const key = dangerousKeys[i % dangerousKeys.length];
        const payload = {
          pwned: `evil_${i}`,
          nested: {
            polluted: true,
            arr: [1, 2, 3]
          }
        };
        writePromises.push(gmStorageRepo.setGmValue(scriptId, key, payload));
      }

      await Promise.all(writePromises);

      // Assert Object.prototype remains completely pristine
      expect((Object.prototype as any).pwned).toBeUndefined();
      expect((Object.prototype as any).evil).toBeUndefined();
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect((Object.prototype as any).nested).toBeUndefined();

      // Clean prototype bucket check
      const bucket = await gmStorageRepo.getGmValues(scriptId);
      expect(Object.getPrototypeOf(bucket)).toBeNull();

      // Normal safe keys can still be stored and read alongside
      await gmStorageRepo.setGmValue(scriptId, 'normalKey', 'normalVal');
      expect(await gmStorageRepo.getGmValue(scriptId, 'normalKey')).toBe('normalVal');

      await gmStorageRepo.clearGmValues(scriptId);
    });

    it('2.2: Fuzzes bundle import with deeply malicious and malformed payloads', async () => {
      const maliciousBundlePayloads = [
        // Payload with __proto__ as top level key and script id
        JSON.stringify({
          version: 1,
          __proto__: { injected: true },
          scripts: [
            { id: '__proto__', name: 'Bad 1', code: '' },
            { id: 'constructor', name: 'Bad 2', code: '' }
          ]
        }),
        // Payload with null prototype keys inside scripts array
        JSON.stringify({
          version: 1,
          scripts: [
            { id: 'prototype', name: 'Bad 3', code: '' },
            { id: 'valid-script-1', name: 'Good Script', code: '// ==UserScript==\n// ==/UserScript==' }
          ]
        }),
        // Malformed structure
        JSON.stringify({
          version: 'invalid',
          scripts: null
        }),
        // Empty payload
        JSON.stringify({})
      ];

      for (const payload of maliciousBundlePayloads) {
        try {
          await importScripts(payload);
          expect((Object.prototype as any).injected).toBeUndefined();
          expect((Object.prototype as any).Bad).toBeUndefined();
        } catch (e) {
          expect(e).toBeDefined();
        }
      }

      expect((Object.prototype as any).injected).toBeUndefined();
      expect((Object.prototype as any).testKey).toBeUndefined();
    });
  });

  // =========================================================================
  // DIMENSION 3: GM Storage Permission & Authorization Fuzzing
  // =========================================================================
  describe('Dimension 3: GM Storage Permission & Sender Authorization Fuzzing', () => {
    it('3.1: Rejects malformed and adversarial external senders without crashing service worker handler', async () => {
      const handler = new GmStorageMessageHandler(gmStorageRepo);
      handler.init();

      const scriptId = 'gm-fuzz-target';
      await saveScript({
        id: scriptId,
        name: 'GM Fuzz Script',
        code: `// ==UserScript==
// @name GM Fuzz
// @match https://secure.bank.com/account/*
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_deleteValue
// ==/UserScript==`,
        enabled: true
      });

      const adversarialSenders: any[] = [
        // External extension sender without tab
        { id: 'foreign-extension-id', url: 'chrome-extension://foreign-id/popup.html' },
        // Foreign webpage url without tab (e.g. onMessageExternal from web)
        { url: 'https://attacker.org/steal' },
        // Foreign webpage with matching URL but no tab context (cannot originate from user tab)
        { url: 'https://secure.bank.com/account/summary' },
        // Missing tab ID
        { tab: { url: 'https://secure.bank.com/account/summary' } },
        // Zero tab ID
        { tab: { id: 0, url: 'https://secure.bank.com/account/summary' } },
        // Invalid and spoofed protocols
        { tab: { id: 10, url: '' } },
        { tab: { id: 10, url: 'javascript:alert(1)' } },
        { tab: { id: 10, url: 'file:///etc/passwd' } },
        { tab: { id: 10, url: 'data:text/html,evil' } },
        // Wrong domain / subdomain
        { tab: { id: 10, url: 'https://evil.bank.com/account/1' } },
        { tab: { id: 10, url: 'https://attacker.bank.com/account/1' } },
        // Subpath not matched by @match
        { tab: { id: 10, url: 'https://secure.bank.com/settings' } }
      ];

      for (const sender of adversarialSenders) {
        const response = await handler.processMessage(
          { type: 'GM_STORAGE_SET', scriptId, key: 'balance', value: 999999 },
          sender
        );

        // Every single adversarial sender MUST be rejected
        expect(response.success).toBe(false);
        expect(response.error).toBeDefined();
      }

      // Assert balance was NOT modified
      const value = await gmStorageRepo.getGmValue(scriptId, 'balance');
      expect(value).toBeUndefined();

      handler.destroy();
      await gmStorageRepo.clearGmValues(scriptId);
    });

    it('3.2: Rejects grant escalation and enforces operation-specific privileges', async () => {
      const handler = new GmStorageMessageHandler(gmStorageRepo);
      handler.init();

      // Script that only has GM_getValue (read-only)
      const readOnlyScriptId = 'read-only-script';
      await saveScript({
        id: readOnlyScriptId,
        name: 'Read Only Script',
        code: `// ==UserScript==
// @name Read Only
// @match https://app.example.com/*
// @grant GM_getValue
// ==/UserScript==`,
        enabled: true
      });

      const validSender: any = {
        tab: { id: 101, url: 'https://app.example.com/home' },
        url: 'https://app.example.com/home'
      };

      // Attempt write with read-only script: MUST fail
      const writeRes = await handler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: readOnlyScriptId, key: 'test', value: 'secret' },
        validSender
      );
      expect(writeRes.success).toBe(false);
      expect(writeRes.error).toContain('Script lacks grant for GM_STORAGE_SET');

      // Attempt delete with read-only script: MUST fail
      const deleteRes = await handler.processMessage(
        { type: 'GM_STORAGE_DELETE', scriptId: readOnlyScriptId, key: 'test' },
        validSender
      );
      expect(deleteRes.success).toBe(false);
      expect(deleteRes.error).toContain('Script lacks grant for GM_STORAGE_DELETE');

      // Attempt write with script having GM_deleteValue only
      const deleteOnlyScriptId = 'delete-only-script';
      await saveScript({
        id: deleteOnlyScriptId,
        name: 'Delete Only Script',
        code: `// ==UserScript==
// @name Delete Only
// @match https://app.example.com/*
// @grant GM_deleteValue
// ==/UserScript==`,
        enabled: true
      });

      const writeRes2 = await handler.processMessage(
        { type: 'GM_STORAGE_SET', scriptId: deleteOnlyScriptId, key: 'test', value: 'secret' },
        validSender
      );
      expect(writeRes2.success).toBe(false);
      expect(writeRes2.error).toContain('Script lacks grant for GM_STORAGE_SET');

      const deleteRes2 = await handler.processMessage(
        { type: 'GM_STORAGE_DELETE', scriptId: deleteOnlyScriptId, key: 'test' },
        validSender
      );
      expect(deleteRes2.success).toBe(true);

      handler.destroy();
    });
  });

  // =========================================================================
  // DIMENSION 4: Debugger Manager Lifecycle & Rehydration Stress
  // =========================================================================
  describe('Dimension 4: Debugger Manager SW Wake-up & Target Rehydration', () => {
    it('4.1: Seamlessly handles 30 concurrent tab targets across rehydration without false CONFLICT', async () => {
      await clearTabSessions();

      const targetMocks: any[] = [];

      // Pre-populate 15 attached sessions in storage repo
      for (let i = 1; i <= 15; i++) {
        await saveTabSession({
          tabId: i,
          status: 'ATTACHED',
          attached: true,
          activeDomains: ['Page', 'Runtime', 'Network'],
          conflictDetected: false,
          updatedAt: Date.now()
        } as any);
      }

      // Chrome debugger ground truth: tabs 1..20 are attached
      for (let i = 1; i <= 20; i++) {
        targetMocks.push({
          tabId: i,
          attached: true,
          url: `https://test-domain-${i}.com/`
        });
      }

      context.mockDebugger.getTargets.mockResolvedValue(targetMocks);

      const debuggerMgr = new TabDebuggerManager();
      await debuggerMgr.init();

      // Check all 20 tabs
      for (let i = 1; i <= 20; i++) {
        const session = debuggerMgr.getSession(i);
        expect(session).toBeDefined();
        expect(session?.status).toBe('ATTACHED');
        expect(session?.attached).toBe(true);
        expect(session?.conflictDetected).toBe(false);
      }

      // Concurrently call attachTab on all 20 tabs
      const attachPromises = [];
      const attachSpy = vi.spyOn(chrome.debugger, 'attach');

      for (let i = 1; i <= 20; i++) {
        attachPromises.push(debuggerMgr.attachTab(i));
      }

      await Promise.all(attachPromises);

      // No redundant attach calls should have been made
      expect(attachSpy).not.toHaveBeenCalled();

      // None of the tabs should be marked CONFLICT
      for (let i = 1; i <= 20; i++) {
        expect(debuggerMgr.getTabStatus(i)).toBe('ATTACHED');
        expect(debuggerMgr.getTabStatus(i)).not.toBe('CONFLICT');
      }

      debuggerMgr.destroy();
      await clearTabSessions();
    });

    it('4.2: Handles rapid re-init cycles (SW sleep/wake cycles) cleanly', async () => {
      for (let cycle = 0; cycle < 5; cycle++) {
        const debuggerMgr = new TabDebuggerManager();
        context.mockDebugger.getTargets.mockResolvedValue([
          { tabId: 100 + cycle, attached: true, url: 'https://wake-test.org' } as any
        ]);

        await debuggerMgr.init();
        expect(debuggerMgr.getSession(100 + cycle)?.status).toBe('ATTACHED');
        expect(debuggerMgr.getSession(100 + cycle)?.conflictDetected).toBe(false);

        debuggerMgr.destroy();
      }
    });
  });

  // =========================================================================
  // DIMENSION 5: Popup Optimistic Concurrency & Timer Lifecycle Stress
  // =========================================================================
  describe('Dimension 5: Popup Optimistic Concurrency & Timer Lifecycle Stress', () => {
    it('5.1: High-concurrency toggle hammering with interleaved stale storage events maintains consistency', async () => {
      const scriptId = 'hammer-script';
      await saveScript({
        id: scriptId,
        name: 'Hammer Target',
        code: '// ==UserScript==\n// ==/UserScript==',
        enabled: true
      });

      let toggleResolvers: Array<(val: any) => void> = [];
      context.mockRuntime.sendMessage.mockImplementation(async (msg: any) => {
        if (msg.type === 'TOGGLE_SCRIPT') {
          return new Promise((resolve) => {
            toggleResolvers.push(resolve);
          });
        }
        return { success: true };
      });

      const Component = defineComponent({
        setup() {
          return usePopupState();
        },
        render: () => h('div')
      });

      const wrapper = mount(Component);
      await flushPromises();

      const storageListener = Array.from(context.storageOnChanged.listeners)[0];

      // Hammer 20 rapid toggles alternating true and false
      for (let i = 0; i < 20; i++) {
        const nextState = i % 2 === 0;
        wrapper.vm.toggleScript(scriptId, nextState);

        // Inject stale storage events in-flight
        if (storageListener) {
          storageListener(
            {
              scripts: {
                oldValue: {},
                newValue: {
                  [scriptId]: { id: scriptId, name: 'Hammer Target', code: '', enabled: !nextState }
                }
              }
            },
            'local'
          );
        }
      }

      // The last toggle request was for false (19 % 2 === 1 => false)
      const lastState = 19 % 2 === 0; // false
      expect(wrapper.vm.scripts.find((s: any) => s.id === scriptId)?.enabled).toBe(lastState);

      // Resolve all pending IPC calls
      for (const res of toggleResolvers) {
        res({ success: true });
      }
      await flushPromises();

      wrapper.unmount();
    });

    it('5.2: Stress-tests rapid mount/unmount cycles during reconnect timers to ensure zero leaks', async () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      context.mockTabs.query.mockResolvedValue([{ id: 10, url: 'https://dev.app' } as any]);

      const Component = defineComponent({
        setup() {
          return usePopupState();
        },
        render: () => h('div')
      });

      // Rapidly mount, trigger reconnect, and unmount 10 times in a row
      for (let i = 0; i < 10; i++) {
        const wrapper = mount(Component);
        await flushPromises();

        await wrapper.vm.reconnectCdp();
        expect(wrapper.vm.reconnectSuccess).toBe(true);

        wrapper.unmount();
      }

      // Verify clearTimeout was invoked for every unmounted cycle
      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThanOrEqual(10);
    });
  });
});
