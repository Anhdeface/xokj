# Project: XOKJ - Chromium Userscript Manager with Hybrid CDP Architecture

## Architecture
XOKJ is a Manifest V3 Chromium Userscript Manager built with Vue 3, Vite, and `@crxjs/vite-plugin`. It combines standard userscript capabilities with deep Chrome DevTools Protocol (CDP) intervention via `chrome.debugger`.

### Architectural Components
1. **Toolchain & Shared Core (`src/shared/`)**:
   - Types (`types.ts`): Unified interfaces for `ScriptRecord`, `ParsedMetadata`, `CdpDeclaration`, `CdpRpcRequest`, `CdpRpcResponse`, `TabSession`, `ConflictEvent`.
   - Metadata Parser (`metadata-parser.ts`): Lexical parser extracting standard Tampermonkey/Violentmonkey directives (`@name`, `@match`, `@run-at`, `@grant`, etc.) and custom `@cdp` directives.
   - Match Pattern Engine (`match-pattern.ts`): Strict Chromium match pattern compiler supporting wildcard subdomains, paths, and `<all_urls>`.
   - Storage Repository (`storage.ts`): Typed abstraction over `chrome.storage.local` with sample scripts pre-seeding and reactive updates.

2. **Background Service Worker & CDP Engine (`src/background/`)**:
   - `TabDebuggerManager`: Manages per-tab `chrome.debugger` sessions (`IDLE` -> `ATTACHING` -> `ATTACHED` -> `CONFLICT` / `DETACHED`). Intercepts `chrome.webNavigation.onBeforeNavigate` to perform early declarative domain enablement (`Network.enable`, `Page.enable`, `Fetch.enable`).
   - `CdpBridgeServer`: Asynchronous RPC bridge handling incoming `cdp.send` / `GM_cdp` requests via `chrome.runtime.onMessage`, enforcing tab security via `sender.tab.id`, and broadcasting CDP events via `chrome.tabs.sendMessage`.
   - `DevToolsConflictHandler`: Catches `chrome.debugger.onDetach` (detecting `canceled_by_user` when native DevTools opens), immediately rejects pending promises with typed `DevToolsConflictError` to prevent worker crash, and broadcasts conflict alerts to UI and content scripts.
   - `ScriptInjector`: Coordinates script injection via `chrome.scripting.executeScript` or CDP `Page.addScriptToEvaluateOnNewDocument`.

3. **Content Script & Runtime SDK (`src/content/`)**:
   - `content.ts`: Bridge between webpage context and background service worker. Injects the userscript runtime environment into matched tabs.
   - `bridge.ts`: Uses `window.postMessage` to communicate with scripts running in the page, forwarding calls to `chrome.runtime.sendMessage` and returning responses.
   - `cdp-sdk.ts`: Client-side SDK exposed to userscripts providing `cdp.send(method, params)`, `cdp.on(event, handler)`, and `GM_cdp(method, params)`.

4. **Extension User Interface (`src/popup/` & `src/dashboard/`)**:
   - `src/popup/`: Compact Vue 3 popup showing active scripts for current tab, individual and global enable/disable toggles, reactive CDP status badge, and DevTools conflict alert banner with "Reconnect CDP" action.
   - `src/dashboard/`: Full-page management dashboard with master-detail layout, search/filter, script CRUD, import/export, and CodeMirror 6 editor with JavaScript syntax highlighting, line numbers, and dark theme.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Scaffolding & Toolchain | Vite 5 + @crxjs/vite-plugin + Vue 3 + TypeScript + decoupled Vitest configuration | M1 | explorer_ui_survey_1 |
