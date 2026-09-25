<template>
  <header class="header-bar">
    <div class="brand">
      <div class="logo-icon">
        <i class="fa-solid fa-bolt"></i>
      </div>
      <span class="title">XOKJ</span>
    </div>
  </header>
</template>

<script setup lang="ts">
</script>

<style scoped>
.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: linear-gradient(180deg, #161822 0%, #10121a 100%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.brand {
  display: flex;
  align-items: center;
  gap: 7px;
}
.logo-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.35);
  transition: transform 0.2s ease;
}
.logo-icon:hover {
  transform: rotate(8deg) scale(1.08);
}
.title {
  font-size: 13px;
  font-weight: 700;
  color: #f8fafc;
  letter-spacing: 0.5px;
}
</style>
