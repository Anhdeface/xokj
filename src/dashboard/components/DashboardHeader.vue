<template>
  <header class="dashboard-header">
    <div class="header-left">
      <div class="logo-badge">⚡</div>
      <div class="brand-titles">
        <h1 class="main-title">XOKJ Dashboard</h1>
        <span class="sub-title">Userscript & CDP Manager</span>
      </div>
      <div class="stat-chips">
        <span class="chip total-chip">{{ scriptsCount }} scripts</span>
        <span v-if="cdpScriptsCount > 0" class="chip cdp-chip">⚡ {{ cdpScriptsCount }} CDP</span>
      </div>
    </div>

    <div class="header-right">
      <button
        class="action-btn primary-btn new-btn"
        @click="$emit('newScript')"
        title="Create new userscript"
      >
        <span class="btn-icon">+</span>
        <span>New Script</span>
      </button>

      <button
        class="action-btn secondary-btn import-btn"
        @click="$emit('importScripts')"
        title="Import scripts from JSON or user.js file"
      >
        <span class="btn-icon">📥</span>
        <span>Import</span>
      </button>

      <button
        class="action-btn secondary-btn export-btn"
        @click="$emit('exportAll')"
        title="Export all scripts as JSON"
      >
        <span class="btn-icon">📤</span>
        <span>Export</span>
      </button>

      <button
        class="action-btn danger-outline-btn reset-btn"
        @click="$emit('resetDefaults')"
        title="Reset scripts to initial default samples"
      >
        <span class="btn-icon">↺</span>
        <span>Reset Defaults</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  scriptsCount: number;
  cdpScriptsCount: number;
}>();

defineEmits<{
  (e: 'newScript'): void;
  (e: 'importScripts'): void;
  (e: 'exportAll'): void;
  (e: 'resetDefaults'): void;
}>();
</script>

<style scoped>
.dashboard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background-color: #16161a;
  border-bottom: 1px solid #272733;
  color: #f4f4f5;
  user-select: none;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-badge {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #fff;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
}

.brand-titles {
  display: flex;
  flex-direction: column;
}

.main-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  line-height: 1.2;
  color: #f4f4f5;
  letter-spacing: 0.3px;
}

.sub-title {
  font-size: 11px;
  color: #a1a1aa;
}

.stat-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
}

.chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: 500;
}

.total-chip {
  background-color: #272733;
  color: #cbd5e1;
}

.cdp-chip {
  background-color: rgba(99, 102, 241, 0.15);
  color: #818cf8;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.primary-btn {
  background-color: #6366f1;
  color: #ffffff;
}

.primary-btn:hover {
  background-color: #4f46e5;
}

.secondary-btn {
  background-color: #24242e;
  border-color: #363645;
  color: #e4e4e7;
}

.secondary-btn:hover {
  background-color: #2e2e3d;
  color: #ffffff;
  border-color: #4b4b5e;
}

.danger-outline-btn {
  background: transparent;
  border-color: #7f1d1d;
  color: #f87171;
}

.danger-outline-btn:hover {
  background-color: rgba(239, 68, 68, 0.15);
  border-color: #ef4444;
}

.btn-icon {
  font-size: 13px;
}
</style>
