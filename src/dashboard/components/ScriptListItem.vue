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
        <i class="fa-solid fa-bolt cdp-mini-icon"></i>
        <span>CDP</span>
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
  padding: 11px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  cursor: pointer;
  background-color: transparent;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
  position: relative;
}

.script-list-item:hover {
  background-color: rgba(255, 255, 255, 0.04);
}

.script-list-item.selected {
  background-color: #1a1e2b;
  border-left: 3px solid #6366f1;
  box-shadow: inset 0 0 16px rgba(99, 102, 241, 0.08);
}

.script-list-item.disabled {
  opacity: 0.6;
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
  gap: 7px;
  overflow: hidden;
}

.script-title {
  font-size: 13px;
  font-weight: 600;
  color: #f1f5f9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.15s ease;
}

.script-list-item.selected .script-title {
  color: #ffffff;
}

.item-version {
  font-size: 9px;
  color: #94a3b8;
  background-color: #202433;
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 1px 4px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
}

.item-desc {
  font-size: 11px;
  color: #94a3b8;
  margin: 4px 0 7px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
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
  padding: 1px 6px;
  border-radius: 4px;
}

.run-at-badge.timing-start {
  background-color: rgba(6, 182, 212, 0.12);
  color: #22d3ee;
  border: 1px solid rgba(6, 182, 212, 0.35);
}

.run-at-badge.timing-end {
  background-color: rgba(168, 85, 247, 0.12);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.35);
}

.run-at-badge.timing-idle {
  background-color: rgba(100, 116, 139, 0.12);
  color: #94a3b8;
  border: 1px solid rgba(100, 116, 139, 0.35);
}

.cdp-badge {
  background: rgba(99, 102, 241, 0.12);
  color: #818cf8;
  border: 1px solid rgba(99, 102, 241, 0.35);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.cdp-mini-icon {
  font-size: 8px;
  color: #a5b4fc;
}

.match-badge {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: #94a3b8;
  font-family: ui-monospace, monospace;
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

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
  background-color: #334155;
  border-radius: 16px;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.item-slider:before {
  position: absolute;
  content: "";
  height: 12px;
  width: 12px;
  left: 1px;
  bottom: 1px;
  background-color: white;
  border-radius: 50%;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}
input:checked + .item-slider {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  border-color: rgba(16, 185, 129, 0.5);
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
}
input:checked + .item-slider:before {
  transform: translateX(14px);
}
</style>
