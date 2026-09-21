# Original User Request

## 2026-09-19T11:22:26Z

Build a Chromium Userscript Manager extension (Manifest V3) using Vue 3, Vite, and @crxjs/vite-plugin that combines standard userscript capabilities with deep Chrome DevTools Protocol (CDP) intervention, featuring a hybrid architecture (declarative metadata & async RPC API), DevTools conflict handling, metadata parsing, and a minimalist popup & dashboard.

Working directory: /home/quanh/Documents/xokj
Integrity mode: development

## Requirements

### R1. Metadata Parser & Script Engine
Parse `// ==UserScript==` header blocks (`@name`, `@match`, `@run-at`, `@grant`, and custom CDP declarations such as `@cdp`). Handle lifecycle management, script storage (`chrome.storage.local`), and script injection into matched tabs according to Chromium Manifest V3 standards.

### R2. Hybrid CDP Architecture & Conflict Management
Implement a hybrid CDP control plane via `chrome.debugger`:
- **Declarative**: Early-stage network/domain initialization based on metadata (e.g., enabling `Network`, `Page`, `Fetch` before navigation/DOM ready).
- **Asynchronous RPC Bridge**: Provide an async API accessible to userscripts to invoke CDP commands (`cdp.send(method, params)` / `GM_cdp`) and listen to CDP events via the background service worker.
- **Conflict & Session Management**: Detect when native DevTools or another debugger attaches or detaches (`chrome.debugger.onDetach`), surface conflict warnings in the UI/infobar, and cleanly manage debugger session lifecycles.

### R3. Extension UI (Popup & Management Dashboard)
Develop a minimalist, responsive user interface using Vue 3, Vite, and `@crxjs/vite-plugin`:
- **Popup**: Compact interface to view active scripts for the current tab, toggle scripts on/off individually or globally, and display CDP status/warning indicators.
- **Dashboard**: Full management interface allowing users to list, create, edit, save, and delete scripts, complete with a lightweight editor supporting syntax highlighting.

## Acceptance Criteria

### Verification Commands
- `npm run test`: All automated unit tests for the metadata parser and CDP RPC bridge message protocol pass cleanly.
- `npm run build`: Vite + `@crxjs/vite-plugin` build succeeds with zero errors, outputting a valid Manifest V3 extension bundle ready to load unpacked in Chromium.

### Functional Checks
- [ ] Sample script with `// ==UserScript==` metadata is parsed with 100% correct field extraction (`@name`, `@match`, `@run-at`, `@cdp`).
- [ ] Userscript can issue a CDP command (e.g., `Page.navigate` or `Network.getCookies`) and receive the asynchronous response through the background worker.
- [ ] Native DevTools conflict (`chrome.debugger.onDetach`) is caught and triggers a visual alert or status change without crashing the background worker.
- [ ] Popup displays list of matching scripts for active tab with functional toggle switches.
- [ ] Dashboard permits creating a new script, editing script content with syntax highlighting, and persisting updates to `chrome.storage.local`.

## Follow-up — 2026-09-20T03:01:53Z

Server was restarted. All unit tests (66 tests) in workspace are passing cleanly and build succeeded. Please resume teamwork orchestration, check orchestrator status, and proceed with the milestones (Milestone 2: Hybrid CDP Engine & Conflict Manager, Milestone 3, Milestone 4, Milestone 5).

## Follow-up — 2026-09-20T11:21:21Z

User requested to resume teamwork and continue ongoing work. Git checkpoint for Milestone 1 & 2 has been created (110 tests passing). Please resume orchestrator and proceed with Milestone 3 (Userscript Runtime Engine & Injection Bridge), Milestone 4 (Extension UI Popup & Dashboard), and Milestone 5.

## Follow-up — 2026-09-21T05:12:38Z

Continue the development of XOKJ, a Chromium Userscript Manager extension (Manifest V3) built with Vue 3, Vite, and @crxjs/vite-plugin, featuring hybrid CDP architecture, DevTools conflict management, runtime injection, and minimalist Popup and Management Dashboard interfaces.

Working directory: /home/quanh/Documents/xokj
Integrity mode: development

## Requirements

### R1. Complete & Verify Milestone 3 (Userscript Runtime & Lifecycle Injection)
Ensure the userscript execution pipeline is fully wired and tested:
- Content script message bridge relays userscript `window.postMessage` to background `chrome.runtime.sendMessage` and dispatches CDP events back.
- Userscript SDK provides `cdp.send(method, params)`, `cdp.on(event, handler)`, and `GM_cdp(method, params)`.
- Script injector correctly handles lifecycle injection at `document-start`, `document-end`, and `document-idle` via `chrome.scripting.executeScript` and ultra-early injection via CDP `Page.addScriptToEvaluateOnNewDocument`.
- Full storage repository CRUD (`chrome.storage.local`) with default sample scripts and reactive sync.

### R2. Milestone 4: Extension UI (Popup & Management Dashboard)
Build the Vue 3 extension UI components:
- **Popup (`src/popup/`)**:
  - List active scripts matching the current tab URL with individual toggle switches.
  - Global script execution toggle switch.
  - Real-time CDP connection status badge (`IDLE`, `ATTACHING`, `ATTACHED`, `CONFLICT`).
  - Native DevTools conflict warning banner with "Reconnect CDP" action button.
- **Dashboard (`src/dashboard/`)**:
  - Master-detail responsive layout listing all stored userscripts with search & filter.
  - Script CRUD operations (Create new, Edit, Save, Delete, Toggle enable/disable).
  - Code editor integration (CodeMirror 6 or lightweight equivalent) with JavaScript syntax highlighting, line numbers, and dark theme.
  - Import/Export scripts as JSON, and reset to default sample scripts.

### R3. Milestone 5: E2E Integration & Verification Hardening
Implement comprehensive test suites and verify all functionality:
- Automated Vitest test suite covering unit tests and E2E simulation (parsers, match patterns, CDP RPC, conflict recovery, injection, storage, and UI state).
- Ensure `npm run test` passes 100% cleanly.
- Ensure `npm run build` succeeds with zero TypeScript or Vite bundle errors, producing a valid Manifest V3 distribution in `dist/`.

## Acceptance Criteria

### Verification Commands
- `npm run test`: All Vitest unit and integration test suites pass with 0 errors.
- `npm run build`: Vite build with `vue-tsc` succeeds with 0 errors, outputting a complete MV3 bundle in `dist/`.

### Functional Checks
- [ ] Userscript can invoke CDP methods (`cdp.send` / `GM_cdp`) and receive async responses or subscribe to live CDP events.
- [ ] Native DevTools conflict (`chrome.debugger.onDetach` with `canceled_by_user`) is detected, non-fatal to worker, and surfaced in the Popup UI with reconnect capability.
- [ ] Popup displays matching scripts for the current active tab with real-time toggle switches and CDP connection indicators.
- [ ] Dashboard provides full CRUD for scripts with code editing, syntax highlighting, and reactive persistence to `chrome.storage.local`.
- [ ] Scripts are injected according to `@run-at` lifecycle and match patterns.

