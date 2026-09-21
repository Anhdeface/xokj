<template>
  <header class="header-bar">
    <div class="brand">
      <div class="logo-icon">
        <i class="fa-solid fa-bolt"></i>
      </div>
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
        <i class="fa-solid fa-gauge-high btn-icon"></i>
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
  padding: 11px 14px;
  background: linear-gradient(180deg, #161822 0%, #12141c 100%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
}
.logo-icon {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(99, 102, 241, 0.4);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.logo-icon:hover {
  transform: rotate(6deg) scale(1.05);
  box-shadow: 0 3px 14px rgba(99, 102, 241, 0.6);
}
.brand-text {
  display: flex;
  flex-direction: column;
}
.title {
  font-size: 14px;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: 0.6px;
  line-height: 1.1;
}
.subtitle {
  font-size: 10px;
  color: #94a3b8;
  font-weight: 400;
  letter-spacing: 0.2px;
}
.dashboard-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #e2e8f0;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  backdrop-filter: blur(8px);
}
.dashboard-btn:hover {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.5);
  color: #ffffff;
  transform: translateY(-1px);
  box-shadow: 0 3px 10px rgba(99, 102, 241, 0.25);
}
.dashboard-btn:active {
  transform: scale(0.97);
}
.btn-icon {
  font-size: 11px;
  color: #818cf8;
  transition: transform 0.2s ease;
}
.dashboard-btn:hover .btn-icon {
  transform: rotate(15deg);
  color: #a5b4fc;
}
</style>
