# Original User Request

## 2026-09-21T11:00:43Z

This is a single self-contained fix; keep it small and focused. Perform a comprehensive architectural audit and stability verification of the XOKJ Userscript & CDP Engine (`src/background`, `src/content`, `src/shared`), identify potential race conditions or architectural bottlenecks, implement edge-case regression tests, and fix any detected issues.

Working directory: /home/quanh/Documents/xokj
Integrity mode: development

## Requirements

### R1. Deep Subsystem Architecture & Conformance Audit
Conduct an end-to-end audit of all engine core modules:
- Background CDP Control Plane (`src/background/debugger-mgr.ts`, `src/background/cdp-bridge.ts`, `src/background/conflict-mgr.ts`): Verify session state transitions (`IDLE`, `ATTACHING`, `ATTACHED`, `DETACHED`, `CONFLICT`), detached event handling, inflight promise rejection guarantees, and clean resource deallocation.
- Injection Pipeline (`src/background/injector.ts`): Verify lifecycle injection (`document-start`, `document-end`, `document-idle`), declarative CDP initialization ordering, navigation tracking, and deduplication map lifecycle without memory leaks.
- Content Script & Sandbox Bridge (`src/content/bridge.ts`, `src/content/cdp-sdk.ts`, `src/content/sandbox.ts`): Verify security boundary isolation, `window.postMessage` RPC origin validation, and event listener cleanups.
- Storage & Concurrency Engine (`src/shared/storage.ts`): Verify atomic mutex serialization, concurrency safety under simultaneous updates, and schema integrity.

### R2. Edge-Case, Stress & Resilience Test Suite
Create rigorous automated tests covering critical failure modes and edge cases:
- Rapid tab open/close and navigation during active CDP transactions.
- Concurrent CDP requests racing against unexpected DevTools detachment (`canceled_by_user`).
- Malformed userscript headers, invalid `@cdp` permissions, and injection error recovery.
- High-frequency storage read/write race conditions.

### R3. Flaw Remediation & Optimization
Refactor and resolve any identified architectural flaws, memory leaks, unhandled promise rejections, or race condition vulnerabilities while maintaining system stability and extension UI compatibility.

## Verification Resources
- Test suite command: `npm test -- --run` (Vitest unit and e2e test suites)
- Type check: `npx tsc --noEmit`
- Build check: `npm run build`

## Acceptance Criteria

### Architectural Conformance & Robustness
- [ ] Complete architectural review demonstrating clean state machine transitions and zero unhandled promise rejection paths across all engine modules.
- [ ] No memory leaks in navigation tracking maps, CDP event dispatchers, or storage mutex queues.

### Test Coverage & Stability
- [ ] New automated unit/adversarial tests added covering race conditions, rapid disconnections, and edge-case injections.
- [ ] 100% of existing tests (259 tests) and all newly added tests pass cleanly without timeout or flakes via `npm test`.
- [ ] Production build (`npm run build`) completes successfully with zero type or bundling errors.

## Follow-up — 2026-09-22T05:19:37Z

The server restarted. Please resume the project orchestrator and agent swarm to continue execution from the current milestone (Milestones 2-6: CDP Control Plane verification, Injection Pipeline & Navigation Lifecycle, Content Script Bridge & Security Isolation, E2E Adversarial Stress Suite, and Final Acceptance Gate). All previous state in .agents/ is intact.

## Follow-up — 2026-09-22T06:02:20Z

Please resume execution of teamwork_preview. Check .agents/orchestrator_1/progress.md and continue from Milestone 2 verification and Milestone 3 (Injection Pipeline & Navigation Lifecycle).

## Follow-up — 2026-09-22T13:57:16Z

The server restarted. Please resume teamwork_preview and the project orchestrator to continue execution across Milestone 3 (Injection Pipeline & Navigation Lifecycle), Milestone 4 (Content Script Bridge & Security Isolation), Milestone 5 (E2E Adversarial Stress Suite), and Milestone 6 (Final Quality Gate). All previous progress and state in .agents/ are preserved.

