import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setupChromeMock } from '../mocks/chrome';
import PopupApp from '@/popup/App.vue';
import { saveScript } from '@/shared/storage';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { DevToolsConflictHandler } from '@/background/conflict-mgr';
import { UiIpcServer } from '@/background/ui-ipc';

describe('Feature 19-21: Popup UI Component Suite (test/unit/popup.spec.ts)', () => {
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

    // Wire sendMessage to dispatch to listeners with tab context
    context.mockRuntime.sendMessage.mockImplementation(async (msg: any) => {
      return context.mockRuntime._emitMessage(msg, { tab: { id: 10 } });
    });

    // Default active tab: https://example.com/app
    context.mockTabs.query.mockResolvedValue([
      { id: 10, url: 'https://example.com/app', title: 'Example App' } as any
    ]);
  });

  afterEach(() => {
    uiIpc.destroy();
    conflictHandler.destroy();
    debuggerMgr.destroy();
  });

  describe('Tier 1: Active Tab Detection & Initialization', () => {
    it('T1.1: queries active tab on mount using chrome.tabs.query', async () => {
      const wrapper = mount(PopupApp);
      await flushPromises();

      expect(context.mockTabs.query).toHaveBeenCalledWith({
        active: true,
        currentWindow: true
      });
      expect(wrapper.text()).toContain('example.com');
    });

    it('T1.2: handles restricted URLs (chrome://) gracefully with security empty state', async () => {
      context.mockTabs.query.mockResolvedValue([
        { id: 11, url: 'chrome://settings', title: 'Settings' } as any
      ]);

      const wrapper = mount(PopupApp);
      await flushPromises();

      expect(wrapper.text()).toContain('Restricted Browser Page');
      expect(wrapper.text()).toContain('Chromium security policies disallow');
    });
  });

  describe('Tier 2: Active Tab Script Matching & Listing', () => {
    it('T2.1: lists scripts matching active tab URL and filters out non-matching ones', async () => {
      await saveScript({
        id: 'script-match',
        name: 'Example Matcher Script',
        code: '// ==UserScript==\n// @match https://example.com/*\n// ==/UserScript==',
        enabled: true
      });
      await saveScript({
        id: 'script-nomatch',
        name: 'Unrelated Domain Script',
        code: '// ==UserScript==\n// @match https://otherdomain.org/*\n// ==/UserScript==',
        enabled: true
      });

      const wrapper = mount(PopupApp);
      await flushPromises();

      expect(wrapper.text()).toContain('Example Matcher Script');
      expect(wrapper.text()).not.toContain('Unrelated Domain Script');
    });

    it('T2.2: renders empty state when zero scripts match active tab', async () => {
      // Clear storage so no scripts exist
      await context.localStorage.clear();
      await context.localStorage.set({ scripts: {}, schemaVersion: 1, settings: { globalEnabled: true } });

      const wrapper = mount(PopupApp);
      await flushPromises();

      expect(wrapper.text()).toContain('No Scripts for This Site');
      expect(wrapper.find('.empty-action-btn').exists()).toBe(true);
    });

    it('T2.3: displays script metadata badges (run-at, CDP, version)', async () => {
      await saveScript({
        id: 'script-cdp',
        name: 'CDP Interceptor Script',
        code: '// ==UserScript==\n// @version 2.1.0\n// @match https://example.com/*\n// @run-at document-start\n// @cdp Network.enable\n// @grant GM_cdp\n// ==/UserScript==',
        enabled: true
      });

      const wrapper = mount(PopupApp);
      await flushPromises();

      expect(wrapper.text()).toContain('v2.1.0');
      expect(wrapper.text()).toContain('start');
      expect(wrapper.text()).toContain('Network');
      expect(wrapper.find('.cdp-badge-tag').exists()).toBe(true);
    });
  });

  describe('Tier 3: Toggle Interactions & State Persistence', () => {
    it('T3.1: toggling individual script switch updates storage and UI state', async () => {
      await saveScript({
        id: 'script-toggle-test',
        name: 'Toggleable Script',
        code: '// ==UserScript==\n// @match https://example.com/*\n// ==/UserScript==',
        enabled: true
      });

      const wrapper = mount(PopupApp);
      await flushPromises();

      // Find the specific card for this script
      const scriptCards = wrapper.findAll('.script-card');
      const scriptCard = scriptCards.find((c) => c.text().includes('Toggleable Script'));
      expect(scriptCard).toBeDefined();

      const checkbox = scriptCard!.find('input[type="checkbox"]');
      expect(checkbox.exists()).toBe(true);

      // Toggle off
      await checkbox.setValue(false);
      await flushPromises();

      const stored = await context.localStorage.get('scripts');
      expect(stored.scripts['script-toggle-test']?.enabled).toBe(false);
    });

    it('T3.2: toggling global switch updates settings.globalEnabled and displays paused banner', async () => {
      const wrapper = mount(PopupApp);
      await flushPromises();

      const globalControls = wrapper.find('.global-controls');
      expect(globalControls.exists()).toBe(true);
      const globalCheckbox = globalControls.find('input[type="checkbox"]');

      // Turn global switch off
      await globalCheckbox.setValue(false);
      await flushPromises();

      const stored = await context.localStorage.get('settings');
      expect(stored.settings?.globalEnabled).toBe(false);
      expect(wrapper.find('.paused-banner').exists()).toBe(true);
      expect(wrapper.find('.paused-banner').text()).toContain('Script execution is globally paused');
    });

    it('T3.3: reactively updates when chrome.storage.onChanged fires externally', async () => {
      const wrapper = mount(PopupApp);
      await flushPromises();

      // Simulate external storage change (e.g. from Dashboard or Background)
      await context.storageOnChanged._emit(
        {
          settings: {
            oldValue: { globalEnabled: true },
            newValue: { globalEnabled: false, autoAttachDebugger: true, logLevel: 'info' }
          }
        },
        'local'
      );
      await flushPromises();

      expect(wrapper.find('.paused-banner').exists()).toBe(true);
    });
  });

  describe('Tier 4: CDP Connection Status Badge', () => {
    it('T4.1: renders IDLE state badge by default when no debugger is attached', async () => {
      const wrapper = mount(PopupApp);
      await flushPromises();

      const badge = wrapper.find('.cdp-badge');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain('CDP IDLE');
      expect(badge.classes()).toContain('status-idle');
    });

    it('T4.2: renders ATTACHED badge when session is attached', async () => {
      debuggerMgr.setTabStatus(10, 'ATTACHED');
      await context.localStorage.set({
        tab_sessions: {
          10: {
            tabId: 10,
            status: 'ATTACHED',
            attached: true,
            activeDomains: ['Network', 'Page'],
            conflictDetected: false,
            updatedAt: Date.now()
          }
        }
      });

      const wrapper = mount(PopupApp);
      await flushPromises();

      const badge = wrapper.find('.cdp-badge');
      expect(badge.text()).toContain('CDP ATTACHED');
      expect(badge.classes()).toContain('status-attached');
    });

    it('T4.3: updates reactively on CDP_LIFECYCLE_EVENT runtime message', async () => {
      const wrapper = mount(PopupApp);
      await flushPromises();

      expect(wrapper.find('.cdp-badge').text()).toContain('CDP IDLE');

      // Dispatch lifecycle event
      await context.mockRuntime._emitMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 10,
        status: 'ATTACHED'
      });
      await flushPromises();

      expect(wrapper.find('.cdp-badge').text()).toContain('CDP ATTACHED');
    });
  });

  describe('Tier 5: DevTools Conflict Warning & Reconnect Flow', () => {
    it('T5.1: renders conflict badge, warning banner, and Reconnect button when status is CONFLICT', async () => {
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

      const wrapper = mount(PopupApp);
      await flushPromises();

      const badge = wrapper.find('.cdp-badge');
      expect(badge.text()).toContain('CDP CONFLICT');
      expect(badge.classes()).toContain('status-conflict');

      const banner = wrapper.find('.conflict-banner');
      expect(banner.exists()).toBe(true);
      expect(banner.text()).toContain('DevTools Conflict Detected');
      expect(banner.text()).toContain('canceled_by_user');
      expect(banner.find('.reconnect-btn').exists()).toBe(true);
    });

    it('T5.2 & T5.3: clicking "Reconnect CDP" dispatches RECONNECT_CDP and transitions to ATTACHED on success', async () => {
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

      context.mockDebugger.attach.mockResolvedValueOnce();

      const wrapper = mount(PopupApp);
      await flushPromises();

      const reconnectBtn = wrapper.find('.reconnect-btn');
      expect(reconnectBtn.exists()).toBe(true);

      await reconnectBtn.trigger('click');
      await flushPromises();

      // Banner dismissed and status is ATTACHED
      expect(wrapper.find('.conflict-banner').exists()).toBe(false);
      expect(wrapper.find('.cdp-badge').text()).toContain('CDP ATTACHED');
      expect(wrapper.find('.success-toast').exists()).toBe(true);
    });

    it('T5.4: displays error inside banner if DevTools is still open', async () => {
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

      // Emulate DevTools still open error
      context.mockDebugger.attach.mockRejectedValueOnce(
        new Error('Cannot attach: another debugger is open')
      );

      const wrapper = mount(PopupApp);
      await flushPromises();

      const reconnectBtn = wrapper.find('.reconnect-btn');
      expect(reconnectBtn.exists()).toBe(true);
      await reconnectBtn.trigger('click');
      await flushPromises();

      const banner = wrapper.find('.conflict-banner');
      expect(banner.exists()).toBe(true);
      expect(banner.find('.banner-error').exists()).toBe(true);
      expect(banner.find('.banner-error').text()).toContain('DevTools is still open');
    });
  });

  describe('Tier 6: Dashboard Navigation & Tab Reloading', () => {
    it('T6.1: clicking Dashboard button invokes chrome.runtime.openOptionsPage', async () => {
      const wrapper = mount(PopupApp);
      await flushPromises();

      const dashboardBtn = wrapper.find('.dashboard-btn');
      expect(dashboardBtn.exists()).toBe(true);

      await dashboardBtn.trigger('click');
      await flushPromises();

      expect(context.mockRuntime.openOptionsPage).toHaveBeenCalled();
    });

    it('T6.2: clicking tab reload button reloads active tab', async () => {
      const wrapper = mount(PopupApp);
      await flushPromises();

      const reloadBtn = wrapper.find('.reload-tab-btn');
      expect(reloadBtn.exists()).toBe(true);

      await reloadBtn.trigger('click');
      await flushPromises();

      expect(context.mockTabs.reload).toHaveBeenCalledWith(10);
    });
  });
});
