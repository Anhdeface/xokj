<template>
  <div class="script-card" :class="{ 'card-disabled': !script.enabled || !globalEnabled }">
    <div class="card-main">
      <div class="card-info">
        <div class="title-row">
          <span class="script-name" :title="script.name">{{ script.name }}</span>
          <span v-if="script.metadata?.version" class="version-tag">
            v{{ script.metadata.version }}
          </span>
          <span class="timing-badge" :class="timingClass">
            {{ timingLabel }}
          </span>
          <span v-if="hasCdp" class="cdp-badge-tag" :title="cdpTooltip">
            <i class="fa-solid fa-bolt cdp-icon"></i>
            <span>{{ cdpLabel }}</span>
          </span>
          <span v-if="hasGrants" class="grant-badge-tag">
            <i class="fa-solid fa-key grant-icon"></i>
            <span>{{ grantsLabel }}</span>
          </span>
        </div>
        <p v-if="script.metadata?.description" class="script-desc" :title="script.metadata.description">
          {{ script.metadata.description }}
        </p>
      </div>
      <div class="card-action">
        <button
          class="edit-btn"
          title="Edit in Dashboard"
          @click="$emit('edit', script.id)"
        >
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <label class="item-switch">
          <input
            type="checkbox"
            :checked="script.enabled"
            :disabled="!globalEnabled"
            @change="$emit('toggle', script.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="item-slider"></span>
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ScriptRecord } from '@/shared/types';

const props = defineProps<{
  script: ScriptRecord;
  globalEnabled: boolean;
}>();

defineEmits<{
  (e: 'toggle', scriptId: string, enabled: boolean): void;
  (e: 'edit', scriptId: string): void;
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
         (m?.grants && m.grants.includes('GM_cdp'));
});

const cdpLabel = computed(() => {
  const domains = props.script.metadata?.cdpDomains;
  if (domains && domains.length > 0) {
    return domains.join(', ');
  }
  return 'CDP';
});

const cdpTooltip = computed(() => {
  const declarations = props.script.metadata?.cdpDeclarations || props.script.metadata?.cdp || [];
  if (declarations.length > 0) {
    return `CDP Declarations:\n${declarations.map(d => d.command).join('\n')}`;
  }
  return 'CDP RPC Enabled';
});

const hasGrants = computed(() => {
  const g = props.script.metadata?.grants;
  return g && g.length > 0 && !g.includes('none');
});

const grantsLabel = computed(() => {
  const g = props.script.metadata?.grants || [];
  const filtered = g.filter(x => x !== 'none' && x !== 'GM_cdp');
  return filtered.length ? filtered.join(', ') : 'grants';
});
</script>

<style scoped>
.script-card {
  background-color: #151722;
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 7px;
  padding: 7px 10px;
  margin: 3px 10px;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.script-card:hover {
  background-color: #1b1e2c;
  border-color: rgba(99, 102, 241, 0.3);
}
.script-card.card-disabled {
  opacity: 0.55;
}
.card-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.card-info {
  flex: 1;
  min-width: 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: nowrap;
  overflow: hidden;
}
.script-name {
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}
.version-tag {
  font-size: 9px;
  background-color: #222634;
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: #94a3b8;
  padding: 0 4px;
  border-radius: 3px;
  font-family: ui-monospace, monospace;
  flex-shrink: 0;
}
.script-desc {
  font-size: 10px;
  color: #64748b;
  margin: 2px 0 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.25;
}
.timing-badge {
  font-size: 8.5px;
  font-weight: 600;
  padding: 0 4px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}
.timing-start {
  background-color: rgba(6, 182, 212, 0.12);
  color: #22d3ee;
  border: 1px solid rgba(6, 182, 212, 0.35);
}
.timing-end {
  background-color: rgba(168, 85, 247, 0.12);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.35);
}
.timing-idle {
  background-color: rgba(100, 116, 139, 0.12);
  color: #94a3b8;
  border: 1px solid rgba(100, 116, 139, 0.35);
}
.cdp-badge-tag {
  font-size: 8.5px;
  font-weight: 600;
  background: rgba(99, 102, 241, 0.12);
  color: #818cf8;
  border: 1px solid rgba(99, 102, 241, 0.35);
  padding: 0 5px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}
.cdp-icon {
  font-size: 7.5px;
  color: #a5b4fc;
}
.grant-badge-tag {
  font-size: 8.5px;
  background-color: rgba(234, 179, 8, 0.1);
  color: #fbbf24;
  border: 1px solid rgba(234, 179, 8, 0.3);
  padding: 0 4px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.grant-icon {
  font-size: 7px;
}
.card-action {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.edit-btn {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  cursor: pointer;
  font-size: 10px;
  color: #94a3b8;
  padding: 2px 4px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}
.edit-btn:hover {
  color: #818cf8;
  background-color: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.4);
}

.item-switch {
  position: relative;
  display: inline-block;
  width: 28px;
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
  box-shadow: 0 0 6px rgba(16, 185, 129, 0.4);
}
input:checked + .item-slider:before {
  transform: translateX(12px);
}
input:disabled + .item-slider {
  cursor: not-allowed;
  opacity: 0.4;
}
</style>
