<template>
  <div class="popup-container">
    <header class="header">
      <h1 class="title">XOKJ Control Panel</h1>
      <span class="badge">MV3 CDP</span>
    </header>
    <main class="content">
      <p class="status-text">Userscript manager ready.</p>
    </main>
  </div>
</template>

<script setup lang="ts">
// Popup root component stub (Milestone 1)
</script>

<style scoped>
.popup-container {
  width: 320px;
  min-height: 200px;
  padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: #1a1a1a;
  color: #f3f4f6;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #333;
  padding-bottom: 8px;
}
.title {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
.badge {
  font-size: 11px;
  background-color: #3b82f6;
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
}
.content {
  margin-top: 12px;
  font-size: 13px;
  color: #9ca3af;
}
</style>
