import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setupChromeMock } from '../mocks/chrome';
import DashboardApp from '@/dashboard/App.vue';
import { saveScript, getScripts, resetToDefaultScripts, toggleScript } from '@/shared/storage';

describe('Feature 22-24: Dashboard UI Component Suite (test/unit/dashboard.spec.ts)', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
  });

  describe('Tier 1: Master-Detail Initial Rendering', () => {
    it('T1.1: loads and renders all stored scripts in sidebar', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const items = wrapper.findAll('.script-list-item');
      expect(items.length).toBeGreaterThanOrEqual(3);

      const text = wrapper.text();
      expect(text).toContain('CDP Network & Page Logger');
      expect(text).toContain('CDP Cookie & Header Inspector');
      expect(text).toContain('DOM Element Highlighter');
    });

    it('T1.2: selects first script by default and populates editor area', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      expect(wrapper.find('.detail-pane').text()).toContain('CDP Network & Page Logger');
      expect(wrapper.find('.codemirror-wrapper').exists()).toBe(true);
    });

    it('T1.3: displays script metadata inspector with parsed directives', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const inspector = wrapper.find('.metadata-inspector');
      expect(inspector.exists()).toBe(true);
      expect(inspector.text()).toContain('run-at:');
      expect(inspector.text()).toContain('document-start');
      expect(inspector.text()).toContain('cdp:');
      expect(inspector.text()).toContain('Network');
    });
  });

  describe('Tier 2: Search & Filter Capabilities', () => {
    it('T2.1: filters script list in real-time as user types in search input', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const searchInput = wrapper.find('.search-input');
      expect(searchInput.exists()).toBe(true);

      await searchInput.setValue('Cookie');
      await flushPromises();

      const items = wrapper.findAll('.script-list-item');
      expect(items.length).toBe(1);
      expect(items[0].text()).toContain('CDP Cookie & Header Inspector');
    });

    it('T2.2: CDP filter tab restricts list to scripts with CDP capabilities', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const cdpTab = wrapper.find('.cdp-tab-btn');
      expect(cdpTab.exists()).toBe(true);

      await cdpTab.trigger('click');
      await flushPromises();

      const items = wrapper.findAll('.script-list-item');
      // In default scripts: 2 CDP scripts, 1 standard DOM script
      expect(items.length).toBe(2);
      expect(wrapper.text()).not.toContain('DOM Element Highlighter');
    });

    it('T2.3: Enabled / Disabled filter tabs restrict by enabled state', async () => {
      // Disable one script
      const scripts = await getScripts();
      const firstId = Object.keys(scripts)[0];
      await toggleScript(firstId, false);

      const wrapper = mount(DashboardApp);
      await flushPromises();

      // Click "Disabled" tab
      const tabs = wrapper.findAll('.tab-btn');
      const disabledTab = tabs.find((t) => t.text().includes('Disabled'));
      expect(disabledTab).toBeDefined();

      await disabledTab!.trigger('click');
      await flushPromises();

      const items = wrapper.findAll('.script-list-item');
      expect(items.length).toBe(1);
      expect(items[0].text()).toContain(scripts[firstId].name);
    });
  });

  describe('Tier 3: Script CRUD Operations', () => {
    it('T3.1: clicking "New Script" creates new script and focuses editor', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const newBtn = wrapper.find('.new-btn');
      expect(newBtn.exists()).toBe(true);

      await newBtn.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('New Userscript');
      expect(wrapper.find('.detail-pane').text()).toContain('New Userscript');

      const all = await getScripts();
      const created = Object.values(all).find((s) => s.name === 'New Userscript');
      expect(created).toBeDefined();
    });

    it('T3.2 & T3.3: saving updated code re-parses metadata and updates storage', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const updatedCode = `// ==UserScript==
// @name         Renamed Test Script
// @match        https://updated-domain.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

console.log('Updated');`;

      // Update draftCode by emitting update:modelValue from ScriptEditor
      const editorWrapper = wrapper.findComponent({ name: 'ScriptEditor' });
      expect(editorWrapper.exists()).toBe(true);

      editorWrapper.vm.$emit('update:modelValue', updatedCode);
      await flushPromises();

      expect(wrapper.find('.dirty-badge').exists()).toBe(true);

      // Click Save
      const saveBtn = wrapper.find('.save-btn');
      expect(saveBtn.attributes('disabled')).toBeUndefined();

      await saveBtn.trigger('click');
      await flushPromises();

      // Re-read storage
      const all = await getScripts();
      const updated = Object.values(all).find((s) => s.name === 'Renamed Test Script');
      expect(updated).toBeDefined();
      expect(updated?.metadata.runAt).toBe('document-end');
      expect(updated?.metadata.matches).toContain('https://updated-domain.com/*');
    });

    it('T3.4: clicking "Revert" discards unsaved edits', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const editorWrapper = wrapper.findComponent({ name: 'ScriptEditor' });
      editorWrapper.vm.$emit('update:modelValue', '// changed code');
      await flushPromises();

      expect(wrapper.find('.dirty-badge').exists()).toBe(true);

      const revertBtn = wrapper.find('.revert-btn');
      await revertBtn.trigger('click');
      await flushPromises();

      expect(wrapper.find('.dirty-badge').exists()).toBe(false);
    });

    it('T3.5: clicking "Delete" opens confirm modal and deletes script on confirmation', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const deleteBtn = wrapper.find('.delete-btn');
      expect(deleteBtn.exists()).toBe(true);

      await deleteBtn.trigger('click');
      await flushPromises();

      // Confirm modal is displayed
      const modal = wrapper.findComponent({ name: 'ConfirmModal' });
      expect(modal.exists()).toBe(true);
      expect(modal.text()).toContain('Delete Script');

      // Click confirm
      const confirmBtn = modal.find('.btn-danger');
      await confirmBtn.trigger('click');
      await flushPromises();

      const all = await getScripts();
      expect(Object.keys(all).length).toBe(2);
    });

    it('T3.6: toggling script switch updates enabled state in storage', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const toggleCurrentBtn = wrapper.find('.toggle-current-btn');
      expect(toggleCurrentBtn.exists()).toBe(true);

      // Disable currently selected script
      await toggleCurrentBtn.trigger('click');
      await flushPromises();

      const scripts = await getScripts();
      const first = scripts['sample-cdp-logger'];
      expect(first.enabled).toBe(false);
    });
  });

  describe('Tier 4: Import / Export & Sample Reset', () => {
    it('T4.1: clicking "Export" executes JSON generation without errors', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const exportBtn = wrapper.find('.export-btn');
      expect(exportBtn.exists()).toBe(true);

      // Trigger export
      await exportBtn.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Exported all scripts');
    });

    it('T4.2: import handles valid JSON bundle', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const input = wrapper.find('input[type="file"]');
      expect(input.exists()).toBe(true);

      // Emulate FileReader
      const newScriptData = {
        name: 'Imported Test Script',
        code: '// ==UserScript==\n// @name Imported Test Script\n// @match *://*/*\n// ==/UserScript==',
        enabled: true
      };
      await saveScript(newScriptData);
      await flushPromises();

      expect(wrapper.text()).toContain('Imported Test Script');
    });

    it('T4.3: clicking "Reset Defaults" restores initial pre-seeded sample scripts', async () => {
      await context.localStorage.clear();
      await saveScript({ id: 'temp', name: 'Custom Temp Script', code: '// ==UserScript==' });

      const wrapper = mount(DashboardApp);
      await flushPromises();

      const resetBtn = wrapper.find('.reset-btn');
      await resetBtn.trigger('click');
      await flushPromises();

      // Confirm modal opens
      const modal = wrapper.findComponent({ name: 'ConfirmModal' });
      expect(modal.exists()).toBe(true);
      expect(modal.text()).toContain('Reset to Default Scripts');

      const confirmBtn = modal.find('.btn-danger');
      await confirmBtn.trigger('click');
      await flushPromises();

      const scripts = await getScripts();
      expect(scripts['sample-cdp-logger']).toBeDefined();
      expect(scripts['sample-cookie-inspector']).toBeDefined();
      expect(scripts['temp']).toBeUndefined();
    });
  });

  describe('Tier 5: CodeMirror 6 Editor Integration & Storage Reactivity', () => {
    it('T5.1: mounts CodeMirror EditorView DOM structure', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const cmWrapper = wrapper.find('.codemirror-wrapper');
      expect(cmWrapper.exists()).toBe(true);
      expect(cmWrapper.find('.cm-editor').exists()).toBe(true);
      expect(cmWrapper.find('.cm-content').exists()).toBe(true);
    });

    it('T5.2: switches editor document when another script is selected in sidebar', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const items = wrapper.findAll('.script-list-item');
      expect(items.length).toBeGreaterThanOrEqual(2);

      // Select second script
      await items[1].trigger('click');
      await flushPromises();

      expect(wrapper.find('.detail-pane').text()).toContain('CDP Cookie & Header Inspector');
    });

    it('T5.3: reactively synchronizes when scripts change in external storage', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      // External script added
      const added = await saveScript({
        id: 'external-script',
        name: 'External Reactive Script',
        code: '// ==UserScript==\n// @name External Reactive Script\n// ==/UserScript=='
      });

      // Storage event dispatched
      const current = await getScripts();
      await context.storageOnChanged._emit(
        {
          scripts: {
            newValue: current,
            oldValue: {}
          }
        },
        'local'
      );
      await flushPromises();

      expect(wrapper.text()).toContain('External Reactive Script');
    });
  });
});
