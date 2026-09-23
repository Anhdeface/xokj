# Project: XOKJ Architecture Audit, Test Suite & Flaw Remediation

## Architecture
- **Background CDP Control Plane**: `src/background/debugger-mgr.ts`, `src/background/cdp-bridge.ts`, `src/background/conflict-mgr.ts`, `src/background/index.ts`. Manages per-tab debugger sessions, attachment lifecycle, CDP command routing, DevTools conflict detection, and inflight request settling.
- **Injection Pipeline**: `src/background/injector.ts`. Tracks document lifecycle (`document-start`, `document-end`, `document-idle`), performs script matching/filtering, executes scripts in MAIN world, synchronizes declarative CDP domain enabling, and manages deduplication.
- **Content Script & Sandbox Bridge**: `src/content/bridge.ts`, `src/content/cdp-sdk.ts`, `src/content/sandbox.ts`, `src/content/index.ts`. Manages window message RPC forwarding between MAIN world and extension service worker, enforces origin and channel verification, provides userscript SDK API (`cdp`, `GM_cdp`), and handles lifecycle detachment.
- **Storage & Concurrency Engine**: `src/shared/storage.ts`, `src/shared/types.ts`. Manages persistent settings and userscript definitions in `chrome.storage.local` and session cache in `chrome.storage.session`. Requires atomic mutex serialization to guarantee zero data loss under concurrent mutations.
- **Testing & Verification**: Vitest test runner (`npm test -- --run`), TypeScript compiler (`npx tsc --noEmit`), Vite production bundler (`npm run build`).

## Feature Inventory
| # | Feature / Issue | Description | Milestone | Source |
|---|-----------------|-------------|-----------|--------|
| 1 | Storage AsyncMutex Serialization | Implement non-deadlocking FIFO `AsyncMutex` in `src/shared/storage.ts` to serialize mutations (`saveScript`, `toggleScript`, `deleteScript`, `resetToDefaultScripts`, `saveSettings`) and fix Lost-Update race conditions. | M1 | Explorer 3 |
| 2 | Atomic Script Import Batching | Refactor `importScripts` in `src/shared/storage.ts` to acquire mutex once, read once, process all records, and write once, preventing reentrancy deadlocks and $O(N^2)$ writes. | M1 | Explorer 3 |
| 3 | Resolve Adversarial Lost-Update Test | Convert `it.fails` in `test/unit/popup-adversarial.spec.ts:108` to `it` and verify all concurrent toggles preserve state. | M1 | Explorer 3 |
| 4 | Unified Session Operation Lock | Replace isolated `attachLock` in `src/background/debugger-mgr.ts` with mutual exclusion across `attachTab` and `detachTab` to prevent zombie attachments and swallowed operations. | M2 | Explorer 1 |
| 5 | Single Owner for `debugger.onDetach` | Consolidate `chrome.debugger.onDetach` handling in `TabDebuggerManager` and remove redundant listeners in `cdp-bridge.ts` and `conflict-mgr.ts` to eliminate triple lifecycle broadcasts and storage write collisions. | M2 | Explorer 1 |
| 6 | Closed Tab Resurrection Fix | Ensure `setTabStatus` in `debugger-mgr.ts` does not call `createSession(tabId)` if tab was removed or is in `DETACHED` state; prune `tab_sessions` in `chrome.storage.local` on `handleTabRemoved`. | M2 | Explorer 1 |
| 7 | CdpBridgeServer Idle Detach Cleanup | Fix early exit in `rejectPendingRequestsForTab` in `cdp-bridge.ts` so `attachedTabs`, `tabRequests`, and `attachLocks` are unconditionally cleaned up even when zero requests are inflight. | M2 | Explorer 1 |
| 8 | Inflight Command Window Hardening | Register `InflightRequestEntry` in `inflightRequests` and `tabRequests` before awaiting `ensureAttached(tabId)` in `cdp-bridge.ts`, guaranteeing immediate rejection on detachment. | M2 | Explorer 1 |
| 9 | Declarative Init Interruption Check | Check `session.status !== 'ATTACHED'` inside `executeDeclarativeInit` loop in `debugger-mgr.ts` to abort if tab was detached/navigated. | M2 | Explorer 1 |
| 10 | ContentScriptBridge Detach Draining | Drain `this.pendingRequests` in `src/content/bridge.ts` on `DETACHED` lifecycle events with code 1002, preventing 30s client hangs. | M2 | Explorer 1 |
| 11 | Frame-Scoped Navigation Deduplication | Structure `injectionHistory` in `src/background/injector.ts` as `Map<number, Map<number, Set<string>>>` to prevent subframe memory leaks and permit iframe re-injection. | M3 | Explorer 2 |
| 12 | Same-URL Link Navigation Reset | Reset injection deduplication on navigation commit when `frameId === 0` even if URL matches, ensuring link clicks execute userscripts. | M3 | Explorer 2 |
| 13 | Declarative CDP Ordering for All Stages | Ensure `ensureCdpReadyForScripts` is executed in `processStage` for scripts at `document-end` and `document-idle` when requiring `@cdp`, not only `document-start`. | M3 | Explorer 2 |
| 14 | Injection Failure Deduplication Rollback | Remove `dedupeKey` from `injectionHistory` if `executeScriptInTab` fails, allowing subsequent injection attempts on reload. | M3 | Explorer 2 |
| 15 | Bridge RPC Channel Token & Origin Security | Require secret `channelId` and validate message origin in `ContentScriptBridge`, preventing arbitrary webpage scripts from calling privileged CDP commands. | M4 | Explorer 2 |
| 16 | Background Userscript Permission Validation | Validate in `CdpBridgeServer.processRpcRequest` that calling script has authorized CDP metadata before executing debugger commands. | M4 | Explorer 2 |
| 17 | Main-World CDP SDK Injection & Closure Binding | Provide secure `cdp` and `GM_cdp` bindings directly to userscript execution sandbox, removing reliance on unpopulated global `window.cdp`. | M4 | Explorer 2 |
| 18 | Secure Extension GM Storage | Prevent `createGmApi` from using webpage `window.localStorage`; use isolated storage or memory cache. | M4 | Explorer 2 |
| 19 | R2 Stress & Resilience Test Suite | Implement comprehensive tests for: (1) Storage high-frequency race conditions, (2) Concurrent CDP requests vs sudden detachment (`canceled_by_user`), (3) Rapid tab open/close/nav races, (4) Malformed userscript headers & injection recovery. | M5 | Explorer 3 |
| 20 | Final Verification & Quality Gate | Run full test suite (`npm test -- --run`), verify 100% passing of existing 259 tests and new tests, type check (`npx tsc --noEmit`), and production build (`npm run build`). | M6 | Explorer 3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Storage & Concurrency Engine Hardening | Features 1, 2, 3: `src/shared/storage.ts` AsyncMutex, batching, resolve `popup-adversarial.spec.ts:108` `it.fails`. | none | DONE |
| M2 | Background CDP Control Plane Remediation | Features 4, 5, 6, 7, 8, 9, 10: `src/background/debugger-mgr.ts`, `cdp-bridge.ts`, `conflict-mgr.ts`, `src/content/bridge.ts`. | M1 | DONE |
| M3 | Injection Pipeline & Navigation Lifecycle | Features 11, 12, 13, 14: `src/background/injector.ts` frame deduplication, same-URL reset, all-stage CDP readiness, error rollback. | M2 | DONE |
| M4 | Content Script Bridge & Security Isolation | Features 15, 16, 17, 18: `src/content/bridge.ts`, `cdp-sdk.ts`, `sandbox.ts`, `src/content/index.ts`, `cdp-bridge.ts`, `injector.ts`. | M3 | DONE |
| M5 | E2E Adversarial & Stress Test Suite | Feature 19: Comprehensive automated stress test suite covering R2 requirements. | M1, M2, M3, M4 | PLANNED |
| M6 | Final Verification & Build Quality Gate | Feature 20: 100% test pass (259 original + new tests), zero TS errors, successful production build. | M5 | PLANNED |

