<template>
  <div class="dashboard-root">
    <!-- Header -->
    <DashboardHeader
      :scripts-count="scriptList.length"
      :cdp-scripts-count="cdpScriptsCount"
      @new-script="handleCreateNewScript"
      @import-scripts="handleImportClick"
      @export-all="handleExportAll"
      @reset-defaults="showResetConfirm = true"
    />

    <!-- Main Master-Detail Layout -->
    <main class="dashboard-body">
      <!-- Left Sidebar (Master) -->
      <aside class="sidebar-pane">
        <ScriptList
          :scripts="filteredScripts"
          :total-count="scriptList.length"
          :selected-id="selectedScriptId"
          :search-query="searchQuery"
          :active-filter="activeFilter"
          @update:search-query="searchQuery = $event"
          @update:active-filter="activeFilter = $event"
          @select="handleSelectScript"
          @toggle="handleToggleScript"
        />
      </aside>

      <!-- Right Main Panel (Detail / Editor) -->
      <section class="detail-pane">
        <template v-if="selectedScript">
          <!-- Editor Toolbar -->
          <div class="editor-header-bar">
            <div class="script-title-area">
              <span class="script-name">{{ selectedScript.name }}</span>
              <span v-if="isDirty" class="dirty-badge" title="Unsaved changes">• Unsaved</span>
              <span class="status-pill" :class="selectedScript.enabled ? 'enabled' : 'disabled'">
                {{ selectedScript.enabled ? 'Enabled' : 'Disabled' }}
              </span>
            </div>

            <div class="editor-action-buttons">
              <button
                class="btn btn-secondary revert-btn"
                :disabled="!isDirty"
                @click="handleRevertChanges"
                title="Discard editor changes"
              >
                Revert
              </button>
              <button
                class="btn btn-primary save-btn"
                :disabled="!isDirty"
                @click="handleSaveScript"
                title="Save changes (Ctrl+S / Cmd+S)"
              >
                Save
              </button>
              <button
                class="btn btn-outline toggle-current-btn"
                @click="handleToggleCurrentScript"
                :title="selectedScript.enabled ? 'Disable Script' : 'Enable Script'"
              >
                {{ selectedScript.enabled ? 'Disable' : 'Enable' }}
              </button>
              <button
                class="btn btn-outline export-single-btn"
                @click="handleExportSingle"
                title="Export this script to JSON"
              >
                Export
              </button>
              <button
                class="btn btn-danger delete-btn"
                @click="showDeleteConfirm = true"
                title="Delete this script"
              >
                Delete
              </button>
            </div>
          </div>

          <!-- Metadata & Directive Inspector -->
          <ScriptMetadataInspector
            :metadata="selectedScript.metadata"
            :parse-errors="selectedScript.parseErrors"
          />

          <!-- CodeMirror 6 Editor Container -->
          <div class="editor-viewport">
            <ScriptEditor
              v-model="draftCode"
              @save="handleSaveScript"
            />
          </div>
        </template>

        <div v-else class="empty-detail-state">
          <div class="empty-icon">📜</div>
          <h3>No Script Selected</h3>
          <p>Choose a script from the sidebar to inspect metadata and edit code, or create a new one.</p>
          <button class="btn btn-primary" @click="handleCreateNewScript">+ Create New Script</button>
        </div>
      </section>
    </main>

    <!-- Hidden File Input for Import -->
    <input
      type="file"
      ref="fileInputRef"
      style="display: none"
      accept=".json,.js,.user.js"
      @change="onFileSelected"
    />

    <!-- Confirm Modals -->
    <ConfirmModal
      v-if="showDeleteConfirm"
      title="Delete Script"
      :message="`Are you sure you want to delete '${selectedScript?.name}'? This action cannot be undone.`"
      confirm-text="Delete"
      confirm-type="danger"
      @confirm="confirmDeleteScript"
      @cancel="showDeleteConfirm = false"
    />

    <ConfirmModal
      v-if="showResetConfirm"
      title="Reset to Default Scripts"
      message="Reset all scripts in storage to the original sample scripts? Any custom scripts will be overwritten."
      confirm-text="Reset to Defaults"
      confirm-type="danger"
      @confirm="confirmResetDefaults"
      @cancel="showResetConfirm = false"
    />

    <ConfirmModal
      v-if="showDiscardConfirm"
      title="Unsaved Changes"
      message="You have unsaved changes in this script. Do you want to discard them and proceed?"
      confirm-text="Discard & Switch"
      confirm-type="warning"
      @confirm="confirmDiscardAndSwitch"
      @cancel="cancelDiscard"
    />

    <!-- Toast Notifications -->
    <ToastNotification
      v-if="toast"
      :type="toast.type"
      :message="toast.message"
      @close="toast = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { ScriptRecord } from '@/shared/types';
