<template>
  <div class="modal-backdrop" @click.self="$emit('cancel')">
    <div class="modal-dialog">
      <div class="modal-header">
        <div class="modal-title-row">
          <i :class="modalTypeIconClass"></i>
          <h3 class="modal-title">{{ title }}</h3>
        </div>
        <button class="modal-close-btn" @click="$emit('cancel')">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="modal-body">
        <p class="modal-message">{{ message }}</p>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary cancel-btn" @click="$emit('cancel')">
          Cancel
        </button>
        <button
          class="btn confirm-btn"
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

const modalTypeIconClass = computed(() => {
  switch (props.confirmType) {
    case 'danger':
      return 'fa-solid fa-triangle-exclamation modal-type-icon icon-danger';
    case 'warning':
      return 'fa-solid fa-circle-exclamation modal-type-icon icon-warning';
    case 'primary':
    default:
      return 'fa-solid fa-circle-question modal-type-icon icon-primary';
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
  background-color: rgba(5, 7, 12, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  backdrop-filter: blur(6px);
  animation: modal-fade 0.2s ease-out;
}

.modal-dialog {
  background: #161824;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  width: 440px;
  max-width: 90vw;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modal-pop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: #13151f;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.modal-title-row {
  display: flex;
  align-items: center;
  gap: 9px;
}

.modal-type-icon {
  font-size: 15px;
}
.icon-danger {
  color: #f87171;
}
.icon-warning {
  color: #fbbf24;
}
.icon-primary {
  color: #818cf8;
}

.modal-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: 0.2px;
}

.modal-close-btn {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 5px;
  color: #94a3b8;
  cursor: pointer;
  font-size: 12px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.modal-close-btn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.1);
  transform: scale(1.05);
}

.modal-body {
  padding: 18px 20px;
  color: #cbd5e1;
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
  padding: 12px 20px;
  background-color: #10121a;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.btn {
  padding: 7px 15px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn:active {
  transform: scale(0.97);
}

.btn-secondary {
  background-color: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
}

.btn-secondary:hover {
  background-color: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}

.btn-primary {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(99, 102, 241, 0.35);
}

.btn-primary:hover {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.5);
}

.btn-danger {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(239, 68, 68, 0.35);
}

.btn-danger:hover {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(239, 68, 68, 0.5);
}

.btn-warning {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(245, 158, 11, 0.35);
}

.btn-warning:hover {
  background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
  transform: translateY(-1px);
}

@keyframes modal-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes modal-pop {
  from {
    opacity: 0;
    transform: scale(0.93) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
