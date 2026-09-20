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
