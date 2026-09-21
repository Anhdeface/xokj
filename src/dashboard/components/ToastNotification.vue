<template>
  <div class="toast-wrapper">
    <div class="toast" :class="toastClass">
      <span class="toast-icon">
        <i :class="iconClass"></i>
      </span>
      <span class="toast-message">{{ message }}</span>
      <button class="toast-close" @click="$emit('close')">
        <i class="fa-solid fa-xmark"></i>
      </button>
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

const iconClass = computed(() => {
  switch (props.type) {
    case 'error':
      return 'fa-solid fa-circle-exclamation';
    case 'info':
      return 'fa-solid fa-circle-info';
    case 'success':
    default:
      return 'fa-solid fa-circle-check';
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
  animation: slide-spring 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.toast {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05);
  min-width: 240px;
  max-width: 420px;
  backdrop-filter: blur(8px);
}

.toast-success {
  background-color: rgba(6, 78, 59, 0.9);
  border: 1px solid rgba(16, 185, 129, 0.5);
  color: #d1fae5;
}
.toast-success .toast-icon {
  color: #34d399;
}

.toast-info {
  background-color: rgba(30, 27, 75, 0.9);
  border: 1px solid rgba(99, 102, 241, 0.5);
  color: #e0e7ff;
}
.toast-info .toast-icon {
  color: #818cf8;
}

.toast-error {
  background-color: rgba(127, 29, 29, 0.9);
  border: 1px solid rgba(239, 68, 68, 0.5);
  color: #fee2e2;
}
.toast-error .toast-icon {
  color: #f87171;
}

.toast-icon {
  font-size: 15px;
  flex-shrink: 0;
}

.toast-message {
  flex: 1;
  line-height: 1.35;
}

.toast-close {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: inherit;
  opacity: 0.8;
  cursor: pointer;
  padding: 3px 5px;
  font-size: 11px;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toast-close:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.15);
  transform: scale(1.05);
}

@keyframes slide-spring {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
