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
  gap: 5px;
  padding: 3px 8px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.3px;
  border: 1px solid transparent;
  user-select: none;
}

.status-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

/* ATTACHED: Green */
.status-attached {
  background-color: rgba(16, 185, 129, 0.15);
  border-color: #10b981;
  color: #34d399;
}
.status-attached .status-indicator {
  background-color: #10b981;
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.7);
  animation: pulse-dot 2s infinite ease-in-out;
}

/* ATTACHING: Amber */
.status-attaching {
  background-color: rgba(245, 158, 11, 0.15);
  border-color: #f59e0b;
  color: #fbbf24;
}
.status-attaching .status-indicator {
  background-color: #f59e0b;
  animation: blink-dot 1s infinite;
}

/* CONFLICT: Red */
.status-conflict {
  background-color: rgba(239, 68, 68, 0.15);
  border-color: #ef4444;
  color: #f87171;
}
.status-conflict .status-indicator {
  background-color: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.7);
}

/* IDLE & DETACHED: Slate/Gray */
.status-idle,
.status-detached {
  background-color: rgba(113, 113, 122, 0.15);
  border-color: #52525b;
  color: #a1a1aa;
}
.status-idle .status-indicator,
.status-detached .status-indicator {
  background-color: #71717a;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

@keyframes blink-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}
</style>
