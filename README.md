# XOKJ — Chromium Userscript Manager with Hybrid CDP Architecture

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](package.json)
[![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)](manifest.config.ts)
[![Vue](https://img.shields.io/badge/vue-3.5.13-emerald.svg)](package.json)
[![Vite](https://img.shields.io/badge/vite-5.4.14-purple.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-259%20passed-brightgreen.svg)](test/)

**XOKJ** is an advanced, production-ready Chromium Userscript Manager built on **Manifest V3**, **Vue 3**, **Vite**, and `@crxjs/vite-plugin`. It extends traditional userscript functionality (Greasemonkey / Tampermonkey / Violentmonkey) with deep **Chrome DevTools Protocol (CDP)** control plane intervention via `chrome.debugger`.

---

## 🌟 Key Architecture & Highlights

```
                       ┌───────────────────────────────────────────────────────────┐
                       │               Web Page Context (MAIN World)               │
                       │                                                           │
                       │   ┌───────────────────────────────────────────────────┐   │
                       │   │                   Userscript                      │   │
                       │   │  cdp.send('Network.getCookies') / cdp.on('Page.*')│   │
                       │   └─────────────────────────┬─────────────────────────┘   │
                       │                             │ window.postMessage          │
                       │                             ▼                             │
                       │   ┌───────────────────────────────────────────────────┐   │
                       │   │            Userscript CDP SDK & Sandbox           │   │
                       │   └─────────────────────────┬─────────────────────────┘   │
                       └─────────────────────────────┼─────────────────────────────┘
                                                     │ window.postMessage
                       ┌─────────────────────────────┼─────────────────────────────┐
                       │                             ▼                             │
                       │   ┌───────────────────────────────────────────────────┐   │
                       │   │         Content Script Bridge (ISOLATED World)    │   │
                       │   └─────────────────────────┬─────────────────────────┘   │
                       │                             │ chrome.runtime.sendMessage  │
                       └─────────────────────────────┼─────────────────────────────┘
                                                     │
                       ┌─────────────────────────────▼─────────────────────────────┐
                       │           Background Service Worker (MV3)                 │
                       │                                                           │
                       │   ┌──────────────────────┐    ┌───────────────────────┐   │
                       │   │   CdpBridgeServer    │◄───┤  TabDebuggerManager   │   │
                       │   │ (Async RPC & Events) │    │(Session State Machine)│   │
                       │   └──────────┬───────────┘    └───────────┬───────────┘   │
                       │              │                            │               │
                       │   ┌──────────▼───────────┐    ┌───────────▼───────────┐   │
                       │   │DevToolsConflictMgr   │    │    ScriptInjector     │   │
                       │   │ (Safe Inflight Reject│    │(@run-at lifecycle &   │   │
                       │   │  & Reconnect Engine) │    │ declarative CDP init) │   │
                       │   └──────────────────────┘    └───────────────────────┘   │
                       │                             │                             │
                       │                             ▼                             │
                       │                  chrome.debugger / CDP Host               │
                       └───────────────────────────────────────────────────────────┘
```

---

## 🧩 Architectural Subsystems

### 1. Hybrid CDP Control Plane
- **Early Declarative Initialization**: Intercepts `chrome.webNavigation.onBeforeNavigate` to pre-attach `chrome.debugger` and enable declared domains (e.g. `Network.enable`, `Page.enable`, `Fetch.enable`) *before* web page resources load.
- **Asynchronous RPC Bridge**: Full-duplex JSON-RPC routing between web page contexts and `chrome.debugger.sendCommand`, validating tab identity and guarding against cross-tab access.
- **Event Multiplexer**: Automatically multiplexes `chrome.debugger.onEvent` events (e.g., `Network.requestWillBeSent`, `Page.loadEventFired`) to active userscript listeners.

### 2. DevTools Conflict Detection & Recovery
- **Zero-Crash Conflict Management**: Listens to `chrome.debugger.onDetach` (detecting `canceled_by_user` when native Chrome DevTools opens).
- **Safe In-Flight Promise Rejection**: Immediately resolves/rejects pending CDP commands with a typed `DevToolsConflictError` (code `1001`), preventing hung background promises and worker crashes.
- **Visual Alerting & Reconnection**: Emits lifecycle status to UI pages and content scripts, displaying a conflict banner in the Popup UI with a single-click "Reconnect CDP" button once native DevTools is closed.

### 3. Userscript Runtime & Lifecycle Injection
- **Standards-Compliant Parser**: Full lexical parser for `// ==UserScript==` header blocks (`@name`, `@version`, `@match`, `@include`, `@exclude`, `@run-at`, `@grant`, `@cdp`).
- **Multi-Phase Injection Pipeline**: Schedules script execution based on `@run-at`:
  - `document-start`: Injected immediately upon document creation via `chrome.scripting.executeScript` (`injectImmediately: true`).
  - `document-end`: Injected when DOM is parsed.
  - `document-idle`: Injected when the page is idle.
- **Ultra-early CDP Script Injection**: Evaluates scripts prior to script execution via `Page.addScriptToEvaluateOnNewDocument`.
- **Deduplication Engine**: Navigation-aware injection deduplication tracking `(tabId, frameId, scriptId, url)` tuples to prevent duplicate execution across iframe lifecycles.

### 4. Concurrency-Safe Storage Subsystem
- **Typed Local Storage**: Strongly-typed repository abstraction around `chrome.storage.local`.
- **Atomic Operations & Mutex Queue**: Serialized update queue ensuring high-frequency concurrent toggle actions do not produce dual-write hazards or lost updates.
- **Default Script Pre-seeding**: Bundles initial sample scripts demonstrating declarative CDP Network logging and cookie inspection.

### 5. Extension User Interfaces (Vue 3)
- **Popup UI (`src/popup/`)**:
  - Displays matching scripts for the active browser tab with individual toggle switches.
  - Global script execution toggle.
  - Real-time reactive CDP session badge (`IDLE`, `ATTACHING`, `ATTACHED`, `CONFLICT`).
  - DevTools conflict banner with **"Reconnect CDP"** action.
- **Management Dashboard (`src/dashboard/`)**:
  - Full-page Master-Detail view with search and filter capabilities.
  - Complete CRUD operations (Create, Edit, Save, Delete, Toggle).
  - Integrated **CodeMirror 6** editor featuring JavaScript syntax highlighting, line numbers, and dark theme (`one-dark`).
  - Import / Export script collections as JSON, and reset to defaults.

---

## 📜 Custom `@cdp` Metadata Grammar & Userscript API

### Metadata Declaration

Userscripts declare required CDP capabilities in their header block:

```javascript
// ==UserScript==
// @name         CDP Network & Cookie Inspector
// @namespace    https://xokj.dev/scripts
// @version      1.0.0
// @description  Inspect network requests and manage cookies via CDP
// @match        https://*.example.com/*
// @run-at       document-start
// @grant        GM_cdp
// @cdp          Network.enable {"maxTotalBufferSize": 10000000}
// @cdp          Page.enable
// ==/UserScript==

(async () => {
  // Listen to CDP events broadcast from the background worker
  cdp.on('Network.requestWillBeSent', (params) => {
    console.log('[XOKJ CDP]', params.request.method, params.request.url);
  });

  // Send asynchronous CDP commands
  const cookies = await cdp.send('Network.getCookies', {
    urls: ['https://example.com']
  });
  console.log('[XOKJ Cookies]', cookies);
})();
```

### Supported Client-Side SDK Methods

| Method | Description |
|---|---|
| `cdp.send(method, params)` | Asynchronously execute a CDP method on the current tab and return the result. |
| `GM_cdp(method, params)` | Alias for `cdp.send` for Tampermonkey/Violentmonkey compatibility. |
| `cdp.on(event, handler)` | Subscribe to incoming CDP events for the current tab. |
| `cdp.off(event, handler)` | Unsubscribe from a previously registered CDP event handler. |

---

## 📁 Project Structure

```
xokj/
├── manifest.config.ts         # Chrome Extension Manifest V3 configuration
├── vite.config.ts             # Vite build configuration with @crxjs/vite-plugin
├── vitest.config.ts           # Vitest unit & E2E configuration
├── tsconfig.json              # TypeScript root configuration
├── package.json               # Dependencies & build scripts (v0.1.0)
│
├── src/
│   ├── shared/                # Core domain contracts and utilities
│   │   ├── types.ts           # Shared TypeScript interfaces (CDP RPC, Scripts, Events)
│   │   ├── metadata-parser.ts # // ==UserScript== header & @cdp lexical parser
│   │   ├── match-pattern.ts   # Chromium URL match pattern engine
│   │   └── storage.ts         # Concurrency-safe chrome.storage.local repository
│   │
│   ├── background/            # Background Service Worker subsystem
│   │   ├── index.ts           # Service worker entry point
│   │   ├── debugger-mgr.ts    # chrome.debugger session state machine
│   │   ├── cdp-bridge.ts      # Full-duplex CDP RPC bridge & event multiplexer
│   │   ├── conflict-mgr.ts    # Native DevTools conflict detection & recovery
│   │   ├── injector.ts        # Lifecycle script injection coordinator
│   │   └── ui-ipc.ts          # IPC handler for popup & dashboard communication
│   │
│   ├── content/               # Content Script & Injected Runtime SDK
│   │   ├── index.ts           # Content script entry point
│   │   ├── bridge.ts          # Window postMessage ↔ chrome.runtime message relay
│   │   ├── sandbox.ts         # Userscript execution sandbox & @grant isolation
│   │   └── cdp-sdk.ts         # Client-side cdp.send() / GM_cdp SDK
│   │
│   ├── popup/                 # Compact Popup UI (Vue 3)
│   │   ├── index.html         # Popup entry HTML
│   │   ├── main.ts            # Vue 3 mount point
│   │   ├── App.vue            # Popup root view
│   │   ├── components/        # ScriptCard, CdpStatusBadge, ConflictBanner, GlobalControls
│   │   └── composables/       # usePopupState composable
│   │
│   └── dashboard/             # Management Dashboard UI (Vue 3 + CodeMirror 6)
│       ├── index.html         # Dashboard entry HTML
│       ├── main.ts            # Vue 3 mount point
│       ├── App.vue            # Dashboard root view
│       └── components/        # ScriptEditor, ScriptList, ScriptMetadataInspector
│
└── test/                      # Test Suites (259 passing tests)
    ├── mocks/                 # Headless chrome.* API mock suite
    ├── unit/                  # Unit test suites (parser, matchers, cdp-bridge, ui, storage)
    └── e2e/                   # Full pipeline E2E integration test suite
```

---

## 🛠️ Getting Started

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation
```bash
# Clone repository
git clone https://github.com/Anhdeface/xokj.git
cd xokj

# Install dependencies
npm install
```

### Running Tests
```bash
# Run all 259 unit, adversarial, and E2E integration tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Building the Extension
```bash
# Type-check and compile Manifest V3 bundle
npm run build
```
The compiled extension bundle will be output to the `dist/` directory.

### Loading into Chromium / Chrome / Brave / Edge
1. Open your browser and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the `dist/` folder in the project directory.

---

## 🔒 Security & Sandboxing Model

1. **Tab ID Isolation**: The background service worker strictly enforces `sender.tab.id` for all CDP operations. A script running in Tab A cannot issue commands targeting Tab B.
2. **System URL Protection**: CDP operations and script injection are blocked on restricted scheme pages (`chrome://*`, `edge://*`, `chrome-extension://*`, Chrome Web Store).
3. **Promise Invalidation**: When native DevTools attaches, all in-flight debugger commands are immediately aborted and rejected, preventing dangling resources and service worker exhaustion.

---

## 📄 License
MIT License. See [LICENSE](LICENSE) for details.