import {
  getScripts,
  saveScript,
  deleteScript,
  toggleScript,
  resetToDefaultScripts,
  exportScripts,
  importScripts,
  onScriptsChanged
} from '@/shared/storage';
import DashboardHeader from './components/DashboardHeader.vue';
import ScriptList from './components/ScriptList.vue';
import ScriptEditor from './components/ScriptEditor.vue';
import ScriptMetadataInspector from './components/ScriptMetadataInspector.vue';
import ConfirmModal from './components/ConfirmModal.vue';
import ToastNotification from './components/ToastNotification.vue';

// State
const scripts = ref<Record<string, ScriptRecord>>({});
const selectedScriptId = ref<string | null>(null);
const draftCode = ref<string>('');
const searchQuery = ref<string>('');
const activeFilter = ref<'all' | 'enabled' | 'disabled' | 'cdp'>('all');

// Modals & UI helpers
const showDeleteConfirm = ref(false);
const showResetConfirm = ref(false);
const showDiscardConfirm = ref(false);
const pendingSwitchId = ref<string | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const toast = ref<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

let unsubscribeStorage: (() => void) | null = null;

function showToast(message: string, type: 'success' | 'info' | 'error' = 'success') {
  toast.value = { message, type };
  setTimeout(() => {
    if (toast.value?.message === message) toast.value = null;
  }, 3000);
}

// Computeds
const scriptList = computed(() => Object.values(scripts.value));
const selectedScript = computed(() => {
  if (!selectedScriptId.value) return null;
  return scripts.value[selectedScriptId.value] || null;
});

const isDirty = computed(() => {
  if (!selectedScript.value) return false;
  return draftCode.value !== selectedScript.value.code;
});

const cdpScriptsCount = computed(() => {
  return scriptList.value.filter(
    (s) =>
      (s.metadata?.cdp && s.metadata.cdp.length > 0) ||
      (s.metadata?.cdpDomains && s.metadata.cdpDomains.length > 0) ||
      (s.metadata?.grants && s.metadata.grants.includes('GM_cdp'))
  ).length;
});

const filteredScripts = computed(() => {
  return scriptList.value.filter((script) => {
    if (activeFilter.value === 'enabled' && !script.enabled) return false;
    if (activeFilter.value === 'disabled' && script.enabled) return false;
    if (activeFilter.value === 'cdp') {
      const hasCdp =
        (script.metadata?.cdp && script.metadata.cdp.length > 0) ||
        (script.metadata?.cdpDomains && script.metadata.cdpDomains.length > 0) ||
        (script.metadata?.grants && script.metadata.grants.includes('GM_cdp'));
      if (!hasCdp) return false;
    }

    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim();
      const matchName = script.name.toLowerCase().includes(q);
      const matchDesc = (script.metadata?.description || '').toLowerCase().includes(q);
      const matchCode = script.code.toLowerCase().includes(q);
      const matchPattern = (script.metadata?.matches || []).some((m) =>
        m.toLowerCase().includes(q)
      );
      if (!matchName && !matchDesc && !matchCode && !matchPattern) return false;
    }

    return true;
  });
});

