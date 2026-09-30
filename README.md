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
3. [Monorepo Quickstart & Setup Guide](#3-monorepo-quickstart--setup-guide)
   - [3.1. Prerequisites](#31-prerequisites)
   - [3.2. Installation and Build](#32-installation-and-build)
   - [3.3. Global CLI Registration via npm link](#33-global-cli-registration-via-npm-link)
   - [3.4. Unified Version Management](#34-unified-version-management)
4. [NPM Scripts Reference](#4-npm-scripts-reference)
5. [Repository Directory Structure](#5-repository-directory-structure)
6. [License](#6-license)

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

## 3. Monorepo Quickstart & Setup Guide

### 3.1. Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### 3.2. Installation and Build
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

### 3.3. Global CLI Registration via npm link
To use `xb` and `xobrow` from any directory on your operating system:
```bash
# Run the link script from the monorepo root
npm run link

# Verify global availability
xb --version
xobrow --help
```

### 3.4. Unified Version Management
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

## 4. NPM Scripts Reference

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

## 5. Repository Directory Structure

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

## 6. License

MIT License. See [LICENSE](LICENSE) for details.
