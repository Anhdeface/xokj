import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setupChromeMock } from '../mocks/chrome';
import PopupApp from '@/popup/App.vue';
import { saveScript, getScripts, getSettings, saveSettings } from '@/shared/storage';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { DevToolsConflictHandler } from '@/background/conflict-mgr';
import { UiIpcServer } from '@/background/ui-ipc';

describe('Adversarial Stress Test: Popup UI & Background UI IPC', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let debuggerMgr: TabDebuggerManager;
  let conflictHandler: DevToolsConflictHandler;
  let uiIpc: UiIpcServer;

  beforeEach(async () => {
    context = setupChromeMock();
    debuggerMgr = new TabDebuggerManager();
    conflictHandler = new DevToolsConflictHandler(null, debuggerMgr);
    uiIpc = new UiIpcServer(debuggerMgr);

    await debuggerMgr.init();
    conflictHandler.init();
    uiIpc.init();

    // Route runtime.sendMessage to registered listeners with tab context
    context.mockRuntime.sendMessage.mockImplementation(async (msg: any) => {
      return context.mockRuntime._emitMessage(msg, { tab: { id: 10 } });
    });

    // Default tab
    context.mockTabs.query.mockResolvedValue([
      { id: 10, url: 'https://example.com/app', title: 'Example App' } as any
    ]);
  });

  afterEach(() => {
    uiIpc.destroy();
    conflictHandler.destroy();
    debuggerMgr.destroy();
  });

  describe('Adversarial Area 1: Rapid Toggle Concurrency & State Sync', () => {
    it('1.1: rapid alternating toggles on a single script converge cleanly without desync', async () => {
      await saveScript({
        id: 'script-rapid',
        name: 'Rapid Toggle Target',
        code: '// ==UserScript==\n// @match https://example.com/*\n// ==/UserScript==',
        enabled: true
      });

      const wrapper = mount(PopupApp);
      await flushPromises();

      const scriptCard = wrapper.findAll('.script-card').find((c) => c.text().includes('Rapid Toggle Target'));
      expect(scriptCard).toBeDefined();
      const checkbox = scriptCard!.find('input[type="checkbox"]');

      // Rapidly toggle 20 times in quick succession without waiting between each
      let desiredState = true;
      for (let i = 0; i < 20; i++) {
        desiredState = !desiredState;
        await checkbox.setValue(desiredState);
      }
      await flushPromises();

      // Check final state in storage
      const stored = await getScripts();
      expect(stored['script-rapid']?.enabled).toBe(desiredState);

      // Check UI reflected state
      const updatedCard = wrapper.findAll('.script-card').find((c) => c.text().includes('Rapid Toggle Target'));
      const updatedCheckbox = updatedCard!.find('input[type="checkbox"]').element as HTMLInputElement;
      expect(updatedCheckbox.checked).toBe(desiredState);
    });

    it('1.1b: unawaited rapid toggles on the same script (click hammering)', async () => {
      await saveScript({
        id: 'script-hammer',
        name: 'Hammer Target',
        code: '// ==UserScript==\n// @match https://example.com/*\n// ==/UserScript==',
        enabled: true
      });

      const wrapper = mount(PopupApp);
      await flushPromises();

      const scriptCard = wrapper.findAll('.script-card').find((c) => c.text().includes('Hammer Target'));
      const checkbox = scriptCard!.find('input[type="checkbox"]');

      // Hammer the toggle 4 times in parallel microtasks without awaiting storage
      const p1 = checkbox.setValue(false);
      const p2 = checkbox.setValue(true);
      const p3 = checkbox.setValue(false);
      const p4 = checkbox.setValue(true);
      await Promise.all([p1, p2, p3, p4]);
      await flushPromises();

      const stored = await getScripts();
      // Final desired state was true
      expect(stored['script-hammer']?.enabled).toBe(true);

      const updatedCard = wrapper.findAll('.script-card').find((c) => c.text().includes('Hammer Target'));
      const updatedCheckbox = updatedCard!.find('input[type="checkbox"]').element as HTMLInputElement;
      expect(updatedCheckbox.checked).toBe(true);
    });

    it('1.2: concurrent toggles across multiple distinct scripts do not lose updates (REPRODUCED BUG: lost update race condition)', async () => {
      // Seed 5 scripts
      for (let i = 1; i <= 5; i++) {
        await saveScript({
          id: `script-multi-${i}`,
          name: `Multi Script ${i}`,
          code: `// ==UserScript==\n// @match https://example.com/*\n// ==/UserScript==`,
          enabled: true
        });
      }

      const wrapper = mount(PopupApp);
      await flushPromises();

      const cards = wrapper.findAll('.script-card');
      const targetCards = cards.filter((c) => c.text().includes('Multi Script'));
      expect(targetCards.length).toBe(5);

      // Desired states: [false, true, false, false, true]
      const desired = [false, true, false, false, true];

      // Dispatch toggles concurrently
      await Promise.all(
        targetCards.map((card, idx) => {
          const cb = card.find('input[type="checkbox"]');
          return cb.setValue(desired[idx]);
        })
      );
      await flushPromises();

      // Verify all 5 scripts in storage reflect desired states without lost writes
      const stored = await getScripts();
      const actual = [1, 2, 3, 4, 5].map((i) => stored[`script-multi-${i}`]?.enabled);
      // Bug reproduction: actual has [true, true, true, false, true] instead of [false, true, false, false, true]
      for (let i = 1; i <= 5; i++) {
        expect(stored[`script-multi-${i}`]?.enabled).toBe(desired[i - 1]);
      }
    });

    it('1.3: rapid alternating global switch toggles converge to final state', async () => {
      const wrapper = mount(PopupApp);
      await flushPromises();

      const globalCheckbox = wrapper.find('.global-controls input[type="checkbox"]');
      expect(globalCheckbox.exists()).toBe(true);

      let expectedGlobal = true;
      for (let i = 0; i < 15; i++) {
        expectedGlobal = !expectedGlobal;
        await globalCheckbox.setValue(expectedGlobal);
      }
      await flushPromises();

      const settings = await getSettings();
      expect(settings.globalEnabled).toBe(expectedGlobal);

      const labelStatus = wrapper.find('.global-controls .label-status');
      if (expectedGlobal) {
        expect(labelStatus.exists()).toBe(true);
        expect(labelStatus.text()).toContain('Active');
      } else {
        expect(labelStatus.exists()).toBe(false);
      }
    });

    it('1.4: individual toggles are disabled when globalEnabled is false and re-enabled when globalEnabled is true', async () => {
      await saveScript({
        id: 'script-disable-check',
        name: 'Disable Check Script',
        code: '// ==UserScript==\n// @match https://example.com/*\n// ==/UserScript==',
        enabled: true
      });

      const wrapper = mount(PopupApp);
      await flushPromises();

      const globalCheckbox = wrapper.find('.global-controls input[type="checkbox"]');
      const scriptCard = wrapper.find('.script-card');
      let scriptCheckbox = scriptCard.find('input[type="checkbox"]').element as HTMLInputElement;
      expect(scriptCheckbox.disabled).toBe(false);

      // Pause globally
      await globalCheckbox.setValue(false);
      await flushPromises();

      scriptCheckbox = wrapper.find('.script-card input[type="checkbox"]').element as HTMLInputElement;
      expect(scriptCheckbox.disabled).toBe(true);
      expect(wrapper.find('.card-disabled').exists()).toBe(true);

      // Re-enable globally
      await globalCheckbox.setValue(true);
      await flushPromises();

      scriptCheckbox = wrapper.find('.script-card input[type="checkbox"]').element as HTMLInputElement;
      expect(scriptCheckbox.disabled).toBe(false);
    });

    it('1.5: handles dual IPC and direct storage writes without infinite recursion', async () => {
      const msgSpy = vi.spyOn(context.mockRuntime, 'sendMessage');

      await saveScript({
        id: 'script-dual-ipc',
        name: 'Dual IPC Script',
        code: '// ==UserScript==\n// @match https://example.com/*\n// ==/UserScript==',
        enabled: true
      });

      const wrapper = mount(PopupApp);
      await flushPromises();

      const cards = wrapper.findAll('.script-card');
      const card = cards.find((c) => c.text().includes('Dual IPC Script'));
      expect(card).toBeDefined();
      const cb = card!.find('input[type="checkbox"]');

      await cb.setValue(false);
      await flushPromises();

      expect(msgSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'TOGGLE_SCRIPT', scriptId: 'script-dual-ipc', enabled: false })
      );

      const scripts = await getScripts();
      expect(scripts['script-dual-ipc']?.enabled).toBe(false);
    });
  });

  describe('Adversarial Area 2: URL Matching Edge Cases', () => {
    it('2.1: wildcard subdomain (*.example.com) matches root, single, and nested subdomains', async () => {
      await saveScript({
        id: 'script-subdomain',
        name: 'Subdomain Matcher',
        code: '// ==UserScript==\n// @match *://*.example.com/*\n// ==/UserScript==',
        enabled: true
      });

      const testUrls = [
        { url: 'https://example.com/test', shouldMatch: true },
        { url: 'https://sub.example.com/path', shouldMatch: true },
        { url: 'http://a.b.c.example.com/deep/path', shouldMatch: true },
        { url: 'https://notexample.com/path', shouldMatch: false },
        { url: 'https://example.com.evil.com/phish', shouldMatch: false }
      ];

      for (const { url, shouldMatch } of testUrls) {
        context.mockTabs.query.mockResolvedValue([
          { id: 10, url, title: 'Test Tab' } as any
        ]);
        const wrapper = mount(PopupApp);
        await flushPromises();

        const match = wrapper.text().includes('Subdomain Matcher');
        expect(match, `URL: ${url} expected shouldMatch=${shouldMatch}`).toBe(shouldMatch);
      }
    });

    it('2.2: port matching edge cases (explicit port vs generic host vs non-matching port)', async () => {
      await saveScript({
        id: 'script-port-8080',
        name: 'Port 8080 Only',
        code: '// ==UserScript==\n// @match http://localhost:8080/*\n// ==/UserScript==',
        enabled: true
      });
      await saveScript({
        id: 'script-generic-port',
        name: 'Generic Host Matching Port',
        code: '// ==UserScript==\n// @match https://example.com/*\n// ==/UserScript==',
        enabled: true
      });

      // Test localhost:8080 -> Port 8080 Only matches, Generic doesn't
      context.mockTabs.query.mockResolvedValue([
        { id: 10, url: 'http://localhost:8080/dashboard', title: 'Local 8080' } as any
      ]);
      let wrapper = mount(PopupApp);
      await flushPromises();
      expect(wrapper.text()).toContain('Port 8080 Only');
      expect(wrapper.text()).not.toContain('Generic Host Matching Port');

      // Test localhost:3000 -> Port 8080 Only does NOT match
      context.mockTabs.query.mockResolvedValue([
        { id: 10, url: 'http://localhost:3000/dashboard', title: 'Local 3000' } as any
      ]);
      wrapper = mount(PopupApp);
      await flushPromises();
      expect(wrapper.text()).not.toContain('Port 8080 Only');

      // Test https://example.com:8443/app -> Generic Host allows optional port in tested URL
      context.mockTabs.query.mockResolvedValue([
        { id: 10, url: 'https://example.com:8443/app', title: 'Example Port' } as any
      ]);
      wrapper = mount(PopupApp);
      await flushPromises();
      expect(wrapper.text()).toContain('Generic Host Matching Port');
    });

    it('2.3: URL query parameters and fragment hashes do not break pattern matching', async () => {
      await saveScript({
        id: 'script-query-hash',
        name: 'Query and Hash Target',
        code: '// ==UserScript==\n// @match https://example.com/search*\n// ==/UserScript==',
        enabled: true
      });

      const complexUrls = [
        'https://example.com/search?q=userscript+cdp&order=desc',
        'https://example.com/search#results',
        'https://example.com/search?q=test#page=2&filter=active',
        'https://example.com/search/?key=val&special=%20%21%40'
      ];

      for (const url of complexUrls) {
        context.mockTabs.query.mockResolvedValue([
          { id: 10, url, title: 'Complex URL' } as any
        ]);
        const wrapper = mount(PopupApp);
        await flushPromises();

        expect(wrapper.text(), `Failed to match on URL: ${url}`).toContain('Query and Hash Target');
      }
    });

    it('2.4: trailing slash and root path normalization', async () => {
      await saveScript({
        id: 'script-root',
        name: 'Root Path Matcher',
        code: '// ==UserScript==\n// @match https://example.com/*\n// ==/UserScript==',
        enabled: true
      });

      // Browser tabs may supply https://example.com without explicit trailing slash in raw string
      context.mockTabs.query.mockResolvedValue([
        { id: 10, url: 'https://example.com', title: 'Root Domain' } as any
      ]);
      const wrapper = mount(PopupApp);
      await flushPromises();

      expect(wrapper.text()).toContain('Root Path Matcher');
    });

    it('2.5: restricted pages strictly rejected with security banner across all browser schemes', async () => {
      await saveScript({
        id: 'script-all',
        name: 'Universal Script',
        code: '// ==UserScript==\n// @match <all_urls>\n// ==/UserScript==',
        enabled: true
      });

      const restrictedUrls = [
        'chrome://settings',
        'chrome://extensions',
        'chrome-extension://abcdefghijklmnopqrstuvwxyz/popup.html',
        'chrome-untrusted://terminal',
        'edge://flags',
        'devtools://devtools/bundled/inspector.html',
        'about:blank',
        'view-source:https://example.com',
        'data:text/html,<h1>Hello</h1>',
        'javascript:void(0)',
        'https://chromewebstore.google.com/detail/test',
        'https://chrome.google.com/webstore/category/extensions'
      ];

      for (const url of restrictedUrls) {
        context.mockTabs.query.mockResolvedValue([
          { id: 99, url, title: 'Restricted Page' } as any
        ]);
        const wrapper = mount(PopupApp);
        await flushPromises();

        expect(wrapper.text()).toContain('Restricted Browser Page');
        expect(wrapper.text()).not.toContain('Universal Script');
        expect(wrapper.find('.tab-context-bar').exists()).toBe(false);
      }
    });

    it('2.6: exclusion patterns (@exclude) take strict precedence over matching patterns', async () => {
      await saveScript({
        id: 'script-excluded',
        name: 'Excluded On Admin',
        code: '// ==UserScript==\n// @match https://example.com/*\n// @exclude https://example.com/admin/*\n// ==/UserScript==',
        enabled: true
      });

      // Public path -> matches
      context.mockTabs.query.mockResolvedValue([
        { id: 10, url: 'https://example.com/public/feed', title: 'Public Feed' } as any
      ]);
      let wrapper = mount(PopupApp);
      await flushPromises();
      expect(wrapper.text()).toContain('Excluded On Admin');

      // Admin path -> excluded
      context.mockTabs.query.mockResolvedValue([
        { id: 10, url: 'https://example.com/admin/settings', title: 'Admin Settings' } as any
      ]);
      wrapper = mount(PopupApp);
      await flushPromises();
      expect(wrapper.text()).not.toContain('Excluded On Admin');
    });
  });

  describe('Adversarial Area 3: Conflict Lifecycle Transitions & Recovery', () => {
    it('3.1: complete conflict lifecycle: IDLE -> ATTACHED -> CONFLICT -> reconnect fail -> reconnect success', async () => {
      const wrapper = mount(PopupApp);
      await flushPromises();

      // Step 1: Initial state is IDLE
      expect(wrapper.find('.cdp-badge').text()).toContain('CDP IDLE');
      expect(wrapper.find('.conflict-banner').exists()).toBe(false);

      // Step 2: Tab attaches -> ATTACHED
      await context.mockRuntime._emitMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 10,
        status: 'ATTACHED'
      });
      await flushPromises();
      expect(wrapper.find('.cdp-badge').text()).toContain('CDP ATTACHED');
      expect(wrapper.find('.conflict-banner').exists()).toBe(false);

      // Step 3: Native DevTools opens -> CONFLICT
      debuggerMgr.setTabStatus(10, 'CONFLICT', 'canceled_by_user');
      await context.mockRuntime._emitMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 10,
        status: 'CONFLICT',
        reason: 'canceled_by_user'
      });
      await flushPromises();

      expect(wrapper.find('.cdp-badge').text()).toContain('CDP CONFLICT');
      const banner = wrapper.find('.conflict-banner');
      expect(banner.exists()).toBe(true);
      expect(banner.text()).toContain('canceled_by_user');

      // Step 4: User clicks Reconnect while DevTools is still open
      context.mockDebugger.attach.mockRejectedValueOnce(
        new Error('Cannot attach to target: another debugger is already attached')
      );

      const reconnectBtn = banner.find('.reconnect-btn');
      expect(reconnectBtn.exists()).toBe(true);
      await reconnectBtn.trigger('click');
      await flushPromises();

      // Verify error message surfaced inside banner
      expect(wrapper.find('.conflict-banner').exists()).toBe(true);
      const errorMsg = wrapper.find('.banner-error');
      expect(errorMsg.exists()).toBe(true);
      expect(errorMsg.text()).toContain('DevTools is still open');
      expect(wrapper.find('.cdp-badge').text()).toContain('CDP CONFLICT');

      // Step 5: Native DevTools closed -> User clicks Reconnect again
      context.mockDebugger.attach.mockResolvedValueOnce();

      const freshReconnectBtn = wrapper.find('.reconnect-btn');
      expect(freshReconnectBtn.exists()).toBe(true);
      await freshReconnectBtn.trigger('click');
      await flushPromises();

      // Verify successful reconnection
      expect(wrapper.find('.conflict-banner').exists()).toBe(false);
      expect(wrapper.find('.cdp-badge').text()).toContain('CDP ATTACHED');
      expect(wrapper.find('.success-toast').exists()).toBe(true);
      expect(wrapper.find('.success-toast').text()).toContain('reconnected successfully');
    });

    it('3.2: guards against concurrent duplicate Reconnect clicks while request is inflight', async () => {
      debuggerMgr.setTabStatus(10, 'CONFLICT', 'canceled_by_user');
      await context.localStorage.set({
        tab_sessions: {
          10: {
            tabId: 10,
            status: 'CONFLICT',
            attached: false,
            activeDomains: [],
            conflictDetected: true,
            conflictReason: 'canceled_by_user',
            updatedAt: Date.now()
          }
        }
      });

      // Introduce artificial delay in attach
      let resolveAttach: () => void;
      context.mockDebugger.attach.mockImplementation(
        () => new Promise<void>((res) => { resolveAttach = res; })
      );

      const wrapper = mount(PopupApp);
      await flushPromises();

      const reconnectBtn = wrapper.find('.reconnect-btn');
      expect(reconnectBtn.exists()).toBe(true);

      const sendSpy = vi.spyOn(context.mockRuntime, 'sendMessage');

      // First click
      await reconnectBtn.trigger('click');
      // Second click while in flight
      await reconnectBtn.trigger('click');

      // Should only dispatch one RECONNECT_CDP message
      const reconnectCalls = sendSpy.mock.calls.filter(
        (c) => c[0]?.type === 'RECONNECT_CDP'
      );
      expect(reconnectCalls.length).toBe(1);

      // Button should show spinner / disabled state
      expect(reconnectBtn.text()).toContain('Reconnecting...');
      expect((reconnectBtn.element as HTMLButtonElement).disabled).toBe(true);

      // Resolve attach
      resolveAttach!();
      await flushPromises();

      expect(wrapper.find('.cdp-badge').text()).toContain('CDP ATTACHED');
    });

    it('3.3: cold start recovery of CONFLICT state from storage without background ping', async () => {
      // Simulate stored conflict state prior to popup opening
      await context.localStorage.set({
        tab_sessions: {
          10: {
            tabId: 10,
            status: 'CONFLICT',
            attached: false,
            activeDomains: [],
            conflictDetected: true,
            conflictReason: 'canceled_by_user',
            updatedAt: Date.now()
          }
        }
      });

      // Background IPC fails or is sleeping
      context.mockRuntime.sendMessage.mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.')
      );

      const wrapper = mount(PopupApp);
      await flushPromises();

      // Popup successfully initialized conflict state from local storage fallback
      expect(wrapper.find('.cdp-badge').text()).toContain('CDP CONFLICT');
      expect(wrapper.find('.conflict-banner').exists()).toBe(true);
      expect(wrapper.find('.conflict-banner').text()).toContain('canceled_by_user');
    });

    it('3.4: handles generic non-DevTools detachment gracefully', async () => {
      const wrapper = mount(PopupApp);
      await flushPromises();

      // Broadcast DETACHED event (e.g. target_closed)
      await context.mockRuntime._emitMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 10,
        status: 'DETACHED',
        reason: 'target_closed'
      });
      await flushPromises();

      // DETACHED should update badge but NOT show conflict banner
      expect(wrapper.find('.cdp-badge').text()).toContain('CDP DETACHED');
      expect(wrapper.find('.conflict-banner').exists()).toBe(false);
    });
  });
});
