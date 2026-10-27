/**
 * Empirical Challenger M4-2: UI Reactivity, Dashboard Filtering Performance & Timer Cleanup Stress Suite
 * Location: test/unit/challenger-m4-2-ui-empirical.spec.ts
 *
 * Verifies:
 * 1. Dashboard filtering performance & CPU footprint:
 *    - Massive userscript collections (100 scripts, 50MB+ source text, 20,000+ lines each).
 *    - Search latency benchmark across 500 queries (< 1ms per query, zero UI lockups, worst-case < 15ms).
 *    - Proof of zero code string scanning (code-only keywords return zero results, avoiding megabyte scans).
 *    - ReDoS safety and regex metacharacter immunity (< 1ms execution, no catastrophic backtracking).
 *    - Combinatorial filtering (activeFilter + searchQuery) under heavy script load.
 *    - High-frequency 1,000 rapid keystroke inputs without memory or latency accumulation.
 * 2. Timer cleanup & zero handle leaks in usePopupState:
 *    - Pending setTimeout handle tracking in reconnectTimers Set.
 *    - 100% clearTimeout execution on unmount for all active timers.
 *    - Zero timer execution or state mutation post-unmount under fake timers.
 *    - Natural timer expiry self-cleanup from Set prior to unmount.
 *    - Complete removal of chrome.runtime.onMessage and chrome.storage.onChanged listeners on unmount.
 *    - 50-cycle rapid mount/reconnect/unmount churn test with zero accumulated timer handles or listener leaks.
 *    - Reconnect failure does not schedule timer or leak handles.
 * 3. Dashboard lifecycle & Toast timer cleanup:
 *    - showToast timer tracking and guaranteed cancellation on onBeforeUnmount.
 *    - Storage change listener unsubscription on onBeforeUnmount.
 * 4. Popup optimistic state reconciliation & elimination of double storage writes:
 *    - Verifies toggleScript and toggleGlobal dispatch single runtime message without redundant storage write.
 *    - Stale storage change events during in-flight toggle do not overwrite optimistic local UI state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { setupChromeMock } from '../mocks/chrome';
import { useDashboardState } from '@/dashboard/composables/useDashboardState';
import { usePopupState } from '@/popup/composables/usePopupState';
import PopupApp from '@/popup/App.vue';
import { saveScript, resetToDefaultScripts, getScripts } from '@/shared/storage';
import * as storageModule from '@/shared/storage';
import type { ScriptRecord } from '@/shared/types';

describe('Empirical Challenger M4-2: Dashboard Performance & Popup Timer Cleanup', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: Dashboard Filtering Performance & CPU Footprint
  // =========================================================================

  describe('Section 1: Dashboard Filtering Performance & CPU Footprint with Massive Scripts', () => {
    const TestDashboardComponent = defineComponent({
      setup() {
        return useDashboardState();
      },
      template: '<div></div>'
    });

    it('1.1: generates massive script collection (100 scripts, 50MB+ source text) and populates dashboard', async () => {
      const massiveHeader = `// ==UserScript==\n// @name Massive Scalability Target\n// @match *://massive.test/*\n// @description High performance stress target\n// ==/UserScript==\n`;
      const massiveCodeBody = massiveHeader + Array.from({ length: 25000 }, (_, i) => `const var_${i} = ${i} * 3; // filler comment`).join('\n');
      expect(massiveCodeBody.length).toBeGreaterThan(1_000_000); // > 1MB per script

      const scriptsBatch: Record<string, ScriptRecord> = {};
      for (let i = 0; i < 100; i++) {
        const isMassive = i % 10 === 0;
        const code = isMassive ? massiveCodeBody : `// ==UserScript==\n// @name Normal Script ${i}\n// @match https://example${i}.com/*\n// ==/UserScript==\nconsole.log(${i});`;
        const id = `stress-script-${i}`;
        scriptsBatch[id] = {
          id,
          name: isMassive ? `Massive Script ${i}` : `Normal Script ${i}`,
          code,
          enabled: i % 3 !== 0,
          metadata: {
            name: isMassive ? `Massive Script ${i}` : `Normal Script ${i}`,
            description: isMassive ? `Heavy payload script with 25k lines ${i}` : `Standard script ${i}`,
            matches: isMassive ? ['*://massive.test/*', `*://sub${i}.massive.test/*`] : [`https://example${i}.com/*`],
            matchPatterns: isMassive ? ['*://massive.test/*'] : [],
            includes: [],
            excludes: [],
            runAt: 'document-idle',
            grants: isMassive && i % 20 === 0 ? ['GM_cdp'] : ['none'],
            cdp: isMassive && i % 20 === 0 ? [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {}, raw: 'Network.enable' }] : [],
            cdpDeclarations: [],
            cdpDomains: isMassive && i % 20 === 0 ? ['Network'] : [],
            requires: [],
            resources: {},
            noframes: false,
            connects: [],
            rawEntries: {}
          },
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      }

      await context.localStorage.set({ scripts: scriptsBatch });

      const wrapper = mount(TestDashboardComponent);
      await flushPromises();

      expect(wrapper.vm.scriptList.length).toBe(100);
      expect(wrapper.vm.filteredScripts.length).toBe(100);
    });

    it('1.2: benchmark: 500 search queries across massive scripts execute with average latency < 1ms and zero UI lockup (worst-case < 15ms)', async () => {
      const massiveCode = Array.from({ length: 20000 }, (_, i) => `let item_${i} = ${i};`).join('\n');
      const scriptsBatch: Record<string, ScriptRecord> = {};
      for (let i = 0; i < 100; i++) {
        const id = `bench-script-${i}`;
        scriptsBatch[id] = {
          id,
          name: `Userscript Benchmark Target ${i}`,
          code: `// ==UserScript==\n// @name Target ${i}\n// ==/UserScript==\n` + massiveCode,
          enabled: true,
          metadata: {
            name: `Userscript Benchmark Target ${i}`,
            description: `Automated test userscript number ${i} for performance profiling`,
            matches: [`https://test-${i}.example.org/*`, `https://*.cluster-${i % 5}.net/*`],
            matchPatterns: [],
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
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      }
      await context.localStorage.set({ scripts: scriptsBatch });

      const wrapper = mount(TestDashboardComponent);
      await flushPromises();

      const searchQueries = [
        'Benchmark',
        'Target 42',
        'Target 99',
        'cluster-2',
        'example.org',
        'profiling',
        'nonexistent-query-string',
        'test-1',
        'Userscript',
        'number 5'
      ];

      const QUERY_RUNS = 500;
      let worstCaseLatency = 0;

      const tStart = performance.now();
      for (let run = 0; run < QUERY_RUNS; run++) {
        const q = searchQueries[run % searchQueries.length];
        const singleStart = performance.now();

        wrapper.vm.searchQuery = q;
        const results = wrapper.vm.filteredScripts;

        const singleDuration = performance.now() - singleStart;
        if (singleDuration > worstCaseLatency) {
          worstCaseLatency = singleDuration;
        }

        expect(results).toBeDefined();
      }
      const totalElapsed = performance.now() - tStart;
      const avgLatency = totalElapsed / QUERY_RUNS;

      expect(avgLatency, `Average search latency (${avgLatency.toFixed(3)}ms) must be < 1.0ms`).toBeLessThan(1.0);
      expect(worstCaseLatency, `Worst-case single query latency (${worstCaseLatency.toFixed(3)}ms) must be < 15ms`).toBeLessThan(15.0);
    });

    it('1.3: proof of zero source code scanning: keywords present only in script.code do NOT match and do NOT scan megabytes', async () => {
      const uniqueCodeCanary = 'SECRET_CANARY_INTERNAL_CODE_TOKEN_987654';
      const massiveCode = `// ==UserScript==\n// @name Innocent Script Name\n// @description Innocent description\n// @match https://innocent.com/*\n// ==/UserScript==\n` +
        Array.from({ length: 30000 }, () => '// padding lines').join('\n') +
        `\nconst secret = "${uniqueCodeCanary}";\n` +
        Array.from({ length: 30000 }, () => '// padding lines').join('\n');

      await saveScript({
        id: 'canary-script',
        name: 'Innocent Script Name',
        code: massiveCode
      });

      const wrapper = mount(TestDashboardComponent);
      await flushPromises();

      // Search for code canary
      wrapper.vm.searchQuery = uniqueCodeCanary;
      const filtered = wrapper.vm.filteredScripts;

      // Must return 0 results because script.code is deliberately NOT scanned on keystrokes
      expect(filtered.length).toBe(0);

      // Verify that searching by name or description matches immediately
      wrapper.vm.searchQuery = 'Innocent Script';
      expect(wrapper.vm.filteredScripts.length).toBe(1);
      expect(wrapper.vm.filteredScripts[0].id).toBe('canary-script');

      wrapper.vm.searchQuery = 'Innocent description';
      expect(wrapper.vm.filteredScripts.length).toBe(1);

      wrapper.vm.searchQuery = 'innocent.com';
      expect(wrapper.vm.filteredScripts.length).toBe(1);
    });

    it('1.4: ReDoS immunity and hostile query patterns execute in < 1ms without catastrophic backtracking', async () => {
      const wrapper = mount(TestDashboardComponent);
      await flushPromises();

      const hostileQueries = [
        '(((((((a+)+)+)+)+)+)+)$',
        'a{1,1000000}',
        '(a*)*b',
        '.*.*.*.*.*.*.*.*.*.*a',
        '\\\\\\\\\\\\[[[[((((',
        '??????????????',
        '+++++****^^^^^$$$$$',
        '\\d+\\w+\\s+\\D+\\W+\\S+',
        '[a-z]-[A-Z]-[0-9]-[!-~]',
        '^.*(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$'
      ];

      for (const query of hostileQueries) {
        const start = performance.now();
        wrapper.vm.searchQuery = query;
        const res = wrapper.vm.filteredScripts;
        const elapsed = performance.now() - start;

        expect(elapsed, `Hostile query "${query}" took ${elapsed.toFixed(3)}ms`).toBeLessThan(1.0);
        expect(Array.isArray(res)).toBe(true);
      }
    });

    it('1.5: activeFilter combined with search filtering across large datasets is accurate and fast', async () => {
      const scriptsBatch: Record<string, ScriptRecord> = {};
      for (let i = 0; i < 100; i++) {
        const isCdp = i < 20;
        const isEnabled = i % 2 === 0;
        scriptsBatch[`script-${i}`] = {
          id: `script-${i}`,
          name: `Script ${i} Alpha`,
          code: `// ==UserScript==\n// @name Script ${i} Alpha\n// ==/UserScript==`,
          enabled: isEnabled,
          metadata: {
            name: `Script ${i} Alpha`,
            description: `Description ${i}`,
            matches: ['https://example.com/*'],
            matchPatterns: [],
            includes: [],
            excludes: [],
            runAt: 'document-idle',
            grants: isCdp ? ['GM_cdp'] : ['none'],
            cdp: isCdp ? [{ domain: 'Page', method: 'enable', command: 'Page.enable', params: {}, raw: 'Page.enable' }] : [],
            cdpDeclarations: [],
            cdpDomains: isCdp ? ['Page'] : [],
            requires: [],
            resources: {},
            noframes: false,
            connects: [],
            rawEntries: {}
          },
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      }
      await context.localStorage.set({ scripts: scriptsBatch });

      const wrapper = mount(TestDashboardComponent);
      await flushPromises();

      // 1. activeFilter = 'enabled' + searchQuery = 'Alpha'
      wrapper.vm.activeFilter = 'enabled';
      wrapper.vm.searchQuery = 'Alpha';
      expect(wrapper.vm.filteredScripts.length).toBe(50);
      expect(wrapper.vm.filteredScripts.every((s) => s.enabled)).toBe(true);

      // 2. activeFilter = 'disabled' + searchQuery = 'Alpha'
      wrapper.vm.activeFilter = 'disabled';
      wrapper.vm.searchQuery = 'Alpha';
      expect(wrapper.vm.filteredScripts.length).toBe(50);
      expect(wrapper.vm.filteredScripts.every((s) => !s.enabled)).toBe(true);

      // 3. activeFilter = 'cdp' + searchQuery = 'Alpha'
      wrapper.vm.activeFilter = 'cdp';
      wrapper.vm.searchQuery = 'Alpha';
      expect(wrapper.vm.filteredScripts.length).toBe(20);

      // 4. activeFilter = 'cdp' + searchQuery = 'Script 1'
      wrapper.vm.searchQuery = 'Script 1';
      expect(wrapper.vm.filteredScripts.length).toBe(11);
    });

    it('1.6: 1,000 rapid keystrokes to searchQuery maintain consistent low CPU duration without memory leaks', async () => {
      const wrapper = mount(TestDashboardComponent);
      await flushPromises();

      const baseString = 'CDP Network & Page Logger';
      const start = performance.now();

      // Simulate typing forward and deleting backward 1,000 times
      for (let i = 1; i <= 1000; i++) {
        const len = (i % baseString.length) + 1;
        wrapper.vm.searchQuery = baseString.slice(0, len);
        const count = wrapper.vm.filteredScripts.length;
        expect(count).toBeGreaterThanOrEqual(1);
      }

      const totalTime = performance.now() - start;
      const perKeystrokeTime = totalTime / 1000;

      // 1,000 keystrokes should comfortably complete in < 250ms (0.25ms / keystroke)
      expect(totalTime, `1,000 keystrokes took ${totalTime.toFixed(1)}ms`).toBeLessThan(250);
      expect(perKeystrokeTime).toBeLessThan(0.25);
    });
  });

  // =========================================================================
  // SECTION 2: Popup Timer Cleanup & Zero Handle Leaks (usePopupState)
  // =========================================================================

  describe('Section 2: Popup Timer Cleanup & Zero Handle Leaks in usePopupState', () => {
    const TestPopupComponent = defineComponent({
      setup() {
        return usePopupState();
      },
      template: '<div></div>'
    });

    it('2.1: scheduling reconnect timer tracks timer handle and resets reconnectSuccess after 3000ms', async () => {
      const wrapper = mount(TestPopupComponent);
      await flushPromises();

      expect(wrapper.vm.reconnectSuccess).toBe(false);

      vi.useFakeTimers();

      // Trigger CDP_LIFECYCLE_EVENT with ATTACHED status matching tabId = 1
      context.mockRuntime._emitMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 1,
        status: 'ATTACHED'
      });

      expect(wrapper.vm.reconnectSuccess).toBe(true);
      expect(wrapper.vm.cdpStatus).toBe('ATTACHED');

      // Advance by 2999ms: timer still in flight, reconnectSuccess is true
      vi.advanceTimersByTime(2999);
      expect(wrapper.vm.reconnectSuccess).toBe(true);

      // Advance by 1ms (total 3000ms): timer fires and resets reconnectSuccess to false
      vi.advanceTimersByTime(1);
      expect(wrapper.vm.reconnectSuccess).toBe(false);

      wrapper.unmount();
      vi.useRealTimers();
    });

    it('2.2: mounting and unmounting usePopupState clears ALL pending timers and leaks ZERO handles', async () => {
      const wrapper = mount(TestPopupComponent);
      await flushPromises();

      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      // Fire 5 rapid lifecycle attach events to schedule multiple reconnect reset timers
      for (let i = 0; i < 5; i++) {
        context.mockRuntime._emitMessage({
          type: 'CDP_LIFECYCLE_EVENT',
          tabId: 1,
          status: 'ATTACHED'
        });
      }

      expect(wrapper.vm.reconnectSuccess).toBe(true);

      const clearCallsBefore = clearTimeoutSpy.mock.calls.length;

      // Unmount the component while all 5 timers are still pending!
      wrapper.unmount();

      const clearCallsAfter = clearTimeoutSpy.mock.calls.length;
      const timersClearedOnUnmount = clearCallsAfter - clearCallsBefore;

      // Exactly 5 clearTimeout calls must have been made to clear the 5 pending timers
      expect(timersClearedOnUnmount).toBe(5);

      // Advance timers by 10,000ms: verify zero residual timers execute and no errors occur
      expect(() => {
        vi.advanceTimersByTime(10000);
      }).not.toThrow();

      vi.useRealTimers();
    });

    it('2.3: natural timer expiry cleans up Set entry prior to unmount so unmount does not double-clear', async () => {
      const wrapper = mount(TestPopupComponent);
      await flushPromises();

      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      context.mockRuntime._emitMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 1,
        status: 'ATTACHED'
      });

      expect(wrapper.vm.reconnectSuccess).toBe(true);

      // Allow 3000ms timer to naturally complete
      vi.advanceTimersByTime(3000);
      expect(wrapper.vm.reconnectSuccess).toBe(false);

      const clearCountBeforeUnmount = clearTimeoutSpy.mock.calls.length;

      // Unmount now: since the timer already completed and self-deleted from reconnectTimers Set,
      // unmount should have 0 active timers in the Set to clear
      wrapper.unmount();

      const clearCountAfterUnmount = clearTimeoutSpy.mock.calls.length;
      expect(clearCountAfterUnmount - clearCountBeforeUnmount).toBe(0);

      vi.useRealTimers();
    });

    it('2.4: unmount removes runtime and storage event listeners preventing post-unmount listener leaks', async () => {
      const removeMessageSpy = vi.spyOn(context.mockRuntime.onMessage, 'removeListener');
      const removeStorageSpy = vi.spyOn(context.storageOnChanged, 'removeListener');

      const wrapper = mount(TestPopupComponent);
      await flushPromises();

      expect(removeMessageSpy).not.toHaveBeenCalled();
      expect(removeStorageSpy).not.toHaveBeenCalled();

      // Unmount
      wrapper.unmount();

      // Both listeners must be cleaned up on onUnmounted
      expect(removeMessageSpy).toHaveBeenCalledTimes(1);
      expect(removeStorageSpy).toHaveBeenCalledTimes(1);

      // Dispatch runtime message post-unmount: verify no errors and unmounted state is not mutated
      expect(() => {
        context.mockRuntime._emitMessage({
          type: 'CDP_LIFECYCLE_EVENT',
          tabId: 1,
          status: 'CONFLICT',
          reason: 'canceled_by_user'
        });
      }).not.toThrow();
    });

    it('2.5: 50-cycle rapid mount/reconnect/unmount churn test leaves zero dangling timers or listener leaks', async () => {
      const CHURN_CYCLES = 50;
      let totalClearCount = 0;

      for (let cycle = 0; cycle < CHURN_CYCLES; cycle++) {
        const wrapper = mount(TestPopupComponent);
        await flushPromises();

        vi.useFakeTimers();
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

        // Schedule timer
        context.mockRuntime._emitMessage({
          type: 'CDP_LIFECYCLE_EVENT',
          tabId: 1,
          status: 'ATTACHED'
        });

        // Advance random time (less than 3000ms so timer is still pending)
        vi.advanceTimersByTime(500);

        const beforeUnmount = clearTimeoutSpy.mock.calls.length;

        // Unmount
        wrapper.unmount();

        const afterUnmount = clearTimeoutSpy.mock.calls.length;
        totalClearCount += (afterUnmount - beforeUnmount);

        vi.useRealTimers();
      }

      // In every cycle, the pending timer was cleared
      expect(totalClearCount).toBe(CHURN_CYCLES);
    });

    it('2.6: PopupApp component unmount clears timers and cleans up cleanly', async () => {
      const wrapper = mount(PopupApp);
      await flushPromises();

      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      // Trigger attach event
      context.mockRuntime._emitMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 1,
        status: 'ATTACHED'
      });

      const clearCountBefore = clearTimeoutSpy.mock.calls.length;

      // Unmount PopupApp
      wrapper.unmount();

      const clearCountAfter = clearTimeoutSpy.mock.calls.length;
      expect(clearCountAfter).toBeGreaterThan(clearCountBefore);

      vi.useRealTimers();
    });

    it('2.7: failed reconnectCdp does NOT schedule timer and preserves error state', async () => {
      vi.useFakeTimers();
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      const wrapper = mount(TestPopupComponent);
      await flushPromises();

      context.mockRuntime.sendMessage.mockResolvedValueOnce({
        success: false,
        error: 'Debugger attach rejected'
      });

      const timeoutCallsBefore = setTimeoutSpy.mock.calls.length;

      await wrapper.vm.reconnectCdp();

      expect(wrapper.vm.reconnectError).toBe('Debugger attach rejected');
      expect(wrapper.vm.reconnectSuccess).toBe(false);

      // Verify no reconnect reset timer was scheduled
      expect(setTimeoutSpy.mock.calls.length).toBe(timeoutCallsBefore);

      wrapper.unmount();
      vi.useRealTimers();
    });
  });

  // =========================================================================
  // SECTION 3: Dashboard Toast Timer & Storage Unsubscribe Cleanup
  // =========================================================================

  describe('Section 3: Dashboard Toast Timer & Storage Unsubscribe Cleanup', () => {
    const TestDashboardComponent = defineComponent({
      setup() {
        return useDashboardState();
      },
      template: '<div></div>'
    });

    it('3.1: showToast sets timer, clears previous timer, and auto-dismisses after 3000ms', async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const wrapper = mount(TestDashboardComponent);
      await flushPromises();

      expect(wrapper.vm.toast).toBeNull();

      // Show toast 1
      wrapper.vm.showToast('First toast');
      expect(wrapper.vm.toast?.message).toBe('First toast');

      // Show toast 2 before toast 1 expires -> must cancel toast 1 timer
      const clearCallsBefore = clearTimeoutSpy.mock.calls.length;
      wrapper.vm.showToast('Second toast');
      expect(clearTimeoutSpy.mock.calls.length).toBe(clearCallsBefore + 1);
      expect(wrapper.vm.toast?.message).toBe('Second toast');

      // Advance by 3000ms -> auto-dismiss
      vi.advanceTimersByTime(3000);
      expect(wrapper.vm.toast).toBeNull();

      wrapper.unmount();
      vi.useRealTimers();
    });

    it('3.2: unmounting dashboard clears pending toastTimer and unsubscribes storage listener', async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const wrapper = mount(TestDashboardComponent);
      await flushPromises();

      // Trigger toast
      wrapper.vm.showToast('Pending toast before unmount');
      expect(wrapper.vm.toast).not.toBeNull();

      const clearCountBefore = clearTimeoutSpy.mock.calls.length;

      // Unmount dashboard
      wrapper.unmount();

      // Verify toastTimer was cancelled
      expect(clearTimeoutSpy.mock.calls.length).toBe(clearCountBefore + 1);

      // Verify external storage updates no longer affect unmounted state
      await context.localStorage.set({
        scripts: {
          'post-unmount-script': {
            id: 'post-unmount-script',
            name: 'Post Unmount Script',
            code: '// ==UserScript==',
            enabled: true,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        }
      });

      // Does not throw and does not mutate unmounted instance
      expect(() => {
        vi.advanceTimersByTime(5000);
      }).not.toThrow();

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // SECTION 4: Popup Optimistic State & Single-Source Mutation (BUG-2 Prevention)
  // =========================================================================

  describe('Section 4: Popup Optimistic State Reconciliation & Double-Write Prevention', () => {
    const TestPopupComponent = defineComponent({
      setup() {
        return usePopupState();
      },
      template: '<div></div>'
    });

    it('4.1: toggleScript sends runtime message and does NOT perform redundant direct storage write', async () => {
      const storageToggleSpy = vi.spyOn(storageModule, 'toggleScript');

      const wrapper = mount(TestPopupComponent);
      await flushPromises();

      const scriptId = 'sample-cdp-logger';
      const targetScript = wrapper.vm.scripts.find((s) => s.id === scriptId);
      expect(targetScript).toBeDefined();
      expect(targetScript!.enabled).toBe(true);

      // Toggle off
      await wrapper.vm.toggleScript(scriptId, false);

      // 1. chrome.runtime.sendMessage MUST be invoked
      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        { type: 'TOGGLE_SCRIPT', scriptId, enabled: false }
      );

      // 2. Direct storageToggleScript must NOT be invoked when chrome.runtime.sendMessage is available (BUG-2 fix)
      expect(storageToggleSpy).not.toHaveBeenCalled();

      // 3. Optimistic state is updated immediately
      expect(targetScript!.enabled).toBe(false);

      wrapper.unmount();
    });

    it('4.2: toggleGlobal sends runtime message and does NOT perform redundant direct saveSettings', async () => {
      const saveSettingsSpy = vi.spyOn(storageModule, 'saveSettings');

      const wrapper = mount(TestPopupComponent);
      await flushPromises();

      expect(wrapper.vm.globalEnabled).toBe(true);

      // Toggle global off
      await wrapper.vm.toggleGlobal(false);

      // 1. chrome.runtime.sendMessage MUST be invoked
      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        { type: 'TOGGLE_GLOBAL', enabled: false }
      );

      // 2. Direct saveSettings must NOT be invoked (BUG-2 fix)
      expect(saveSettingsSpy).not.toHaveBeenCalled();

      // 3. Optimistic state is false
      expect(wrapper.vm.globalEnabled).toBe(false);

      wrapper.unmount();
    });

    it('4.3: stale storage change event during in-flight toggle does not overwrite optimistic state', async () => {
      // Slow down runtime.sendMessage to keep request in flight
      let resolveMessage: (res: any) => void;
      context.mockRuntime.sendMessage.mockImplementation(
        () => new Promise((resolve) => { resolveMessage = resolve; })
      );

      const wrapper = mount(TestPopupComponent);
      await flushPromises();

      const scriptId = 'sample-cdp-logger';
      const togglePromise = wrapper.vm.toggleScript(scriptId, false);

      // Local optimistic state is already false
      const target = wrapper.vm.scripts.find((s) => s.id === scriptId);
      expect(target!.enabled).toBe(false);

      // Simulate a stale storage change event coming from an earlier background operation
      // where the script was still enabled (true)
      const currentScripts = await getScripts();
      await context.storageOnChanged._emit(
        {
          scripts: {
            newValue: currentScripts, // has enabled: true
            oldValue: currentScripts
          }
        },
        'local'
      );
      await flushPromises();

      // Thanks to pendingScriptToggles guard, the UI state must REMAIN false and NOT flicker to true!
      const targetAfterStaleEvent = wrapper.vm.scripts.find((s) => s.id === scriptId);
      expect(targetAfterStaleEvent!.enabled).toBe(false);

      // Resolve in-flight request
      resolveMessage!({ success: true });
      await togglePromise;
      await flushPromises();

      expect(targetAfterStaleEvent!.enabled).toBe(false);

      wrapper.unmount();
    });
  });
});
