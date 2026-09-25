<template>
  <div class="codemirror-wrapper" ref="editorContainer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    readonly?: boolean;
  }>(),
  {
    readonly: false
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'change', value: string): void;
  (e: 'save'): void;
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
.codemirror-wrapper {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}
</style>
