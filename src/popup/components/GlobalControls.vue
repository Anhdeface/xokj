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
          {{ globalEnabled ? 'Active' : 'Paused' }}
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
  padding: 10px 14px;
  background-color: #141722;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.control-left {
  display: flex;
  align-items: center;
  gap: 11px;
}
.control-label {
  display: flex;
  flex-direction: column;
}
.label-primary {
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
  letter-spacing: 0.2px;
}
.label-status {
  font-size: 10px;
  color: #34d399;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: color 0.2s ease;
}
.status-icon {
  font-size: 7px;
}
.label-status.status-off {
  color: #f87171;
}

/* Custom smooth switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
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
  border-radius: 20px;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 2px;
  bottom: 2px;
  background-color: #ffffff;
  border-radius: 50%;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
input:checked + .slider {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  border-color: rgba(99, 102, 241, 0.6);
  box-shadow: 0 0 10px rgba(99, 102, 241, 0.4);
}
input:checked + .slider:before {
  transform: translateX(16px);
}
</style>
