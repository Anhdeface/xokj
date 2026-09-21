<template>
  <div class="script-list-container">
    <!-- Filter Tabs -->
    <div class="filter-tabs">
      <button
        class="tab-btn"
        :class="{ active: activeFilter === 'all' }"
        @click="$emit('update:activeFilter', 'all')"
      >
        All <span class="tab-count">({{ totalCount }})</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeFilter === 'enabled' }"
        @click="$emit('update:activeFilter', 'enabled')"
      >
        Enabled
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeFilter === 'disabled' }"
        @click="$emit('update:activeFilter', 'disabled')"
      >
        Disabled
      </button>
      <button
        class="tab-btn cdp-tab-btn"
        :class="{ active: activeFilter === 'cdp' }"
        @click="$emit('update:activeFilter', 'cdp')"
      >
        ⚡ CDP
      </button>
    </div>

    <!-- Search Box -->
    <div class="search-box">
      <span class="search-icon">🔍</span>
      <input
        type="text"
        class="search-input"
        placeholder="Filter scripts..."
        :value="searchQuery"
        @input="$emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
      />
      <button
        v-if="searchQuery"
        class="clear-search-btn"
        @click="$emit('update:searchQuery', '')"
      >
        ✕
      </button>
    </div>

    <!-- Script Items Scroll -->
    <div class="script-items-scroll">
      <div v-if="scripts.length === 0" class="empty-list-notice">
        <span class="notice-icon">🔍</span>
        <span class="notice-text">No matching scripts</span>
      </div>

      <ScriptListItem
        v-for="script in scripts"
        :key="script.id"
        :script="script"
        :is-selected="script.id === selectedId"
        @select="$emit('select', $event)"
        @toggle="$emit('toggle', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ScriptRecord } from '@/shared/types';
import ScriptListItem from './ScriptListItem.vue';

defineProps<{
  scripts: ScriptRecord[];
  totalCount: number;
  selectedId: string | null;
  searchQuery: string;
  activeFilter: 'all' | 'enabled' | 'disabled' | 'cdp';
}>();

defineEmits<{
  (e: 'update:searchQuery', val: string): void;
  (e: 'update:activeFilter', val: 'all' | 'enabled' | 'disabled' | 'cdp'): void;
  (e: 'select', id: string): void;
  (e: 'toggle', id: string): void;
}>();
</script>

<style scoped>
.script-list-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #16161a;
  border-right: 1px solid #272733;
}

.filter-tabs {
  display: flex;
  padding: 8px 12px;
  gap: 4px;
  background-color: #121215;
  border-bottom: 1px solid #24242e;
}

.tab-btn {
  flex: 1;
  padding: 5px 4px;
  background: transparent;
  border: none;
  border-radius: 5px;
  color: #a1a1aa;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;
}

.tab-btn:hover {
  background-color: #24242e;
  color: #e4e4e7;
}

.tab-btn.active {
  background-color: #272733;
  color: #ffffff;
  font-weight: 600;
}

.cdp-tab-btn.active {
  background-color: rgba(99, 102, 241, 0.2);
  color: #818cf8;
}

.tab-count {
  font-size: 10px;
  opacity: 0.75;
}

.search-box {
  display: flex;
  align-items: center;
  position: relative;
  padding: 8px 12px;
  border-bottom: 1px solid #24242e;
}

.search-icon {
  position: absolute;
  left: 20px;
  font-size: 12px;
  color: #71717a;
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 6px 28px 6px 28px;
  background-color: #1e1e26;
  border: 1px solid #2e2e3d;
  border-radius: 6px;
  color: #f4f4f5;
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}

.search-input:focus {
  border-color: #6366f1;
}

.search-input::placeholder {
  color: #71717a;
}

.clear-search-btn {
  position: absolute;
  right: 20px;
  background: none;
  border: none;
  color: #a1a1aa;
  font-size: 11px;
  cursor: pointer;
}

.script-items-scroll {
  flex: 1;
  overflow-y: auto;
}

.empty-list-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  color: #71717a;
  gap: 8px;
}

.notice-icon {
  font-size: 24px;
}

.notice-text {
  font-size: 12px;
}
</style>
