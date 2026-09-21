<template>
  <div class="script-card" :class="{ 'card-disabled': !script.enabled || !globalEnabled }">
    <div class="card-main">
      <div class="card-info">
        <div class="title-row">
          <span class="script-name" :title="script.name">{{ script.name }}</span>
          <span v-if="script.metadata?.version" class="version-tag">
            v{{ script.metadata.version }}
          </span>
        </div>
        <p v-if="script.metadata?.description" class="script-desc" :title="script.metadata.description">
          {{ script.metadata.description }}
        </p>
        <div class="badges-row">
          <span class="timing-badge" :class="timingClass">
            {{ timingLabel }}
          </span>
          <span v-if="hasCdp" class="cdp-badge-tag" :title="cdpTooltip">
            ⚡ {{ cdpLabel }}
          </span>
          <span v-if="hasGrants" class="grant-badge-tag">
            {{ grantsLabel }}
          </span>
        </div>
      </div>
      <div class="card-action">
        <label class="item-switch">
          <input
            type="checkbox"
            :checked="script.enabled"
            :disabled="!globalEnabled"
            @change="$emit('toggle', script.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="item-slider"></span>
        </label>
        <button
          class="edit-btn"
          title="Edit in Dashboard"
          @click="$emit('edit', script.id)"
        >
          ✏️
        </button>
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
  background-color: #1a1a20;
  border: 1px solid #272733;
  border-radius: 7px;
  padding: 10px 12px;
  margin: 6px 14px;
  transition: all 0.15s ease;
}
.script-card:hover {
  background-color: #202028;
  border-color: #3b3b4d;
}
.script-card.card-disabled {
  opacity: 0.6;
}
.card-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.card-info {
  flex: 1;
  min-width: 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
}
.script-name {
  font-size: 13px;
  font-weight: 600;
  color: #f4f4f5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.version-tag {
  font-size: 9px;
  background-color: #2e2e3d;
  color: #94a3b8;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
}
.script-desc {
  font-size: 11px;
  color: #a1a1aa;
  margin: 0 0 6px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badges-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}
.timing-badge {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  text-transform: uppercase;
}
.timing-start {
  background-color: rgba(6, 182, 212, 0.15);
  color: #22d3ee;
  border: 1px solid rgba(6, 182, 212, 0.4);
}
.timing-end {
  background-color: rgba(168, 85, 247, 0.15);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.4);
}
.timing-idle {
  background-color: rgba(100, 116, 139, 0.15);
  color: #94a3b8;
  border: 1px solid rgba(100, 116, 139, 0.4);
}
.cdp-badge-tag {
  font-size: 9px;
  font-weight: 600;
  background-color: rgba(99, 102, 241, 0.15);
  color: #818cf8;
  border: 1px solid rgba(99, 102, 241, 0.4);
  padding: 1px 5px;
  border-radius: 3px;
}
.grant-badge-tag {
  font-size: 9px;
  background-color: rgba(234, 179, 8, 0.12);
  color: #facc15;
  border: 1px solid rgba(234, 179, 8, 0.3);
  padding: 1px 4px;
  border-radius: 3px;
}
.card-action {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
}
.edit-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 11px;
  opacity: 0.6;
  padding: 2px;
  transition: opacity 0.15s;
}
.edit-btn:hover {
  opacity: 1;
}

/* Item switch */
.item-switch {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
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
  border-radius: 18px;
  transition: 0.2s;
}
.item-slider:before {
  position: absolute;
  content: "";
  height: 12px;
  width: 12px;
  left: 3px;
  bottom: 3px;
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
input:disabled + .item-slider {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
