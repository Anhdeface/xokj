# XOKJ

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](package.json)
[![Manifest](https://img.shields.io/badge/manifest-v3-green.svg)](manifest.config.ts)
[![Vue](https://img.shields.io/badge/vue-3.5.13-emerald.svg)](package.json)
[![Vite](https://img.shields.io/badge/vite-5.4.14-purple.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-715%20passed-brightgreen.svg)](test/)

XOKJ is a Chromium Userscript Manager built for Manifest V3 using Vue 3, Vite, and `@crxjs/vite-plugin`. In addition to standard userscript execution environments, it provides a Chrome DevTools Protocol (CDP) control plane via `chrome.debugger` to allow userscripts to perform protocol-level operations directly from the webpage execution context.

---

## Architecture Overview

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
                       │   │(Conflict Handling &  │    │(@run-at lifecycle &   │   │
                       │   │ Inflight Rejection)  │    │ declarative CDP init) │   │
                       │   └──────────────────────┘    └───────────────────────┘   │
                       │                             │                             │
                       │                             ▼                             │
                       │                  chrome.debugger / CDP Host               │
                       └───────────────────────────────────────────────────────────┘
```

---

## Subsystems & Technical Implementation

### 1. CDP Control Plane & Session Lifecycle
- **Session State Machine (`TabDebuggerManager`)**: Tracks per-tab debugger sessions through explicit states (`IDLE`, `ATTACHING`, `ATTACHED`, `DETACHED`, `CONFLICT`). Attachment and detachment operations are synchronized per tab to prevent concurrent state corruption.
- **Declarative Domain Initialization**: Pre-enables domains specified in script metadata (such as `Network.enable`, `Page.enable`, `Fetch.enable`) using parallel `Promise.allSettled` execution when attaching to a tab.
- **In-Memory Caching & RPC Routing (`CdpBridgeServer`)**: Routes JSON-RPC messages between content script bridges and `chrome.debugger.sendCommand`. Caches parsed script permission rules in memory with reactive invalidation on storage changes to eliminate repeated asynchronous reads during high-frequency command dispatch.
- **Resource De-retention**: Explicitly prunes empty tracking structures (`tabRequests`) and session state upon request completion or tab closure.

### 2. DevTools Conflict Coordination
- **Attachment Conflict Detection (`DevToolsConflictManager`)**: Listens to `chrome.debugger.onDetach` events for reason `canceled_by_user`, which occurs when a user opens native Chrome DevTools on an attached tab.
- **In-Flight Request Settlement**: Rejects all pending CDP command promises for the detached tab with error code `1001` (`DevToolsConflictError`) or code `1002` (`DETACHED`), avoiding hanging promises in content scripts or service worker contexts.
- **State Propagation**: Broadcasts session state changes to the popup UI and content script bridge, allowing manual reconnection once native DevTools is closed.

### 3. Userscript Injection Pipeline & Sandboxing
- **Metadata Parsing (`metadata-parser.ts`)**: Parses standard userscript headers (`@name`, `@version`, `@match`, `@include`, `@exclude`, `@run-at`, `@grant`) alongside custom `@cdp <Domain.method|Domain.enable> [parameters]` declarations.
- **URL Match Engine (`match-pattern.ts`)**: Implements Chrome match pattern semantics backed by a bounded Least Recently Used (LRU) RegExp compilation cache (capacity: 1,000 entries) to avoid recompiling pattern regular expressions across navigation events.
- **Injection Scheduling (`injector.ts`)**: Dispatches scripts according to their `@run-at` lifecycle stage (`document-start`, `document-end`, `document-idle`). In-memory settings and script caches reduce I/O during navigation.
- **Deduplication & Subframe Tracking**: Maintains frame-scoped injection tracking (`Map<tabId, Map<frameId, Set<dedupeKey>>>`). Cleans up frame entries on navigation commit and clears entire tab state upon `chrome.tabs.onRemoved`.
- **Sandbox Isolation (`sandbox.ts`)**: Evaluates userscripts in the target execution world while binding only declared `@grant` APIs. De-references script source strings and execution closures post-evaluation to facilitate garbage collection.
- **Content Bridge Relay (`bridge.ts`)**: Implements a zero-allocation fast-path message filter that rejects foreign `window.postMessage` traffic before payload processing. Includes explicit `disconnect()` lifecycle teardown for iframe removal.

### 4. Storage Engine & Mutex
- **FIFO AsyncMutex (`storage.ts`)**: Serializes storage mutation operations (`saveScript`, `toggleScript`, `deleteScript`, `importScripts`, `saveSettings`) to prevent lost-update race conditions in `chrome.storage.local`.
- **Fast-Path Execution**: Utilizes a synchronous fast-path when uncontended and queues tasks in a linear array to minimize heap allocations.
- **Batch Processing**: Groups bulk operations during script import into a single mutex acquisition, reading and writing storage once per batch.

### 5. User Interface (Vue 3)
- **Popup (`src/popup/`)**: Displays matching scripts for the current tab, per-script toggle controls, global execution switch, and real-time CDP session status with manual reconnect capability.
- **Management Dashboard (`src/dashboard/`)**: Full-page interface for script management (create, edit, delete, toggle, import, export). Integrates CodeMirror 6 with JavaScript syntax highlighting and dark theme support. Bundled with chunk-splitting to isolate editor assets from the main UI script.

---

## Metadata Specification & Userscript API

### Header Block Structure

```javascript
// ==UserScript==
// @name         Network and Cookie Logger
// @namespace    https://xokj.dev/scripts
// @version      1.0.0
// @description  Demonstrates declarative CDP attachment and event listening
// @match        https://*.example.com/*
// @run-at       document-start
// @grant        GM_cdp
// @cdp          Network.enable {"maxTotalBufferSize": 10000000}
// @cdp          Page.enable
// ==/UserScript==

(async () => {
  // Subscribe to CDP events
  cdp.on('Network.requestWillBeSent', (params) => {
    console.log('[CDP Event]', params.request.method, params.request.url);
  });

  // Execute CDP methods
  try {
    const cookies = await cdp.send('Network.getCookies', {
      urls: ['https://example.com']
    });
    console.log('[CDP Result]', cookies);
  } catch (err) {
    console.error('[CDP Error]', err);
  }
})();
```

### Client SDK Methods

| Method | Parameters | Return Type | Description |
|---|---|---|---|
| `cdp.send(method, params?)` | `method: string`, `params?: object` | `Promise<any>` | Sends an asynchronous JSON-RPC command to the CDP session attached to the current tab. |
| `GM_cdp(method, params?)` | `method: string`, `params?: object` | `Promise<any>` | Alias for `cdp.send`. |
| `cdp.on(event, handler)` | `event: string`, `handler: (params: any) => void` | `void` | Registers a listener for events dispatched by the CDP control plane. |
| `cdp.off(event, handler)` | `event: string`, `handler: (params: any) => void` | `void` | Unregisters an existing event listener. |

---

## Codebase Layout

```
xokj/
├── manifest.config.ts         # Manifest V3 declarative configuration
├── vite.config.ts             # Vite configuration with @crxjs/vite-plugin & code splitting
├── vitest.config.ts           # Vitest runner configuration
├── tsconfig.json              # TypeScript compilation options
├── package.json               # Project dependencies and test scripts
│
├── src/
│   ├── shared/                # Core data models, parsing, and storage
│   │   ├── types.ts           # Protocol interfaces, RPC contracts, and script definitions
│   │   ├── metadata-parser.ts # Lexical parser for // ==UserScript== and @cdp headers
│   │   ├── match-pattern.ts   # URL pattern matching with LRU regex cache
│   │   └── storage.ts         # chrome.storage.local repository with FIFO AsyncMutex
│   │
│   ├── background/            # MV3 Service Worker subsystem
│   │   ├── index.ts           # Service worker lifecycle and listener registration
│   │   ├── debugger-mgr.ts    # Per-tab chrome.debugger session state manager
│   │   ├── cdp-bridge.ts      # RPC routing, permission validation, and event multiplexing
│   │   ├── conflict-mgr.ts    # Native DevTools conflict detection and rejection handling
│   │   ├── injector.ts        # Tab/frame lifecycle injection and deduplication engine
│   │   └── ui-ipc.ts          # IPC handler for popup and dashboard communication
│   │
│   ├── content/               # Content script and execution sandbox
│   │   ├── index.ts           # Content script entry point
│   │   ├── bridge.ts          # Window postMessage <-> chrome.runtime message bridge
│   │   ├── sandbox.ts         # Main-world userscript sandbox and @grant API binder
│   │   └── cdp-sdk.ts         # Client-side cdp / GM_cdp API client
│   │
│   ├── popup/                 # Extension popup interface (Vue 3)
│   │   ├── index.html         # Entry HTML
│   │   ├── main.ts            # Vue mount point
│   │   ├── App.vue            # Root view
│   │   ├── components/        # ScriptCard, CdpStatusBadge, ConflictBanner, GlobalControls
│   │   └── composables/       # Reactive popup state composable
│   │
│   └── dashboard/             # Management dashboard interface (Vue 3 + CodeMirror 6)
│       ├── index.html         # Entry HTML
│       ├── main.ts            # Vue mount point
│       ├── App.vue            # Root view
│       └── components/        # ScriptEditor, ScriptList, ScriptMetadataInspector
│
└── test/                      # Test suites (715 passing tests across 37 files)
    ├── mocks/                 # In-memory chrome.* API mock harness
    ├── unit/                  # Unit and component tests
    └── e2e/                   # Pipeline and integration test suites
```

---

## Development & Build Verification

### Requirements
- Node.js >= 18.0.0
- npm >= 9.0.0

### Setup
```bash
# Clone the repository
git clone https://github.com/Anhdeface/xokj.git
cd xokj

# Install dependencies
npm install
```

### Running Tests & Type Checks
```bash
# Run full test suite (715 tests across 37 files)
npm test

# Run tests in watch mode
npm run test:watch

# Run TypeScript type validation
npm run type-check
```

### Production Build
```bash
# Compile and package extension into dist/
npm run build
```

### Loading the Extension in Chromium
1. Navigate to `chrome://extensions` (or `brave://extensions`, `edge://extensions`).
2. Enable **Developer mode** toggle.
3. Click **Load unpacked** and select the `dist/` directory.

---

## Security Model & Boundary Constraints

1. **Tab Identity Enforcement**: The service worker verifies `sender.tab.id` on all incoming RPC requests. Commands cannot target arbitrary tab IDs outside the caller's context.
2. **Channel Token & Origin Verification**: Inter-world communication between the MAIN world and the ISOLATED world uses structured message validation with runtime channel identifiers.
3. **Restricted Scheme Protection**: Script injection and debugger attachment are disallowed on browser internal schemes (`chrome://*`, `edge://*`, `chrome-extension://*`, and the Chrome Web Store).
4. **Deterministic In-Flight Settlement**: Upon unexpected debugger detachment (e.g., native DevTools opened or tab closed), all unresolved CDP promises are rejected immediately with structured error codes to prevent resource leaks.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
