<template>
  <div class="global-controls">
    <div class="control-left">
      <div class="switch-container">
        <label class="toggle-switch">
          <input
            type="checkbox"
            :checked="globalEnabled"
            @change="$emit('toggleGlobal', ($event.target as HTMLInputElement).checked)"
          />
          <span class="slider"></span>
        </label>
      </div>
      <div class="control-label">
        <span class="label-primary">Script Engine</span>
        <span class="label-status" :class="{ 'status-off': !globalEnabled }">
          <i class="fa-solid fa-circle-dot status-icon"></i>
          <span>{{ globalEnabled ? 'Active' : 'Paused' }}</span>
        </span>
      </div>
    </div>
    <div class="control-right">
      <CdpStatusBadge
        :status="cdpStatus"
        :active-domains="activeDomains"
        :conflict-reason="conflictReason"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DebuggerSessionStatus } from '@/shared/types';
import CdpStatusBadge from './CdpStatusBadge.vue';

defineProps<{
  globalEnabled: boolean;
  cdpStatus: DebuggerSessionStatus;
  activeDomains?: string[];
  conflictReason?: string;
}>();

defineEmits<{
  (e: 'toggleGlobal', value: boolean): void;
}>();
</script>

<style scoped>
.global-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background-color: #12141c;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.control-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.control-label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.label-primary {
  font-size: 11px;
  font-weight: 600;
  color: #e2e8f0;
}
.label-status {
  font-size: 10px;
  color: #34d399;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  transition: color 0.2s ease;
}
.status-icon {
  font-size: 6px;
}
.label-status.status-off {
  color: #f87171;
}

/* Compact smooth switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 30px;
  height: 16px;
}
.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: #334155;
  border-radius: 16px;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.slider:before {
  position: absolute;
  content: "";
  height: 12px;
  width: 12px;
  left: 1px;
  bottom: 1px;
  background-color: #ffffff;
  border-radius: 50%;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
input:checked + .slider {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  border-color: rgba(99, 102, 241, 0.6);
  box-shadow: 0 0 8px rgba(99, 102, 241, 0.4);
}
input:checked + .slider:before {
  transform: translateX(14px);
}
</style>
