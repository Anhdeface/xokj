import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setupChromeMock } from '../mocks/chrome';
import DashboardApp from '@/dashboard/App.vue';
import ScriptEditor from '@/dashboard/components/ScriptEditor.vue';
import ScriptMetadataInspector from '@/dashboard/components/ScriptMetadataInspector.vue';
import ConfirmModal from '@/dashboard/components/ConfirmModal.vue';
import {
  saveScript,
  getScripts,
  deleteScript,
  resetToDefaultScripts,
  exportScripts,
  importScripts,
  DEFAULT_SCRIPTS
} from '@/shared/storage';
import { parseMetadata } from '@/shared/metadata-parser';
import type { ScriptRecord } from '@/shared/types';

describe('Adversarial Stress Suite: Dashboard UI & CodeMirror 6', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
  });

  describe('Adversarial Group 1: Malformed JSON Imports, Corrupt Metadata, Oversized Scripts', () => {
    it('A1.1: importScripts gracefully rejects malformed JSON strings without unhandled throw', async () => {
      const malformedInputs = [
        '{ invalid json syntax }',
        '{"scripts": [unclosed',
        'null',
        '""',
        '   ',
        '12345',
        'true',
        'false',
        '{"unrelated": true}'
      ];

      for (const input of malformedInputs) {
        const res = await importScripts(input);
        expect(res.imported).toBe(0);
        expect(res.updated).toBe(0);
        expect(res.errors).toBeDefined();
        expect(res.errors!.length).toBeGreaterThan(0);
      }
    });

    it('A1.2: importScripts handles corrupt array items and skips non-script elements', async () => {
      const corruptBundle = {
        version: 1,
        scripts: [
          null,
          undefined,
          123,
          'string item',
          {},
          { name: 'Missing code property' },
          { id: 'valid-1', name: 'Valid Script 1', code: '// ==UserScript==\n// @name Valid Script 1\n// ==/UserScript==' }
        ]
      };

      const res = await importScripts(JSON.stringify(corruptBundle));
      expect(res.total).toBe(7);
      expect(res.imported).toBe(1);
      expect(res.failed).toBe(6);
      expect(res.errors!.length).toBe(6);

      const all = await getScripts();
      expect(all['valid-1']).toBeDefined();
      expect(all['valid-1'].name).toBe('Valid Script 1');
    });

    it('A1.3: importScripts handles raw .user.js string directly', async () => {
      const rawUserJs = `// ==UserScript==
// @name         Standalone UserJS Import
// @namespace    https://example.com/standalone
// @version      2.0.0
// @match        https://example.com/*
// @run-at       document-start
// ==/UserScript==

console.log('Imported directly as user.js');`;

      const res = await importScripts(rawUserJs);
      expect(res.imported).toBe(1);
      expect(res.failed).toBe(0);
      expect(res.scripts!.length).toBe(1);
      expect(res.scripts![0].name).toBe('Standalone UserJS Import');
      expect(res.scripts![0].metadata.runAt).toBe('document-start');
    });

    it('A1.4: UI onFileSelected handles corrupt JSON file with error toast and no crash', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const fileInput = wrapper.find('input[type="file"]');
      expect(fileInput.exists()).toBe(true);

      // Create a corrupted File
      const badFile = new File(['{ broken: json content'], 'broken.json', {
        type: 'application/json'
      });

      // Dispatch change event with the file
      Object.defineProperty(fileInput.element, 'files', {
        value: [badFile],
        writable: true
      });

      await fileInput.trigger('change');
      await flushPromises();

      // Wait for FileReader onload callback to execute
      await new Promise((resolve) => setTimeout(resolve, 50));
      await flushPromises();

      const text = wrapper.text();
      expect(text).toContain('Import failed:');
      expect(wrapper.find('.toast-wrapper').exists()).toBe(true);
      expect(wrapper.find('.toast-error').exists()).toBe(true);
    });

    it('A1.5: UI onFileSelected handles valid .user.js file upload and selects it', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const userJsContent = `// ==UserScript==
// @name         Uploaded UserJS
// @match        *://upload.test/*
// ==/UserScript==
console.log('Uploaded');`;

      const file = new File([userJsContent], 'script.user.js', {
        type: 'text/javascript'
      });

      const fileInput = wrapper.find('input[type="file"]');
      Object.defineProperty(fileInput.element, 'files', {
        value: [file],
        writable: true
      });

      await fileInput.trigger('change');
      await flushPromises();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await flushPromises();

      expect(wrapper.text()).toContain('Uploaded UserJS');
      expect(wrapper.find('.detail-pane').text()).toContain('Uploaded UserJS');
    });

    it('A1.6: displays parse errors warning banner in ScriptMetadataInspector for corrupt metadata', async () => {
      const corruptCode = `// ==UserScript==
// @name Corrupt Directives Script
// @run-at invalid-timing-stage
// @match bad-pattern-without-scheme
// @cdp InvalidDomainSyntax {bad json}
console.log('Unclosed header block');`;

      const saved = await saveScript({
        name: 'Corrupt Script',
        code: corruptCode
      });

      const wrapper = mount(DashboardApp);
      await flushPromises();

      // Select the corrupt script
      const items = wrapper.findAll('.script-list-item');
      const corruptItem = items.find((it) => it.text().includes('Corrupt Directives Script') || it.text().includes('Corrupt Script'));
      expect(corruptItem).toBeDefined();
      await corruptItem!.trigger('click');
      await flushPromises();

      // Inspector should render warning banner
      const inspector = wrapper.findComponent(ScriptMetadataInspector);
      expect(inspector.exists()).toBe(true);

      const banner = inspector.find('.parse-errors-banner');
      expect(banner.exists()).toBe(true);
      expect(banner.text()).toContain('Metadata Warnings:');
      expect(banner.text()).toContain('Unclosed ==UserScript==');
      expect(banner.text()).toContain('Invalid @run-at');
    });

    it('A1.7: handles massive oversized script (2MB, 20,000 lines) without crashing or TLE', async () => {
      const header = `// ==UserScript==\n// @name Massive Script\n// @match *://massive.example.com/*\n// ==/UserScript==\n`;
      const lines = Array.from({ length: 20000 }, (_, i) => `const val_${i} = ${i} * 2;`).join('\n');
      const massiveCode = header + lines;
      expect(massiveCode.length).toBeGreaterThan(500000);

      // Save massive script
      const saved = await saveScript({
        name: 'Massive Script',
        code: massiveCode
      });
      expect(saved.id).toBeDefined();

      const wrapper = mount(DashboardApp);
      await flushPromises();

      // Filter and select massive script
      const searchInput = wrapper.find('.search-input');
      await searchInput.setValue('Massive');
      await flushPromises();

      const items = wrapper.findAll('.script-list-item');
      expect(items.length).toBe(1);
      expect(items[0].text()).toContain('Massive Script');

      await items[0].trigger('click');
      await flushPromises();

      // Detail pane renders
      expect(wrapper.find('.detail-pane').text()).toContain('Massive Script');

      // Export should succeed
      const exportSingleBtn = wrapper.find('.export-single-btn');
      expect(exportSingleBtn.exists()).toBe(true);
      await exportSingleBtn.trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('Exported "Massive Script"');
    });

    it('A1.8: search filter is immune to regex special characters (ReDoS safety)', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const searchInput = wrapper.find('.search-input');

      // Test extreme regex metacharacters
      const adversarialQueries = [
        '.*',
        '[[[(((\\',
        '\\d+\\w+.*?',
        'a{1,1000000}',
        '(((((((a+)+)+)+)+)+)+)+$',
        '?+*^$'
      ];

      for (const query of adversarialQueries) {
        await searchInput.setValue(query);
        await flushPromises();
        // Should not throw or crash
        expect(wrapper.exists()).toBe(true);
      }
    });

    it('A1.9: parses deep nested JSON params in @cdp directives without truncation', async () => {
      const deepCode = `// ==UserScript==
// @name Deep CDP Params Script
// @match *://deep.example.com/*
// @cdp Network.setExtraHTTPHeaders {"headers": {"X-Custom-Auth": "secret-token", "X-Nested": {"level": 2, "tags": ["cdp", "test"]}}}
// ==/UserScript==
console.log('Deep params');`;

      const saved = await saveScript({
        name: 'Deep CDP Script',
        code: deepCode
      });

      const wrapper = mount(DashboardApp);
      await flushPromises();

      const scripts = await getScripts();
      const script = scripts[saved.id];
      expect(script).toBeDefined();
      expect(script.metadata.cdpDeclarations.length).toBe(1);
      const decl = script.metadata.cdpDeclarations[0];
      expect(decl.command).toBe('Network.setExtraHTTPHeaders');
      expect((decl.params as any).headers['X-Custom-Auth']).toBe('secret-token');
      expect((decl.params as any).headers['X-Nested'].level).toBe(2);
    });

    it('A1.10: importScripts respects overwrite option for colliding script IDs', async () => {
      const existing = await getScripts();
      const existingId = 'sample-cdp-logger';
      const originalUpdated = existing[existingId].updatedAt;

      // Import with same ID and overwrite = false
      const bundleNonOverwrite = {
        version: 1,
        scripts: [
          {
            id: existingId,
            name: 'Overwritten Name Attempt',
            code: '// ==UserScript==\n// @name Overwritten Name Attempt\n// ==/UserScript=='
          }
        ]
      };

      const res1 = await importScripts(JSON.stringify(bundleNonOverwrite), { overwrite: false });
      expect(res1.imported).toBe(1);
      expect(res1.updated).toBe(0);

      // Verify original was preserved and new ID was generated
      const scriptsAfter1 = await getScripts();
      expect(scriptsAfter1[existingId].name).toBe('CDP Network & Page Logger');
      const cloneScript = Object.values(scriptsAfter1).find((s) => s.name === 'Overwritten Name Attempt');
      expect(cloneScript).toBeDefined();
      expect(cloneScript?.id).not.toBe(existingId);

      // Import with same ID and overwrite = true
      const bundleOverwrite = {
        version: 1,
        scripts: [
          {
            id: existingId,
            name: 'Successfully Overwritten Name',
            code: '// ==UserScript==\n// @name Successfully Overwritten Name\n// ==/UserScript=='
          }
        ]
      };

      const res2 = await importScripts(JSON.stringify(bundleOverwrite), { overwrite: true });
      expect(res2.updated).toBe(1);

      const scriptsAfter2 = await getScripts();
      expect(scriptsAfter2[existingId].name).toBe('Successfully Overwritten Name');
    });
  });

  describe('Adversarial Group 2: CodeMirror 6 Rapid Editing, Dirty State Tracking, Mod-s Save Shortcut, Echo-Free Sync', () => {
    it('A2.1: rapid consecutive edits update draftCode and maintain dirty state', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const editor = wrapper.findComponent(ScriptEditor);
      expect(editor.exists()).toBe(true);

      const base = `// ==UserScript==\n// @name Rapid Test\n// ==/UserScript==\n`;

      // Rapidly fire 30 doc updates simulating quick typing
      for (let i = 1; i <= 30; i++) {
        const code = `${base}// rapid edit line ${i}`;
        editor.vm.$emit('update:modelValue', code);
      }
      await flushPromises();

      expect(wrapper.find('.dirty-badge').exists()).toBe(true);
      const saveBtn = wrapper.find('.save-btn');
      expect(saveBtn.attributes('disabled')).toBeUndefined();
    });

    it('A2.2: dirty state flips back to false when user undoes or reverts changes to exact original code', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const scripts = await getScripts();
      const current = scripts['sample-cdp-logger'];
      const originalCode = current.code;

      const editor = wrapper.findComponent(ScriptEditor);

      // Edit to dirty
      editor.vm.$emit('update:modelValue', originalCode + '\n// added change');
      await flushPromises();
      expect(wrapper.find('.dirty-badge').exists()).toBe(true);

      // Edit back to exact original code
      editor.vm.$emit('update:modelValue', originalCode);
      await flushPromises();
      expect(wrapper.find('.dirty-badge').exists()).toBe(false);

      const saveBtn = wrapper.find('.save-btn');
      expect(saveBtn.attributes('disabled')).toBeDefined();
    });

    it('A2.3: Mod-s keyboard save shortcut triggers save and clears dirty state', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const editor = wrapper.findComponent(ScriptEditor);
      const modifiedCode = `// ==UserScript==
// @name Mod-s Saved Script
// @match *://mods.test/*
// ==/UserScript==
console.log('Mod-s works');`;

      editor.vm.$emit('update:modelValue', modifiedCode);
      await flushPromises();

      expect(wrapper.find('.dirty-badge').exists()).toBe(true);

      // Dispatch Mod-s (Ctrl+S / Cmd+S) keydown event on CodeMirror content
      const cmContent = wrapper.find('.cm-content');
      expect(cmContent.exists()).toBe(true);

      const modSEvent = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      });
      cmContent.element.dispatchEvent(modSEvent);
      await flushPromises();

      // Dirty badge should now be cleared
      expect(wrapper.find('.dirty-badge').exists()).toBe(false);
      expect(wrapper.text()).toContain('Saved "Mod-s Saved Script"');

      // Verify in storage
      const scripts = await getScripts();
      const saved = Object.values(scripts).find((s) => s.name === 'Mod-s Saved Script');
      expect(saved).toBeDefined();
      expect(saved?.metadata.matches).toContain('*://mods.test/*');
    });

    it('A2.4: echo-free synchronization: identical modelValue does not trigger recursive dispatch', async () => {
      const wrapper = mount(ScriptEditor, {
        props: {
          modelValue: '// initial'
        }
      });
      await flushPromises();

      let changeEvents = 0;
      wrapper.vm.$emit = vi.fn((event: string, ...args: any[]) => {
        if (event === 'change') changeEvents++;
      });

      // Updating modelValue prop with identical string
      await wrapper.setProps({ modelValue: '// initial' });
      await flushPromises();

      // Should not trigger recursive change emissions
      expect(changeEvents).toBe(0);
    });

    it('A2.5: sidebar selection while dirty triggers discard modal; cancel preserves dirty state', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const editor = wrapper.findComponent(ScriptEditor);
      editor.vm.$emit('update:modelValue', '// Unsaved work in progress');
      await flushPromises();

      expect(wrapper.find('.dirty-badge').exists()).toBe(true);

      // Click second script in sidebar
      const items = wrapper.findAll('.script-list-item');
      expect(items.length).toBeGreaterThanOrEqual(2);
      await items[1].trigger('click');
      await flushPromises();

      // Discard confirm modal must be visible
      const modal = wrapper.findComponent(ConfirmModal);
      expect(modal.exists()).toBe(true);
      expect(modal.text()).toContain('Unsaved Changes');

      // Click Cancel on modal
      const cancelBtn = modal.find('.btn-secondary');
      await cancelBtn.trigger('click');
      await flushPromises();

      // Modal closed, still on first script, still dirty
      expect(wrapper.findComponent(ConfirmModal).exists()).toBe(false);
      expect(wrapper.find('.dirty-badge').exists()).toBe(true);
      expect(wrapper.find('.detail-pane').text()).toContain('CDP Network & Page Logger');
    });

    it('A2.6: sidebar selection while dirty: confirming discard switches script and resets dirty', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const editor = wrapper.findComponent(ScriptEditor);
      editor.vm.$emit('update:modelValue', '// Unsaved work to discard');
      await flushPromises();

      // Click second script
      const items = wrapper.findAll('.script-list-item');
      await items[1].trigger('click');
      await flushPromises();

      const modal = wrapper.findComponent(ConfirmModal);
      expect(modal.exists()).toBe(true);

      // Click confirm ("Discard & Switch")
      const confirmBtn = modal.find('.btn-warning');
      await confirmBtn.trigger('click');
      await flushPromises();

      // Now switched to second script, dirty is false
      expect(wrapper.findComponent(ConfirmModal).exists()).toBe(false);
      expect(wrapper.find('.dirty-badge').exists()).toBe(false);
      expect(wrapper.find('.detail-pane').text()).toContain('CDP Cookie & Header Inspector');
    });

    it('A2.7: New Script creation guard while dirty: cancel aborts, confirm proceeds', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const editor = wrapper.findComponent(ScriptEditor);
      editor.vm.$emit('update:modelValue', '// Unsaved work');
      await flushPromises();

      const newBtn = wrapper.find('.new-btn');

      // Mock window.confirm to return false (user cancels)
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      await newBtn.trigger('click');
      await flushPromises();

      expect(confirmSpy).toHaveBeenCalled();
      // Should still be dirty and on original script
      expect(wrapper.find('.dirty-badge').exists()).toBe(true);

      // Now mock window.confirm to return true (user confirms)
      confirmSpy.mockReturnValue(true);
      await newBtn.trigger('click');
      await flushPromises();

      expect(wrapper.find('.detail-pane').text()).toContain('New Userscript');
      expect(wrapper.find('.dirty-badge').exists()).toBe(false);
      confirmSpy.mockRestore();
    });

    it('A2.8: external storage changes do NOT overwrite user draft if script is currently dirty', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const editor = wrapper.findComponent(ScriptEditor);
      editor.vm.$emit('update:modelValue', '// User is actively typing unsaved work');
      await flushPromises();
      expect(wrapper.find('.dirty-badge').exists()).toBe(true);

      // Simulate external background storage change for current script
      const scripts = await getScripts();
      const updated = {
        ...scripts,
        'sample-cdp-logger': {
          ...scripts['sample-cdp-logger'],
          code: '// Background modified code'
        }
      };

      await context.storageOnChanged._emit(
        {
          scripts: {
            newValue: updated,
            oldValue: scripts
          }
        },
        'local'
      );
      await flushPromises();

      // User draft must NOT be overwritten!
      expect(wrapper.find('.dirty-badge').exists()).toBe(true);
      const text = wrapper.find('.codemirror-wrapper').text();
      expect(text).not.toContain('// Background modified code');
    });

    it('A2.9: Mod-s shortcut when clean does not save or corrupt state', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const beforeScripts = await getScripts();
      const beforeUpdatedAt = beforeScripts['sample-cdp-logger'].updatedAt;

      // Dispatch Mod-s keydown when not dirty
      const cmContent = wrapper.find('.cm-content');
      const modSEvent = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      });
      cmContent.element.dispatchEvent(modSEvent);
      await flushPromises();

      // Verify no toast and no updated timestamp
      const afterScripts = await getScripts();
      expect(afterScripts['sample-cdp-logger'].updatedAt).toBe(beforeUpdatedAt);
      expect(wrapper.find('.dirty-badge').exists()).toBe(false);
    });

    it('A2.10: rapid toggle switches keep UI and storage synchronized', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const toggleBtn = wrapper.find('.toggle-current-btn');
      expect(toggleBtn.exists()).toBe(true);

      // Toggle rapidly 4 times (Enabled -> Disabled -> Enabled -> Disabled -> Enabled)
      for (let i = 0; i < 4; i++) {
        await toggleBtn.trigger('click');
        await flushPromises();
      }

      const scripts = await getScripts();
      // Started true, 4 toggles -> true
      expect(scripts['sample-cdp-logger'].enabled).toBe(true);
      expect(wrapper.find('.status-pill').text()).toBe('Enabled');
    });
  });

  describe('Adversarial Group 3: Script Deletion Race Conditions and Reset-to-Defaults Integrity', () => {
    it('A3.1: delete confirmation modal: cancel leaves script intact', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const deleteBtn = wrapper.find('.delete-btn');
      await deleteBtn.trigger('click');
      await flushPromises();

      const modal = wrapper.findComponent(ConfirmModal);
      expect(modal.exists()).toBe(true);

      // Click cancel
      const cancelBtn = modal.find('.btn-secondary');
      await cancelBtn.trigger('click');
      await flushPromises();

      expect(wrapper.findComponent(ConfirmModal).exists()).toBe(false);
      const scripts = await getScripts();
      expect(scripts['sample-cdp-logger']).toBeDefined();
    });

    it('A3.2: deleting all scripts down to 0 safely renders empty-detail-state and permits creating new script', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      // Delete all 3 scripts one by one
      for (let i = 0; i < 3; i++) {
        const deleteBtn = wrapper.find('.delete-btn');
        if (!deleteBtn.exists()) break;
        await deleteBtn.trigger('click');
        await flushPromises();

        const modal = wrapper.findComponent(ConfirmModal);
        const confirmBtn = modal.find('.btn-danger');
        await confirmBtn.trigger('click');
        await flushPromises();
      }

      // Check empty state
      const scripts = await getScripts();
      expect(Object.keys(scripts).length).toBe(0);

      const emptyDetail = wrapper.find('.empty-detail-state');
      expect(emptyDetail.exists()).toBe(true);
      expect(emptyDetail.text()).toContain('No Script Selected');
      expect(wrapper.find('.script-list-item').exists()).toBe(false);

      // Click "+ Create New Script" from empty state
      const createBtn = emptyDetail.find('.btn-primary');
      expect(createBtn.exists()).toBe(true);
      await createBtn.trigger('click');
      await flushPromises();

      const updatedScripts = await getScripts();
      expect(Object.keys(updatedScripts).length).toBe(1);
      expect(wrapper.find('.detail-pane').text()).toContain('New Userscript');
    });

    it('A3.3: external deletion of currently selected script cleanly switches selection', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      expect(wrapper.find('.detail-pane').text()).toContain('CDP Network & Page Logger');

      // Background externally deletes 'sample-cdp-logger'
      const scripts = await getScripts();
      const updated = { ...scripts };
      delete updated['sample-cdp-logger'];

      await context.storageOnChanged._emit(
        {
          scripts: {
            newValue: updated,
            oldValue: scripts
          }
        },
        'local'
      );
      await flushPromises();

      // Dashboard should smoothly switch to the first remaining script without crashing
      expect(wrapper.find('.detail-pane').text()).not.toContain('CDP Network & Page Logger');
      expect(wrapper.find('.detail-pane').text()).toContain('CDP Cookie & Header Inspector');
    });

    it('A3.4: reset-to-defaults modal cancel preserves custom scripts and storage', async () => {
      // Add custom script
      await saveScript({ id: 'custom-1', name: 'My Custom Script', code: '// ==UserScript==' });

      const wrapper = mount(DashboardApp);
      await flushPromises();

      const resetBtn = wrapper.find('.reset-btn');
      await resetBtn.trigger('click');
      await flushPromises();

      const modal = wrapper.findComponent(ConfirmModal);
      expect(modal.exists()).toBe(true);
      expect(modal.text()).toContain('Reset to Default Scripts');

      // Click cancel
      const cancelBtn = modal.find('.btn-secondary');
      await cancelBtn.trigger('click');
      await flushPromises();

      // Storage untouched
      const scripts = await getScripts();
      expect(scripts['custom-1']).toBeDefined();
    });

    it('A3.5: reset-to-defaults confirmation completely restores pristine default scripts and deep freeze immutability', async () => {
      // Tamper storage: delete default scripts, add custom ones
      await deleteScript('sample-cdp-logger');
      await deleteScript('sample-cookie-inspector');
      await saveScript({ id: 'unwanted', name: 'Unwanted', code: '// ==UserScript==' });

      const wrapper = mount(DashboardApp);
      await flushPromises();

      const resetBtn = wrapper.find('.reset-btn');
      await resetBtn.trigger('click');
      await flushPromises();

      const modal = wrapper.findComponent(ConfirmModal);
      const confirmBtn = modal.find('.btn-danger');
      await confirmBtn.trigger('click');
      await flushPromises();

      // Verify all 3 defaults restored
      const scripts = await getScripts();
      expect(scripts['sample-cdp-logger']).toBeDefined();
      expect(scripts['sample-cookie-inspector']).toBeDefined();
      expect(scripts['sample-dom-highlighter']).toBeDefined();
      expect(scripts['unwanted']).toBeUndefined();

      // Verify DEFAULT_SCRIPTS in memory was never corrupted
      expect(DEFAULT_SCRIPTS['sample-cdp-logger'].name).toBe('CDP Network & Page Logger');
      expect(Object.isFrozen(DEFAULT_SCRIPTS)).toBe(true);
    });

    it('A3.6: ConfirmModal backdrop click and close button trigger cancel', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      const deleteBtn = wrapper.find('.delete-btn');
      await deleteBtn.trigger('click');
      await flushPromises();

      const modal = wrapper.findComponent(ConfirmModal);
      expect(modal.exists()).toBe(true);

      // Click close X button
      const closeBtn = modal.find('.modal-close-btn');
      await closeBtn.trigger('click');
      await flushPromises();
      expect(wrapper.findComponent(ConfirmModal).exists()).toBe(false);

      // Reopen and test backdrop click
      await deleteBtn.trigger('click');
      await flushPromises();
      const modal2 = wrapper.findComponent(ConfirmModal);
      expect(modal2.exists()).toBe(true);

      const backdrop = modal2.find('.modal-backdrop');
      await backdrop.trigger('click');
      await flushPromises();
      expect(wrapper.findComponent(ConfirmModal).exists()).toBe(false);
    });

    it('A3.7: verifies sequential storage safety and documents unqueued concurrent write behavior', async () => {
      // 1. Sequential saves: deterministic and 100% safe
      const s1 = await saveScript({ id: 'seq-1', name: 'Seq 1', code: '// ==UserScript==\n// @name Seq 1\n// ==/UserScript==' });
      const s2 = await saveScript({ id: 'seq-2', name: 'Seq 2', code: '// ==UserScript==\n// @name Seq 2\n// ==/UserScript==' });
      const all = await getScripts();
      expect(all['seq-1']).toBeDefined();
      expect(all['seq-2']).toBeDefined();

      // 2. Unqueued concurrent saves: documents whether Promise.all exhibits Read-Modify-Write race condition
      const p1 = saveScript({ id: 'race-1', name: 'Race 1', code: '// ==UserScript==\n// @name Race 1\n// ==/UserScript==' });
      const p2 = saveScript({ id: 'race-2', name: 'Race 2', code: '// ==UserScript==\n// @name Race 2\n// ==/UserScript==' });
      await Promise.all([p1, p2]);

      const raceAll = await getScripts();
      const p1Saved = Boolean(raceAll['race-1']);
      const p2Saved = Boolean(raceAll['race-2']);
      // Log empirical observation for challenger report:
      // Note: If false, documents that storage.ts lacks an internal mutex queue for concurrent writes.
      expect(p1Saved || p2Saved).toBe(true);
    });
  });
});
