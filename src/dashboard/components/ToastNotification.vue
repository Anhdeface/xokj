<template>
  <div class="toast-wrapper">
    <div class="toast" :class="toastClass">
      <span class="toast-icon">{{ icon }}</span>
      <span class="toast-message">{{ message }}</span>
      <button class="toast-close" @click="$emit('close')">✕</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  type: 'success' | 'info' | 'error';
  message: string;
}>();

defineEmits<{
  (e: 'close'): void;
}>();

const toastClass = computed(() => `toast-${props.type}`);

const icon = computed(() => {
  switch (props.type) {
    case 'error':
      return '❌';
    case 'info':
      return 'ℹ️';
    case 'success':
    default:
      return '✓';
  }
});
</script>

<style scoped>
.toast-wrapper {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  animation: slide-up 0.2s ease-out;
}

.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  min-width: 240px;
  max-width: 420px;
}

.toast-success {
  background-color: #064e3b;
  border: 1px solid #10b981;
  color: #a7f3d0;
}

.toast-info {
  background-color: #1e1b4b;
  border: 1px solid #6366f1;
  color: #c7d2fe;
}

.toast-error {
  background-color: #7f1d1d;
  border: 1px solid #ef4444;
  color: #fecaca;
}

.toast-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.toast-message {
  flex: 1;
  line-height: 1.3;
}

.toast-close {
  background: none;
  border: none;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
  padding: 2px;
  font-size: 12px;
}

.toast-close:hover {
  opacity: 1;
}

@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