## Interface Contracts
### `AsyncMutex` (`src/shared/storage.ts`)
- `runExclusive<T>(task: () => Promise<T>): Promise<T>`
- Serializes promises in strict FIFO queue.
- Rejection handling: always resets queue tail via `.catch(() => {})` so downstream tasks execute cleanly.

### `TabDebuggerManager` (`src/background/debugger-mgr.ts`)
- `attachTab(tabId: number): Promise<void>` & `detachTab(tabId: number): Promise<void>`
- Mutual exclusion via `session.operationLock: Promise<void> | null`.
- State transitions: `IDLE` -> `ATTACHING` -> `ATTACHED` -> `DETACHED` / `CONFLICT`.
- Sole owner of `chrome.debugger.onDetach`, invoking `cdpBridge.rejectPendingRequestsForTab(tabId, error)` and `this.broadcastLifecycle(tabId, status, reason)`.

### `CdpBridgeServer` (`src/background/cdp-bridge.ts`)
- `rejectPendingRequestsForTab(tabId: number, error: Error | CdpRpcError): number`
- Unconditionally deletes `this.attachedTabs.delete(tabId)`, `this.attachLocks.delete(tabId)`, `this.tabRequests.delete(tabId)`.
- Rejects pending requests with `code: 1001` (if conflict) or `code: 1002` (if detached/closed).

### `ScriptInjector` (`src/background/injector.ts`)
- `injectionHistory: Map<number, Map<number, Set<string>>>` (tabId -> frameId -> Set of dedupeKeys).
- On top-level navigation (`frameId === 0`): clears all frames for `tabId`.
- On subframe navigation (`frameId !== 0`): clears only the specific `frameId`.
- On error: rolls back dedupe reservation.

### `ContentScriptBridge` (`src/content/bridge.ts`)
- Enforces `requireChannelId: true`.
- On `status === 'DETACHED'`: drains `pendingRequests` with `code: 1002`.

## Code Layout
- `src/shared/storage.ts`: Storage engine & mutex serialization.
- `src/background/debugger-mgr.ts`: Per-tab debugger session state machine.
- `src/background/cdp-bridge.ts`: CDP RPC server & inflight request tracker.
- `src/background/conflict-mgr.ts`: DevTools conflict coordinator.
- `src/background/injector.ts`: Userscript lifecycle injection & deduplication.
- `src/content/bridge.ts`: Content script RPC relay.
- `src/content/cdp-sdk.ts`: Userscript CDP client & GM API.
- `src/content/sandbox.ts`: Sandbox runner & scope isolation.
- `test/unit/`: Vitest unit tests.
- `test/e2e/`: Vitest end-to-end integration pipeline tests.
- `test/mocks/chrome.ts`: Headless Chrome extension API mock harness.
