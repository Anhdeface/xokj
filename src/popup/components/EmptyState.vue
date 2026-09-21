<template>
  <div class="empty-state">
    <div class="empty-icon">{{ icon }}</div>
    <h3 class="empty-title">{{ title }}</h3>
    <p class="empty-desc">{{ description }}</p>
    <button
      v-if="showDashboardAction"
      class="empty-action-btn"
      @click="$emit('openDashboard')"
    >
      + Create Script in Dashboard
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  type: 'restricted' | 'no-matches' | 'loading';
  url?: string;
}>();

defineEmits<{
  (e: 'openDashboard'): void;
}>();

const icon = computed(() => {
  switch (props.type) {
    case 'restricted': return '🛡️';
    case 'loading': return '⏳';
    case 'no-matches':
    default: return '📜';
  }
});

const title = computed(() => {
  switch (props.type) {
    case 'restricted': return 'Restricted Browser Page';
    case 'loading': return 'Analyzing Active Tab...';
    case 'no-matches':
    default: return 'No Scripts for This Site';
  }
});

const description = computed(() => {
  switch (props.type) {
    case 'restricted':
      return 'Chromium security policies disallow userscript injection and CDP debugging on browser system and Web Store pages.';
    case 'loading':
      return 'Querying active tab match patterns and CDP status...';
    case 'no-matches':
    default:
      return 'No userscripts currently match this URL. You can create a new script in the dashboard.';
  }
});

const showDashboardAction = computed(() => props.type === 'no-matches');
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px 20px;
  text-align: center;
}
.empty-icon {
  font-size: 32px;
  margin-bottom: 8px;
}
.empty-title {
  font-size: 13px;
  font-weight: 600;
  color: #f4f4f5;
  margin: 0 0 6px 0;
}
.empty-desc {
  font-size: 11px;
  color: #a1a1aa;
  max-width: 280px;
  line-height: 1.4;
  margin: 0 0 14px 0;
}
.empty-action-btn {
  background-color: #6366f1;
  color: #ffffff;
  border: none;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s;
}
.empty-action-btn:hover {
  background-color: #4f46e5;
}
</style>
