<template>
  <div class="dashboard-root">
    <DashboardHeader
      :scripts-count="scriptList.length"
      :cdp-scripts-count="cdpScriptsCount"
      @new-script="handleCreateNewScript"
      @import-scripts="importExportRef?.triggerFileInput()"
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
          @create="handleCreateNewScript"
        />
      </aside>

      <section class="detail-pane">
        <template v-if="selectedScript">
          <MetadataPanel
            :metadata="selectedScript.metadata"
            :parse-errors="selectedScript.parseErrors"
          />

          <ScriptEditor
            :script="selectedScript"
            :is-dirty="isDirty"
            v-model="draftCode"
            @save="handleSaveScript"
            @revert="handleRevertChanges"
            @toggle="handleToggleCurrentScript"
            @export="handleExportSingle"
            @delete="showDeleteConfirm = true"
          />
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

    <ImportExportModal
      ref="importExportRef"
      v-model="showImportExportModal"
      :scripts="scripts"
      :selected-script-id="selectedScriptId"
      @imported="handleImportSuccess"
      @toast="showToast($event.message, $event.type)"
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
import { ref } from 'vue';
import DashboardHeader from './components/DashboardHeader.vue';
import ScriptList from './components/ScriptList.vue';
import ScriptEditor from './components/ScriptEditor.vue';
import MetadataPanel from './components/MetadataPanel.vue';
import ImportExportModal from './components/ImportExportModal.vue';
import ConfirmModal from './components/ConfirmModal.vue';
import ToastNotification from './components/ToastNotification.vue';
import { useDashboardState } from './composables/useDashboardState';

const importExportRef = ref<InstanceType<typeof ImportExportModal> | null>(null);

const {
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
} = useDashboardState();
</script>

<style>
/* Global html, body, scrollbar styles */
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background-color: #0b0d14;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #f1f5f9;
  overflow: hidden;
}
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 9999px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }
</style>

<style scoped>
/* Scoped layout styles for root grid & empty state */
.dashboard-root { display: flex; flex-direction: column; height: 100vh; background-color: #0b0d14; }
.dashboard-body { display: flex; flex: 1; overflow: hidden; }
.sidebar-pane { width: 320px; flex-shrink: 0; height: 100%; }
.detail-pane { flex: 1; display: flex; flex-direction: column; height: 100%; background-color: #141722; overflow: hidden; }
.empty-detail-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #64748b; text-align: center; padding: 40px; }
.empty-icon-box { width: 64px; height: 64px; border-radius: 16px; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.25); color: #818cf8; display: flex; align-items: center; justify-content: center; font-size: 28px; margin-bottom: 16px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); animation: float-box 3s ease-in-out infinite; }
.empty-detail-state h3 { font-size: 16px; color: #f1f5f9; margin: 0 0 8px 0; }
.empty-detail-state p { font-size: 13px; max-width: 340px; color: #94a3b8; margin: 0 0 20px 0; line-height: 1.5; }
.create-script-btn { padding: 8px 16px; font-size: 12px; }
@keyframes float-box { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
</style>
