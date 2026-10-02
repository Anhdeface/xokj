# XOKJ Extension Technical Manual

[![Extension Version](https://img.shields.io/github/package-json/v/Anhdeface/xokj?filename=package.json&label=extension%20version&color=blue)](package.json)
[![Manifest](https://img.shields.io/badge/Manifest-V3-success)](manifest.config.ts)
[![Vue](https://img.shields.io/github/package-json/dependency-version/Anhdeface/xokj/vue?filename=package.json&color=emerald)](package.json)
[![Vite](https://img.shields.io/github/package-json/dependency-version/Anhdeface/xokj/vite?filename=package.json&color=purple)](package.json)
[![CodeMirror](https://img.shields.io/github/package-json/dependency-version/Anhdeface/xokj/codemirror?filename=package.json&color=blue)](package.json)
[![License](https://img.shields.io/github/license/Anhdeface/xokj?color=gray)](LICENSE)

An open-source Chromium Userscript Manager built on Manifest V3, providing a hybrid Chrome DevTools Protocol (CDP) control plane for browser automation and userscript development.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Subsystems and Internal Implementation](#3-subsystems-and-internal-implementation)
   - [3.1. Background Service Worker Subsystem](#31-background-service-worker-subsystem)
   - [3.2. Content Script and Execution Bridge](#32-content-script-and-execution-bridge)
   - [3.3. DevTools Conflict Management](#33-devtools-conflict-management)
   - [3.4. Userscript Injection Engine and Lifecycle](#34-userscript-injection-engine-and-lifecycle)
   - [3.5. Storage Engine and Concurrency Mutex](#35-storage-engine-and-concurrency-mutex)
   - [3.6. User Interface Subsystems](#36-user-interface-subsystems)
4. [Metadata Specification and Client API](#4-metadata-specification-and-client-api)
   - [4.1. Metadata Directives](#41-metadata-directives)
   - [4.2. CDP Client API Interface](#42-cdp-client-api-interface)
   - [4.3. Standard GM API Polyfills](#43-standard-gm-api-polyfills)
5. [Technology Stack and Dependency Matrix](#5-technology-stack-and-dependency-matrix)
6. [Codebase Organization](#6-codebase-organization)
7. [Building and Loading into Chromium](#7-building-and-loading-into-chromium)
8. [Security and Execution Boundary Constraints](#8-security-and-execution-boundary-constraints)
9. [License](#9-license)

---

## 1. Overview

XOKJ is a specialized userscript engine designed for Chromium-based browsers (Google Chrome, Microsoft Edge, Brave, Chromium). Built to comply with Manifest V3 service worker lifecycle constraints, it introduces a bi-directional communication bridge between standard web execution contexts (MAIN world) and the browser's underlying Chrome DevTools Protocol (CDP) backend via the `chrome.debugger` API.

This architecture enables userscripts to perform protocol-level operations—such as low-level network request interception, cookie manipulation, synthetic input dispatch, and frame navigation—directly from userscript code without requiring external automation binaries (such as Puppeteer or Selenium).

---

## 2. Architecture Overview

The system operates across three distinct execution tiers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Web Page Context (MAIN World)                        │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        Userscript Execution                         │   │
│   │   cdp.send('Network.getCookies') / cdp.on('Page.loadEventFired')    │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
│                                      │ window.postMessage                   │
│                                      ▼                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                   Userscript CDP SDK & Sandbox                      │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       │ window.postMessage
┌──────────────────────────────────────┼──────────────────────────────────────┐
│                                      ▼                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │              Content Script Bridge (ISOLATED World)                 │   │
│   └──────────────────────────────────┬──────────────────────────────────┘   │
│                                      │ chrome.runtime.sendMessage           │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                    Background Service Worker (MV3)                          │
│                                                                             │
│   ┌───────────────────────┐                    ┌────────────────────────┐   │
│   │    CdpBridgeServer    │◄───────────────────┤   TabDebuggerManager   │   │
│   │ (Async RPC & Events)  │                    │(Session State Machine) │   │
│   └───────────┬───────────┘                    └───────────┬────────────┘   │
│               │                                            │                │
│   ┌───────────▼───────────┐                    ┌───────────▼────────────┐   │
│   │  DevToolsConflictMgr  │                    │     ScriptInjector     │   │
│   │(Conflict Handling &   │                    │ (@run-at lifecycle &   │   │
│   │ Inflight Rejection)   │                    │ declarative CDP init)  │   │
│   └───────────────────────┘                    └────────────────────────┘   │
│                                                            │                │
│                                                            ▼                │
│                                               chrome.debugger / CDP Host    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Subsystems and Internal Implementation

### 3.1. Background Service Worker Subsystem
The background tier (`src/background/`) coordinates tab lifecycles, storage mutations, and debugger attachments:
- **TabDebuggerManager (`src/background/debugger-mgr.ts`)**: Implements an authoritative state machine for every active browser tab (`IDLE`, `ATTACHING`, `ATTACHED`, `DETACHED`, `CONFLICT`). Ensures mutex-guaranteed attachment routines to prevent concurrent attach race conditions.
- **CdpBridgeServer (`src/background/cdp-bridge.ts` & `src/background/cdp/`)**: Modular coordinator handling asynchronous RPC message routing (`router.ts`), in-flight timeout protection (`timeout-guard.ts`), permission validation (`permission-guard.ts`), and CDP event/lifecycle broadcasting (`broadcaster.ts`).
- **Declarative Domain Initialization**: Pre-enables protocol domains requested in script headers (e.g., `Network.enable`, `Page.enable`) upon debugger attachment using parallel `Promise.allSettled` execution.
- **Persistent GM Storage Handler (`src/background/gm-handler.ts`)**: Routes userscript storage mutations (`GM_STORAGE_SET`, `GM_STORAGE_DELETE`) to `GmStorageRepository`.

### 3.2. Content Script and Execution Bridge
Content scripts (`src/content/`) establish communication channels between web pages and the extension service worker:
- **Bridge Relay (`src/content/bridge.ts` & `src/content/bridge/`)**: Intercepts `window.postMessage` payloads in the ISOLATED world, performs 4-layer validation (`validator.ts`), tracks in-flight RPC commands (`request-manager.ts`), relays live CDP events (`event-relayer.ts`), and forwards storage mutations (`storage-forwarder.ts`).
- **Execution Sandbox (`src/background/injector/page-runner.ts` & `src/content/sandbox.ts`)**: Evaluates userscript code directly in the target tab's MAIN world via `chrome.scripting.executeScript`. Injects only authorized client APIs (`GM_*`, `cdp`) and shadows ungranted globals with `undefined`.
- **CDP Client SDK (`src/content/cdp-sdk.ts`)**: Provides client-facing `cdp.send()`, `cdp.on()`, `cdp.off()`, `cdp.getStatus()`, `cdp.isAttached()`, and `GM_cdp(...)` interfaces exposed to userscripts.

### 3.3. DevTools Conflict Management
Chromium permits only a single debugging client to attach to a tab at any given time.
- **Conflict Detection (`src/background/conflict-mgr.ts`)**: Detects when native Chrome DevTools is opened on a managed tab by listening to `chrome.debugger.onDetach` events with reason `canceled_by_user`.
- **In-Flight Request Settlement**: Rejects all pending CDP promises for the detached tab with error code `1001` (`DevToolsConflictError`), preventing hanging asynchronous operations.
- **Reconnection Handling**: Transmits conflict status updates to the UI, allowing the user to resume CDP automation once native DevTools is closed.

### 3.4. Userscript Injection Engine and Lifecycle
- **Metadata Lexical Parser (`src/shared/metadata-parser.ts`)**: Tokenizes the userscript comment block to extract script directives (`@name`, `@match`, `@grant`, `@cdp`).
- **Match Pattern Engine (`src/shared/match-pattern.ts`)**: Compiles standard Chrome match patterns into regular expressions with a bounded Least Recently Used (LRU) cache (capacity: 1,000 entries) to optimize URL matching during page navigation.
- **Injection Scheduler (`src/background/injector.ts` & `src/background/injector/`)**: Coordinates script execution across three standard lifecycle phases (`document-start`, `document-end`, `document-idle`), subframe deduplication (`dedup-tracker.ts`), pre-hydrated storage snapshot loading (`storage-loader.ts`), and serialized MAIN-world page execution (`page-runner.ts`).
- **Frame Deduplication**: Maintains hierarchical tracking maps to prevent duplicate script execution in subframes.

### 3.5. Storage Engine and Concurrency Mutex
- **Modular Storage Architecture (`src/shared/storage/`)**: Partitioned into single-responsibility submodules:
  - `defaults.ts`: Storage keys, factory configurations, default sample scripts (`sample-cdp-logger`, `sample-cookie-inspector`, `sample-dom-highlighter`).
  - `mutex.ts`: FIFO `AsyncMutex` providing error-isolated critical sections.
  - `script-record.ts`: Type guards and normalization for `ScriptRecord`.
  - `scripts-repo.ts`: Script CRUD and URL match filtering.
  - `settings-repo.ts`: Global settings management.
  - `tab-repo.ts`: Tab debugger session state persistence.
  - `bundle.ts`: Script import/export serialization.
  - `gm-repo.ts`: Persistent Greasemonkey key-value storage engine (`GmStorageRepository`).
- **Persistent Userscript Storage**: Key-value data set via `GM_setValue` is saved to `chrome.storage.local` under keys `gm_values_<scriptId>`, surviving page navigations and browser restarts.
- **Atomic Operations**: Mutex-serialized batch transactions prevent data corruption during simultaneous operations.

### 3.6. User Interface Subsystems
- **Extension Popup (`src/popup/`)**: Vue 3 application providing real-time tab status, active matching script list, per-script enable/disable toggles, global killswitch, and CDP debugger reconnect buttons.
- **Management Dashboard (`src/dashboard/`)**: Single-page application for script creation, editing, deletion, and settings configuration. Integrates CodeMirror 6 with JavaScript syntax highlighting, line numbers, and dark theme support.

---

## 4. Metadata Specification and Client API

### 4.1. Metadata Directives

Userscripts configured for XOKJ define their operational metadata within a structured header comment:

```javascript
// ==UserScript==
// @name         Network and Cookie Logger
// @namespace    https://xokj.dev/scripts
// @version      1.0.0
// @description  Example script demonstrating CDP usage
// @match        https://*.example.com/*
// @run-at       document-start
// @grant        GM_cdp
// @grant        GM_setValue
// @grant        GM_getValue
// @cdp          Network.enable {"maxTotalBufferSize": 10000000}
// @cdp          Page.enable
// ==/UserScript==
```

Supported Directives:
- `@name`: Human-readable identifier for the script.
- `@namespace`: Unique namespace identifier.
- `@version`: Semantic version string.
- `@match`: URL pattern for injection targeting.
- `@run-at`: Injection timing (`document-start`, `document-end`, `document-idle`).
- `@grant`: Declared permissions (`none`, `*`, `GM_cdp`, `cdp`, `GM_setValue`, `GM_getValue`, `GM_deleteValue`, `GM_listValues`, `GM_addStyle`, `GM_log`, `GM_info`).
- `@cdp`: Declarative CDP domain or method initialization with optional JSON parameters (e.g. `Network.enable`, `Page.enable`).

### 4.2. CDP Client API Interface

When `@grant GM_cdp`, `@grant cdp`, `@grant *`, or `@cdp` directives are specified, the `cdp` client SDK is made available in the script's global scope:

```typescript
interface CdpClient {
  /**
   * Dispatches an asynchronous command to the tab's active CDP debugger session.
   * @param method Standard Chrome DevTools Protocol method name (e.g. 'Page.navigate', 'Network.getCookies')
   * @param params Structured parameter payload dictionary
   * @returns Promise resolving to the command response payload
   */
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;

  /**
   * Registers an event listener for CDP backend notifications.
   * Supports exact names ('Network.requestWillBeSent'), domain wildcards ('Network.*'), and global wildcard ('*').
   * @param event CDP event name or wildcard pattern
   * @param handler Callback receiving event parameters (and event method name when using wildcards)
   * @returns Unsubscribe closure: invoke () => void to remove registration
   */
  on<T = unknown>(event: string, handler: (params: T, method?: string) => void): () => void;

  /**
   * Unregisters an existing event listener.
   * @param event CDP event name or wildcard pattern
   * @param handler Reference to the previously registered callback
   */
  off<T = unknown>(event: string, handler: (params: T, method?: string) => void): void;

  /**
   * Checks whether the current tab's debugger session is actively attached.
   * @returns Promise resolving to true if attached, false otherwise
   */
  isAttached(): Promise<boolean>;

  /**
   * Queries the current CDP debugger session status for the current tab.
   * @returns Promise resolving to 'ATTACHED' | 'CONFLICT' | 'DETACHED' | 'IDLE'
   */
  getStatus(): Promise<'ATTACHED' | 'CONFLICT' | 'DETACHED' | 'IDLE'>;
}

/**
 * Callable alias: GM_cdp(method, params) delegates directly to cdp.send(method, params).
 * Also exposes .send, .on, .off, .getStatus, and .isAttached properties.
 */
```

Example Usage:
```javascript
(async () => {
  // Live event listener with unbinder registration
  const unbindRequest = cdp.on('Network.requestWillBeSent', (event) => {
    console.log('Intercepted request:', event.request.url);
    const count = Number(GM_getValue('request_count', 0)) + 1;
    GM_setValue('request_count', count);
  });

  const unbindLoad = cdp.on('Page.loadEventFired', () => {
    console.log('Page load event fired');
  });

  // Cleanly release channels on page teardown (prevents listener leaks)
  window.addEventListener('pagehide', () => {
    unbindRequest();
    unbindLoad();
  }, { once: true });

  // Method invocation with try/catch guard
  try {
    const cookies = await cdp.send('Network.getCookies', {
      urls: [window.location.href]
    });
    console.log('Retrieved cookies:', cookies);
  } catch (error) {
    console.error('CDP command failed or DevTools conflict:', error);
  }
})();
```

### 4.3. Standard GM API Polyfills
- `GM_setValue(key, value)`: Updates in-sandbox key-value cache synchronously and writes through to persistent `chrome.storage.local` (`gm_values_<scriptId>`) asynchronously via window postMessage.
- `GM_getValue(key, defaultValue)`: Synchronously retrieves value from the pre-hydrated storage snapshot loaded prior to script execution.
- `GM_deleteValue(key)`: Deletes a key from the in-sandbox cache synchronously and dispatches delete write-through to background storage.
- `GM_listValues()`: Synchronously returns an array of all keys stored for the script.
- `GM_addStyle(css)`: Injects a `<style type="text/css" data-xokj-script="...">` element into document head or root. Returns the created `HTMLStyleElement`.
- `GM_log(...args)`: Formats and logs diagnostic messages to `console.log` prefixed with `[<script_name>]`.
- `GM_info`: Exposes read-only metadata descriptor object containing `{ script: { name, version, description, matches }, scriptHandler: 'XOKJ', version: '0.1.0' }`.

---

## 5. Technology Stack and Dependency Matrix

All library dependencies are declared in [`package.json`](package.json) and resolved dynamically during build time:

| Library / Framework | Role in Extension Subsystem | Manifest Reference |
|---|---|---|
| **Vue 3** | Reactive component model for Popup (`src/popup/`) and Dashboard (`src/dashboard/`) | [`package.json`](package.json) |
| **CodeMirror 6** | Extensible browser-based code editor with JavaScript mode and themes | [`package.json`](package.json) |
| **Vite** | Modern frontend build tool, dev server, and production bundler | [`package.json`](package.json) |
| **@crxjs/vite-plugin** | Compiles Manifest V3 extension bundle with background service worker HMR | [`package.json`](package.json) |
| **@fortawesome/fontawesome-free** | Iconography for status badges, buttons, and editor controls | [`package.json`](package.json) |
| **TypeScript** | Static typing and compile-time contract enforcement | [`package.json`](package.json) |
| **Vitest** | Fast unit and integration test runner | [`package.json`](package.json) |
| **happy-dom** | In-memory DOM implementation for UI component unit tests | [`package.json`](package.json) |
| **vue-tsc** | Type-checking engine for Vue Single File Components | [`package.json`](package.json) |

---

## 6. Codebase Organization

```
xokj/
├── manifest.config.ts         # Manifest V3 build configuration
├── vite.config.ts             # Vite bundler configuration (@crxjs plugin)
├── tsconfig.json              # TypeScript compiler configuration
├── package.json               # Monorepo root and extension manifest
│
├── src/
│   ├── shared/                # Shared utilities, types, and modular storage
│   │   ├── types.ts           # Protocol contracts and script data models
│   │   ├── metadata-parser.ts # Userscript header parser
│   │   ├── match-pattern.ts   # URL pattern matching with LRU cache
│   │   └── storage/           # Modular storage subsystem
│   │       ├── defaults.ts    # Storage keys, settings, default sample scripts
│   │       ├── mutex.ts       # FIFO AsyncMutex concurrency lock
│   │       ├── script-record.ts # ScriptRecord validation and normalization
│   │       ├── scripts-repo.ts # Script CRUD and querying
│   │       ├── settings-repo.ts # App settings repository
│   │       ├── tab-repo.ts    # Tab session state repository
│   │       ├── bundle.ts      # Batch import/export serialization
│   │       ├── gm-repo.ts     # Persistent Greasemonkey key-value engine
│   │       └── index.ts       # Unified storage facade
│   │
│   ├── background/            # Manifest V3 Background Service Worker
│   │   ├── index.ts           # Service worker entrypoint and event dispatch
│   │   ├── debugger-mgr.ts    # Authoritative chrome.debugger state manager
│   │   ├── cdp/               # Modular CDP bridge subsystem
│   │   │   ├── router.ts      # JSON-RPC request validation & anti-spoofing
│   │   │   ├── timeout-guard.ts # Inflight command tracking & 30s timeout guards
│   │   │   ├── broadcaster.ts # CDP_RPC_EVENT & CDP_LIFECYCLE_EVENT dispatch
│   │   │   └── permission-guard.ts # Script permissions & match verification
│   │   ├── cdp-bridge.ts      # CDP bridge server public coordinator facade
│   │   ├── conflict-mgr.ts    # Native DevTools conflict handler
│   │   ├── injector/          # Modular injection subsystem
│   │   │   ├── stage-scheduler.ts # Lifecycle injection scheduler (@run-at)
│   │   │   ├── page-runner.ts # Self-contained MAIN world userscript sandbox
│   │   │   ├── dedup-tracker.ts # Subframe deduplication tracking
│   │   │   └── storage-loader.ts # Pre-hydration storage snapshot loader
│   │   ├── injector.ts        # Script injector public coordinator facade
│   │   ├── gm-handler.ts      # Background GM storage message router
│   │   └── ui-ipc.ts          # Extension UI message handlers
│   │
│   ├── content/               # Content scripts and sandboxing
│   │   ├── index.ts           # Content script entrypoint
│   │   ├── bridge/            # Modular content script bridge subsystem
│   │   │   ├── validator.ts   # 4-layer validation & channel token security
│   │   │   ├── request-manager.ts # Pending RPC request tracking & timeouts
│   │   │   ├── event-relayer.ts # Event & lifecycle relay to window
│   │   │   └── storage-forwarder.ts # Storage mutation forwarding to service worker
│   │   ├── bridge.ts          # Content script bridge coordinator facade
│   │   ├── sandbox.ts         # Userscript sandbox & grant API binder
│   │   └── cdp-sdk.ts         # Client cdp/GM_cdp SDK implementation
│   │
│   ├── popup/                 # Extension popup interface (Vue 3)
│   │   ├── index.html         # HTML entry
│   │   ├── main.ts            # Vue mount point
│   │   ├── App.vue            # Root view
│   │   ├── composables/       # usePopupState reactive state management
│   │   └── components/        # ScriptCard, CdpStatusBadge, ConflictBanner
│   │
│   └── dashboard/             # Management dashboard (Vue 3 + CodeMirror 6)
│       ├── index.html         # HTML entry
│       ├── main.ts            # Vue mount point
│       ├── App.vue            # Clean layout root SFC (~110 lines)
│       ├── composables/       # useDashboardState reactive storage sync & CRUD
│       └── components/        # ScriptList, ScriptEditor, MetadataPanel, ImportExportModal, ConfirmModal, ToastNotification
│
└── test/                      # Unit and integration test suites
```

---

## 7. Building and Loading into Chromium

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Build Instructions
```bash
# 1. Install dependencies
npm install

# 2. Compile TypeScript and bundle extension
npm run build
```

The compiled extension files are output to the `dist/` directory.

### Loading into Browser
1. Open a Chromium-based browser (Chrome, Edge, Brave).
2. Navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the upper-right corner.
4. Click **Load unpacked** in the upper-left corner.
5. Select the `dist/` folder inside the `xokj` repository.

---

## 8. Security and Execution Boundary Constraints

1. **MAIN World Execution Context**: Userscripts execute directly in the target webpage's MAIN world via `chrome.scripting.executeScript({ world: 'MAIN', func: pageSandboxRunner, args: [...] })`, providing native access to page DOM, JavaScript globals, and events.
2. **Strict Lexical Sandbox & Privileged Global Shadowing**: `pageSandboxRunner` is a 100% self-contained function serialized with zero external imports. It wraps script code in an isolated IIFE (`new Function(...)`) that injects only declared APIs and explicitly shadows all 9 privileged keys (`cdp`, `GM_cdp`, `GM_info`, `GM_setValue`, `GM_getValue`, `GM_deleteValue`, `GM_listValues`, `GM_addStyle`, `GM_log`) with `undefined` when ungranted.
3. **Pre-Hydration & Write-Through Persistence**: Userscript storage is pre-hydrated before execution into an isolated in-memory map. `GM_getValue` runs synchronously without IPC lag, while mutations asynchronously write through to background `chrome.storage.local` (`gm_values_<scriptId>`) via mutex-serialized transactions.
4. **4-Layer ContentScriptBridge Validation Gate**:
   - **Step 0 Fast-Path**: Drops >99.9% of non-extension window messages before property access, preventing hostile getter traps.
   - **Layer 1 (Source)**: Enforces `event.source === window`.
   - **Layer 2 (Origin)**: Verifies `event.origin === window.location.origin`.
   - **Layer 3 (Sender Tag)**: Validates `data.source === 'xokj-userscript'`.
   - **Layer 4 (Channel Token)**: Validates cryptographic session token (`crypto.randomUUID()`).
5. **Tab Identity Scoping & Anti-Spoofing**: The service worker strictly enforces `sender.tab.id` from the extension message envelope. Any client-supplied `tabId` is stripped; userscripts in Tab A cannot access or control Tab B.
6. **Deterministic In-Flight Settlement & Conflict Invalidation**: When native DevTools opens, `chrome.debugger.onDetach` transitions the tab to `CONFLICT`, immediately rejecting all in-flight promises with `DevToolsConflictError` (code `1001`). Clean detachments reject with code `1002`.
7. **Restricted Scheme Protection**: Script injection and debugger attachment are strictly prohibited on internal browser URLs (`chrome://*`, `edge://*`, `chrome-extension://*`, `about:*`, `view-source:*`, and the Chrome Web Store).

---

## 9. License

MIT License. See [LICENSE](LICENSE) for details.
