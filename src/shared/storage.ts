import type { ScriptRecord, AppSettings, ScriptFilter } from './types';
import { parseMetadata } from './metadata-parser';
import { matchesAny, isRestrictedUrl } from './match-pattern';

export const STORAGE_KEYS = {
  SCRIPTS: 'scripts',
  TAB_SESSIONS: 'tab_sessions',
  SETTINGS: 'settings'
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  globalEnabled: true,
  autoAttachDebugger: true,
  debuggerProtocolVersion: '1.3',
  logLevel: 'info'
};

/**
 * Default sample scripts pre-seeded into extension storage.
 * Includes a sample script demonstrating declarative CDP Network and Page domain enablement.
 */
export const DEFAULT_SCRIPTS: Record<string, ScriptRecord> = {
  'sample-cdp-logger': {
    id: 'sample-cdp-logger',
    name: 'CDP Network & Page Logger',
    code: `// ==UserScript==
// @name         CDP Network & Page Logger
// @namespace    https://xokj.dev/scripts
// @version      1.0.0
// @description  Declaratively enables Network and Page domains via CDP and logs request activity
// @match        *://*.example.com/*
// @match        https://httpbin.org/*
// @run-at       document-start
// @grant        GM_cdp
// @cdp          Network.enable
// @cdp          Page.enable
// ==/UserScript==

(function() {
  'use strict';
  console.log('[XOKJ CDP Sample] Initialized on', window.location.href);

  if (typeof cdp !== 'undefined') {
    cdp.on('Network.requestWillBeSent', (params) => {
      console.log('[CDP Request]', params.request.method, params.request.url);
    });
    cdp.on('Page.loadEventFired', () => {
      console.log('[CDP Page] Load event fired');
    });
  }
})();`,
    metadata: {
      name: 'CDP Network & Page Logger',
      namespace: 'https://xokj.dev/scripts',
      version: '1.0.0',
      description: 'Declaratively enables Network and Page domains via CDP and logs request activity',
      matches: ['*://*.example.com/*', 'https://httpbin.org/*'],
      matchPatterns: ['*://*.example.com/*', 'https://httpbin.org/*'],
      includes: [],
      excludes: [],
      runAt: 'document-start',
      grants: ['GM_cdp'],
      cdp: [
        { domain: 'Network', method: 'enable', command: 'Network.enable', params: {}, raw: 'Network.enable' },
        { domain: 'Page', method: 'enable', command: 'Page.enable', params: {}, raw: 'Page.enable' }
      ],
      cdpDeclarations: [
        { domain: 'Network', method: 'enable', command: 'Network.enable', params: {}, raw: 'Network.enable' },
        { domain: 'Page', method: 'enable', command: 'Page.enable', params: {}, raw: 'Page.enable' }
      ],
      cdpDomains: ['Network', 'Page'],
      requires: [],
      resources: {},
      noframes: false,
      connects: [],
      rawEntries: {}
    },
    enabled: true,
    createdAt: 1726744800000,
    updatedAt: 1726744800000
  },
  'sample-cookie-inspector': {
    id: 'sample-cookie-inspector',
    name: 'CDP Cookie & Header Inspector',
    code: `// ==UserScript==
// @name         CDP Cookie & Header Inspector
// @namespace    https://xokj.dev/scripts
// @version      1.1.0
// @description  Inspects browser cookies and network state via asynchronous CDP RPC
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_cdp
// @cdp          Network.enable
// ==/UserScript==

(async function() {
  'use strict';
  console.log('[XOKJ Cookie Inspector] Running on', window.location.href);
  if (typeof cdp !== 'undefined' && cdp.send) {
    try {
      const cookies = await cdp.send('Network.getCookies', { urls: [window.location.href] });
      console.log('[XOKJ Cookie Inspector] Retrieved cookies via CDP:', cookies);
    } catch (err) {
      console.warn('[XOKJ Cookie Inspector] CDP call failed or DevTools conflict:', err);
    }
  }
})();`,
    metadata: {
      name: 'CDP Cookie & Header Inspector',
      namespace: 'https://xokj.dev/scripts',
      version: '1.1.0',
      description: 'Inspects browser cookies and network state via asynchronous CDP RPC',
      matches: ['*://*/*'],
      matchPatterns: ['*://*/*'],
      includes: [],
      excludes: [],
      runAt: 'document-idle',
      grants: ['GM_cdp'],
      cdp: [
        { domain: 'Network', method: 'enable', command: 'Network.enable', params: {}, raw: 'Network.enable' }
      ],
      cdpDeclarations: [
        { domain: 'Network', method: 'enable', command: 'Network.enable', params: {}, raw: 'Network.enable' }
      ],
      cdpDomains: ['Network'],
      requires: [],
      resources: {},
      noframes: false,
      connects: [],
      rawEntries: {}
    },
    enabled: true,
    createdAt: 1726744800000,
    updatedAt: 1726744800000
  },
  'sample-dom-highlighter': {
    id: 'sample-dom-highlighter',
    name: 'DOM Element Highlighter',
    code: `// ==UserScript==
// @name         DOM Element Highlighter
// @namespace    https://xokj.dev/scripts
// @version      1.0.0
// @description  Minimalist userscript demonstrating standard DOM manipulation without CDP
// @match        <all_urls>
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function() {
  'use strict';
  console.log('[XOKJ DOM Highlighter] Injected into', window.location.href);
})();`,
    metadata: {
      name: 'DOM Element Highlighter',
      namespace: 'https://xokj.dev/scripts',
      version: '1.0.0',
      description: 'Minimalist userscript demonstrating standard DOM manipulation without CDP',
      matches: ['<all_urls>'],
      matchPatterns: ['<all_urls>'],
      includes: [],
      excludes: [],
      runAt: 'document-end',
      grants: ['none'],
      cdp: [],
      cdpDeclarations: [],
      cdpDomains: [],
      requires: [],
      resources: {},
      noframes: false,
      connects: [],
      rawEntries: {}
    },
    enabled: true,
    createdAt: 1726744800000,
    updatedAt: 1726744800000
  }
};

