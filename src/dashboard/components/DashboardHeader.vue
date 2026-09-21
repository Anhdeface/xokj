<template>
  <header class="dashboard-header">
    <div class="header-left">
      <div class="logo-badge">
        <i class="fa-solid fa-bolt"></i>
      </div>
      <div class="brand-titles">
        <h1 class="main-title">XOKJ Dashboard</h1>
        <span class="sub-title">Userscript & CDP Manager</span>
      </div>
      <div class="stat-chips">
        <span class="chip total-chip">
          <i class="fa-solid fa-layer-group chip-icon"></i>
          <span>{{ scriptsCount }} scripts</span>
        </span>
        <span v-if="cdpScriptsCount > 0" class="chip cdp-chip">
          <i class="fa-solid fa-bolt chip-icon"></i>
          <span>{{ cdpScriptsCount }} CDP</span>
        </span>
      </div>
    </div>

    <div class="header-right">
      <button
        class="action-btn primary-btn new-btn"
        @click="$emit('newScript')"
        title="Create new userscript"
      >
        <i class="fa-solid fa-plus btn-icon"></i>
        <span>New Script</span>
      </button>

      <button
        class="action-btn secondary-btn import-btn"
        @click="$emit('importScripts')"
        title="Import scripts from JSON or user.js file"
      >
        <i class="fa-solid fa-file-arrow-up btn-icon"></i>
        <span>Import</span>
      </button>

      <button
        class="action-btn secondary-btn export-btn"
        @click="$emit('exportAll')"
        title="Export all scripts as JSON"
      >
        <i class="fa-solid fa-file-export btn-icon"></i>
        <span>Export</span>
      </button>

      <button
        class="action-btn danger-outline-btn reset-btn"
        @click="$emit('resetDefaults')"
        title="Reset scripts to initial default samples"
      >
        <i class="fa-solid fa-arrow-rotate-left btn-icon"></i>
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
  background: linear-gradient(180deg, #13151f 0%, #0e1017 100%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: #f1f5f9;
  user-select: none;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}

.logo-badge {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.logo-badge:hover {
  transform: rotate(8deg) scale(1.06);
  box-shadow: 0 6px 18px rgba(99, 102, 241, 0.6);
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
  color: #f8fafc;
  letter-spacing: 0.3px;
}

.sub-title {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 400;
}

.stat-chips {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 12px;
}

.chip {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 9999px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.chip-icon {
  font-size: 10px;
}

.total-chip {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}

.cdp-chip {
  background: rgba(99, 102, 241, 0.12);
  color: #818cf8;
  border: 1px solid rgba(99, 102, 241, 0.35);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 13px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  border: 1px solid transparent;
}
.action-btn:active {
  transform: scale(0.97);
}

.primary-btn {
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(99, 102, 241, 0.35);
}

.primary-btn:hover {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.5);
}

.secondary-btn {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
  color: #e2e8f0;
  backdrop-filter: blur(8px);
}

.secondary-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
}

.danger-outline-btn {
  background: transparent;
  border-color: rgba(239, 68, 68, 0.3);
  color: #f87171;
}

.danger-outline-btn:hover {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.6);
  color: #fca5a5;
  transform: translateY(-1px);
  box-shadow: 0 3px 10px rgba(239, 68, 68, 0.2);
}

.btn-icon {
  font-size: 11px;
}
</style>
