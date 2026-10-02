import type { ScriptRecord, ScriptFilter } from '../types';
import { matchesAny, isRestrictedUrl } from '../match-pattern';
import {
  STORAGE_KEYS,
  DEFAULT_SCRIPTS,
  deepClone,
  getStorageItem,
  setStorageItem
} from './defaults';
import { storageMutex } from './mutex';
import { prepareScriptRecord } from './script-record';

/**
 * Internal helper to read scripts directly from storage without acquiring the mutex.
 * Must only be called within mutex-locked execution contexts or when seeding.
 */
export async function getScriptsInternal(): Promise<Record<string, ScriptRecord>> {
  const scripts = await getStorageItem<Record<string, ScriptRecord>>(STORAGE_KEYS.SCRIPTS);
  if (scripts === undefined || scripts === null) {
    const initial = deepClone(DEFAULT_SCRIPTS);
    await setStorageItem(STORAGE_KEYS.SCRIPTS, initial);
    return initial;
  }
  return scripts;
}

/**
 * Retrieves all stored scripts.
 * If storage is empty, safely acquires mutex to seed with DEFAULT_SCRIPTS.
 * Once initialized, serves direct parallel reads with zero mutex contention.
 * Always returns records to protect internal storage.
 */
export async function getScripts(): Promise<Record<string, ScriptRecord>> {
  const scripts = await getStorageItem<Record<string, ScriptRecord>>(STORAGE_KEYS.SCRIPTS);
  if (scripts === undefined || scripts === null) {
    return storageMutex.runExclusive(async () => {
      return getScriptsInternal();
    });
  }
  return scripts;
}

/**
 * Retrieves an array of all stored scripts.
 */
export async function getScriptList(): Promise<ScriptRecord[]> {
  const scripts = await getScripts();
  return Object.values(scripts);
}

/**
 * Extended querying helper with filtering by enabled state, URL pattern match, runAt, search text, domain.
 */
export async function getAllScripts(filter?: ScriptFilter): Promise<ScriptRecord[]> {
  const list = await getScriptList();
  if (!filter) return list;

  return list.filter((script) => {
    if (filter.enabled !== undefined && script.enabled !== filter.enabled) return false;
    if (filter.enabledOnly && !script.enabled) return false;
    if (filter.runAt && (script.metadata?.runAt || 'document-idle') !== filter.runAt) return false;

    if (filter.search) {
      const q = filter.search.toLowerCase();
      const matchName = script.name.toLowerCase().includes(q);
      const matchDesc = script.metadata?.description?.toLowerCase().includes(q);
      const matchCode = script.code.toLowerCase().includes(q);
      if (!matchName && !matchDesc && !matchCode) return false;
    }

    if (filter.url) {
      if (isRestrictedUrl(filter.url)) return false;
      if (matchesAny(script.metadata?.excludes || [], filter.url)) return false;
      const patterns =
        script.metadata?.matches?.length
          ? script.metadata.matches
          : script.metadata?.matchPatterns?.length
          ? script.metadata.matchPatterns
          : script.metadata?.includes || [];
      if (!matchesAny(patterns, filter.url)) return false;
    }

    if (filter.domain) {
      const patterns = script.metadata?.matches || script.metadata?.matchPatterns || [];
      const hasDomain = patterns.some((p) => p.includes(filter.domain!));
      if (!hasDomain) return false;
    }

    return true;
  });
}

/**
 * Retrieves a single script by ID, or null if not found.
 */
export async function getScript(id: string): Promise<ScriptRecord | null> {
  if (!id || typeof id !== 'string' || id === '__proto__') {
    return null;
  }
  const scripts = await getScripts();
  return Object.prototype.hasOwnProperty.call(scripts, id) ? deepClone(scripts[id]) : null;
}

/**
 * Persists a script to chrome.storage.local.
 * Automatically updates updatedAt and sets createdAt if missing.
 * Auto-parses metadata from code if code changed or metadata was not provided.
 */
export async function saveScript(
  script: ScriptRecord | (Partial<ScriptRecord> & { code: string; id?: string })
): Promise<ScriptRecord> {
  if (!script || typeof script.code !== 'string') {
    throw new Error('Cannot save script without valid source code');
  }
  if (script.id === '__proto__') {
    throw new Error('Invalid script ID: "__proto__" is reserved');
  }

  return storageMutex.runExclusive(async () => {
    const scripts = await getScriptsInternal();
    const now = Date.now();
    const existing =
      script.id && Object.prototype.hasOwnProperty.call(scripts, script.id)
        ? scripts[script.id]
        : undefined;
    const updated = prepareScriptRecord(script, existing, now);

    if (updated.id === '__proto__') {
      throw new Error('Invalid script ID: "__proto__" is reserved');
    }

    if (!script.id) {
      while (
        Object.prototype.hasOwnProperty.call(scripts, updated.id) ||
        updated.id === '__proto__'
      ) {
        updated.id =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `script_${now}_${Math.random().toString(36).slice(2, 7)}`;
      }
    }

    scripts[updated.id] = updated;
    await setStorageItem(STORAGE_KEYS.SCRIPTS, scripts);
    return deepClone(updated);
  });
}

/**
 * Deletes a script by ID from chrome.storage.local.
 * Never mutates DEFAULT_SCRIPTS.
 */
export async function deleteScript(id: string): Promise<void> {
  if (!id || typeof id !== 'string' || id === '__proto__') {
    return;
  }

  return storageMutex.runExclusive(async () => {
    const scripts = await getScriptsInternal();
    if (Object.prototype.hasOwnProperty.call(scripts, id)) {
      delete scripts[id];
      await setStorageItem(STORAGE_KEYS.SCRIPTS, scripts);
    }
  });
}

/**
 * Toggles a script's enabled state.
 * If `enabled` parameter is provided, sets it to that boolean.
 * Otherwise flips current value.
 */
export async function toggleScript(id: string, enabled?: boolean): Promise<boolean> {
  if (!id || typeof id !== 'string' || id === '__proto__') {
    throw new Error(`Script with ID "${id}" not found`);
  }

  return storageMutex.runExclusive(async () => {
    const scripts = await getScriptsInternal();
    if (!Object.prototype.hasOwnProperty.call(scripts, id)) {
      throw new Error(`Script with ID "${id}" not found`);
    }

    const script = scripts[id];
    const newStatus = typeof enabled === 'boolean' ? enabled : !script.enabled;
    script.enabled = newStatus;
    script.updatedAt = Date.now();

    await setStorageItem(STORAGE_KEYS.SCRIPTS, scripts);
    return newStatus;
  });
}

/**
 * Resets scripts in storage back to the initial default sample scripts.
 * Deep-clones DEFAULT_SCRIPTS so the template remains intact.
 */
export async function resetToDefaultScripts(): Promise<Record<string, ScriptRecord>> {
  return storageMutex.runExclusive(async () => {
    const defaults = deepClone(DEFAULT_SCRIPTS);
    await setStorageItem(STORAGE_KEYS.SCRIPTS, defaults);
    return defaults;
  });
}

/**
 * Subscribes to storage changes on the scripts collection.
 */
export function onScriptsChanged(
  callback: (scripts: Record<string, ScriptRecord>) => void
): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
    return () => {};
  }

  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.SCRIPTS]) {
      const newValue = changes[STORAGE_KEYS.SCRIPTS].newValue || {};
      callback(deepClone(newValue));
    }
  };

  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
