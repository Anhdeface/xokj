<template>
  <div
    class="cdp-badge"
    :class="statusClass"
    :title="badgeTooltip"
  >
    <span class="status-indicator"></span>
    <span class="status-label">{{ displayLabel }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DebuggerSessionStatus } from '@/shared/types';

const props = defineProps<{
  status: DebuggerSessionStatus;
  activeDomains?: string[];
  conflictReason?: string;
}>();

const statusClass = computed(() => {
  switch (props.status) {
    case 'ATTACHED':
      return 'status-attached';
    case 'ATTACHING':
      return 'status-attaching';
    case 'CONFLICT':
      return 'status-conflict';
    case 'DETACHED':
      return 'status-detached';
    case 'IDLE':
    default:
      return 'status-idle';
  }
});

const displayLabel = computed(() => {
  switch (props.status) {
    case 'ATTACHED':
      return 'CDP ATTACHED';
    case 'ATTACHING':
      return 'CDP ATTACHING';
    case 'CONFLICT':
      return 'CDP CONFLICT';
    case 'DETACHED':
      return 'CDP DETACHED';
    case 'IDLE':
    default:
      return 'CDP IDLE';
  }
});

const badgeTooltip = computed(() => {
  switch (props.status) {
    case 'ATTACHED':
      return props.activeDomains?.length
        ? `CDP active. Domains: ${props.activeDomains.join(', ')}`
        : 'CDP debugger active on this tab';
    case 'CONFLICT':
      return props.conflictReason
        ? `DevTools conflict: ${props.conflictReason}`
        : 'Native Chrome DevTools opened on tab';
    case 'ATTACHING':
      return 'Attaching Chrome debugger...';
    case 'DETACHED':
      return 'CDP session detached';
    case 'IDLE':
    default:
      return 'No active CDP debugger session';
  }
});
</script>

<style scoped>
.cdp-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.4px;
  border: 1px solid transparent;
  user-select: none;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.status-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  position: relative;
}

.status-attached {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.4);
  color: #34d399;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.15);
}
.status-attached .status-indicator {
  background-color: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.8);
  animation: pulse-dot 2s infinite ease-in-out;
}

.status-attaching {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.4);
  color: #fbbf24;
}
.status-attaching .status-indicator {
  background-color: #f59e0b;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.6);
  animation: blink-dot 1s infinite ease-in-out;
}

.status-conflict {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.5);
  color: #f87171;
  animation: conflict-shake 3s infinite ease-in-out;
}
.status-conflict .status-indicator {
  background-color: #ef4444;
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.8);
}

.status-idle,
.status-detached {
  background: rgba(100, 116, 139, 0.1);
  border-color: rgba(100, 116, 139, 0.3);
  color: #94a3b8;
}
.status-idle .status-indicator,
.status-detached .status-indicator {
  background-color: #64748b;
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.85);
  }
}

@keyframes blink-dot {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.3;
    transform: scale(0.8);
  }
}

@keyframes conflict-shake {
  0%, 90%, 100% {
    transform: translateX(0);
  }
  92% {
    transform: translateX(-2px);
  }
  94% {
    transform: translateX(2px);
  }
  96% {
    transform: translateX(-1px);
  }
  98% {
    transform: translateX(1px);
  }
}
</style>
