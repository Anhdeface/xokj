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
- **TabDebuggerManager (`src/background/debugger-mgr.ts`)**: Implements a state machine for every active browser tab (`IDLE`, `ATTACHING`, `ATTACHED`, `DETACHED`, `CONFLICT`). Ensures mutex-guaranteed attachment routines to prevent concurrent attach race conditions.
- **CdpBridgeServer (`src/background/cdp-bridge.ts`)**: Handles asynchronous RPC message routing from content scripts, validates script permission boundaries, and multiplexes incoming CDP protocol events back to the appropriate content script channels.
- **Declarative Domain Initialization**: Pre-enables protocol domains requested in script headers (e.g., `Network.enable`, `Page.enable`) upon debugger attachment using parallel `Promise.allSettled` execution.

### 3.2. Content Script and Execution Bridge
Content scripts (`src/content/`) establish communication channels between web pages and the extension service worker:
- **Bridge Relay (`src/content/bridge.ts`)**: Intercepts `window.postMessage` payloads in the ISOLATED world, performs message schema validation, and relays commands to the background service worker via `chrome.runtime.sendMessage`.
- **Execution Sandbox (`src/content/sandbox.ts`)**: Evaluates userscript code in the target world while injecting only authorized client APIs (`GM_*`, `cdp`).
- **CDP Client SDK (`src/content/cdp-sdk.ts`)**: Provides the client-facing `cdp.send()` and `cdp.on()` interface exposed to userscripts.

### 3.3. DevTools Conflict Management
Chromium permits only a single debugging client to attach to a tab at any given time.
- **Conflict Detection (`src/background/conflict-mgr.ts`)**: Detects when native Chrome DevTools is opened on a managed tab by listening to `chrome.debugger.onDetach` events with reason `canceled_by_user`.
- **In-Flight Request Settlement**: Rejects all pending CDP promises for the detached tab with error code `1001` (`DevToolsConflictError`), preventing hanging asynchronous operations.
- **Reconnection Handling**: Transmits conflict status updates to the UI, allowing the user to resume CDP automation once native DevTools is closed.

### 3.4. Userscript Injection Engine and Lifecycle
- **Metadata Lexical Parser (`src/shared/metadata-parser.ts`)**: Tokenizes the userscript comment block to extract script directives (`@name`, `@match`, `@grant`, `@cdp`).
- **Match Pattern Engine (`src/shared/match-pattern.ts`)**: Compiles standard Chrome match patterns into regular expressions with a bounded Least Recently Used (LRU) cache (capacity: 1,000 entries) to optimize URL matching during page navigation.
- **Injection Scheduler (`src/background/injector.ts`)**: Schedules script execution across three standard lifecycle phases:
  - `document-start`: Injected before DOM parsing begins.
  - `document-end`: Injected after the DOM structure is built, before subresources load.
  - `document-idle`: Injected after window `load` event completion.
- **Frame Deduplication**: Maintains a hierarchical tracking map (`Map<tabId, Map<frameId, Set<scriptId>>>`) to prevent duplicate script execution in subframes.

### 3.5. Storage Engine and Concurrency Mutex
- **FIFO AsyncMutex (`src/shared/storage.ts`)**: Serializes read-modify-write transactions against `chrome.storage.local`. Prevents data corruption during simultaneous script updates or bulk import operations.
- **Atomic Operations**: Groups batch script imports into single read-write cycles to minimize storage I/O.

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
- `@grant`: Declared permissions (`none`, `GM_cdp`, `GM_setValue`, `GM_getValue`, `GM_deleteValue`, `GM_listValues`, `GM_xmlhttpRequest`, `window.close`).
- `@cdp`: Declarative CDP domain or method initialization with optional JSON parameters.

### 4.2. CDP Client API Interface

When `@grant GM_cdp` or `@cdp` directives are specified, the `cdp` client SDK is made available in the script's global scope:

