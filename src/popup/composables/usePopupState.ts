import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { ScriptRecord, DebuggerSessionStatus, AppSettings } from '@/shared/types';
import { getScripts, getSettings, saveSettings, toggleScript as storageToggleScript } from '@/shared/storage';
import { isRestrictedUrl, matchesAny } from '@/shared/match-pattern';

export interface TabInfo {
  id: number | null;
  url: string;
  title: string;
  favIconUrl?: string;
  isRestricted: boolean;
  hostname: string;
}

export function usePopupState() {
  const tabInfo = ref<TabInfo>({
    id: null,
    url: '',
    title: '',
    favIconUrl: undefined,
    isRestricted: false,
    hostname: ''
  });

  const globalEnabled = ref<boolean>(true);
  const cdpStatus = ref<DebuggerSessionStatus>('IDLE');
  const conflictReason = ref<string | undefined>(undefined);
  const scripts = ref<ScriptRecord[]>([]);
  const isLoading = ref<boolean>(true);
  const isReconnecting = ref<boolean>(false);
  const reconnectError = ref<string | null>(null);
  const reconnectSuccess = ref<boolean>(false);

  function extractHostname(url: string): string {
    if (!url) return '';
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  // Reactive matching scripts computed from in-memory scripts list
  const matchingScripts = computed<ScriptRecord[]>(() => {
    const url = tabInfo.value.url;
    if (!url || tabInfo.value.isRestricted) return [];

    return scripts.value.filter((script) => {
      // Exclusions take precedence
      if (matchesAny(script.metadata?.excludes || [], url)) return false;

      const patterns = script.metadata?.matches?.length
        ? script.metadata.matches
        : script.metadata?.matchPatterns?.length
        ? script.metadata.matchPatterns
        : script.metadata?.includes || [];

      return matchesAny(patterns, url);
    });
  });

  const activeCount = computed(() => {
    return matchingScripts.value.filter((s) => s.enabled).length;
  });

  async function queryActiveTab(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
      tabInfo.value = {
        id: 1,
        url: 'https://example.com/test',
        title: 'Example Domain',
        isRestricted: false,
        hostname: 'example.com'
      };
      return;
    }

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const url = tab.url || '';
        tabInfo.value = {
          id: tab.id ?? null,
          url,
          title: tab.title || '',
          favIconUrl: tab.favIconUrl,
          isRestricted: isRestrictedUrl(url),
          hostname: extractHostname(url)
        };
      }
    } catch (err) {
      console.warn('[usePopupState] Failed to query active tab:', err);
    }
  }

  async function loadCdpStatus(): Promise<void> {
    const tabId = tabInfo.value.id;
    if (tabId === null || typeof chrome === 'undefined' || !chrome.storage?.local) {
      cdpStatus.value = 'IDLE';
      return;
    }

    try {
      const stored = await chrome.storage.local.get('tab_sessions');
      const sessions = stored.tab_sessions || {};
      const session = sessions[tabId];
      if (session) {
        cdpStatus.value = session.status || 'IDLE';
        conflictReason.value = session.conflictReason;
      } else {
        cdpStatus.value = 'IDLE';
      }
    } catch {
      cdpStatus.value = 'IDLE';
    }
  }

  async function syncFromBackground(): Promise<void> {
    const tabId = tabInfo.value.id;
    if (tabId === null || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_ACTIVE_SCRIPTS_FOR_TAB',
        tabId,
        url: tabInfo.value.url
      });
      if (response && response.cdpStatus) {
        cdpStatus.value = response.cdpStatus;
        conflictReason.value = response.conflictReason;
      }
    } catch {
      // Ignore IPC fallback errors
    }
  }

  function handleRuntimeMessage(message: any): void {
    if (!message) return;

    if (message.type === 'CDP_LIFECYCLE_EVENT') {
      if (message.tabId === tabInfo.value.id) {
        cdpStatus.value = message.status;
        conflictReason.value = message.reason;

        if (message.status === 'ATTACHED') {
          reconnectError.value = null;
          reconnectSuccess.value = true;
          setTimeout(() => {
            reconnectSuccess.value = false;
          }, 3000);
        }
      }
    }
  }

  function handleStorageChanged(
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void {
    if (areaName !== 'local') return;

    if (changes.scripts) {
      const newScripts = changes.scripts.newValue || {};
      scripts.value = Object.values(newScripts);
    }

    if (changes.settings) {
      const newSettings: AppSettings = changes.settings.newValue;
      if (newSettings && typeof newSettings.globalEnabled === 'boolean') {
        globalEnabled.value = newSettings.globalEnabled;
      }
    }

    if (changes.tab_sessions && tabInfo.value.id !== null) {
      const sessions = changes.tab_sessions.newValue || {};
      const current = sessions[tabInfo.value.id];
      if (current) {
        cdpStatus.value = current.status;
        conflictReason.value = current.conflictReason;
      }
    }
  }

  async function toggleGlobal(enabled: boolean): Promise<void> {
    globalEnabled.value = enabled;
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'TOGGLE_GLOBAL', enabled }).catch(() => {});
    }
    await saveSettings({ globalEnabled: enabled });
  }

  async function toggleScript(scriptId: string, enabled: boolean): Promise<void> {
    const target = scripts.value.find((s) => s.id === scriptId);
    if (target) {
      target.enabled = enabled;
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'TOGGLE_SCRIPT', scriptId, enabled }).catch(() => {});
    }
    await storageToggleScript(scriptId, enabled);
  }

  async function reconnectCdp(): Promise<void> {
    const tabId = tabInfo.value.id;
    if (tabId === null || isReconnecting.value) return;

    isReconnecting.value = true;
    reconnectError.value = null;
    reconnectSuccess.value = false;

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({
          type: 'RECONNECT_CDP',
          tabId
        });

        if (response && !response.success) {
          reconnectError.value = response.error || 'Failed to reconnect debugger';
        } else {
          cdpStatus.value = 'ATTACHED';
          conflictReason.value = undefined;
          reconnectSuccess.value = true;
          setTimeout(() => {
            reconnectSuccess.value = false;
          }, 3000);
        }
      } else {
        cdpStatus.value = 'ATTACHED';
        reconnectSuccess.value = true;
      }
    } catch (err: any) {
      reconnectError.value = err?.message || 'Error communicating with background worker';
    } finally {
      isReconnecting.value = false;
    }
  }

  async function reloadTab(): Promise<void> {
    const tabId = tabInfo.value.id;
    if (tabId !== null && typeof chrome !== 'undefined' && chrome.tabs?.reload) {
      await chrome.tabs.reload(tabId);
    }
  }

  function openDashboard(scriptId?: string): void {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }

    const path = scriptId
      ? `src/dashboard/index.html?script=${encodeURIComponent(scriptId)}`
      : 'src/dashboard/index.html';

    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: chrome.runtime?.getURL ? chrome.runtime.getURL(path) : path });
    } else if (typeof window !== 'undefined') {
      window.open(path, '_blank');
    }
  }

  onMounted(async () => {
    isLoading.value = true;
    try {
      await queryActiveTab();
      const [allScripts, currentSettings] = await Promise.all([
        getScripts(),
        getSettings()
      ]);
      scripts.value = Object.values(allScripts);
      globalEnabled.value = currentSettings.globalEnabled ?? true;
      await loadCdpStatus();
      await syncFromBackground();

      if (typeof chrome !== 'undefined') {
        chrome.runtime?.onMessage?.addListener(handleRuntimeMessage);
        chrome.storage?.onChanged?.addListener(handleStorageChanged);
      }
    } finally {
      isLoading.value = false;
    }
  });

  onUnmounted(() => {
    if (typeof chrome !== 'undefined') {
      chrome.runtime?.onMessage?.removeListener(handleRuntimeMessage);
      chrome.storage?.onChanged?.removeListener(handleStorageChanged);
    }
  });

  return {
    tabInfo,
    globalEnabled,
    cdpStatus,
    conflictReason,
    scripts,
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
  };
}