// Selection & Navigation
function handleSelectScript(id: string) {
  if (id === selectedScriptId.value) return;
  if (isDirty.value) {
    pendingSwitchId.value = id;
    showDiscardConfirm.value = true;
    return;
  }
  selectScript(id);
}

function selectScript(id: string) {
  selectedScriptId.value = id;
  const script = scripts.value[id];
  draftCode.value = script ? script.code : '';
}

function confirmDiscardAndSwitch() {
  showDiscardConfirm.value = false;
  if (pendingSwitchId.value) {
    selectScript(pendingSwitchId.value);
    pendingSwitchId.value = null;
  }
}

function cancelDiscard() {
  showDiscardConfirm.value = false;
  pendingSwitchId.value = null;
}

// CRUD Operations
async function handleCreateNewScript() {
  if (isDirty.value) {
    const shouldProceed = window.confirm(
      'You have unsaved changes. Discard and create new script?'
    );
    if (!shouldProceed) return;
  }

  const defaultNewTemplate = `// ==UserScript==
// @name         New Userscript
// @namespace    https://xokj.dev/scripts
// @version      1.0.0
// @description  A new userscript with CDP capabilities
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_cdp
// @cdp          Network.enable
// ==/UserScript==

(function() {
  'use strict';
  console.log('[XOKJ] Script running on', window.location.href);

  if (typeof cdp !== 'undefined') {
    cdp.on('Network.requestWillBeSent', (params) => {
      console.log('[CDP Request]', params.request.url);
    });
  }
})();`;

  const created = await saveScript({
    code: defaultNewTemplate,
    enabled: true
  });

  scripts.value[created.id] = created;
  selectScript(created.id);
  showToast(`Created new script "${created.name}"`);
}

async function handleSaveScript() {
  if (!selectedScript.value || !isDirty.value) return;

  const saved = await saveScript({
    id: selectedScript.value.id,
    code: draftCode.value,
    enabled: selectedScript.value.enabled
  });

  scripts.value[saved.id] = saved;
  draftCode.value = saved.code;
  showToast(`Saved "${saved.name}"`);
}

function handleRevertChanges() {
  if (!selectedScript.value || !isDirty.value) return;
  draftCode.value = selectedScript.value.code;
  showToast('Reverted unsaved changes', 'info');
}

async function confirmDeleteScript() {
  showDeleteConfirm.value = false;
  if (!selectedScript.value) return;

  const id = selectedScript.value.id;
  const name = selectedScript.value.name;
  await deleteScript(id);
  delete scripts.value[id];

  const remaining = Object.keys(scripts.value);
  if (remaining.length > 0) {
    selectScript(remaining[0]);
  } else {
    selectedScriptId.value = null;
    draftCode.value = '';
  }
  showToast(`Deleted "${name}"`, 'info');
}

async function handleToggleScript(id: string) {
  const newStatus = await toggleScript(id);
  if (scripts.value[id]) {
    scripts.value[id].enabled = newStatus;
  }
}

async function handleToggleCurrentScript() {
  if (!selectedScript.value) return;
  await handleToggleScript(selectedScript.value.id);
}

// Import / Export / Reset
async function handleExportAll() {
  const jsonStr = await exportScripts();
  downloadJson(jsonStr, `xokj-scripts-${new Date().toISOString().slice(0, 10)}.json`);
  showToast('Exported all scripts');
}

async function handleExportSingle() {
  if (!selectedScript.value) return;
  const jsonStr = await exportScripts([selectedScript.value.id]);
  const safeName = selectedScript.value.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  downloadJson(jsonStr, `${safeName}.json`);
  showToast(`Exported "${selectedScript.value.name}"`);
}