/**
 * Safe deep clone utility using structuredClone with JSON fallback.
 */
export function deepClone<T>(val: T): T {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (typeof structuredClone === 'function') {
    return structuredClone(val);
  }
  return JSON.parse(JSON.stringify(val));
}

/**
 * Deep freezes an object and all nested object properties.
 */
export function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key];
    if (val && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

// Freeze defaults at module load to prevent in-memory mutation
deepFreeze(DEFAULT_SETTINGS);
deepFreeze(DEFAULT_SCRIPTS);

/**
 * Internal helper to read raw items from chrome.storage.local
 */
async function getStorageItem<T>(key: string): Promise<T | undefined> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return undefined;
  }
  const result = await chrome.storage.local.get(key);
  return result[key] !== undefined ? deepClone(result[key] as T) : undefined;
}

/**
 * Internal helper to write items to chrome.storage.local
 */
async function setStorageItem<T>(key: string, value: T): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  await chrome.storage.local.set({ [key]: deepClone(value) });
}

/**
 * Retrieves all stored scripts.
 * If storage is empty, automatically seeds with DEFAULT_SCRIPTS.
 * Always returns deep-cloned records to protect internal storage.
 */
export async function getScripts(): Promise<Record<string, ScriptRecord>> {
  const scripts = await getStorageItem<Record<string, ScriptRecord>>(STORAGE_KEYS.SCRIPTS);
  if (scripts === undefined || scripts === null) {
    const initial = deepClone(DEFAULT_SCRIPTS);
    await setStorageItem(STORAGE_KEYS.SCRIPTS, initial);
    return deepClone(initial);
  }
  return deepClone(scripts);
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
  const scripts = await getScripts();
  return scripts[id] ? deepClone(scripts[id]) : null;
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

  const scripts = await getScripts();
  const now = Date.now();

  let id = script.id;
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `script_${now}_${Math.random().toString(36).slice(2, 7)}`;
  }

  const existing = scripts[id];
  const existingCodeChanged = Boolean(existing && existing.code !== script.code);

  let metadata = script.metadata;
  let parseErrors: string[] | undefined = existing?.parseErrors;

  const metadataMissing =
    !metadata ||
    ((!metadata.matches || metadata.matches.length === 0) &&
      (!metadata.matchPatterns || metadata.matchPatterns.length === 0));

  if (existingCodeChanged || metadataMissing) {
    const parseRes = parseMetadata(script.code);
    metadata = parseRes.metadata;
    parseErrors = parseRes.errors.length > 0 ? parseRes.errors : undefined;
  }

  if (!metadata) {
    const parseRes = parseMetadata(script.code);
    metadata = parseRes.metadata;
  }

  const name = script.name || metadata.name || existing?.name || 'Unnamed Script';

  const updatedScript: ScriptRecord = {
    id,
    name,
    code: script.code,
    metadata: deepClone(metadata),
    enabled: typeof script.enabled === 'boolean' ? script.enabled : existing?.enabled ?? true,
    createdAt: existing?.createdAt || script.createdAt || now,
    updatedAt: now,
    lastRunAt: existing?.lastRunAt || script.lastRunAt,
    parseErrors
  };

  scripts[id] = updatedScript;
  await setStorageItem(STORAGE_KEYS.SCRIPTS, scripts);
  return deepClone(updatedScript);
}

/**
 * Deletes a script by ID from chrome.storage.local.
 * Never mutates DEFAULT_SCRIPTS.
 */
export async function deleteScript(id: string): Promise<void> {
  const scripts = await getScripts();
  if (scripts[id]) {
    delete scripts[id];
    await setStorageItem(STORAGE_KEYS.SCRIPTS, scripts);
  }
}