## Follow-up — 2026-09-22T14:39:29Z

USER DIRECTIVE: Complete Milestone 3 (Injection Pipeline & Navigation Lifecycle), verify all M3 challenger tests pass 100%, create a clean git checkpoint / commit for Milestone 3, and then STOP execution without proceeding to Milestone 4. Provide a full final summary of Milestone 1, 2, and 3 achievements upon completion.

## Follow-up — 2026-09-23T05:21:32Z

Server restarted. Please resume teamwork_preview to complete Milestone 3 verification, verify all 394 tests pass, create the git checkpoint commit for Milestone 3, and provide the final report as requested. All files in .agents/ are preserved.

## Follow-up — 2026-09-23T05:30:30Z

This is a single self-contained fix; keep it small and focused. Implement Milestone 4: Content Script Bridge & Security Isolation for the XOKJ Userscript Manager extension codebase.

Working directory: /home/quanh/Documents/xokj
Integrity mode: development

## Requirements

### R1. Bridge RPC Channel Token & Origin Security (Feature 15)
- Enforce strict channel validation and message source/origin checks in `ContentScriptBridge` (`src/content/bridge.ts`).
- Require and verify secret `channelId` for all `CDP_RPC_REQUEST` messages from the webpage Main World to prevent unauthenticated/foreign scripts from accessing the bridge.

### R2. Background Userscript Permission Validation (Feature 16)
- In `CdpBridgeServer.processRpcRequest` (`src/background/cdp-bridge.ts`), validate that requests originating from userscripts contain valid script credentials/metadata confirming granted `@cdp` or `@grant` permissions prior to executing any CDP commands.

### R3. Main-World CDP SDK Injection & Closure Binding (Feature 17)
- In `src/content/sandbox.ts` and `src/background/injector.ts`, bind `cdp`, `GM_cdp`, and `GM_*` APIs directly inside the userscript execution closure instead of relying on mutable or unpopulated global objects (`window.cdp`).
- Respect declared `@grant` and `@cdp` directives when constructing the sandbox scope.

### R4. Secure Extension GM Storage (Feature 18)
- Update `createGmApi` in `src/content/cdp-sdk.ts` to ensure userscript key-value storage (`GM_setValue`, `GM_getValue`, `GM_deleteValue`, `GM_listValues`) is isolated and does not expose private userscript data to standard unpartitioned webpage `window.localStorage`.

## Acceptance Criteria

### Security & Verification Guardrails
- [ ] `ContentScriptBridge` drops and rejects any window messages lacking a valid matching `channelId` or having invalid origins.
- [ ] `CdpBridgeServer` enforces authorization checks against script permissions before sending CDP debugger commands.
- [ ] Userscript sandbox closure provides strict isolation, ensuring `@grant none` scripts receive zero privileged APIs, while granted scripts receive properly bound `cdp`/`GM_cdp`/`GM_*` instances.
- [ ] `createGmApi` storage operations do not pollute or read from vulnerable webpage `localStorage`.
- [ ] Comprehensive unit tests for M4 features are added/updated in `test/unit/content-bridge.spec.ts`, `test/unit/cdp-sdk.spec.ts`, and `test/unit/sandbox.spec.ts` (or new test files).
- [ ] All existing and new tests pass cleanly with `npx vitest run --no-file-parallelism` (394+ tests, 0 failures).
- [ ] TypeScript compilation succeeds with zero errors (`npx tsc --noEmit`).
- [ ] `PROJECT.md` is updated to mark Milestone 4 as `DONE`.

## Follow-up — 2026-09-23T06:26:14Z

The server has restarted. All agent state in `.agents/` is intact. Please resume teamwork_preview execution from your current state in `.agents/orchestrator_1/progress.md` (Milestone 4: Content Script Bridge & Security Isolation, Iteration 2). Check on your subagents' status, re-dispatch/resume orchestrator, workers, reviewers, challengers, and auditors as needed, and drive Milestone 4 to completion and victory audit.
