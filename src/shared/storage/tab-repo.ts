import type { TabSessionState } from '../types';
import {
  STORAGE_KEYS,
  deepClone,
  getStorageItem,
  setStorageItem
} from './defaults';
import { AsyncMutex } from './mutex';

/**
 * Dedicated independent mutex for tab session persistence.
 * Completely decoupled from storageMutex to guarantee TabDebuggerManager
 * never blocks or deadlocks during userscript storage operations.
 */
const tabMutex = new AsyncMutex();

/**
 * Retrieves all persisted tab debugger sessions from chrome.storage.local.
 */
export async function getTabSessions(): Promise<Record<number, TabSessionState>> {
  const sessions = await getStorageItem<Record<number, TabSessionState>>(STORAGE_KEYS.TAB_SESSIONS);
  return sessions ? deepClone(sessions) : {};
}

/**
 * Retrieves a single persisted tab debugger session by tabId.
 */
export async function getTabSession(tabId: number): Promise<TabSessionState | undefined> {
  if (tabId === undefined || tabId === null || typeof tabId !== 'number' || isNaN(tabId)) {
    return undefined;
  }
  const key = String(tabId);
  if (key === '__proto__') {
    return undefined;
  }
  const sessions = await getTabSessions();
  return Object.prototype.hasOwnProperty.call(sessions, key) && sessions[tabId]
    ? deepClone(sessions[tabId])
    : undefined;
}

/**
 * Persists a tab debugger session record to chrome.storage.local.
 * Atomic read-modify-write serialized via dedicated tabMutex.
 */
export async function saveTabSession(session: TabSessionState): Promise<void> {
  if (!session || typeof session.tabId !== 'number' || isNaN(session.tabId)) {
    return;
  }
  return tabMutex.runExclusive(async () => {
    const sessions = (await getStorageItem<Record<number, TabSessionState>>(STORAGE_KEYS.TAB_SESSIONS)) || {};
    sessions[session.tabId] = deepClone(session);
    await setStorageItem(STORAGE_KEYS.TAB_SESSIONS, sessions);
  });
}

/**
 * Deletes a persisted tab debugger session record by tabId.
 */
export async function deleteTabSession(tabId: number): Promise<void> {
  if (tabId === undefined || tabId === null || typeof tabId !== 'number' || isNaN(tabId)) {
    return;
  }
  const key = String(tabId);
  if (key === '__proto__') {
    return;
  }
  return tabMutex.runExclusive(async () => {
    const sessions = (await getStorageItem<Record<number, TabSessionState>>(STORAGE_KEYS.TAB_SESSIONS)) || {};
    if (Object.prototype.hasOwnProperty.call(sessions, key)) {
      delete sessions[tabId];
      await setStorageItem(STORAGE_KEYS.TAB_SESSIONS, sessions);
    }
  });
}

/**
 * Completely clears all persisted tab debugger session records.
 */
export async function clearTabSessions(): Promise<void> {
  return tabMutex.runExclusive(async () => {
    await setStorageItem(STORAGE_KEYS.TAB_SESSIONS, {});
  });
}
