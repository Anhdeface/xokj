# E2E Test Infra: XOKJ

## Test Philosophy
- Opaque-box, requirement-driven. Derived from ORIGINAL_REQUEST.md.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise Interaction + Real-World Workload Scenarios.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | Scaffolding & Toolchain | ORIGINAL_REQUEST §AC | 5 | 5 | ✓ |
| 2 | Header Block Lexical Parser | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 3 | Standard Metadata Extraction | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 4 | Custom @cdp Grammar Parser | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 5 | Chromium Match Pattern Compiler | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 6 | Storage Schema & Defaults | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 7 | Chrome Debugger Session Manager | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 8 | Early Declarative CDP Init | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 9 | Async RPC Bridge Protocol | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 10 | CDP Event Dispatcher | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 11 | DevTools Conflict Detector | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 12 | Safe Inflight Promise Rejection | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 13 | Tab Debugger Mock Suite | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 14 | Content Script Message Bridge | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 15 | Userscript Runtime SDK | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 16 | Lifecycle-based Script Injection | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 17 | Ultra-early CDP Script Injection | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 18 | Script Repository CRUD | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 19 | Popup Active Tab Script Listing | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 20 | Popup Global Toggle & Badges | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 21 | Popup DevTools Reconnect Action | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 22 | Dashboard Script Management | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 23 | CodeMirror 6 Syntax Highlighter | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 24 | Dashboard Import/Export & Samples | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |

## Test Architecture
- Test runner: Vitest (`npm run test`)
- Test case format: Vitest suite with mocked Chrome APIs and real domain components
- Directory layout: `test/e2e/`, `test/unit/`, `test/mocks/`

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Network Request Interceptor Userscript with @cdp | F2, F3, F4, F7, F8, F9, F15 | High |
| 2 | DOM Manipulation on Navigation with DevTools Open | F5, F11, F12, F16, F20, F21 | High |
| 3 | Script Authoring, Editing, and Persistence via Dashboard | F6, F18, F22, F23, F24 | Medium |
| 4 | Cookie Inspection & Header Injection Userscript via GM_cdp | F4, F9, F10, F15 | High |
| 5 | Multi-tab Concurrent Script Execution with Selective Toggling | F5, F7, F9, F18, F19, F20 | High |

## Coverage Thresholds
- Tier 1: ≥5 per feature
- Tier 2: ≥5 per feature (where boundaries exist)
- Tier 3: pairwise coverage of major feature interactions
- Tier 4: ≥5 realistic application scenarios
