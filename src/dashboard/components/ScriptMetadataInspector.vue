<template>
  <div class="metadata-inspector">
    <!-- Parse Errors Banner -->
    <div v-if="parseErrors && parseErrors.length > 0" class="parse-errors-banner">
      <span class="warning-icon">⚠️</span>
      <div class="errors-content">
        <span class="error-title">Metadata Warnings:</span>
        <ul class="error-list">
          <li v-for="(err, idx) in parseErrors" :key="idx">{{ err }}</li>
        </ul>
      </div>
    </div>

    <!-- Metadata Attributes Bar -->
    <div class="metadata-attributes">
      <div class="attr-group">
        <span class="attr-label">run-at:</span>
        <span class="attr-pill timing-pill" :class="timingClass">
          {{ metadata?.runAt || 'document-idle' }}
        </span>
      </div>

      <div v-if="matchesList.length > 0" class="attr-group">
        <span class="attr-label">matches:</span>
        <span
          v-for="(match, idx) in matchesList.slice(0, 3)"
          :key="idx"
          class="attr-pill match-pill"
          :title="match"
        >
          {{ match }}
        </span>
        <span v-if="matchesList.length > 3" class="attr-pill more-pill">
          +{{ matchesList.length - 3 }} more
        </span>
      </div>

      <div v-if="cdpList.length > 0" class="attr-group">
        <span class="attr-label">cdp:</span>
        <span
          v-for="(cdpItem, idx) in cdpList"
          :key="idx"
          class="attr-pill cdp-pill"
          :title="cdpItem"
        >
          ⚡ {{ cdpItem }}
        </span>
      </div>

      <div v-if="grantsList.length > 0" class="attr-group">
        <span class="attr-label">grants:</span>
        <span
          v-for="(grant, idx) in grantsList"
          :key="idx"
          class="attr-pill grant-pill"
        >
          {{ grant }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ParsedMetadata } from '@/shared/types';

const props = defineProps<{
  metadata?: ParsedMetadata;
  parseErrors?: string[];
}>();

const timingClass = computed(() => {
  const runAt = props.metadata?.runAt || 'document-idle';
  switch (runAt) {
    case 'document-start': return 'timing-start';
    case 'document-end': return 'timing-end';
    case 'document-idle':
    default: return 'timing-idle';
  }
});

const matchesList = computed(() => {
  const m = props.metadata;
  return m?.matches?.length ? m.matches : m?.matchPatterns?.length ? m.matchPatterns : m?.includes || [];
});

const cdpList = computed(() => {
  const m = props.metadata;
  if (m?.cdpDomains && m.cdpDomains.length > 0) {
    return m.cdpDomains;
  }
  if (m?.cdpDeclarations && m.cdpDeclarations.length > 0) {
    return m.cdpDeclarations.map((d) => d.command);
  }
  if (m?.cdp && m.cdp.length > 0) {
    return m.cdp.map((d) => d.command);
  }
  return [];
});

const grantsList = computed(() => {
  const g = props.metadata?.grants || [];
  return g.filter((x) => x !== 'none');
});
</script>

<style scoped>
.metadata-inspector {
  display: flex;
  flex-direction: column;
  background-color: #141418;
  border-bottom: 1px solid #272733;
}

.parse-errors-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background-color: rgba(245, 158, 11, 0.12);
  border-bottom: 1px solid rgba(245, 158, 11, 0.3);
  padding: 8px 16px;
  color: #fbbf24;
  font-size: 11px;
}

.warning-icon {
  font-size: 14px;
}

.errors-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.error-title {
  font-weight: 600;
}

.error-list {
  margin: 0;
  padding-left: 16px;
}

.metadata-attributes {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  flex-wrap: wrap;
}

.attr-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.attr-label {
  font-size: 11px;
  color: #71717a;
  font-weight: 500;
}

.attr-pill {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.timing-start {
  background-color: rgba(6, 182, 212, 0.15);
  color: #22d3ee;
  border: 1px solid rgba(6, 182, 212, 0.3);
}

.timing-end {
  background-color: rgba(168, 85, 247, 0.15);
  color: #c084fc;
  border: 1px solid rgba(168, 85, 247, 0.3);
}

.timing-idle {
  background-color: rgba(100, 116, 139, 0.15);
  color: #94a3b8;
  border: 1px solid rgba(100, 116, 139, 0.3);
}

.match-pill {
  background-color: #1e1e26;
  border: 1px solid #2e2e3d;
  color: #cbd5e1;
  font-family: monospace;
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.more-pill {
  background-color: #272733;
  color: #94a3b8;
}

.cdp-pill {
  background-color: rgba(99, 102, 241, 0.15);
  color: #818cf8;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.grant-pill {
  background-color: rgba(234, 179, 8, 0.12);
  color: #facc15;
  border: 1px solid rgba(234, 179, 8, 0.3);
}
</style>
