<template>
  <div class="dashboard-container">
    <header class="header">
      <h1 class="title">XOKJ Management Dashboard</h1>
    </header>
    <main class="main-layout">
      <div class="sidebar">
        <p>Scripts List</p>
      </div>
      <div class="editor-pane">
        <p>Editor Area</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
// Dashboard root component stub (Milestone 1)
</script>

<style scoped>
.dashboard-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: #121212;
  color: #e0e0e0;
}
.header {
  padding: 12px 24px;
  border-bottom: 1px solid #2a2a2a;
}
.title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}
.main-layout {
  display: flex;
  flex: 1;
}
.sidebar {
  width: 280px;
  border-right: 1px solid #2a2a2a;
  padding: 16px;
}
.editor-pane {
  flex: 1;
  padding: 16px;
}
</style>
