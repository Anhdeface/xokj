import type { ScriptRecord, AppSettings } from './types';

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
 * Retrieves a single script by ID, or null if not found.
 */
export async function getScript(id: string): Promise<ScriptRecord | null> {
  const scripts = await getScripts();
  return scripts[id] ? deepClone(scripts[id]) : null;
}

/**
 * Persists a script to chrome.storage.local.
 * Automatically updates updatedAt and sets createdAt if missing.
 */
export async function saveScript(script: ScriptRecord): Promise<ScriptRecord> {
  if (!script || !script.id) {
    throw new Error('Cannot save script without a valid ID');
  }

  const scripts = await getScripts();
  const existing = scripts[script.id];
  const now = Date.now();

  const updatedScript: ScriptRecord = {
    ...deepClone(script),
    createdAt: existing?.createdAt || script.createdAt || now,
    updatedAt: now
  };

  scripts[script.id] = updatedScript;
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
