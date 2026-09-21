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
  background-color: #1a1a20;
  border-bottom: 1px solid #27272f;
}
.control-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.control-label {
  display: flex;
  flex-direction: column;
}
.label-primary {
  font-size: 12px;
  font-weight: 600;
  color: #f4f4f5;
}
.label-status {
  font-size: 10px;
  color: #10b981;
  font-weight: 500;
}
.label-status.status-off {
  color: #ef4444;
}

/* Custom iOS-style Switch */
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
  background-color: #3f3f46;
  border-radius: 20px;
  transition: 0.2s;
}
.slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: 0.2s;
}
input:checked + .slider {
  background-color: #6366f1;
}
input:checked + .slider:before {
  transform: translateX(16px);
}
</style>
