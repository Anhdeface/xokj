<template>
  <div class="dashboard-root">
    <DashboardHeader
      :scripts-count="scriptList.length"
      :cdp-scripts-count="cdpScriptsCount"
      @new-script="handleCreateNewScript"
      @import-scripts="handleImportClick"
      @export-all="handleExportAll"
      @reset-defaults="showResetConfirm = true"
    />

    <main class="dashboard-body">
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

      <section class="detail-pane">
        <template v-if="selectedScript">
          <div class="editor-header-bar">
            <div class="script-title-area">
              <span class="script-name">{{ selectedScript.name }}</span>
              <span v-if="isDirty" class="dirty-badge" title="Unsaved changes">
                <span class="dirty-dot"></span>
                <span>Unsaved</span>
              </span>
              <span class="status-pill" :class="selectedScript.enabled ? 'enabled' : 'disabled'">
                <i :class="selectedScript.enabled ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'" class="status-icon"></i>
                <span>{{ selectedScript.enabled ? 'Enabled' : 'Disabled' }}</span>
              </span>
            </div>

            <div class="editor-action-buttons">
              <button
                class="btn btn-secondary revert-btn"
                :disabled="!isDirty"
                @click="handleRevertChanges"
                title="Discard editor changes"
              >
                <i class="fa-solid fa-rotate-left btn-icon"></i>
                <span>Revert</span>
              </button>
              <button
                class="btn btn-primary save-btn"
                :disabled="!isDirty"
                @click="handleSaveScript"
                title="Save changes (Ctrl+S / Cmd+S)"
              >
                <i class="fa-solid fa-floppy-disk btn-icon"></i>
                <span>Save</span>
              </button>
              <button
                class="btn btn-outline toggle-current-btn"
                @click="handleToggleCurrentScript"
                :title="selectedScript.enabled ? 'Disable Script' : 'Enable Script'"
              >
                <i class="fa-solid fa-power-off btn-icon"></i>
                <span>{{ selectedScript.enabled ? 'Disable' : 'Enable' }}</span>
              </button>
              <button
                class="btn btn-outline export-single-btn"
                @click="handleExportSingle"
                title="Export this script to JSON"
              >
                <i class="fa-solid fa-file-export btn-icon"></i>
                <span>Export</span>
              </button>
              <button
                class="btn btn-danger delete-btn"
                @click="showDeleteConfirm = true"
                title="Delete this script"
              >
                <i class="fa-solid fa-trash-can btn-icon"></i>
                <span>Delete</span>
              </button>
            </div>
          </div>

          <ScriptMetadataInspector
            :metadata="selectedScript.metadata"
            :parse-errors="selectedScript.parseErrors"
          />

          <div class="editor-viewport">
            <ScriptEditor
              v-model="draftCode"
              @save="handleSaveScript"
            />
          </div>
        </template>

        <div v-else class="empty-detail-state">
          <div class="empty-icon-box">
            <i class="fa-solid fa-file-code"></i>
          </div>
          <h3>No Script Selected</h3>
          <p>Choose a script from the sidebar to inspect metadata and edit code, or create a new one.</p>
          <button class="btn btn-primary create-script-btn" @click="handleCreateNewScript">
            <i class="fa-solid fa-plus btn-icon"></i>
            <span>Create New Script</span>
          </button>
        </div>
      </section>
    </main>

    <input
      type="file"
      ref="fileInputRef"
      style="display: none"
      accept=".json,.js,.user.js"
      @change="onFileSelected"
    />

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

const scripts = ref<Record<string, ScriptRecord>>({});
const selectedScriptId = ref<string | null>(null);
const draftCode = ref<string>('');
const searchQuery = ref<string>('');
const activeFilter = ref<'all' | 'enabled' | 'disabled' | 'cdp'>('all');

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
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background-color: #0b0d14;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #f1f5f9;
  overflow: hidden;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 9999px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}
</style>

<style scoped>
.dashboard-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: #0b0d14;
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
  background-color: #141722;
  overflow: hidden;
}

.editor-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 20px;
  background: linear-gradient(180deg, #181b26 0%, #141722 100%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.script-title-area {
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
}

.script-name {
  font-size: 14px;
  font-weight: 700;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.2px;
}

.dirty-badge {
  font-size: 11px;
  color: #fbbf24;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.35);
  padding: 2px 7px;
  border-radius: 9999px;
}
.dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #f59e0b;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.8);
  animation: pulse-dot 1.5s infinite ease-in-out;
}

.status-pill {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.status-icon {
  font-size: 9px;
}

.status-pill.enabled {
  background-color: rgba(16, 185, 129, 0.12);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.35);
}

.status-pill.disabled {
  background-color: rgba(100, 116, 139, 0.12);
  color: #94a3b8;
  border: 1px solid rgba(100, 116, 139, 0.3);
}

.editor-action-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn:active:not(:disabled) {
  transform: scale(0.97);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 11px;
}

.btn-primary {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
}

.btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.45);
}

.btn-secondary {
  background-color: rgba(255, 255, 255, 0.05);
  color: #e2e8f0;
  border-color: rgba(255, 255, 255, 0.1);
}

.btn-secondary:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.1);
  color: #ffffff;
  transform: translateY(-1px);
}

.btn-outline {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.12);
  color: #cbd5e1;
}

.btn-outline:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.2);
  color: #ffffff;
  transform: translateY(-1px);
}

.btn-danger {
  background-color: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.4);
  color: #f87171;
}

.btn-danger:hover:not(:disabled) {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: #ffffff;
  border-color: transparent;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
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
  color: #64748b;
  text-align: center;
  padding: 40px;
}

.empty-icon-box {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.25);
  color: #818cf8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  margin-bottom: 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  animation: float-box 3s ease-in-out infinite;
}

.empty-detail-state h3 {
  font-size: 16px;
  color: #f1f5f9;
  margin: 0 0 8px 0;
  letter-spacing: 0.2px;
}

.empty-detail-state p {
  font-size: 13px;
  max-width: 340px;
  color: #94a3b8;
  margin: 0 0 20px 0;
  line-height: 1.5;
}

.create-script-btn {
  padding: 8px 16px;
  font-size: 12px;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}

@keyframes float-box {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}
</style>