| 2 | Header Block Lexical Parser | Parse `// ==UserScript==` to `// ==/UserScript==` block handling CR/LF and leading spaces | M1 | spec_miner_survey_1 |
| 3 | Standard Metadata Extraction | Parse `@name`, `@namespace`, `@version`, `@description`, `@match`, `@include`, `@exclude`, `@run-at`, `@grant` | M1 | spec_miner_survey_1 |
| 4 | Custom `@cdp` Grammar Parser | Parse `@cdp <domain>[.<method>] [paramsJson]` into structured `{ domain, method, command, params }` | M1 | spec_miner_survey_1 |
| 5 | Chromium Match Pattern Compiler | Compile `<scheme>://<host><path>` and `<all_urls>` into strict RegExp supporting wildcard subdomains | M1 | spec_miner_survey_1 |
| 6 | Storage Schema & Defaults | Typed storage repository (`chrome.storage.local`) with sample CDP script preloaded | M1 | spec_miner_survey_1 |
| 7 | Chrome Debugger Session Manager | Manage `chrome.debugger` attachment, session lifecycle, and target `{ tabId }` | M2 | explorer_cdp_survey_1 |
| 8 | Early Declarative CDP Init | Intercept `chrome.webNavigation.onBeforeNavigate` to attach & enable declared CDP domains before navigation | M2 | explorer_cdp_survey_1 |
| 9 | Async RPC Bridge Protocol | Asynchronous request/response routing for `cdp.send` / `GM_cdp` through background worker | M2 | explorer_cdp_survey_1 |
| 10 | CDP Event Dispatcher | Multiplex and forward `chrome.debugger.onEvent` events to the corresponding tab and userscripts | M2 | explorer_cdp_survey_1 |
| 11 | DevTools Conflict Detector | Intercept `chrome.debugger.onDetach` with `canceled_by_user` (native DevTools open), update tab state | M2 | explorer_cdp_survey_1 |
| 12 | Safe Inflight Promise Rejection | Instant rejection of pending CDP commands on detach with `DevToolsConflictError` without crashing worker | M2 | explorer_cdp_survey_1 |
| 13 | Tab Debugger Mock Suite | Node.js / Vitest mock harness simulating `chrome.debugger`, `chrome.runtime`, `chrome.tabs`, `chrome.webNavigation` | M2 | explorer_cdp_survey_1 |
| 14 | Content Script Message Bridge | Isolated world relay bridging userscript `window.postMessage` to `chrome.runtime.sendMessage` | M3 | explorer_cdp_survey_1 |
| 15 | Userscript Runtime SDK | Expose `cdp.send(method, params)`, `cdp.on(event, cb)`, and `GM_cdp(method, params)` in userscript scope | M3 | ORIGINAL_REQUEST R2 |
| 16 | Lifecycle-based Script Injection | Inject matched scripts at `document-start`, `document-end`, and `document-idle` | M3 | ORIGINAL_REQUEST R1 |
| 17 | Ultra-early CDP Script Injection | Evaluate scripts at document creation via CDP `Page.addScriptToEvaluateOnNewDocument` | M3 | spec_miner_survey_1 |
| 18 | Script Repository CRUD | Query, create, update, delete, and toggle scripts with reactive storage persistence | M3 | spec_miner_survey_1 |
| 19 | Popup Active Tab Script Listing | List scripts matching the active tab URL with individual toggle switches | M4 | ORIGINAL_REQUEST R3 |
| 20 | Popup Global Toggle & Badges | Global script execution toggle, CDP connection status badge, and conflict warning banner | M4 | ORIGINAL_REQUEST R3 |
| 21 | Popup DevTools Reconnect Action | User-driven action to reconnect CDP session after native DevTools is closed | M4 | explorer_cdp_survey_1 |
| 22 | Dashboard Script Management | Master-detail UI listing all scripts with search, filter, create, edit, save, delete | M4 | ORIGINAL_REQUEST R3 |
| 23 | CodeMirror 6 Syntax Highlighter | Lightweight code editor with JavaScript syntax highlighting, line numbers, and dark theme | M4 | explorer_ui_survey_1 |
| 24 | Dashboard Import/Export & Samples | Export scripts to JSON, import from file, and reset to default sample scripts | M4 | explorer_ui_survey_1 |
| 25 | E2E Test Suite (Tiers 1-4) | Comprehensive opaque-box test suite verifying parser, matchers, CDP RPC, conflict handling, and UI | M5 | Project Pattern |
| 26 | Adversarial Coverage Hardening (Tier 5) | White-box stress testing, invalid input robustness, and boundary enforcement | M5 | Project Pattern |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Toolchain & Metadata Parser Core | Scaffolding (`package.json`, Vite, Vitest, TS), Types, `metadata-parser.ts`, `match-pattern.ts`, storage types, and unit tests | none | DONE |
| 2 | Hybrid CDP Engine & Conflict Manager | `TabDebuggerManager`, `CdpBridgeServer`, `DevToolsConflictHandler`, mock harness, and RPC bridge unit tests | M1 | DONE |
| 3 | Userscript Runtime Engine & Injection Bridge | Content script bridge, `cdp-sdk.ts`, `ScriptInjector`, storage CRUD repository, and integration tests | M1, M2 | DONE |
| 4 | Extension UI (Popup & Management Dashboard) | Vue 3 Popup (active scripts, toggles, CDP status/conflict banner) and Dashboard (CRUD, CodeMirror 6 editor) | M1, M2, M3 | DONE |
| 5 | E2E Verification & Adversarial Hardening | Phase 1: Pass 100% E2E test suite (Tiers 1-4). Phase 2: Adversarial coverage hardening (Tier 5) | M1, M2, M3, M4 | DONE |

---

## Interface Contracts

### Shared Core ↔ Background & Content Scripts
- `parseMetadata(code: string): ParsedMetadata`
  - Returns parsed attributes (`name`, `version`, `matchPatterns`, `runAt`, `grants`, `cdpDeclarations`). Throws or returns sanitized defaults on syntax issues.
