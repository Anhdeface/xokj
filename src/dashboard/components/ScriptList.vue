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
        <i class="fa-solid fa-bolt cdp-tab-icon"></i>
        <span>CDP</span>
      </button>
    </div>

    <!-- Search Box -->
    <div class="search-box">
      <i class="fa-solid fa-magnifying-glass search-icon"></i>
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
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>

    <!-- Script Items Scroll -->
    <div class="script-items-scroll">
      <div v-if="scripts.length === 0" class="empty-list-notice">
        <div class="notice-icon-wrap">
          <i class="fa-solid fa-magnifying-glass notice-icon"></i>
        </div>
        <span class="notice-text">No matching scripts</span>
      </div>

      <TransitionGroup name="list-anim" tag="div">
        <ScriptListItem
          v-for="script in scripts"
          :key="script.id"
          :script="script"
          :is-selected="script.id === selectedId"
          @select="$emit('select', $event)"
          @toggle="$emit('toggle', $event)"
        />
      </TransitionGroup>
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
  background-color: #12141c;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
}

.filter-tabs {
  display: flex;
  padding: 8px 10px;
  gap: 4px;
  background-color: #0e1017;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.tab-btn {
  flex: 1;
  padding: 6px 4px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #94a3b8;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.tab-btn:hover {
  background-color: rgba(255, 255, 255, 0.05);
  color: #f1f5f9;
}

.tab-btn.active {
  background-color: #1f2333;
  border-color: rgba(255, 255, 255, 0.1);
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}

.cdp-tab-btn.active {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.4);
  color: #818cf8;
}

.cdp-tab-icon {
  font-size: 9px;
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
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background-color: #10121a;
}

.search-icon {
  position: absolute;
  left: 22px;
  font-size: 11px;
  color: #64748b;
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 6px 28px 6px 28px;
  background-color: #181b26;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: #f1f5f9;
  font-size: 12px;
  outline: none;
  transition: all 0.2s ease;
}

.search-input:focus {
  border-color: #6366f1;
  background-color: #1c202e;
  box-shadow: 0 0 8px rgba(99, 102, 241, 0.25);
}

.search-input::placeholder {
  color: #64748b;
}

.clear-search-btn {
  position: absolute;
  right: 20px;
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 11px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  transition: color 0.15s ease;
}
.clear-search-btn:hover {
  color: #ffffff;
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
  padding: 48px 16px;
  color: #64748b;
  gap: 10px;
}

.notice-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
}

.notice-icon {
  font-size: 16px;
  color: #64748b;
}

.notice-text {
  font-size: 12px;
  color: #94a3b8;
}

/* Animations */
.list-anim-enter-active,
.list-anim-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.list-anim-enter-from {
  opacity: 0;
  transform: translateX(-8px);
}
.list-anim-leave-to {
  opacity: 0;
  transform: translateX(8px);
}
.list-anim-move {
  transition: transform 0.2s ease;
}
</style>
