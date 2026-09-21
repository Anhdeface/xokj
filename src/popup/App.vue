<template>
  <div class="popup-container">
    <HeaderBar @open-dashboard="openDashboard()" />

    <GlobalControls
      :global-enabled="globalEnabled"
      :cdp-status="cdpStatus"
      :conflict-reason="conflictReason"
      @toggle-global="toggleGlobal"
    />

    <ConflictBanner
      :visible="cdpStatus === 'CONFLICT'"
      :reason="conflictReason"
      :is-reconnecting="isReconnecting"
      :error-message="reconnectError"
      @reconnect="reconnectCdp"
    />

    <div v-if="reconnectSuccess" class="success-toast">
      ✓ CDP debugger reconnected successfully!
    </div>

    <TabContextBar
      v-if="!tabInfo.isRestricted"
      :url="tabInfo.url"
      :hostname="tabInfo.hostname"
      :fav-icon-url="tabInfo.favIconUrl"
      :matching-count="matchingScripts.length"
      @reload-tab="reloadTab"
    />

    <div v-if="!globalEnabled" class="paused-banner">
      ⏸ Script execution is globally paused
    </div>

    <main class="script-list-area">
      <div v-if="isLoading">
        <EmptyState type="loading" />
      </div>

      <div v-else-if="tabInfo.isRestricted">
        <EmptyState type="restricted" :url="tabInfo.url" />
      </div>

      <div v-else-if="matchingScripts.length === 0">
        <EmptyState type="no-matches" :url="tabInfo.url" @open-dashboard="openDashboard()" />
      </div>

      <div v-else class="scripts-scroll">
        <ScriptCard
          v-for="script in matchingScripts"
          :key="script.id"
          :script="script"
          :global-enabled="globalEnabled"
          @toggle="toggleScript"
          @edit="openDashboard"
        />
      </div>
    </main>

    <footer class="popup-footer">
      <span class="footer-stats">
        {{ activeCount }}/{{ matchingScripts.length }} active on this page
      </span>
      <button class="footer-link" @click="openDashboard()">
        Manage all scripts →
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { usePopupState } from './composables/usePopupState';
import HeaderBar from './components/HeaderBar.vue';
import GlobalControls from './components/GlobalControls.vue';
import ConflictBanner from './components/ConflictBanner.vue';
import TabContextBar from './components/TabContextBar.vue';
import ScriptCard from './components/ScriptCard.vue';
import EmptyState from './components/EmptyState.vue';

const {
  tabInfo,
  globalEnabled,
  cdpStatus,
  conflictReason,
  matchingScripts,
  activeCount,
  isLoading,
  isReconnecting,
  reconnectError,
  reconnectSuccess,
  toggleGlobal,
  toggleScript,
  reconnectCdp,
  reloadTab,
  openDashboard
} = usePopupState();
</script>

<style>
/* Reset & base styling inside popup */
html, body {
  margin: 0;
  padding: 0;
  background-color: #121216;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #f4f4f5;
  user-select: none;
}
</style>

<style scoped>
.popup-container {
  width: 380px;
  max-height: 560px;
  min-height: 280px;
  display: flex;
  flex-direction: column;
  background-color: #121216;
  overflow: hidden;
}

.script-list-area {
  flex: 1;
  overflow-y: auto;
  min-height: 120px;
  max-height: 380px;
}

.scripts-scroll {
  padding: 4px 0 8px 0;
}

.paused-banner {
  background-color: rgba(245, 158, 11, 0.12);
  border-bottom: 1px solid rgba(245, 158, 11, 0.3);
  color: #f59e0b;
  font-size: 11px;
  font-weight: 500;
  text-align: center;
  padding: 5px 12px;
}

.success-toast {
  background-color: rgba(16, 185, 129, 0.15);
  border: 1px solid #10b981;
  color: #34d399;
  font-size: 11px;
  font-weight: 600;
  padding: 6px 12px;
  margin: 6px 14px;
  border-radius: 6px;
  text-align: center;
}

.popup-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background-color: #16161a;
  border-top: 1px solid #23232b;
  font-size: 10px;
  color: #a1a1aa;
}

.footer-link {
  background: none;
  border: none;
  color: #818cf8;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
}

.footer-link:hover {
  text-decoration: underline;
}
</style>
