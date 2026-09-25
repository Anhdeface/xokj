<template>
  <header class="header-bar">
    <div class="brand">
      <div class="logo-icon">
        <i class="fa-solid fa-bolt"></i>
      </div>
      <span class="title">XOKJ</span>
    </div>

    <!-- Active Tab Context Pill -->
    <div
      v-if="!isRestricted && (hostname || url)"
      class="tab-context-bar"
      :title="url"
    >
      <div class="tab-host">
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

      <button
        class="reload-tab-btn"
        title="Reload tab to apply userscript changes"
        @click="$emit('reloadTab')"
      >
        <i class="fa-solid fa-rotate-right"></i>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineProps<{
  url?: string;
  hostname?: string;
  favIconUrl?: string;
  isRestricted?: boolean;
  matchingCount?: number;
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
.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: linear-gradient(180deg, #161822 0%, #10121a 100%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  min-height: 26px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.logo-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.35);
  transition: transform 0.2s ease;
}
.logo-icon:hover {
  transform: rotate(8deg) scale(1.08);
}

.title {
  font-size: 13px;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: 0.5px;
  line-height: 1;
}

/* Elegant capsule pill for active tab domain */
.tab-context-bar {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9999px;
  padding: 3px 4px 3px 10px;
  max-width: 200px;
  height: 26px;
  box-sizing: border-box;
  backdrop-filter: blur(8px);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.tab-context-bar:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.18);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.tab-host {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  min-width: 0;
}

.favicon {
  width: 13px;
  height: 13px;
  border-radius: 3px;
  flex-shrink: 0;
}

.globe-icon {
  font-size: 10px;
  color: #64748b;
  flex-shrink: 0;
}

.hostname {
  color: #e2e8f0;
  font-weight: 500;
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 130px;
  line-height: normal;
  letter-spacing: 0.15px;
}

.reload-tab-btn {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 9px;
  padding: 0;
  flex-shrink: 0;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.reload-tab-btn:hover {
  background: rgba(99, 102, 241, 0.25);
  border-color: rgba(99, 102, 241, 0.5);
  color: #ffffff;
  transform: rotate(90deg);
}

.reload-tab-btn:active {
  transform: rotate(180deg) scale(0.92);
}
</style>
