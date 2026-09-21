<template>
  <div class="modal-backdrop" @click.self="$emit('cancel')">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3 class="modal-title">{{ title }}</h3>
        <button class="modal-close-btn" @click="$emit('cancel')">✕</button>
      </div>

      <div class="modal-body">
        <p class="modal-message">{{ message }}</p>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" @click="$emit('cancel')">
          Cancel
        </button>
        <button
          class="btn"
          :class="confirmBtnClass"
          @click="$emit('confirm')"
        >
          {{ confirmText || 'Confirm' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    title: string;
    message: string;
    confirmText?: string;
    confirmType?: 'primary' | 'danger' | 'warning';
  }>(),
  {
    confirmText: 'Confirm',
    confirmType: 'primary'
  }
);

defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();

const confirmBtnClass = computed(() => {
  switch (props.confirmType) {
    case 'danger':
      return 'btn-danger';
    case 'warning':
      return 'btn-warning';
    case 'primary':
    default:
      return 'btn-primary';
  }
});
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  backdrop-filter: blur(2px);
}

.modal-dialog {
  background-color: #1e1e24;
  border: 1px solid #2e2e3d;
  border-radius: 8px;
  width: 440px;
  max-width: 90vw;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #272733;
}

.modal-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #f4f4f5;
}

.modal-close-btn {
  background: none;
  border: none;
  color: #a1a1aa;
  cursor: pointer;
  font-size: 14px;
}

.modal-body {
  padding: 16px 18px;
  color: #d4d4d8;
  font-size: 13px;
  line-height: 1.5;
}

.modal-message {
  margin: 0;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px;
  background-color: #16161a;
  border-top: 1px solid #272733;
}

.btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}

.btn-secondary {
  background-color: #272733;
  color: #e4e4e7;
}

.btn-secondary:hover {
  background-color: #323242;
}

.btn-primary {
  background-color: #6366f1;
  color: #ffffff;
}

.btn-primary:hover {
  background-color: #4f46e5;
}

.btn-danger {
  background-color: #ef4444;
  color: #ffffff;
}

.btn-danger:hover {
  background-color: #dc2626;
}

.btn-warning {
  background-color: #f59e0b;
  color: #ffffff;
}

.btn-warning:hover {
  background-color: #d97706;
}
</style>
