# XoBrow (`xobrow` / `xb`)

Uncompromising standalone CLI static analysis and security audit tool for userscripts targeting the `xokj` Chromium CDP extension engine.

## Usage

```bash
# Direct binary execution
./bin/xobrow.js check <file_or_pattern>

# Via npm scripts
npm run xb -- check <file_or_pattern>
npm run xobrow -- check <file_or_pattern>

# Options
-s, --strict           Treat warnings as errors (exits with code 1)
-f, --format <format>  Output format: "stylish" (default) or "json"
-q, --quiet            Suppress passing summaries and warnings
-v, --version          Display version
-h, --help             Display command help
```

## Exit Codes

- `0`: Clean pass (zero errors, and zero warnings in strict mode)
- `1`: Violations detected (errors found, or warnings in strict mode)
- `2`: Invocation / operational error (invalid flags, missing files, empty glob)
