<template>
  <div v-if="visible" class="conflict-banner">
    <div class="banner-icon">
      <i class="fa-solid fa-triangle-exclamation"></i>
    </div>
    <div class="banner-body">
      <div class="banner-header">
        <span class="banner-title">DevTools Conflict Detected</span>
      </div>
      <p class="banner-desc">
        Native DevTools is open on this tab. Chrome disallows simultaneous extension CDP sessions.
        Close DevTools to restore script interception.
      </p>
      <div v-if="reason" class="banner-reason">
        Reason: <code>{{ reason }}</code>
      </div>
      <div v-if="errorMessage" class="banner-error">
        <i class="fa-solid fa-circle-exclamation"></i> {{ errorMessage }}
      </div>
      <div class="banner-actions">
        <button
          class="reconnect-btn"
          :disabled="isReconnecting"
          @click="$emit('reconnect')"
        >
          <i v-if="isReconnecting" class="fa-solid fa-circle-notch fa-spin btn-icon"></i>
          <i v-else class="fa-solid fa-arrows-rotate btn-icon"></i>
          <span>{{ isReconnecting ? 'Reconnecting...' : 'Reconnect CDP' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
  reason?: string;
  isReconnecting: boolean;
  errorMessage?: string | null;
}>();

defineEmits<{
  (e: 'reconnect'): void;
}>();
</script>

<style scoped>
.conflict-banner {
  display: flex;
  gap: 12px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: 9px;
  padding: 12px 14px;
  margin: 10px 14px 4px 14px;
  box-shadow: 0 4px 16px rgba(239, 68, 68, 0.1);
  backdrop-filter: blur(8px);
  animation: banner-pop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.banner-icon {
  font-size: 16px;
  color: #f87171;
  flex-shrink: 0;
  padding-top: 1px;
}
.banner-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.banner-title {
  font-size: 12px;
  font-weight: 700;
  color: #fca5a5;
  letter-spacing: 0.2px;
}
.banner-desc {
  font-size: 11px;
  color: #e2e8f0;
  line-height: 1.4;
  margin: 0;
}
.banner-reason {
  font-size: 10px;
  color: #94a3b8;
}
.banner-reason code {
  background-color: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 1px 5px;
  border-radius: 4px;
  color: #fca5a5;
  font-family: ui-monospace, monospace;
}
.banner-error {
  font-size: 11px;
  color: #fecaca;
  background-color: rgba(239, 68, 68, 0.25);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 5px;
  padding: 5px 8px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
}
.banner-actions {
  margin-top: 4px;
}
.reconnect-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: #ffffff;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
}
.reconnect-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
}
.reconnect-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.reconnect-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-icon {
  font-size: 11px;
}

@keyframes banner-pop {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
