<template>
  <div class="empty-state">
    <div class="empty-icon-wrap" :class="`icon-type-${type}`">
      <i :class="iconClass"></i>
    </div>
    <h3 class="empty-title">{{ title }}</h3>
    <p class="empty-desc">{{ description }}</p>
    <button
      v-if="showDashboardAction"
      class="empty-action-btn"
      @click="$emit('openDashboard')"
    >
      <i class="fa-solid fa-plus btn-icon"></i>
      <span>Create Script in Dashboard</span>
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

const iconClass = computed(() => {
  switch (props.type) {
    case 'restricted': return 'fa-solid fa-shield-halved';
    case 'loading': return 'fa-solid fa-circle-notch fa-spin';
    case 'no-matches':
    default: return 'fa-solid fa-scroll';
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
  padding: 38px 22px;
  text-align: center;
}
.empty-icon-wrap {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  margin-bottom: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  animation: float-icon 3s ease-in-out infinite;
}
.icon-type-restricted {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #f87171;
}
.icon-type-loading {
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(99, 102, 241, 0.3);
  color: #818cf8;
}
.icon-type-no-matches {
  background: rgba(139, 92, 246, 0.12);
  border: 1px solid rgba(139, 92, 246, 0.3);
  color: #c084fc;
}
.empty-title {
  font-size: 13px;
  font-weight: 600;
  color: #f1f5f9;
  margin: 0 0 6px 0;
  letter-spacing: 0.2px;
}
.empty-desc {
  font-size: 11px;
  color: #94a3b8;
  max-width: 280px;
  line-height: 1.45;
  margin: 0 0 16px 0;
}
.empty-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #ffffff;
  border: none;
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 2px 10px rgba(99, 102, 241, 0.35);
}
.empty-action-btn:hover {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.5);
}
.empty-action-btn:active {
  transform: scale(0.97);
}
.btn-icon {
  font-size: 10px;
}

@keyframes float-icon {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}
</style>
