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
      <i v-else class="fa-solid fa-globe globe-icon"></i>
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
        <i class="fa-solid fa-rotate-right"></i>
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
  padding: 5px 12px;
  background-color: #0e1017;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
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
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  border-radius: 3px;
}
.globe-icon {
  font-size: 10px;
  color: #64748b;
}
.hostname {
  color: #94a3b8;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
}
.tab-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.match-count-badge {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  padding: 1px 6px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 500;
}
.reload-tab-btn {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 9px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.reload-tab-btn:hover {
  border-color: rgba(99, 102, 241, 0.6);
  color: #ffffff;
  background-color: rgba(99, 102, 241, 0.18);
  transform: rotate(45deg);
}
.reload-tab-btn:active {
  transform: rotate(180deg) scale(0.92);
}
</style>
