import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { ScriptRecord } from '@/shared/types';
import {
  getScripts,
  saveScript,
  deleteScript,
  toggleScript,
  resetToDefaultScripts,
  exportScripts,
  onScriptsChanged
} from '@/shared/storage';

export function useDashboardState() {
  const scripts = ref<Record<string, ScriptRecord>>({});
  const selectedScriptId = ref<string | null>(null);
  const draftCode = ref<string>('');
  const searchQuery = ref<string>('');
  const activeFilter = ref<'all' | 'enabled' | 'disabled' | 'cdp'>('all');

  const showDeleteConfirm = ref(false);
  const showResetConfirm = ref(false);
  const showDiscardConfirm = ref(false);
  const showImportExportModal = ref(false);
  const pendingSwitchId = ref<string | null>(null);
  const toast = ref<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  let unsubscribeStorage: (() => void) | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function showToast(message: string, type: 'success' | 'info' | 'error' = 'success') {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    toast.value = { message, type };
    toastTimer = setTimeout(() => {
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
    const unbind = cdp.on('Network.requestWillBeSent', (params) => {
      console.log('[CDP Request]', params.request ? params.request.url : params);
    });

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', () => {
        unbind();
      }, { once: true });
    }
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

  async function handleImportSuccess(payload?: { count?: number; selectedId?: string }) {
    scripts.value = await getScripts();
    if (payload?.selectedId) {
      selectScript(payload.selectedId);
    } else {
      const keys = Object.keys(scripts.value);
      if (keys.length > 0 && !selectedScriptId.value) {
        selectScript(keys[0]);
      }
    }
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
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  });

  return {
    scripts,
    selectedScriptId,
    draftCode,
    searchQuery,
    activeFilter,
    showDeleteConfirm,
    showResetConfirm,
    showDiscardConfirm,
    showImportExportModal,
    toast,
    scriptList,
    selectedScript,
    isDirty,
    cdpScriptsCount,
    filteredScripts,
    showToast,
    selectScript,
    handleSelectScript,
    confirmDiscardAndSwitch,
    cancelDiscard,
    handleCreateNewScript,
    handleSaveScript,
    handleRevertChanges,
    confirmDeleteScript,
    handleToggleScript,
    handleToggleCurrentScript,
    handleExportAll,
    handleExportSingle,
    confirmResetDefaults,
    handleImportSuccess
  };
}
