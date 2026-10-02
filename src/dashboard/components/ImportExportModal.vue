<template>
  <div class="import-export-wrapper">
    <!-- Unconditionally rendered hidden file input for automated tests & programmatic triggers -->
    <input
      type="file"
      ref="fileInputRef"
      style="display: none"
      accept=".json,.js,.user.js"
      @change="onFileSelected"
    />

    <!-- Interactive Import/Export Modal Dialog -->
    <div v-if="modelValue" class="modal-backdrop" @click.self="closeModal">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title-row">
            <i class="fa-solid fa-file-arrow-up modal-header-icon"></i>
            <h3 class="modal-title">Import & Export Scripts</h3>
          </div>
          <button class="modal-close-btn" @click="closeModal" title="Close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="modal-body">
          <section class="modal-section">
            <h4 class="section-title">Import Scripts</h4>
            <p class="section-desc">
              Import a JSON bundle or a raw <code>.user.js</code> userscript file. Existing scripts will not be overwritten by default.
            </p>
            <div class="import-dropzone" @click="triggerFileInput">
              <i class="fa-solid fa-cloud-arrow-up dropzone-icon"></i>
              <span class="dropzone-text">Click to browse or drop file here</span>
              <span class="dropzone-hint">Supports .json, .js, .user.js</span>
            </div>
          </section>

          <section class="modal-section export-section">
            <h4 class="section-title">Export Scripts</h4>
            <p class="section-desc">
              Export installed scripts as a portable JSON backup.
            </p>
            <div class="export-actions">
              <button class="btn btn-secondary" @click="exportAll">
                <i class="fa-solid fa-download btn-icon"></i>
                <span>Export All Scripts ({{ Object.keys(scripts || {}).length }})</span>
              </button>
              <button
                v-if="selectedScriptId && scripts && scripts[selectedScriptId]"
                class="btn btn-outline"
                @click="exportSingle(selectedScriptId)"
              >
                <i class="fa-solid fa-file-export btn-icon"></i>
                <span>Export "{{ scripts[selectedScriptId]?.name }}"</span>
              </button>
            </div>
          </section>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" @click="closeModal">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { ScriptRecord } from '@/shared/types';
import { importScripts, exportScripts } from '@/shared/storage';

defineOptions({
  name: 'ImportExportModal'
});

const props = withDefaults(
  defineProps<{
    modelValue?: boolean;
    scripts?: Record<string, ScriptRecord>;
    selectedScriptId?: string | null;
  }>(),
  {
    modelValue: false,
    scripts: () => ({}),
    selectedScriptId: null
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'imported', payload: { count: number; selectedId?: string }): void;
  (e: 'toast', payload: { message: string; type: 'success' | 'info' | 'error' }): void;
}>();

const fileInputRef = ref<HTMLInputElement | null>(null);

function triggerFileInput() {
  if (fileInputRef.value) {
    fileInputRef.value.value = '';
    fileInputRef.value.click();
  }
}

function closeModal() {
  emit('update:modelValue', false);
}

function openModal() {
  emit('update:modelValue', true);
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

async function exportAll() {
  try {
    const jsonStr = await exportScripts();
    downloadJson(jsonStr, `xokj-scripts-${new Date().toISOString().slice(0, 10)}.json`);
    emit('toast', { message: 'Exported all scripts', type: 'success' });
  } catch (err: any) {
    emit('toast', { message: `Export error: ${err.message || String(err)}`, type: 'error' });
  }
}

async function exportSingle(id?: string) {
  const targetId = id || props.selectedScriptId;
  if (!targetId || !props.scripts || !props.scripts[targetId]) return;
  const script = props.scripts[targetId];
  try {
    const jsonStr = await exportScripts([targetId]);
    const safeName = script.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadJson(jsonStr, `${safeName}.json`);
    emit('toast', { message: `Exported "${script.name}"`, type: 'success' });
  } catch (err: any) {
    emit('toast', { message: `Export error: ${err.message || String(err)}`, type: 'error' });
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
        emit('toast', { message: `Import failed: ${res.errors[0]}`, type: 'error' });
        return;
      }

      const selectedId = res.scripts && res.scripts.length > 0 ? res.scripts[0].id : undefined;
      emit('imported', { count: res.imported, selectedId });
      emit('toast', {
        message: `Imported ${res.imported} script(s), updated ${res.updated}`,
        type: 'success'
      });
      if (props.modelValue) {
        closeModal();
      }
    } catch (err: any) {
      emit('toast', {
        message: `Import error: ${err.message || String(err)}`,
        type: 'error'
      });
    }
  };

  reader.readAsText(file);
}

defineExpose({
  triggerFileInput,
  openModal,
  closeModal,
  exportAll,
  exportSingle
});
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.15s ease-out;
}

.modal-dialog {
  background-color: #161822;
  border: 1px solid #232736;
  border-radius: 12px;
  width: 90%;
  max-width: 520px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.15s ease-out;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #1e2230;
  background-color: #12141c;
}

.modal-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.modal-header-icon {
  font-size: 16px;
  color: #818cf8;
}

.modal-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #f1f5f9;
}

.modal-close-btn {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 14px;
  border-radius: 4px;
  transition: color 0.15s;
}

.modal-close-btn:hover {
  color: #cbd5e1;
}

.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.modal-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #e2e8f0;
}

.section-desc {
  margin: 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}

.import-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  border: 2px dashed #2a2f42;
  border-radius: 8px;
  background-color: #12141d;
  cursor: pointer;
  transition: all 0.15s ease;
}

.import-dropzone:hover {
  border-color: #6366f1;
  background-color: #171a27;
}

.dropzone-icon {
  font-size: 28px;
  color: #6366f1;
}

.dropzone-text {
  font-size: 13px;
  font-weight: 500;
  color: #f1f5f9;
}

.dropzone-hint {
  font-size: 11px;
  color: #64748b;
}

.export-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid #1e2230;
  background-color: #12141c;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-secondary {
  background-color: #262a36;
  color: #cbd5e1;
  border: 1px solid #333846;
}

.btn-secondary:hover {
  background-color: #2f3444;
  color: #f1f5f9;
}

.btn-outline {
  background-color: transparent;
  color: #94a3b8;
  border: 1px solid #2a2f3f;
}

.btn-outline:hover {
  background-color: #1e2230;
  color: #e2e8f0;
}

.btn-icon {
  font-size: 11px;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
</style>
