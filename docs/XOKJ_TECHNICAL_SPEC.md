# XOKJ System Architecture & Technical Specification

This document provides a comprehensive technical reference for the internal architecture, state machines, concurrency models, and communication protocols of the XOKJ Userscript Manager.

---

## Table of Contents

1. [System Architectural Invariants](#1-system-architectural-invariants)
2. [Manifest V3 Service Worker Lifecycle](#2-manifest-v3-service-worker-lifecycle)
3. [Tab Debugger Manager State Machine](#3-tab-debugger-manager-state-machine)
   - [3.1. State Definition and Transition Model](#31-state-definition-and-transition-model)
   - [3.2. Concurrency Synchronization & Attachment Mutex](#32-concurrency-synchronization--attachment-mutex)
   - [3.3. Declarative Domain Pre-Initialization](#33-declarative-domain-pre-initialization)
4. [CDP Bridge Server & JSON-RPC Dispatch](#4-cdp-bridge-server--json-rpc-dispatch)
   - [4.1. In-Memory Permission Cache](#41-in-memory-permission-cache)
   - [4.2. In-Flight Request Tracking and Settlement](#42-in-flight-request-tracking-and-settlement)
   - [4.3. Event Multiplexing and Channel Routing](#43-event-multiplexing-and-channel-routing)
5. [Native DevTools Conflict Management](#5-native-devtools-conflict-management)
   - [5.1. Detach Signal Detection](#51-detach-signal-detection)
   - [5.2. In-Flight Request Rejection Protocol](#52-in-flight-request-rejection-protocol)
   - [5.3. State Propagation and UI Reconciliation](#53-state-propagation-and-ui-reconciliation)
6. [Userscript Injection Pipeline & Lifecycle Scheduling](#6-userscript-injection-pipeline--lifecycle-scheduling)
   - [6.1. Metadata Lexical Parsing](#61-metadata-lexical-parsing)
   - [6.2. Match Pattern Engine & LRU Compilation Cache](#62-match-pattern-engine--lru-compilation-cache)
   - [6.3. Multi-Phase Injection Scheduling](#63-multi-phase-injection-scheduling)
   - [6.4. Subframe Deduplication & Teardown Protocol](#64-subframe-deduplication--teardown-protocol)
7. [Storage Subsystem & FIFO AsyncMutex](#7-storage-subsystem--fifo-asyncmutex)
   - [7.1. Storage Schema Design](#71-storage-schema-design)
   - [7.2. FIFO AsyncMutex Implementation](#72-fifo-asyncmutex-implementation)
   - [7.3. Atomic Batch Transactions](#73-atomic-batch-transactions)
8. [Cross-World Communication & Sandboxing](#8-cross-world-communication--sandboxing)
   - [8.1. PostMessage Relay & Channel Tokens](#81-postmessage-relay--channel-tokens)
   - [8.2. Userscript Sandbox & Grant API Polyfills](#82-userscript-sandbox--grant-api-polyfills)
9. [UI Subsystems & State Synchronization](#9-ui-subsystems--state-synchronization)
10. [Security Model & Boundary Protections](#10-security-model--boundary-protections)

---

## 1. System Architectural Invariants

XOKJ enforces five foundational architectural invariants:

1. **Deterministic Single-Session Debugger Attachment**: For any given browser tab ID $T$, at most one active `chrome.debugger` attachment session exists at any point in time.
2. **Tab Identity Isolation**: All Remote Procedure Calls (RPC) received by the background service worker are verified against `sender.tab.id`. A script executing in Tab $A$ is strictly prohibited from dispatching commands or reading events from Tab $B$.
3. **Deterministic Promise Settlement**: When a debugger session terminates (due to tab closure, navigation, or native DevTools attachment), all pending CDP command promises for that tab are rejected immediately with typed error codes. No promise is permitted to remain unsettled.
4. **Zero State Mutation on Storage Reads**: All read operations against userscript storage operate on immutable snapshots or in-memory caches, serialized via a FIFO AsyncMutex.
5. **Restricted Scheme Immutability**: No userscript code is evaluated, and no debugger session is established, on internal browser origins (`chrome://*`, `edge://*`, `chrome-extension://*`, or `https://chromewebstore.google.com/*`).

---

## 2. Manifest V3 Service Worker Lifecycle

In Manifest V3, background pages are replaced with ephemeral Service Workers (`src/background/index.ts`). Service workers may be terminated by the browser engine after 30 seconds of inactivity.

To maintain continuous operations without lost state:
- **Event-Driven Initialization**: All listeners (`chrome.tabs.onUpdated`, `chrome.webNavigation.onCommitted`, `chrome.runtime.onMessage`, `chrome.debugger.onDetach`) are registered synchronously at the top level of `index.ts`.
- **Stateless Reconstitution**: Persistent data (installed scripts, global settings, enabled toggles) resides in `chrome.storage.local`. The service worker loads and populates in-memory lookup caches upon initial startup or message arrival.
- **Session Cleanliness**: In-flight debugging state is tied to active tabs. When the service worker awakens, it queries `chrome.debugger.getTargets()` to reconcile active debugger sessions against open tabs.

---

## 3. Tab Debugger Manager State Machine

The `TabDebuggerManager` (`src/background/debugger-mgr.ts`) coordinates debugger lifecycle states for every active browser tab.

### 3.1. State Definition and Transition Model

```
                    ┌─────────────────────────┐
                    │          IDLE           │
                    └────────────┬────────────┘
                                 │ attach(tabId)
                                 ▼
                    ┌─────────────────────────┐
                    │        ATTACHING        │
                    └──────┬────────────┬─────┘
             Success       │            │ Failure / Error
             ┌─────────────┘            └─────────────┐
             ▼                                        ▼
    ┌─────────────────┐                      ┌─────────────────┐
    │    ATTACHED     │                      │      IDLE       │
    └────────┬────────┘                      └─────────────────┘
             │
             ├──────────────────────────┬──────────────────────────┐
             │ detach(tabId) / Close    │ DevTools Opened          │ Target Crashed
             ▼                          ▼                          ▼
    ┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
    │    DETACHED     │        │    CONFLICT     │        │    DETACHED     │
    └────────┬────────┘        └────────┬────────┘        └────────┬────────┘
             │                          │ User closes DevTools     │
             │                          │ + Manual Reconnect       │
             └──────────────────────────┼──────────────────────────┘
                                        │
                                        ▼
                             [ Re-entry to IDLE ]
```

State Descriptions:
- `IDLE`: No debugger is attached to the tab.
- `ATTACHING`: An asynchronous `chrome.debugger.attach` request is in flight. Further attach requests for the same tab are queued or deduplicated.
- `ATTACHED`: The debugger session is established and active. Commands may be dispatched.
- `DETACHED`: The debugger session was terminated cleanly (e.g., tab closed, user toggled off, or navigation teardown).
- `CONFLICT`: Native Chrome DevTools was opened on the tab, triggering `chrome.debugger.onDetach` with reason `canceled_by_user`.

### 3.2. Concurrency Synchronization & Attachment Mutex
To prevent race conditions where multiple userscripts simultaneously trigger attachment on the same tab during initial page load, `TabDebuggerManager` maintains an in-flight attachment promise map:
```typescript
private attachingPromises = new Map<number, Promise<void>>();
```
If a request arrives while state is `ATTACHING`, the caller awaits the existing promise rather than initiating a duplicate `chrome.debugger.attach` call.

### 3.3. Declarative Domain Pre-Initialization
Upon successful attachment, `TabDebuggerManager` inspects the declared `@cdp` directives for all active scripts on that tab and executes domain initialization in parallel using `Promise.allSettled`:
```typescript
const initCommands = [
  chrome.debugger.sendCommand({ tabId }, "Page.enable", {}),
  chrome.debugger.sendCommand({ tabId }, "Network.enable", { maxTotalBufferSize: 10000000 }),
  chrome.debugger.sendCommand({ tabId }, "Runtime.enable", {})
];
await Promise.allSettled(initCommands);
```

---

## 4. CDP Bridge Server & JSON-RPC Dispatch

The `CdpBridgeServer` (`src/background/cdp-bridge.ts`) acts as the central RPC multiplexer between content script clients and the Chromium debugger engine.

### 4.1. In-Memory Permission Cache
To avoid asynchronous disk/storage reads during high-frequency CDP commands (such as DOM mutation tracking or mouse move events), `CdpBridgeServer` maintains an in-memory rule cache:
```typescript
private scriptRulesCache = new Map<string, ParsedMetadata>();
```
This cache is updated reactively whenever `chrome.storage.onChanged` fires for userscripts.

### 4.2. In-Flight Request Tracking and Settlement
Every command dispatched from `cdp.send()` generates a unique 64-bit request ID. The bridge server tracks pending requests per tab:
```typescript
interface InFlightRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}
private tabRequests = new Map<number, Map<string, InFlightRequest>>();
```
When `chrome.debugger.sendCommand` completes, the corresponding promise is settled and removed from the map. If a response exceeds the configured timeout threshold (default: 30,000 ms), the promise rejects with a `TimeoutError`.

### 4.3. Event Multiplexing and Channel Routing
CDP backend events emitted via `chrome.debugger.onEvent` are routed to content scripts:
1. The service worker receives `(source, method, params)`.
2. It validates that the tab has an active attached session and userscripts with permission for `method`.
3. It dispatches a message `{ type: 'CDP_RPC_EVENT', tabId, method, params }` via `chrome.tabs.sendMessage(tabId, message)`.
4. `ContentScriptBridge` intercepts the message and relays it via `window.postMessage` to all listening userscripts in the MAIN world.

---

## 5. Native DevTools Conflict Management

Chromium imposes a strict constraint: only one debugger client may attach to a tab. Opening the built-in Chrome DevTools (F12) automatically disconnects `chrome.debugger`.

The `DevToolsConflictManager` (`src/background/conflict-mgr.ts`) handles this graceful degradation:

### 5.1. Detach Signal Detection
Listens to `chrome.debugger.onDetach`:
```typescript
chrome.debugger.onDetach.addListener((source, reason) => {
  if (reason === 'canceled_by_user') {
    this.handleUserDevToolsConflict(source.tabId);
  } else {
    this.handleCleanDetach(source.tabId, reason);
  }
});
```

### 5.2. In-Flight Request Rejection Protocol
Upon detecting `canceled_by_user`:
1. Transitions tab state in `TabDebuggerManager` to `CONFLICT`.
2. Drains the `tabRequests` map for that tab.
3. Rejects every pending in-flight promise with:
   ```typescript
   class DevToolsConflictError extends Error {
     readonly code = 1001;
     constructor(tabId: number) {
       super(`CDP operation aborted: Native DevTools opened on tab ${tabId}.`);
     }
   }
   ```
4. Notifies content script bridges to suppress further outgoing requests until reconnected.

### 5.3. State Propagation and UI Reconciliation
Emits a broadcast message to the Popup UI (`src/popup/`) and Management Dashboard (`src/dashboard/`). The UI displays an alert banner explaining that native DevTools is active, providing a manual "Reconnect" button once DevTools is closed.

---

## 6. Userscript Injection Pipeline & Lifecycle Scheduling

The injection subsystem (`src/background/injector.ts`) controls how and when userscripts are delivered to web pages.

### 6.1. Metadata Lexical Parsing
`metadata-parser.ts` tokenizes header blocks into a structured `ParsedMetadata` object:
- Extraction of standard userscript headers (`@name`, `@version`, `@match`, `@run-at`, `@grant`).
- Extraction of structured `@cdp <Domain.method> [json_params]` declarations.

### 6.2. Match Pattern Engine & LRU Compilation Cache
`match-pattern.ts` compiles standard Chrome match pattern strings (`https://*.example.com/*`) into strict Regular Expressions.
- Backed by an LRU cache with a fixed capacity of 1,000 entries.
- If cache capacity is exceeded, the least recently used compiled RegExp is evicted, ensuring bounded memory usage.

### 6.3. Multi-Phase Injection Scheduling
Scripts are registered against three distinct browser lifecycle events:
- `document-start`: Handled during `chrome.webNavigation.onCommitted`. Evaluated before the DOM or external scripts execute.
- `document-end`: Handled during `chrome.webNavigation.onDOMContentLoaded`. Evaluated when DOM tree construction completes.
- `document-idle`: Handled during `chrome.webNavigation.onCompleted` (or 200ms after DOMContentLoaded). Evaluated after page subresources load.

### 6.4. Subframe Deduplication & Teardown Protocol
To prevent duplicate execution in pages with complex nested iframes:
- The injector maintains `Map<tabId, Map<frameId, Set<scriptId>>>`.
- On `chrome.webNavigation.onCommitted`, if navigation is top-level (`frameId === 0`), all subframe tracking for `tabId` is flushed.
- On `chrome.tabs.onRemoved`, all tab-scoped maps are deleted immediately.

---

## 7. Storage Subsystem & FIFO AsyncMutex

The storage subsystem (`src/shared/storage/`) manages persistent state in `chrome.storage.local`.

### 7.1. Storage Schema Design

The extension persists configuration, installed scripts, and session states in `chrome.storage.local`:

```typescript
export interface ExtensionStorageSchema {
  /** Schema migration version integer */
  schemaVersion: number;
  /** Primary dictionary of installed userscripts indexed by unique ID */
  scripts: Record<string, ScriptRecord>;
  /** Global application configuration */
  settings: AppSettings;
  /** Active tab debugger session cache */
  tab_sessions?: Record<number, TabSessionState>;
}

export interface ScriptRecord {
  id: string;
  name: string;
  code: string;
  metadata: ParsedMetadata;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  parseErrors?: string[];
}

export interface AppSettings {
  globalEnabled: boolean;
  autoAttachDebugger: boolean;
  debuggerProtocolVersion?: string; // Default: '1.3'
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
```

Persistent userscript key-value data created via `GM_setValue` is partitioned into dedicated script buckets in `chrome.storage.local`:
- Prefix: `gm_values_<scriptId>` -> `Record<string, unknown>`
- Managed by `GmStorageRepository` (`src/shared/storage/gm-repo.ts`) with mutex-serialized atomic transactions.

### 7.2. FIFO AsyncMutex Implementation
`chrome.storage.local` provides asynchronous APIs (`get`, `set`) without native transaction locking. Simultaneous mutations (e.g. toggling two scripts concurrently) can result in lost updates.

`AsyncMutex` resolves this by serializing operations in a FIFO queue:
```typescript
export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async runExclusive<T>(callback: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await callback();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}
```

### 7.3. Atomic Batch Transactions
During bulk operations (e.g., importing multiple userscripts), the storage repository acquires the mutex once, reads storage once, updates the in-memory dictionary, and writes to `chrome.storage.local` in a single atomic payload.

---

## 8. Cross-World Communication & Sandboxing

Chromium isolates content scripts into separate JavaScript execution worlds:
- **MAIN World**: The page's execution context where standard website JavaScript runs.
- **ISOLATED World**: The extension's content script context, inaccessible to the page's scripts.

### 8.1. PostMessage Relay & Channel Tokens
Communication between the Userscript SDK in the MAIN world and the Content Script Bridge in the ISOLATED world uses `window.postMessage`:
1. Canonical message types:
   - `CDP_RPC_REQUEST`: Dispatched by userscript to invoke CDP methods.
   - `CDP_RPC_RESPONSE`: Dispatched by bridge returning RPC result or error.
   - `CDP_RPC_EVENT`: Dispatched by bridge pushing live CDP events.
   - `CDP_LIFECYCLE_EVENT`: Dispatched by bridge pushing status changes (`ATTACHED`, `CONFLICT`, `DETACHED`).
   - `GM_STORAGE_SET`: Dispatched by userscript to write-through storage mutations.
   - `GM_STORAGE_DELETE`: Dispatched by userscript to delete stored keys.
2. Step 0 fast-path pre-filter drops non-matching messages immediately before payload parsing.
3. Payloads include a correlation token (`id`) to map asynchronous responses back to the originating caller.
4. Cryptographic channel tokens (`channelId`) authorize communication between the MAIN world sandbox and ISOLATED world bridge.

### 8.2. Userscript Sandbox & Grant API Polyfills
`src/background/injector/page-runner.ts` executes userscripts directly in the target tab's MAIN world:
- If `@grant none` is specified, all 9 privileged keys are shadowed with `undefined`.
- If `@grant` directives or `@cdp` are specified, an isolated execution scope is constructed exposing only authorized APIs:
  - CDP APIs: `cdp.send()`, `cdp.on()`, `cdp.off()`, `cdp.getStatus()`, `cdp.isAttached()`, and `GM_cdp(...)`.
  - Greasemonkey APIs: `GM_setValue()`, `GM_getValue()`, `GM_deleteValue()`, `GM_listValues()`, `GM_addStyle()`, `GM_log()`, and `GM_info`.
- All ungranted privileged keys are explicitly shadowed with `undefined` in the wrapper scope.
- In-memory storage is pre-hydrated from `chrome.storage.local` prior to execution, ensuring synchronous `GM_getValue` with zero async delay.

---

## 9. UI Subsystems & State Synchronization

The user interface components are built with Vue 3 and bundled via Vite:

- **Extension Popup (`src/popup/`)**:
  - Displays scripts matching the active tab URL.
  - Provides instant toggle switches that persist state via `chrome.runtime.sendMessage({ type: 'TOGGLE_SCRIPT' })`.
  - Shows live CDP status badges (`ATTACHED`, `ATTACHING`, `CONFLICT`, `DETACHED`, `IDLE`).
- **Management Dashboard (`src/dashboard/`)**:
  - Modular architecture decomposed into `ScriptList.vue`, `ScriptEditor.vue`, `MetadataPanel.vue`, `ImportExportModal.vue`, and composable `useDashboardState.ts`.
  - Full-screen userscript editor integrating CodeMirror 6 with dynamic language highlighting, dark theme, and keyboard shortcuts (`Mod-s`).
  - Chunk-split in Vite configuration ensuring CodeMirror bundle is loaded only on dashboard access (dashboard entry chunk < 50 kB).

---

## 10. Security Model & Boundary Protections

1. **Origin Filtering**: Script injection is denied on origins matching `chrome://*`, `chrome-extension://*`, and `view-source:*`.
2. **Context Isolation**: Web pages cannot access extension APIs (`chrome.debugger`, `chrome.storage`) directly; all requests must pass through the verified bridge and permission validators.
3. **Memory Safety**: Event listeners and session handles are explicitly cleared upon tab navigation or tab closure to prevent memory leaks in the background service worker.

---

*Document Version: 1.0.0 — Target Engine: xokj 0.2.0*