function downloadJson(content: string, filename: string) {
  if (typeof Blob === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function handleImportClick() {
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
    fileInputRef.value.click();
  }
}

async function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files || input.files.length === 0) return;

  const file = input.files[0];
  const reader = new FileReader();

  reader.onload = async () => {
    try {
      const content = reader.result as string;
      const res = await importScripts(content, { overwrite: false, autoEnable: true });

      if (res.errors && res.errors.length > 0 && res.imported === 0 && res.updated === 0) {
        showToast(`Import failed: ${res.errors[0]}`, 'error');
        return;
      }

      // Refresh scripts
      scripts.value = await getScripts();
      if (res.scripts && res.scripts.length > 0) {
        selectScript(res.scripts[0].id);
      }
      showToast(`Imported ${res.imported} script(s), updated ${res.updated}`);
    } catch (err: any) {
      showToast(`Import error: ${err.message || String(err)}`, 'error');
    }
  };

  reader.readAsText(file);
}

async function confirmResetDefaults() {
  showResetConfirm.value = false;
  const defaults = await resetToDefaultScripts();
  scripts.value = defaults;
  if (defaults['sample-cdp-logger']) {
    selectScript('sample-cdp-logger');
  } else {
    const keys = Object.keys(defaults);
    if (keys.length > 0) selectScript(keys[0]);
  }
  showToast('Reset scripts to defaults');
}

// Lifecycle
onMounted(async () => {
  scripts.value = await getScripts();
  const keys = Object.keys(scripts.value);
  if (keys.length > 0) {
    selectScript(keys[0]);
  }

  unsubscribeStorage = onScriptsChanged((updated) => {
    scripts.value = updated;
    if (selectedScriptId.value && updated[selectedScriptId.value]) {
      if (!isDirty.value) {
        draftCode.value = updated[selectedScriptId.value].code;
      }
    } else if (selectedScriptId.value && !updated[selectedScriptId.value]) {
      const rem = Object.keys(updated);
      if (rem.length > 0) selectScript(rem[0]);
      else {
        selectedScriptId.value = null;
        draftCode.value = '';
      }
    }
  });
});

onBeforeUnmount(() => {
  if (unsubscribeStorage) {
    unsubscribeStorage();
    unsubscribeStorage = null;
  }
});
</script>

<style>
/* Base styling */
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background-color: #121215;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #f4f4f5;
  overflow: hidden;
}
</style>

<style scoped>
.dashboard-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #121215;
}

.dashboard-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sidebar-pane {
  width: 320px;
  flex-shrink: 0;
  height: 100%;
}

.detail-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #18181b;
  overflow: hidden;
}

.editor-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
  background-color: #1e1e24;
  border-bottom: 1px solid #272733;
}

.script-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.script-name {
  font-size: 14px;
  font-weight: 700;
  color: #f4f4f5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dirty-badge {
  font-size: 11px;
  color: #f59e0b;
  font-weight: 600;
}

.status-pill {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
}

.status-pill.enabled {
  background-color: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.status-pill.disabled {
  background-color: rgba(113, 113, 122, 0.15);
  color: #a1a1aa;
  border: 1px solid rgba(113, 113, 122, 0.3);
}

.editor-action-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn {
  padding: 5px 12px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-primary {
  background-color: #6366f1;
  color: #ffffff;
}

.btn-primary:hover:not(:disabled) {
  background-color: #4f46e5;
}

.btn-secondary {
  background-color: #272733;
  color: #e4e4e7;
  border-color: #363645;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #323242;
}

.btn-outline {
  background: transparent;
  border-color: #363645;
  color: #d4d4d8;
}

.btn-outline:hover:not(:disabled) {
  background-color: #272733;
  color: #ffffff;
}

.btn-danger {
  background-color: rgba(239, 68, 68, 0.15);
  border-color: #ef4444;
  color: #f87171;
}

.btn-danger:hover:not(:disabled) {
  background-color: #ef4444;
  color: #ffffff;
}

.editor-viewport {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.empty-detail-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #71717a;
  text-align: center;
  padding: 40px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-detail-state h3 {
  font-size: 16px;
  color: #f4f4f5;
  margin: 0 0 8px 0;
}

.empty-detail-state p {
  font-size: 13px;
  max-width: 320px;
  margin: 0 0 18px 0;
  line-height: 1.5;
}
</style>