- `matchesUrl(pattern: string, url: string): boolean`
  - Compiles Chromium match pattern and tests target URL.
- `CdpDeclaration`: `{ domain: string; method: string; command: string; params: Record<string, any> }`
- `ScriptRecord`: `{ id: string; name: string; code: string; metadata: ParsedMetadata; enabled: boolean; createdAt: number; updatedAt: number }`

### Userscript SDK ↔ Content Script ↔ Background Service Worker (RPC Bridge)
- Request:
  ```typescript
  interface CdpRpcRequest {
    type: 'CDP_RPC_REQUEST';
    id: string;             // UUID or monotonic string
    tabId?: number;         // Set by background from sender.tab.id
    method: string;         // e.g. "Page.navigate", "Network.getCookies"
    params?: Record<string, any>;
  }
  ```
- Response:
  ```typescript
  interface CdpRpcResponse {
    type: 'CDP_RPC_RESPONSE';
    id: string;
    result?: any;
    error?: { code: number; message: string; data?: any };
  }
  ```
- Event Broadcast:
  ```typescript
  interface CdpRpcEventMessage {
    type: 'CDP_RPC_EVENT';
    tabId: number;
    method: string;         // e.g. "Network.requestWillBeSent"
    params: any;
  }
  ```
- Lifecycle / Conflict Alert:
  ```typescript
  interface CdpRpcLifecycleMessage {
    type: 'CDP_LIFECYCLE_EVENT';
    tabId: number;
    status: 'ATTACHED' | 'DETACHED' | 'CONFLICT';
    reason?: string;        // e.g. "canceled_by_user"
  }
  ```

### Background Service Worker ↔ UI (Popup / Dashboard)
- Storage Key: `scripts`: `Record<string, ScriptRecord>`
- Storage Key: `tab_sessions`: `Record<number, { tabId: number; status: string; reason?: string }>`
- Messages:
  - `{ type: 'GET_ACTIVE_SCRIPTS_FOR_TAB', tabId: number, url: string }` -> `{ scripts: ScriptRecord[], cdpStatus: string }`
  - `{ type: 'TOGGLE_SCRIPT', scriptId: string, enabled: boolean }`
  - `{ type: 'RECONNECT_CDP', tabId: number }` -> `{ success: boolean, error?: string }`

---

## Code Layout
```
xokj/
├── manifest.config.ts         # Chrome Extension Manifest V3 configuration
├── vite.config.ts             # Vite build configuration with @crxjs/vite-plugin
├── vitest.config.ts           # Vitest configuration for decoupled unit testing
├── tsconfig.json              # TypeScript project configuration
├── package.json               # Dependencies and build/test scripts
├── src/
│   ├── shared/                # Core domain logic and contracts (M1)
│   │   ├── types.ts           # Shared TypeScript interfaces
│   │   ├── metadata-parser.ts # // ==UserScript== header & @cdp parser
│   │   ├── match-pattern.ts   # Chromium URL match pattern engine
│   │   └── storage.ts         # chrome.storage.local repository & defaults
│   ├── background/            # Background service worker & CDP subsystem (M2)
│   │   ├── index.ts           # Service worker entry point
│   │   ├── debugger-mgr.ts    # chrome.debugger session state machine
│   │   ├── cdp-bridge.ts      # Async RPC bridge & event dispatcher
│   │   ├── conflict-mgr.ts    # DevTools onDetach conflict management
│   │   └── injector.ts        # Script injection coordinator
│   ├── content/               # Content script & injected runtime SDK (M3)
│   │   ├── index.ts           # Content script entry point (<all_urls>)
│   │   ├── bridge.ts          # Window postMessage ↔ chrome.runtime relay
│   │   └── cdp-sdk.ts         # cdp.send / GM_cdp client SDK for userscripts
│   ├── popup/                 # Popup UI (M4)
│   │   ├── index.html         # Popup entry HTML
│   │   ├── main.ts            # Vue 3 mount
│   │   ├── App.vue            # Popup root component
│   │   └── components/        # ScriptCard, CdpStatusBadge, ConflictBanner
│   └── dashboard/             # Management Dashboard UI (M4)
│       ├── index.html         # Dashboard entry HTML
│       ├── main.ts            # Vue 3 mount
│       ├── App.vue            # Dashboard root master-detail view
│       └── components/        # ScriptEditor (CodeMirror 6), ScriptList, Header
└── test/                      # Test suites (M1-M5)
    ├── mocks/                 # chrome.* API mocks (debugger, runtime, storage)
    ├── unit/                  # Unit tests (parser, matcher, cdp-bridge, conflict)
    └── e2e/                   # E2E integration tests (Tiers 1-5)
```
