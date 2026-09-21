<template>
  <div
    class="script-list-item"
    :class="{
      'selected': isSelected,
      'disabled': !script.enabled
    }"
    @click="$emit('select', script.id)"
  >
    <div class="item-top">
      <div class="item-title-row">
        <span class="script-title" :title="script.name">{{ script.name }}</span>
        <span v-if="script.metadata?.version" class="item-version">
          v{{ script.metadata.version }}
        </span>
      </div>

      <div class="item-toggle-wrap" @click.stop>
        <label class="item-switch">
          <input
            type="checkbox"
            :checked="script.enabled"
            @change="$emit('toggle', script.id)"
          />
          <span class="item-slider"></span>
        </label>
      </div>
    </div>

    <p v-if="script.metadata?.description" class="item-desc" :title="script.metadata.description">
      {{ script.metadata.description }}
    </p>

    <div class="item-meta-row">
      <span class="meta-badge run-at-badge" :class="timingClass">
        {{ timingLabel }}
      </span>

      <span v-if="hasCdp" class="meta-badge cdp-badge" title="CDP active">
        ⚡ CDP
      </span>

      <span v-if="primaryMatch" class="meta-badge match-badge" :title="primaryMatch">
        {{ primaryMatch }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ScriptRecord } from '@/shared/types';

const props = defineProps<{
  script: ScriptRecord;
  isSelected: boolean;
}>();

defineEmits<{
  (e: 'select', id: string): void;
  (e: 'toggle', id: string): void;
}>();

const timingLabel = computed(() => {
  const runAt = props.script.metadata?.runAt || 'document-idle';
  switch (runAt) {
    case 'document-start': return 'start';
    case 'document-end': return 'end';
    case 'document-idle':
    default: return 'idle';
  }
});

const timingClass = computed(() => `timing-${timingLabel.value}`);

const hasCdp = computed(() => {
  const m = props.script.metadata;
  return (m?.cdpDomains && m.cdpDomains.length > 0) ||
         (m?.cdp && m.cdp.length > 0) ||
         (m?.grants && m.grants.includes('GM_cdp'));
});

const primaryMatch = computed(() => {
  const matches = props.script.metadata?.matches || props.script.metadata?.matchPatterns || props.script.metadata?.includes || [];
  return matches.length > 0 ? matches[0] : '';
});
</script>

<style scoped>
.script-list-item {
  padding: 10px 14px;
  border-bottom: 1px solid #24242e;
  cursor: pointer;
  background-color: transparent;
  transition: all 0.15s ease;
  user-select: none;
}

.script-list-item:hover {
  background-color: #1e1e26;
}

.script-list-item.selected {
  background-color: #242432;
  border-left: 3px solid #6366f1;
}

.script-list-item.disabled {
  opacity: 0.65;
}

.item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.item-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.script-title {
  font-size: 13px;
  font-weight: 600;
  color: #f4f4f5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-version {
  font-size: 9px;
  color: #94a3b8;
  background-color: #2e2e3d;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
}

.item-desc {
  font-size: 11px;
  color: #a1a1aa;
  margin: 4px 0 6px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-meta-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.meta-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
}

.run-at-badge.timing-start {
  background-color: rgba(6, 182, 212, 0.15);
  color: #22d3ee;
  border: 1px solid rgba(6, 182, 212, 0.3);
}

.run-at-badge.timing-end {
  background-color: rgba(168, 85, 247, 0.15);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.3);
}

.run-at-badge.timing-idle {
  background-color: rgba(100, 116, 139, 0.15);
  color: #94a3b8;
  border: 1px solid rgba(100, 116, 139, 0.3);
}

.cdp-badge {
  background-color: rgba(99, 102, 241, 0.15);
  color: #818cf8;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.match-badge {
  background-color: #272733;
  color: #94a3b8;
  font-family: monospace;
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Custom switch */
.item-switch {
  position: relative;
  display: inline-block;
  width: 30px;
  height: 16px;
}
.item-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.item-slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: #3f3f46;
  border-radius: 16px;
  transition: 0.2s;
}
.item-slider:before {
  position: absolute;
  content: "";
  height: 12px;
  width: 12px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  border-radius: 50%;
  transition: 0.2s;
}
input:checked + .item-slider {
  background-color: #10b981;
}
input:checked + .item-slider:before {
  transform: translateX(14px);
}
</style>
