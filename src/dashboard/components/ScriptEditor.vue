<template>
  <div class="script-editor-container" :class="{ 'with-header': !!script }">
    <!-- Header Action Toolbar (rendered only when script prop is provided) -->
    <div v-if="script" class="editor-header-bar">
      <div class="script-title-area">
        <span class="script-name">{{ script.name }}</span>
        <span v-if="isDirty" class="dirty-badge" title="Unsaved changes">
          <span class="dirty-dot"></span>
          <span>Unsaved</span>
        </span>
        <span class="status-pill" :class="script.enabled ? 'enabled' : 'disabled'">
          <i :class="script.enabled ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'" class="status-icon"></i>
          <span>{{ script.enabled ? 'Enabled' : 'Disabled' }}</span>
        </span>
      </div>

      <div class="editor-action-buttons">
        <button
          class="btn btn-secondary revert-btn"
          :disabled="!isDirty"
          @click="$emit('revert')"
          title="Discard editor changes"
        >
          <i class="fa-solid fa-rotate-left btn-icon"></i>
          <span>Revert</span>
        </button>
        <button
          class="btn btn-primary save-btn"
          :disabled="!isDirty"
          @click="$emit('save')"
          title="Save changes (Ctrl+S / Cmd+S)"
        >
          <i class="fa-solid fa-floppy-disk btn-icon"></i>
          <span>Save</span>
        </button>
        <button
          class="btn btn-outline toggle-current-btn"
          @click="$emit('toggle')"
          :title="script.enabled ? 'Disable Script' : 'Enable Script'"
        >
          <i class="fa-solid fa-power-off btn-icon"></i>
          <span>{{ script.enabled ? 'Disable' : 'Enable' }}</span>
        </button>
        <button
          class="btn btn-outline export-single-btn"
          @click="$emit('export')"
          title="Export this script to JSON"
        >
          <i class="fa-solid fa-file-export btn-icon"></i>
          <span>Export</span>
        </button>
        <button
          class="btn btn-danger delete-btn"
          @click="$emit('delete')"
          title="Delete this script"
        >
          <i class="fa-solid fa-trash-can btn-icon"></i>
          <span>Delete</span>
        </button>
      </div>
    </div>

    <!-- CodeMirror 6 Editor Viewport -->
    <div class="editor-viewport">
      <div class="codemirror-wrapper" ref="editorContainer"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import type { ScriptRecord } from '@/shared/types';

defineOptions({
  name: 'ScriptEditor'
});

interface ScriptEditorProps {
  modelValue: string;
  readonly?: boolean;
  script?: ScriptRecord | null;
  isDirty?: boolean;
}

const props = withDefaults(defineProps<ScriptEditorProps>(), {
  readonly: false,
  script: null,
  isDirty: false
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'change', value: string): void;
  (e: 'save'): void;
  (e: 'revert'): void;
  (e: 'toggle'): void;
  (e: 'export'): void;
  (e: 'delete'): void;
}>();

const editorContainer = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
const readonlyCompartment = new Compartment();

const saveKeymap = keymap.of([
  {
    key: 'Mod-s',
    run: () => {
      emit('save');
      return true;
    }
  }
]);

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: '#18181b',
    color: '#f4f4f5',
    fontSize: '13px'
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, Consolas, monospace',
    lineHeight: '1.6'
  },
  '.cm-gutters': {
    backgroundColor: '#121215',
    color: '#71717a',
    borderRight: '1px solid #27272a'
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#27272a',
    color: '#e4e4e7'
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.03)'
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: '#3b82f640 !important'
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: '#38bdf8'
  }
});

const updateListener = EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    const val = update.state.doc.toString();
    emit('update:modelValue', val);
    emit('change', val);
  }
});

onMounted(() => {
  if (!editorContainer.value) return;

  const state = EditorState.create({
    doc: props.modelValue || '',
    extensions: [
      basicSetup,
      javascript(),
      oneDark,
      editorTheme,
      saveKeymap,
      updateListener,
      readonlyCompartment.of(EditorState.readOnly.of(props.readonly))
    ]
  });

  view = new EditorView({
    state,
    parent: editorContainer.value
  });
});

watch(
  () => props.modelValue,
  (newVal) => {
    if (!view) return;
    const currentVal = view.state.doc.toString();
    if (newVal !== currentVal) {
      view.dispatch({
        changes: { from: 0, to: currentVal.length, insert: newVal ?? '' }
      });
    }
  }
);

watch(
  () => props.readonly,
  (newReadOnly) => {
    if (!view) return;
    view.dispatch({
      effects: readonlyCompartment.reconfigure(EditorState.readOnly.of(newReadOnly))
    });
  }
);

onBeforeUnmount(() => {
  if (view) {
    view.destroy();
    view = null;
  }
});
</script>

<style scoped>
.script-editor-container {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

/* Editor Header Toolbar Styles */
.editor-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background-color: #12141c;
  border-bottom: 1px solid #1e2230;
  flex-shrink: 0;
  gap: 16px;
}

.script-title-area {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.script-name {
  font-size: 15px;
  font-weight: 600;
  color: #f1f5f9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

.dirty-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 9999px;
  background-color: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #fbbf24;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #f59e0b;
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.8);
  }
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 500;
}

.status-pill.enabled {
  background-color: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.25);
  color: #34d399;
}

.status-pill.disabled {
  background-color: rgba(100, 116, 139, 0.12);
  border: 1px solid rgba(100, 116, 139, 0.25);
  color: #94a3b8;
}

.status-icon {
  font-size: 10px;
}

.editor-action-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-primary {
  background-color: #4f46e5;
  color: #ffffff;
}

.btn-primary:hover:not(:disabled) {
  background-color: #4338ca;
}

.btn-secondary {
  background-color: #262a36;
  color: #cbd5e1;
  border: 1px solid #333846;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #2f3444;
  color: #f1f5f9;
}

.btn-outline {
  background-color: transparent;
  color: #94a3b8;
  border: 1px solid #2a2f3f;
}

.btn-outline:hover:not(:disabled) {
  background-color: #1e2230;
  color: #e2e8f0;
  border-color: #3a4256;
}

.btn-danger {
  background-color: rgba(239, 68, 68, 0.12);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.25);
}

.btn-danger:hover:not(:disabled) {
  background-color: rgba(239, 68, 68, 0.22);
  border-color: rgba(239, 68, 68, 0.4);
  color: #fca5a5;
}

.btn-icon {
  font-size: 11px;
}

.editor-viewport {
  flex: 1;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.codemirror-wrapper {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}
</style>
