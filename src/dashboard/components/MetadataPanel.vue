<template>
  <div class="metadata-panel-container">
    <ScriptMetadataInspector
      :metadata="metadata"
      :parse-errors="parseErrors"
    />
  </div>
</template>

<script setup lang="ts">
import type { ParsedMetadata } from '@/shared/types';
import ScriptMetadataInspector from './ScriptMetadataInspector.vue';

defineOptions({
  name: 'MetadataPanel'
});

defineProps<{
  metadata?: ParsedMetadata;
  parseErrors?: string[];
  editable?: boolean;
}>();
</script>

<style scoped>
.metadata-panel-container {
  width: 100%;
}
</style>
