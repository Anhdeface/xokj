<template>
  <div class="popup-container">
    <HeaderBar @open-dashboard="openDashboard()" />

    <GlobalControls
      :global-enabled="globalEnabled"
      :cdp-status="cdpStatus"
      :conflict-reason="conflictReason"
      @toggle-global="toggleGlobal"
    />

    <Transition name="banner-slide">
      <ConflictBanner
        v-if="cdpStatus === 'CONFLICT'"
        :visible="true"
        :reason="conflictReason"
        :is-reconnecting="isReconnecting"
        :error-message="reconnectError"
        @reconnect="reconnectCdp"
      />
    </Transition>

    <Transition name="banner-slide">
      <div v-if="reconnectSuccess" class="success-toast">
        <i class="fa-solid fa-circle-check toast-icon"></i>
        <span>CDP debugger reconnected successfully!</span>
      </div>
    </Transition>

    <TabContextBar
      v-if="!tabInfo.isRestricted"
      :url="tabInfo.url"
      :hostname="tabInfo.hostname"
      :fav-icon-url="tabInfo.favIconUrl"
      :matching-count="matchingScripts.length"
      @reload-tab="reloadTab"
    />

    <Transition name="banner-slide">
      <div v-if="!globalEnabled" class="paused-banner">
        <i class="fa-solid fa-circle-pause banner-pause-icon"></i>
        <span>Script execution is globally paused</span>
      </div>
    </Transition>

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
        <TransitionGroup name="card-anim" tag="div">
          <ScriptCard
            v-for="script in matchingScripts"
            :key="script.id"
            :script="script"
            :global-enabled="globalEnabled"
            @toggle="toggleScript"
            @edit="openDashboard"
          />
        </TransitionGroup>
      </div>
    </main>

    <footer class="popup-footer">
      <span class="footer-stats">
        <i class="fa-solid fa-layer-group stats-icon"></i>
        <span>{{ activeCount }}/{{ matchingScripts.length }} active on this page</span>
      </span>
      <button class="footer-link" @click="openDashboard()">
        <span>Manage all scripts</span>
        <i class="fa-solid fa-arrow-right link-arrow"></i>
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
html, body {
  margin: 0;
  padding: 0;
  background-color: #0d0f17;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #f1f5f9;
  user-select: none;
}

::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 9999px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>

<style scoped>
.popup-container {
  width: 380px;
  max-height: 560px;
  min-height: 280px;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #111420 0%, #0d0f17 100%);
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.script-list-area {
  flex: 1;
  overflow-y: auto;
  min-height: 120px;
  max-height: 380px;
}

.scripts-scroll {
  padding: 6px 0 10px 0;
}

.paused-banner {
  background: rgba(245, 158, 11, 0.1);
  border-bottom: 1px solid rgba(245, 158, 11, 0.3);
  color: #fbbf24;
  font-size: 11px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
}
.banner-pause-icon {
  font-size: 11px;
}

.success-toast {
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.4);
  color: #34d399;
  font-size: 11px;
  font-weight: 600;
  padding: 7px 12px;
  margin: 6px 14px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  box-shadow: 0 2px 10px rgba(16, 185, 129, 0.15);
}
.toast-icon {
  font-size: 12px;
}

.popup-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 14px;
  background-color: #0f111a;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 10px;
  color: #94a3b8;
}

.footer-stats {
  display: flex;
  align-items: center;
  gap: 5px;
}
.stats-icon {
  font-size: 9px;
  color: #64748b;
}

.footer-link {
  background: none;
  border: none;
  color: #818cf8;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.2s ease;
}

.footer-link:hover {
  color: #a5b4fc;
}
.link-arrow {
  font-size: 9px;
  transition: transform 0.2s ease;
}
.footer-link:hover .link-arrow {
  transform: translateX(2px);
}

.banner-slide-enter-active,
.banner-slide-leave-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.banner-slide-enter-from,
.banner-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.card-anim-enter-active,
.card-anim-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.card-anim-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.card-anim-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
.card-anim-move {
  transition: transform 0.2s ease;
}
</style>
