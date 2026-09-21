<template>
  <div class="tab-context-bar">
    <div class="tab-host" :title="url">
      <img
        v-if="favIconUrl && !imgError"
        :src="favIconUrl"
        alt=""
        class="favicon"
        @error="handleFaviconError"
      />
      <span v-else class="globe-icon">🌐</span>
      <span class="hostname">{{ hostname || 'No active tab' }}</span>
    </div>
    <div class="tab-meta">
      <span class="match-count-badge">
        {{ matchingCount }} {{ matchingCount === 1 ? 'script' : 'scripts' }}
      </span>
      <button
        class="reload-tab-btn"
        title="Reload tab to apply userscript changes"
        @click="$emit('reloadTab')"
      >
        ↻
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  url: string;
  hostname: string;
  favIconUrl?: string;
  matchingCount: number;
}>();

defineEmits<{
  (e: 'reloadTab'): void;
}>();

const imgError = ref(false);
function handleFaviconError() {
  imgError.value = true;
}
</script>

<style scoped>
.tab-context-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background-color: #141418;
  border-bottom: 1px solid #23232b;
  font-size: 11px;
}
.tab-host {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  max-width: 220px;
}
.favicon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border-radius: 2px;
}
.globe-icon {
  font-size: 12px;
}
.hostname {
  color: #a1a1aa;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tab-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.match-count-badge {
  background-color: #272733;
  color: #cbd5e1;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
}
.reload-tab-btn {
  background: none;
  border: 1px solid #333342;
  color: #a1a1aa;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}
.reload-tab-btn:hover {
  border-color: #6366f1;
  color: #ffffff;
  background-color: #272733;
}
</style>
