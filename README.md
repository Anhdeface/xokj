# XOKJ Monorepo: Userscript Engine & Static Analysis Ecosystem

[![xokj Version](https://img.shields.io/github/package-json/v/Anhdeface/xokj?filename=package.json&label=xokj%20version&color=blue)](package.json)
[![xobrow Version](https://img.shields.io/github/package-json/v/Anhdeface/xokj?filename=packages%2Fxobrow%2Fpackage.json&label=xobrow%20version&color=indigo)](packages/xobrow/package.json)
[![Manifest](https://img.shields.io/badge/Manifest-V3-success)](manifest.config.ts)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933)](package.json)
[![License](https://img.shields.io/github/license/Anhdeface/xokj?color=gray)](LICENSE)

A high-performance monorepo providing a Chromium Userscript Manager with a Hybrid Chrome DevTools Protocol (CDP) control plane alongside a strict standalone static analysis and security auditing CLI tool.

---

## Table of Contents

1. [Monorepo Overview](#1-monorepo-overview)
2. [Packages & Component Inventory](#2-packages--component-inventory)
   - [2.1. XOKJ Extension (Root / `src/`)](#21-xokj-extension-root--src)
   - [2.2. XoBrow CLI Auditor (`packages/xobrow`)](#22-xobrow-cli-auditor-packagesxobrow)
3. [Technology Stack & Dependency Matrix](#3-technology-stack--dependency-matrix)
   - [3.1. XOKJ Extension Libraries](#31-xokj-extension-libraries)
   - [3.2. XoBrow CLI Auditor Libraries](#32-xobrow-cli-auditor-libraries)
4. [Monorepo Quickstart & Setup Guide](#4-monorepo-quickstart--setup-guide)
   - [4.1. Prerequisites](#41-prerequisites)
   - [4.2. Installation and Build](#42-installation-and-build)
   - [4.3. Global CLI Registration via npm link](#43-global-cli-registration-via-npm-link)
   - [4.4. Unified Version Management](#44-unified-version-management)
5. [NPM Scripts Reference](#5-npm-scripts-reference)
6. [Repository Directory Structure](#6-repository-directory-structure)
7. [Master Documentation Directory](#7-master-documentation-directory)
8. [License](#8-license)

---

## 1. Monorepo Overview

The `xokj` repository is structured as an npm workspace monorepo containing two integrated subsystems:

1. **XOKJ Browser Extension**: A Manifest V3 userscript manager for Chromium browsers featuring direct Chrome DevTools Protocol (CDP) integration via `chrome.debugger`.
2. **XoBrow (`xb`) Static Analyzer**: A standalone command-line audit tool designed to evaluate external userscript quality, security risks, memory leak hazards, and CDP protocol compliance prior to browser execution.

Both subsystems maintain decoupled version lifecycles, unified dependency trees, and shared typing contracts.

---

## 2. Packages & Component Inventory

### 2.1. XOKJ Extension (Root / `src/`)

The core browser extension provides a userscript runtime environment capable of issuing low-level Chrome DevTools Protocol commands directly from userscripts.

- **Technology Stack**: Manifest V3, Vue 3, Vite, `@crxjs/vite-plugin`, CodeMirror 6, TypeScript.
- **Key Capabilities**:
  - Bi-directional bridge between webpage execution context (MAIN world) and `chrome.debugger` backend.
  - Native DevTools conflict detection and automatic in-flight promise rejection.
  - Multi-phase injection scheduler (`document-start`, `document-end`, `document-idle`).
  - Serialized local storage repository via FIFO AsyncMutex.
  - Integrated CodeMirror 6 script management dashboard with syntax highlighting.
- **Documentation**:
  - [Extension User Guide & Architecture (README_EXTENSION.md)](README_EXTENSION.md)
  - [Complete Technical Specification (docs/XOKJ_TECHNICAL_SPEC.md)](docs/XOKJ_TECHNICAL_SPEC.md)

---

### 2.2. XoBrow CLI Auditor (`packages/xobrow`)

XoBrow is a strict, standalone CLI static analysis tool (`xobrow` and alias `xb`) that parses and audits JavaScript/TypeScript userscripts before they are loaded into the browser engine.

- **Technology Stack**: Node.js ESM, `@babel/parser`, `commander`, `glob`, `picocolors`.
- **Operational Principles**:
  - **Static Analysis Only**: Evaluates scripts via Abstract Syntax Tree (AST) inspection without executing user code.
  - **Zero Code Mutation (Read-Only)**: Strictly analyzes and reports; does not rewrite or auto-fix user source code.
  - **Compiler-Grade Diagnostics**: Outputs ASCII code frames with vertical gutters, token pointer carets (`^^^^`), rule identifiers, and concrete remediation advice.
  - **Deterministic Exit Codes**: Returns exit code `0` on clean pass, `1` on rule violations, and `2` on operational/CLI errors.
- **Rules Engine Coverage (15 Canonical Rules)**:
  - **Security (6 Rules)**: Blocks `eval()`, `new Function()`, string timers, unsafe DOM sinks (`innerHTML`, `document.write`), prototype pollution, and dynamic script tag injection.
  - **Resource Leaks (4 Rules)**: Detects uncleaned `addEventListener`, lingering `setInterval` timers, unclosed `cdp.on` event subscriptions, and unthrottled infinite async loops.
  - **CDP Protocol Integrity (5 Rules)**: Enforces official CDP domain/method schemas, header permission declarations (`@grant GM_cdp`, `@cdp`), async rejection error handling, and validates parameter payloads.
- **Documentation**:
  - [XoBrow Package Overview (packages/xobrow/README.md)](packages/xobrow/README.md)
  - [System Index (packages/xobrow/docs/00_OVERVIEW_AND_INDEX.txt)](packages/xobrow/docs/00_OVERVIEW_AND_INDEX.txt)
  - [Internals & AST Visitor (packages/xobrow/docs/01_ARCHITECTURE_AND_INTERNALS.txt)](packages/xobrow/docs/01_ARCHITECTURE_AND_INTERNALS.txt)
  - [CLI Reference Manual (packages/xobrow/docs/02_CLI_USAGE_AND_INTEGRATION.txt)](packages/xobrow/docs/02_CLI_USAGE_AND_INTEGRATION.txt)
  - [Global npm link Guide (packages/xobrow/docs/03_INSTALLATION_AND_GLOBAL_LINKING.txt)](packages/xobrow/docs/03_INSTALLATION_AND_GLOBAL_LINKING.txt)
  - [Complete 15-Rule Catalog (packages/xobrow/docs/04_RULES_REFERENCE.txt)](packages/xobrow/docs/04_RULES_REFERENCE.txt)

---

## 3. Technology Stack & Dependency Matrix

All versions are resolved dynamically from workspace `package.json` manifests.

### 3.1. XOKJ Extension Libraries

| Library | Role in Subsystem | Resolution Source |
|---|---|---|
| **Vue 3** | Reactive UI framework for extension Popup and Dashboard | [`package.json`](package.json) |
| **CodeMirror 6** | Extensible in-browser code editor with JavaScript syntax highlighting | [`package.json`](package.json) |
| **Vite** | Next-generation frontend tooling and production bundler | [`package.json`](package.json) |
| **@crxjs/vite-plugin** | Compiles Manifest V3 Chrome Extension with HMR support | [`package.json`](package.json) |
| **@fortawesome/fontawesome-free** | Iconography assets for dashboard and popup controls | [`package.json`](package.json) |
| **TypeScript** | Static typing and interface contracts | [`package.json`](package.json) |
| **Vitest** | Unit, component, and integration test execution framework | [`package.json`](package.json) |
| **happy-dom** | Lightweight in-memory DOM simulation for component unit tests | [`package.json`](package.json) |
| **vue-tsc** | Type-checking engine for Vue Single File Components (SFC) | [`package.json`](package.json) |

### 3.2. XoBrow CLI Auditor Libraries

| Library | Role in Subsystem | Resolution Source |
|---|---|---|
| **@babel/parser** | High-performance AST parser with TypeScript and top-level await support | [`packages/xobrow/package.json`](packages/xobrow/package.json) |
| **commander** | Command-line argument parsing, options, and help generation | [`packages/xobrow/package.json`](packages/xobrow/package.json) |
| **glob** | File system traversal and pattern-matching engine | [`packages/xobrow/package.json`](packages/xobrow/package.json) |
| **picocolors** | High-speed, zero-dependency terminal ANSI formatting | [`packages/xobrow/package.json`](packages/xobrow/package.json) |
| **TypeScript** | Static type checking and transpilation to ESM | [`packages/xobrow/package.json`](packages/xobrow/package.json) |
| **Vitest** | Test runner for 400+ unit, adversarial, and E2E fixtures | [`packages/xobrow/package.json`](packages/xobrow/package.json) |

---

## 4. Monorepo Quickstart & Setup Guide

### 4.1. Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### 4.2. Installation and Build
```bash
# Clone the repository
git clone https://github.com/Anhdeface/xokj.git
cd xokj

# Install all workspace dependencies
npm install

# Build the browser extension into dist/
npm run build

# Build the XoBrow CLI package into packages/xobrow/dist/
npm run xobrow:build
```

### 4.3. Global CLI Registration via npm link
To use `xb` and `xobrow` from any directory on your operating system:
```bash
# Run the link script from the monorepo root
npm run link

# Verify global availability
xb --version
xobrow --help
```

### 4.4. Unified Version Management
The repository includes a unified version manager (`scripts/bump-version.js`) to increment versions without hardcoding:
```bash
# Increment patch (0.2.0 -> 0.2.1) across all packages
npm run bump patch

# Increment minor (0.2.0 -> 0.3.0) across all packages
npm run bump minor

# Increment and automatically create Git commit + tag
npm run bump minor --tag
```

---

## 5. NPM Scripts Reference

The root `package.json` provides unified scripts to manage all components in the monorepo:

| Script Command | Target / Scope | Description |
|---|---|---|
| `npm run dev` | Extension | Starts Vite development server with HMR. |
| `npm run build` | Extension | Validates types and compiles production extension into `dist/`. |
| `npm run build:fast` | Extension | Builds extension without strict type check. |
| `npm run type-check` | Extension | Runs `vue-tsc --noEmit` across extension source. |
| `npm test` | Root & Extension | Executes Vitest test suite across all workspace files. |
| `npm run test:watch` | Root | Runs Vitest in interactive watch mode. |
| `npm run xb -- check <file>` | XoBrow CLI | Runs XoBrow checker via root workspace alias. |
| `npm run xobrow -- check <file>`| XoBrow CLI | Alias for `npm run xb`. |
| `npm run xobrow:build` | XoBrow CLI | Compiles TypeScript sources in `packages/xobrow/`. |
| `npm run xobrow:test` | XoBrow CLI | Executes unit and adversarial test suites in `packages/xobrow`. |
| `npm run xobrow:e2e` | XoBrow CLI | Runs dedicated E2E fixture verification suite. |
| `npm run link` | Monorepo System | Creates global system-wide symlinks for `xb` and `xobrow`. |
| `npm run bump [type]` | Monorepo System | Updates semver versions across all workspace `package.json` files. |

---

## 6. Repository Directory Structure

```
xokj/
├── README.md                  # Monorepo Master Index (this document)
├── README_EXTENSION.md        # Dedicated XOKJ Extension Technical Manual
├── LICENSE                    # MIT License
├── package.json               # Monorepo workspace configuration & root scripts
├── manifest.config.ts         # Manifest V3 declarative configuration
├── vite.config.ts             # Vite bundler configuration
├── tsconfig.json              # TypeScript root configuration
│
├── scripts/                   # Workspace automation scripts
│   └── bump-version.js        # Semver version management utility
│
├── docs/                      # Extension technical documentation
│   └── XOKJ_TECHNICAL_SPEC.md # Full system specification for the xokj extension
│
├── src/                       # XOKJ Browser Extension source code
│   ├── background/            # MV3 Service Worker (CDP bridge, debugger manager, injector)
│   ├── content/               # Content scripts, postMessage relay & sandbox
│   ├── shared/                # Data types, metadata parser, match patterns, storage mutex
│   ├── popup/                 # Vue 3 popup interface
│   └── dashboard/             # Vue 3 + CodeMirror 6 management dashboard
│
├── packages/
│   └── xobrow/                # XoBrow Standalone Static Analysis CLI Package
│       ├── README.md          # Package overview & quickstart
│       ├── package.json       # CLI binary mappings (xobrow, xb)
│       ├── tsconfig.json      # Package TypeScript configuration
│       ├── bin/               # CLI binary entrypoints (xobrow.js)
│       ├── src/               # Rules engine, AST parser, visitor, reporter
│       ├── test/              # 400+ unit, adversarial, and E2E test suites
│       └── docs/              # Comprehensive plain-text technical documentation
│           ├── 00_OVERVIEW_AND_INDEX.txt
│           ├── 01_ARCHITECTURE_AND_INTERNALS.txt
│           ├── 02_CLI_USAGE_AND_INTEGRATION.txt
│           ├── 03_INSTALLATION_AND_GLOBAL_LINKING.txt
│           └── 04_RULES_REFERENCE.txt
│
└── test/                      # Monorepo and extension integration test suites
```

---

## 7. Master Documentation Directory

| Document | Format | Location | Primary Audience |
|---|---|---|---|
| Monorepo Master Index | Markdown | [`README.md`](README.md) | All developers & maintainers |
| Extension Technical Manual | Markdown | [`README_EXTENSION.md`](README_EXTENSION.md) | Extension developers & userscript authors |
| Extension Technical Spec | Markdown | [`docs/XOKJ_TECHNICAL_SPEC.md`](docs/XOKJ_TECHNICAL_SPEC.md) | Core architects & security auditors |
| XoBrow Package Overview | Markdown | [`packages/xobrow/README.md`](packages/xobrow/README.md) | CLI users & script developers |
| XoBrow Architecture & Internals | Text | [`packages/xobrow/docs/01_ARCHITECTURE_AND_INTERNALS.txt`](packages/xobrow/docs/01_ARCHITECTURE_AND_INTERNALS.txt) | Tooling engineers & rule contributors |
| XoBrow CLI & CI/CD Manual | Text | [`packages/xobrow/docs/02_CLI_USAGE_AND_INTEGRATION.txt`](packages/xobrow/docs/02_CLI_USAGE_AND_INTEGRATION.txt) | DevOps & automation engineers |
| XoBrow npm link Guide | Text | [`packages/xobrow/docs/03_INSTALLATION_AND_GLOBAL_LINKING.txt`](packages/xobrow/docs/03_INSTALLATION_AND_GLOBAL_LINKING.txt) | Local environment configuration |
| XoBrow 15-Rule Specification | Text | [`packages/xobrow/docs/04_RULES_REFERENCE.txt`](packages/xobrow/docs/04_RULES_REFERENCE.txt) | Security auditors & userscript authors |

---

## 8. License

MIT License. See [LICENSE](LICENSE) for details.
