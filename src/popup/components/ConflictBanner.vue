<template>
  <div v-if="visible" class="conflict-banner">
    <div class="banner-icon">⚠️</div>
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
        {{ errorMessage }}
      </div>
      <div class="banner-actions">
        <button
          class="reconnect-btn"
          :disabled="isReconnecting"
          @click="$emit('reconnect')"
        >
          <span v-if="isReconnecting" class="spinner"></span>
          <span v-else class="btn-symbol">🔄</span>
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
  gap: 10px;
  background-color: rgba(239, 68, 68, 0.12);
  border: 1px solid #ef4444;
  border-radius: 8px;
  padding: 12px;
  margin: 10px 14px 4px 14px;
}
.banner-icon {
  font-size: 18px;
  flex-shrink: 0;
  line-height: 1.2;
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
  color: #f87171;
}
.banner-desc {
  font-size: 11px;
  color: #d4d4d8;
  line-height: 1.35;
  margin: 0;
}
.banner-reason {
  font-size: 10px;
  color: #a1a1aa;
}
.banner-reason code {
  background-color: rgba(0, 0, 0, 0.3);
  padding: 1px 4px;
  border-radius: 3px;
  color: #fca5a5;
  font-family: monospace;
}
.banner-error {
  font-size: 11px;
  color: #f87171;
  background-color: rgba(239, 68, 68, 0.2);
  border-radius: 4px;
  padding: 4px 8px;
  font-weight: 500;
}
.banner-actions {
  margin-top: 4px;
}
.reconnect-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background-color: #ef4444;
  color: #ffffff;
  border: none;
  padding: 5px 12px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.reconnect-btn:hover:not(:disabled) {
  background-color: #dc2626;
}
.reconnect-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-symbol {
  font-size: 12px;
}
.spinner {
  width: 11px;
  height: 11px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
