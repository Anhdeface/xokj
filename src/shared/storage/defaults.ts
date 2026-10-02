import type { ScriptRecord, AppSettings } from '../types';

export const STORAGE_KEYS = {
  SCRIPTS: 'scripts',
  TAB_SESSIONS: 'tab_sessions',
  SETTINGS: 'settings',
  GM_VALUES: 'gm_values'
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
// @grant        GM_setValue
// @grant        GM_getValue
// @cdp          Network.enable
// @cdp          Page.enable
// ==/UserScript==

(function() {
  'use strict';
  console.log('[XOKJ CDP Sample] Initialized on', window.location.href);

  if (typeof cdp !== 'undefined') {
    let requestCount = Number(typeof GM_getValue === 'function' ? GM_getValue('requestCount', 0) : 0);
    console.log('[XOKJ CDP Sample] Cumulative logged requests:', requestCount);

    const unbindRequest = cdp.on('Network.requestWillBeSent', (params) => {
      requestCount += 1;
      console.log('[CDP Request #' + requestCount + ']', params.request.method, params.request.url);
      if (typeof GM_setValue === 'function') {
        GM_setValue('requestCount', requestCount);
      }
    });

    const unbindLoad = cdp.on('Page.loadEventFired', () => {
      console.log('[CDP Page] Load event fired');
    });

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', () => {
        unbindRequest();
        unbindLoad();
      }, { once: true });
    }
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
      grants: ['GM_cdp', 'GM_setValue', 'GM_getValue'],
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
// @grant        GM_setValue
// @grant        GM_getValue
// @cdp          Network.enable
// ==/UserScript==

(async function() {
  'use strict';
  console.log('[XOKJ Cookie Inspector] Running on', window.location.href);
  if (typeof cdp !== 'undefined' && cdp.send) {
    try {
      const cookies = await cdp.send('Network.getCookies', { urls: [window.location.href] });
      console.log('[XOKJ Cookie Inspector] Retrieved cookies via CDP:', cookies);
      if (typeof GM_setValue === 'function' && Array.isArray(cookies)) {
        GM_setValue('last_cookie_count', cookies.length);
        GM_setValue('last_inspected_at', Date.now());
      }
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
      grants: ['GM_cdp', 'GM_setValue', 'GM_getValue'],
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
  if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
    const headings = document.querySelectorAll('h1, h2');
    headings.forEach(function(el) {
      el.style.outline = '2px dashed #4f46e5';
    });
  }
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

deepFreeze(DEFAULT_SETTINGS);
deepFreeze(DEFAULT_SCRIPTS);

/**
 * Internal helper to read raw items from chrome.storage.local
 */
export async function getStorageItem<T>(key: string): Promise<T | undefined> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return undefined;
  }
  if (!key || typeof key !== 'string' || key === '__proto__') {
    return undefined;
  }
  const result = await chrome.storage.local.get(key);
  return result && Object.prototype.hasOwnProperty.call(result, key) && result[key] !== undefined
    ? (result[key] as T)
    : undefined;
}

/**
 * Internal helper to write items to chrome.storage.local
 */
export async function setStorageItem<T>(key: string, value: T): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  await chrome.storage.local.set({ [key]: value });
}

/**
 * Internal helper to remove items from chrome.storage.local
 */
export async function removeStorageItem(key: string | string[]): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  await chrome.storage.local.remove(key);
}
