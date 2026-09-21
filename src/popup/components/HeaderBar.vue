<template>
  <header class="header-bar">
    <div class="brand">
      <div class="logo-icon">⚡</div>
      <div class="brand-text">
        <span class="title">XOKJ</span>
        <span class="subtitle">CDP Userscript Manager</span>
      </div>
    </div>
    <div class="actions">
      <button
        class="dashboard-btn"
        title="Open Script Management Dashboard"
        @click="$emit('openDashboard')"
      >
        <span class="btn-icon">🎛️</span>
        <span class="btn-text">Dashboard</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
defineEmits<{
  (e: 'openDashboard'): void;
}>();
</script>

<style scoped>
.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background-color: #16161a;
  border-bottom: 1px solid #27272f;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.logo-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #fff;
}
.brand-text {
  display: flex;
  flex-direction: column;
}
.title {
  font-size: 14px;
  font-weight: 700;
  color: #f4f4f5;
  letter-spacing: 0.5px;
  line-height: 1.1;
}
.subtitle {
  font-size: 10px;
  color: #a1a1aa;
}
.dashboard-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  background-color: #24242e;
  border: 1px solid #363645;
  color: #e4e4e7;
  padding: 5px 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}
.dashboard-btn:hover {
  background-color: #2f2f3d;
  border-color: #6366f1;
  color: #fff;
}
</style>
