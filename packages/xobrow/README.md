# XoBrow (`xobrow` / `xb`)

[![xobrow Version](https://img.shields.io/github/package-json/v/Anhdeface/xokj?filename=packages%2Fxobrow%2Fpackage.json&label=xobrow%20version&color=indigo)](package.json)
[![Babel Parser](https://img.shields.io/github/package-json/dependency-version/Anhdeface/xokj/@babel/parser?filename=packages%2Fxobrow%2Fpackage.json&label=%40babel%2Fparser&color=yellow)](package.json)
[![Commander](https://img.shields.io/github/package-json/dependency-version/Anhdeface/xokj/commander?filename=packages%2Fxobrow%2Fpackage.json&label=commander&color=red)](package.json)
[![License](https://img.shields.io/github/license/Anhdeface/xokj?color=gray)](../../LICENSE)

Uncompromising standalone CLI static analysis and security audit tool for userscripts targeting the `xokj` Chromium CDP extension engine.

---

## Table of Contents

1. [Overview](#overview)
2. [CLI Usage & Commands](#cli-usage--commands)
3. [Options & Flags](#options--flags)
4. [Exit Code Protocol](#exit-code-protocol)
5. [Rule Inventory](#rule-inventory)
6. [Detailed Documentation Suite](#detailed-documentation-suite)

---

## Overview

XoBrow is designed to inspect external JavaScript and TypeScript userscripts before execution in browser environments equipped with Chrome DevTools Protocol bridges.

- **Static Analysis Only**: Pure AST traversal; user code is never executed during inspection.
- **Zero Code Mutation**: Strictly read-only analysis without altering source files.
- **Compiler-Grade Diagnostics**: Exact line and column reporting with ASCII code frames, vertical gutters, carets (`^^^^`), and remediation suggestions.

---

## CLI Usage & Commands

```bash
# Direct binary execution
./bin/xobrow.js check <file_or_pattern>

# Via npm scripts in monorepo
npm run xb -- check <file_or_pattern>
npm run xobrow -- check <file_or_pattern>

# Global execution (after running npm run link)
xb check my-script.user.js
xobrow check "scripts/**/*.user.js"
```

---

## Options & Flags

| Flag | Description |
|---|---|
| `-s, --strict` | Treat warnings as errors (exits with code 1) |
| `-f, --format <format>` | Output format: `stylish` (default ASCII code frames) or `json` |
| `-q, --quiet` | Suppress passing summaries and warnings |
| `-v, --version` | Display current version dynamically resolved from package manifest |
| `-h, --help` | Display command help |

---

## Exit Codes

- `0`: Clean pass (zero errors, and zero warnings in strict mode)
- `1`: Violations detected (errors found, or warnings in strict mode)
- `2`: Invocation / operational error (invalid flags, missing files, empty glob)

---

## Rule Inventory

XoBrow implements 15 canonical rules across three categories:

1. **Security Policy Enforcement (6 Rules)**: `sec-no-eval`, `sec-no-new-function`, `sec-no-string-timers`, `sec-no-unsafe-dom-sink`, `sec-no-prototype-pollution`, `sec-no-script-injection`.
2. **Resource Leak Prevention (4 Rules)**: `leak-uncleaned-event-listener`, `leak-lingering-interval`, `leak-unclosed-cdp-listener`, `leak-unbounded-async-loop`.
3. **CDP Protocol Integrity (5 Rules)**: `cdp-valid-domain-method`, `cdp-header-permission`, `cdp-handled-async-reject`, `cdp-no-tight-polling`, `cdp-valid-payload`.

---

## Detailed Documentation Suite

Exhaustive technical documentation is available in `docs/`:

- [00_OVERVIEW_AND_INDEX.txt](docs/00_OVERVIEW_AND_INDEX.txt): System overview and documentation map.
- [01_ARCHITECTURE_AND_INTERNALS.txt](docs/01_ARCHITECTURE_AND_INTERNALS.txt): Babel AST parser, two-pass visitor, and diagnostic formatter.
- [02_CLI_USAGE_AND_INTEGRATION.txt](docs/02_CLI_USAGE_AND_INTEGRATION.txt): CLI reference, JSON schema, and CI/CD integration recipes.
- [03_INSTALLATION_AND_GLOBAL_LINKING.txt](docs/03_INSTALLATION_AND_GLOBAL_LINKING.txt): npm link mechanics and PATH troubleshooting.
- [04_RULES_REFERENCE.txt](docs/04_RULES_REFERENCE.txt): Complete 15-rule catalog with compliance examples.