```typescript
interface CdpClient {
  /**
   * Dispatches an asynchronous command to the CDP session.
   * @param method Standard Chrome DevTools Protocol method name (e.g. 'Page.navigate')
   * @param params Structured parameter payload dictionary
   * @returns Promise resolving to the command response payload
   */
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;

  /**
   * Registers an event listener for CDP backend notifications.
   * @param event CDP event name (e.g. 'Network.requestWillBeSent')
   * @param handler Callback receiving the event parameters
   */
  on(event: string, handler: (params: unknown) => void): void;

  /**
   * Unregisters an existing event listener.
   * @param event CDP event name
   * @param handler Reference to the previously registered callback
   */
  off(event: string, handler: (params: unknown) => void): void;
}
```

Example Usage:
```javascript
(async () => {
  // Event listener
  cdp.on('Network.requestWillBeSent', (event) => {
    console.log('Intercepted request:', event.request.url);
  });

  // Method invocation
  try {
    const cookies = await cdp.send('Network.getCookies', {
      urls: ['https://example.com']
    });
    console.log('Retrieved cookies:', cookies);
  } catch (error) {
    console.error('CDP command failed:', error);
  }
})();
```

### 4.3. Standard GM API Polyfills
- `GM_setValue(key, value)`: Asynchronously persists values scoped to the script.
- `GM_getValue(key, defaultValue)`: Retrieves stored script values.
- `GM_deleteValue(key)`: Deletes a stored key.
- `GM_listValues()`: Lists all keys associated with the script.
- `GM_xmlhttpRequest(details)`: Dispatches cross-origin network requests from the background service worker context.

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
│   ├── shared/                # Shared utilities, types, and storage
│   │   ├── types.ts           # Protocol contracts and script data models
│   │   ├── metadata-parser.ts # Userscript header parser
│   │   ├── match-pattern.ts   # URL pattern matching with LRU cache
│   │   └── storage.ts         # chrome.storage.local repository with FIFO AsyncMutex
│   │
│   ├── background/            # Manifest V3 Background Service Worker
│   │   ├── index.ts           # Service worker entrypoint and event dispatch
│   │   ├── debugger-mgr.ts    # Per-tab chrome.debugger state manager
│   │   ├── cdp-bridge.ts      # RPC message router and permission validator
│   │   ├── conflict-mgr.ts    # Native DevTools conflict handler
│   │   ├── injector.ts        # Lifecycle injection scheduler
│   │   └── ui-ipc.ts          # Extension UI message handlers
│   │
│   ├── content/               # Content scripts and sandboxing
│   │   ├── index.ts           # Content script entrypoint
│   │   ├── bridge.ts          # Window postMessage <-> chrome.runtime relay
│   │   ├── sandbox.ts         # Main-world userscript sandbox and API binder
│   │   └── cdp-sdk.ts         # Client cdp/GM_cdp SDK implementation
│   │
│   ├── popup/                 # Extension popup interface (Vue 3)
│   │   ├── index.html         # HTML entry
│   │   ├── main.ts            # Vue mount point
│   │   ├── App.vue            # Root view
│   │   └── components/        # ScriptCard, CdpStatusBadge, ConflictBanner
│   │
│   └── dashboard/             # Management dashboard (Vue 3 + CodeMirror 6)
│       ├── index.html         # HTML entry
│       ├── main.ts            # Vue mount point
│       ├── App.vue            # Root view
│       └── components/        # ScriptEditor, ScriptList, MetadataInspector
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

1. **Tab Identity Scoping**: The service worker verifies `sender.tab.id` on every incoming RPC request. A userscript running in Tab A cannot send CDP commands to Tab B.
2. **Channel Token Verification**: Inter-world communication between the MAIN world and ISOLATED world uses structured payload verification with unique runtime channel tokens.
3. **Restricted Scheme Protection**: Script injection and debugger attachment are strictly prohibited on internal browser URLs (`chrome://*`, `edge://*`, `chrome-extension://*`, and Web Store origins).
4. **Deterministic In-Flight Settlement**: When a debugger session detaches unexpectedly (e.g., native DevTools opened or tab closed), all pending promises are immediately rejected to prevent memory and event leaks.

---

## 9. License

MIT License. See [LICENSE](LICENSE) for details.