/**
 * Toggles a script's enabled state.
 * If `enabled` parameter is provided, sets it to that boolean.
 * Otherwise flips current value.
 */
export async function toggleScript(id: string, enabled?: boolean): Promise<boolean> {
  const scripts = await getScripts();
  const script = scripts[id];
  if (!script) {
    throw new Error(`Script with ID "${id}" not found`);
  }

  const newStatus = typeof enabled === 'boolean' ? enabled : !script.enabled;
  script.enabled = newStatus;
  script.updatedAt = Date.now();

  await setStorageItem(STORAGE_KEYS.SCRIPTS, scripts);
  return newStatus;
}

/**
 * Resets scripts in storage back to the initial default sample scripts.
 * Deep-clones DEFAULT_SCRIPTS so the template remains intact.
 */
export async function resetToDefaultScripts(): Promise<Record<string, ScriptRecord>> {
  const defaults = deepClone(DEFAULT_SCRIPTS);
  await setStorageItem(STORAGE_KEYS.SCRIPTS, defaults);
  return deepClone(defaults);
}

/**
 * Export bundle format.
 */
export interface ExportBundle {
  version: number;
  exportedAt: number;
  generator: string;
  scripts: ScriptRecord[];
}

/**
 * Exports userscripts as a formatted JSON string.
 */
export async function exportScripts(scriptIds?: string[]): Promise<string> {
  const all = await getScriptList();
  const toExport =
    scriptIds && scriptIds.length > 0
      ? all.filter((s) => scriptIds.includes(s.id))
      : all;

  const bundle: ExportBundle = {
    version: 1,
    exportedAt: Date.now(),
    generator: 'XOKJ Userscript Manager',
    scripts: toExport
  };

  return JSON.stringify(bundle, null, 2);
}

/**
 * Import result statistics.
 */
export interface ImportResult {
  total: number;
  imported: number;
  updated: number;
  failed: number;
  errors?: string[];
  scripts?: ScriptRecord[];
}

/**
 * Imports scripts from a JSON string or an array of script objects.
 */
export async function importScripts(
  jsonOrArray: string | ScriptRecord[] | any,
  options: { overwrite?: boolean; autoEnable?: boolean } = {}
): Promise<ImportResult> {
  const result: ImportResult = {
    total: 0,
    imported: 0,
    updated: 0,
    failed: 0,
    errors: [],
    scripts: []
  };

  let rawList: any[] = [];
  try {
    if (typeof jsonOrArray === 'string') {
      const trimmed = jsonOrArray.trim();
      if (trimmed.startsWith('// ==UserScript==')) {
        rawList = [{ code: trimmed }];
      } else {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          rawList = parsed;
        } else if (parsed && Array.isArray(parsed.scripts)) {
          rawList = parsed.scripts;
        } else if (parsed && typeof parsed.code === 'string') {
          rawList = [parsed];
        } else {
          throw new Error('Unrecognized JSON format: expected array or bundle with "scripts"');
        }
      }
    } else if (Array.isArray(jsonOrArray)) {
      rawList = jsonOrArray;
    } else if (jsonOrArray && typeof jsonOrArray === 'object' && typeof jsonOrArray.code === 'string') {
      rawList = [jsonOrArray];
    } else {
      throw new Error('Import data must be a JSON string, a script object, or an array of scripts');
    }
  } catch (err: any) {
    result.errors!.push(`Parse error: ${err.message || String(err)}`);
    return result;
  }

  result.total = rawList.length;
  const existingScripts = await getScripts();

  for (let i = 0; i < rawList.length; i++) {
    const raw = rawList[i];
    try {
      if (!raw || typeof raw.code !== 'string') {
        result.failed++;
        result.errors!.push(`Item #${i + 1} skipped: missing "code" property`);
        continue;
      }

      const hasId = raw.id && typeof raw.id === 'string';
      const exists = hasId && !!existingScripts[raw.id];

      const itemToSave = { ...raw };
      if (exists && !options.overwrite) {
        itemToSave.id = undefined; // Generate new ID
      }

      if (options.autoEnable !== undefined) {
        itemToSave.enabled = options.autoEnable;
      }

      const saved = await saveScript(itemToSave);
      result.scripts!.push(saved);

      if (exists && options.overwrite) {
        result.updated++;
      } else {
        result.imported++;
      }
    } catch (err: any) {
      result.failed++;
      result.errors!.push(`Item #${i + 1} error: ${err.message || String(err)}`);
    }
  }

  return result;
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

/**
 * Retrieves global application settings.
 */
export async function getSettings(): Promise<AppSettings> {
  const settings = await getStorageItem<AppSettings>(STORAGE_KEYS.SETTINGS);
  return settings ? deepClone(settings) : deepClone(DEFAULT_SETTINGS);
}

/**
 * Updates application settings.
 */
export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const updated = { ...current, ...deepClone(settings) };
  await setStorageItem(STORAGE_KEYS.SETTINGS, updated);
  return deepClone(updated);
}
