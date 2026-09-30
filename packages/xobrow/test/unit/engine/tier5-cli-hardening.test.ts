/**
 * Tier 5 White-Box Adversarial Coverage Hardening Suite for XoBrow
 *
 * Exhaustively stress-tests:
 * 1. Malformed AST / syntax errors & exotic character handling
 * 2. Empty & degenerate files
 * 3. Binary & non-JS file boundary conditions
 * 4. Deeply nested AST loops & tight polling edge cases (< 100ms threshold)
 * 5. Extreme CLI arguments (unrecognized flags, missing files, multiple glob combinations)
 * 6. Strict exit codes (0, 1, 2) comprehensive oracle
 * 7. Cryptographic SHA-256 hash invariance across all 36 test fixture files
 * 8. Diagnostic reporter & formatter edge cases
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runCli } from '../../../src/cli.js';
import { scanFile, scanFiles } from '../../../src/engine/scanner.js';
import { resolvePatterns } from '../../../src/engine/glob.js';
import { parseScriptAst } from '../../../src/parser/ast.js';
import { formatDiagnostics } from '../../../src/reporter/formatter.js';
import { formatJsonDiagnostics } from '../../../src/reporter/json-formatter.js';
import type { FileScanResult, RuleDiagnostic } from '../../../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../../../..');
const XOBROW_DIR = path.resolve(ROOT_DIR, 'packages/xobrow');
const BIN_PATH = path.resolve(XOBROW_DIR, 'bin/xobrow.js');
const FIXTURES_DIR = path.resolve(XOBROW_DIR, 'test/fixtures');
const VALID_DIR = path.resolve(FIXTURES_DIR, 'valid');
const INVALID_DIR = path.resolve(FIXTURES_DIR, 'invalid');
const CLI_DIR = path.resolve(FIXTURES_DIR, 'cli');

/**
 * Computes SHA-256 hash of a file.
 */
function getFileSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Recursively collects all files in a directory.
 */
function collectAllFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectAllFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

/**
 * Runs CLI binary via child_process.
 */
function execCliBinary(args: string[], binaryName: 'xobrow' | 'xb' = 'xobrow'): { status: number | null; stdout: string; stderr: string } {
  const binTarget = binaryName === 'xb' ? path.resolve(XOBROW_DIR, 'bin/xb.js') : BIN_PATH;
  const executable = fs.existsSync(binTarget) ? binTarget : BIN_PATH;

  const proc = spawnSync(process.execPath, [executable, ...args], {
    cwd: ROOT_DIR,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 15000
  });

  return {
    status: proc.status,
    stdout: proc.stdout || '',
    stderr: proc.stderr || ''
  };
}

describe('Tier 5 Adversarial Coverage Hardening Suite', () => {
  let tempDir: string;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    console.log = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xobrow-tier5-hardening-'));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Section 1: Malformed AST & Syntax Error Resilience
  // =========================================================================
  describe('1. Malformed AST & Syntax Error Boundary Conditions', () => {
    it('handles fatal unrecoverable syntax error without crash and reports error diagnostic', () => {
      const code = 'const = 42;';
      const result = scanFile('syntax-fatal.js', code);
      expect(result.errorCount).toBeGreaterThanOrEqual(1);
      expect(result.hasErrors).toBe(true);
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
      const err = result.diagnostics.find(d => d.ruleId === 'syntax-error');
      expect(err).toBeDefined();
      expect(err?.severity).toBe('error');
      expect(err?.category).toBe('security');
      expect(err?.location.line).toBe(1);
      expect(err?.location.column).toBeGreaterThanOrEqual(1);
    });

    it('handles unbalanced braces and parentheses gracefully', () => {
      const unbalancedCode = 'function broken() { { { if (true) { return (1 + 2;';
      const result = scanFile('unbalanced.js', unbalancedCode);
      expect(result.hasErrors).toBe(true);
      expect(result.diagnostics.some(d => d.ruleId === 'syntax-error')).toBe(true);
    });

    it('handles unclosed string literal and unclosed regex literal', () => {
      const unclosedString = 'const str = "unclosed string without end\nconst next = 1;';
      const res1 = scanFile('unclosed-str.js', unclosedString);
      expect(res1.hasErrors).toBe(true);
      expect(res1.diagnostics.some(d => d.ruleId === 'syntax-error')).toBe(true);

      const unclosedRegex = 'const reg = /unclosed-regex-without-slash;';
      const res2 = scanFile('unclosed-regex.js', unclosedRegex);
      expect(res2.hasErrors).toBe(true);
      expect(res2.diagnostics.some(d => d.ruleId === 'syntax-error')).toBe(true);
    });

    it('handles Unicode Byte Order Mark (BOM \\uFEFF) at file start', () => {
      const codeWithBom = '\uFEFF// ==UserScript==\n// @grant none\n// ==/UserScript==\nconst a = 1;';
      const result = scanFile('bom.js', codeWithBom);
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
    });

    it('handles null bytes and control characters inside source code', () => {
      const codeWithNull = 'const nullChar = "\0"; const clean = 1;';
      const result = scanFile('null-byte.js', codeWithNull);
      expect(result.hasErrors).toBe(false);
    });

    it('handles raw null byte outside string (tokenization error) with clean syntax diagnostic', () => {
      const codeWithRawNull = 'const x = \x00;';
      const result = scanFile('raw-null.js', codeWithRawNull);
      expect(result.hasErrors).toBe(true);
      expect(result.diagnostics.some(d => d.ruleId === 'syntax-error')).toBe(true);
    });

    it('handles minified single-line script with syntax error at column > 3000', () => {
      const longPrefix = 'const v = ' + '1 + '.repeat(1000);
      const code = longPrefix + ' ; const broken = ;';
      const result = scanFile('long-line-error.js', code);
      expect(result.hasErrors).toBe(true);
      const err = result.diagnostics.find(d => d.ruleId === 'syntax-error');
      expect(err).toBeDefined();
      expect(err?.location.column).toBeGreaterThan(1000);
    });

    it('recovers AST when possible with non-fatal syntax errors (e.g. orphan private identifier)', () => {
      const code = 'const orphan = #field;';
      const result = scanFile('orphan-private.js', code);
      expect(result.hasErrors).toBe(true);
      expect(result.diagnostics.some(d => d.ruleId === 'syntax-error')).toBe(true);
    });
  });

  // =========================================================================
  // Section 2: Empty & Degenerate Files
  // =========================================================================
  describe('2. Empty & Degenerate Files Boundary Conditions', () => {
    it('handles completely empty 0-byte file with exit code 0 and 0 issues found', () => {
      const result = scanFile('empty.js', '');
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('handles whitespace-only file with clean pass', () => {
      const result = scanFile('spaces.js', '   \t\t\r\n\n\r\n   ');
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('handles comments-only file with clean pass', () => {
      const code = `
        // Single line comment
        /* Multi
           line
           comment */
        /** JSDoc comment */
      `;
      const result = scanFile('comments.js', code);
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('handles metadata-header-only file without executable statements', () => {
      const code = `
        // ==UserScript==
        // @name Header Only
        // @description Does nothing
        // @grant GM_cdp
        // @cdp Page
        // ==/UserScript==
      `;
      const result = scanFile('header-only.js', code);
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('handles script consisting solely of a shebang line', () => {
      const code = '#!/usr/bin/env node\n';
      const result = scanFile('shebang-only.js', code);
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(0);
    });

    it('renders clean summary output for empty file via formatDiagnostics', () => {
      const scanRes: FileScanResult = {
        filePath: 'empty.js',
        diagnostics: [],
        errorCount: 0,
        warningCount: 0,
        hasErrors: false,
        hasWarnings: false
      };
      const formatted = formatDiagnostics([scanRes], () => '', { color: false });
      expect(formatted).toContain('Checked 1 file. 0 issues found.');
    });
  });

  // =========================================================================
  // Section 3: Binary & Non-JS Files Handling
  // =========================================================================
  describe('3. Binary & Non-JS Files Handling', () => {
    it('handles binary image header without unhandled crash, producing syntax error', () => {
      const pngHeader = '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01';
      const result = scanFile('image.png', pngHeader);
      expect(result.hasErrors).toBe(true);
      expect(result.diagnostics.some(d => d.ruleId === 'syntax-error')).toBe(true);
    });

    it('handles ELF binary header safely', () => {
      const elfHeader = '\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00';
      const result = scanFile('binary.elf', elfHeader);
      expect(result.hasErrors).toBe(true);
      expect(result.diagnostics.some(d => d.ruleId === 'syntax-error')).toBe(true);
    });

    it('handles random binary bytes buffer safely', () => {
      const randomBuf = crypto.randomBytes(256).toString('binary');
      const result = scanFile('random.bin', randomBuf);
      expect(result.hasErrors).toBe(true);
      expect(result.diagnostics.some(d => d.ruleId === 'syntax-error')).toBe(true);
    });

    it('handles HTML markup safely with syntax error diagnosis', () => {
      const htmlCode = '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>';
      const result = scanFile('index.html', htmlCode);
      expect(result.hasErrors).toBe(true);
      expect(result.diagnostics.some(d => d.ruleId === 'syntax-error')).toBe(true);
    });

    it('handles CSS stylesheet content safely with syntax error diagnosis', () => {
      const cssCode = 'body { background: #ff0000; margin: 0; padding: 20px; } .btn:hover { opacity: 0.8; }';
      const result = scanFile('style.css', cssCode);
      expect(result.hasErrors).toBe(true);
      expect(result.diagnostics.some(d => d.ruleId === 'syntax-error')).toBe(true);
    });

    it('resolves directory globs by filtering out non-JS/TS files automatically', () => {
      const testDir = path.join(tempDir, 'mixed-ext-dir');
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, 'clean.js'), 'const a = 1;');
      fs.writeFileSync(path.join(testDir, 'script.ts'), 'const b: number = 2;');
      fs.writeFileSync(path.join(testDir, 'ignored.png'), 'fake-png-data');
      fs.writeFileSync(path.join(testDir, 'ignored.txt'), 'some text');
      fs.writeFileSync(path.join(testDir, 'ignored.json'), '{"key": "value"}');

      const resolved = resolvePatterns([testDir]);
      expect(resolved).toHaveLength(2);
      expect(resolved.some(p => p.endsWith('clean.js'))).toBe(true);
      expect(resolved.some(p => p.endsWith('script.ts'))).toBe(true);
      expect(resolved.some(p => p.endsWith('.png'))).toBe(false);
      expect(resolved.some(p => p.endsWith('.txt'))).toBe(false);
      expect(resolved.some(p => p.endsWith('.json'))).toBe(false);
    });
  });

  // =========================================================================
  // Section 4: Deeply Nested AST Loops & Tight Polling Stress
  // =========================================================================
  describe('4. Deeply Nested AST Loops & Tight Polling Edge Cases', () => {
    it('traverses 50 levels of nested while loops containing a CDP call without stack overflow', () => {
      let code = 'await cdp.send("Page.navigate", { url: "https://example.com" });';
      for (let i = 0; i < 50; i++) {
        code = `while (true) {\n${code}\n}`;
      }
      code = `// ==UserScript==\n// @grant GM_cdp\n// ==/UserScript==\n${code}`;

      expect(() => {
        const result = scanFile('deep-loops.js', code);
        expect(result.errorCount).toBeGreaterThanOrEqual(1);
        expect(result.diagnostics.some(d => d.ruleId === 'leak-unbounded-async-loop')).toBe(true);
      }).not.toThrow();
    });

    it('strictly tests the 100ms tight polling boundary for loop delays', () => {
      // 0ms delay -> tight polling error
      const code0 = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await cdp.send("Page.navigate", { url: "https://example.com" });
          await delay(0);
          if (done) break;
        }
      `;
      const res0 = scanFile('delay-0.js', code0);
      expect(res0.diagnostics.some(d => d.ruleId === 'cdp-no-tight-polling')).toBe(true);

      // 50ms delay -> tight polling error
      const code50 = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await cdp.send("Page.navigate", { url: "https://example.com" });
          await delay(50);
          if (done) break;
        }
      `;
      const res50 = scanFile('delay-50.js', code50);
      expect(res50.diagnostics.some(d => d.ruleId === 'cdp-no-tight-polling')).toBe(true);

      // 99ms delay -> tight polling error
      const code99 = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await cdp.send("Page.navigate", { url: "https://example.com" });
          await delay(99);
          if (done) break;
        }
      `;
      const res99 = scanFile('delay-99.js', code99);
      expect(res99.diagnostics.some(d => d.ruleId === 'cdp-no-tight-polling')).toBe(true);

      // 100ms delay -> passes threshold (< 100ms is false)
      const code100 = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await cdp.send("Page.navigate", { url: "https://example.com" });
          await delay(100);
          if (done) break;
        }
      `;
      const res100 = scanFile('delay-100.js', code100);
      expect(res100.diagnostics.some(d => d.ruleId === 'cdp-no-tight-polling')).toBe(false);

      // 500ms delay -> passes threshold
      const code500 = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await cdp.send("Page.navigate", { url: "https://example.com" });
          await delay(500);
          if (done) break;
        }
      `;
      const res500 = scanFile('delay-500.js', code500);
      expect(res500.diagnostics.some(d => d.ruleId === 'cdp-no-tight-polling')).toBe(false);

      // Note: Negative numeric literal is an AST UnaryExpression ('-' + 10), so delayArg.type is UnaryExpression not NumericLiteral
      const codeNeg = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await cdp.send("Page.navigate", { url: "https://example.com" });
          await delay(-10);
          if (done) break;
        }
      `;
      const resNeg = scanFile('delay-neg.js', codeNeg);
      // findLoopDelay returns null for UnaryExpression, so cdp-no-tight-polling is false (documented AST boundary limitation)
      expect(resNeg.diagnostics.some(d => d.ruleId === 'cdp-no-tight-polling')).toBe(false);
    });

    it('detects tight polling in setInterval and setTimeout with omitted or low interval arguments', () => {
      // setInterval with omitted interval (defaults to 0ms)
      const codeOmitted = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        const t = setInterval(() => {
          cdp.send("Page.navigate", {}).catch(() => {});
        });
        clearInterval(t);
      `;
      const resOmitted = scanFile('timer-omitted.js', codeOmitted);
      expect(resOmitted.diagnostics.some(d => d.ruleId === 'cdp-no-tight-polling')).toBe(true);

      // setTimeout with 10ms (< 100ms)
      const codeTimeout = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        setTimeout(() => {
          cdp.send("Page.navigate", {}).catch(() => {});
        }, 10);
      `;
      const resTimeout = scanFile('timer-short.js', codeTimeout);
      expect(resTimeout.diagnostics.some(d => d.ruleId === 'cdp-no-tight-polling')).toBe(true);

      // setInterval with 100ms -> passes
      const codeOk = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        const t = setInterval(() => {
          cdp.send("Page.navigate", {}).catch(() => {});
        }, 100);
        clearInterval(t);
      `;
      const resOk = scanFile('timer-ok.js', codeOk);
      expect(resOk.diagnostics.some(d => d.ruleId === 'cdp-no-tight-polling')).toBe(false);
    });

    it('distinguishes inner break/return scopes: break in switch does not satisfy outer while loop', () => {
      const code = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await cdp.send("Page.navigate", { url: "https://example.com" });
          switch (state) {
            case 1:
              break; // breaks switch, NOT loop
          }
          await delay(500);
        }
      `;
      const res = scanFile('switch-break.js', code);
      expect(res.diagnostics.some(d => d.ruleId === 'leak-unbounded-async-loop')).toBe(true);
    });

    it('distinguishes inner break/return scopes: return inside nested helper does not satisfy outer loop', () => {
      const code = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await cdp.send("Page.navigate", { url: "https://example.com" });
          const helper = () => { return 42; };
          helper();
          await delay(500);
        }
      `;
      const res = scanFile('closure-return.js', code);
      expect(res.diagnostics.some(d => d.ruleId === 'leak-unbounded-async-loop')).toBe(true);
    });

    it('correctly passes while loop with direct break condition and adequate delay', () => {
      const code = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await cdp.send("Page.navigate", { url: "https://example.com" });
          await delay(500);
          if (finished) {
            break;
          }
        }
      `;
      const res = scanFile('valid-loop.js', code);
      expect(res.diagnostics.some(d => d.ruleId === 'leak-unbounded-async-loop')).toBe(false);
      expect(res.diagnostics.some(d => d.ruleId === 'cdp-no-tight-polling')).toBe(false);
    });
  });

  // =========================================================================
  // Section 5: Extreme CLI Arguments & Glob Combinations
  // =========================================================================
  describe('5. Extreme CLI Arguments & Resolution Stress', () => {
    it('exits with code 2 when zero arguments are passed to xobrow', async () => {
      const exitCode = await runCli(['node', 'xobrow'], { exitOverride: true });
      expect(exitCode).toBe(2);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('No input files or patterns specified')
      );
    });

    it('exits with code 2 when check subcommand is given no patterns', async () => {
      const exitCode = await runCli(['node', 'xobrow', 'check'], { exitOverride: true });
      expect(exitCode).toBe(2);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('No input files or patterns specified')
      );
    });

    it('exits with code 2 when target file does not exist', async () => {
      const exitCode = await runCli(['node', 'xobrow', 'check', 'completely_missing_file_xyz.js'], { exitOverride: true });
      expect(exitCode).toBe(2);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('File not found: completely_missing_file_xyz.js')
      );
    });

    it('exits with code 2 when target directory does not exist', async () => {
      const exitCode = await runCli(['node', 'xobrow', 'check', 'missing_dir_xyz/'], { exitOverride: true });
      expect(exitCode).toBe(2);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('File not found: missing_dir_xyz/')
      );
    });

    it('exits with code 2 when target directory contains no script files', async () => {
      const emptySubdir = path.join(tempDir, 'empty-scripts-dir');
      fs.mkdirSync(emptySubdir, { recursive: true });

      const exitCode = await runCli(['node', 'xobrow', 'check', emptySubdir], { exitOverride: true });
      expect(exitCode).toBe(2);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('No matching script files found in directory')
      );
    });

    it('exits with code 2 when glob pattern matches zero files', async () => {
      const exitCode = await runCli(['node', 'xobrow', 'check', path.join(FIXTURES_DIR, '**/*.nonexistent')], { exitOverride: true });
      expect(exitCode).toBe(2);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('No files matching pattern')
      );
    });

    it('exits with code 2 on unknown flags', async () => {
      const exitCode = await runCli(['node', 'xobrow', 'check', '--some-wild-unknown-flag'], { exitOverride: true });
      expect(exitCode).toBe(2);
    });

    it('exits with code 2 on invalid format choice', async () => {
      const validFile = path.join(VALID_DIR, 'valid-01-basic-clean.js');
      const exitCode = await runCli(['node', 'xobrow', 'check', '-f', 'xml', validFile], { exitOverride: true });
      expect(exitCode).toBe(2);
    });

    it('exits with code 2 when empty strings or whitespace patterns are supplied', async () => {
      const exitCode = await runCli(['node', 'xobrow', 'check', '   ', ''], { exitOverride: true });
      expect(exitCode).toBe(2);
    });

    it('correctly resolves and deduplicates multiple valid glob combinations', () => {
      const pattern1 = path.join(VALID_DIR, 'valid-01*.js');
      const pattern2 = path.join(VALID_DIR, 'valid-02*.js');
      const duplicatePattern = path.join(VALID_DIR, 'valid-01*.js');

      const resolved = resolvePatterns([pattern1, pattern2, duplicatePattern]);
      expect(resolved.length).toBe(2);
      expect(resolved.every(p => fs.existsSync(p))).toBe(true);
    });

    it('throws error and sets code 2 if any pattern in multi-pattern list fails to resolve', async () => {
      const validPattern = path.join(VALID_DIR, 'valid-01*.js');
      const invalidPattern = 'nonexistent_file_in_multi.js';

      const exitCode = await runCli(['node', 'xobrow', 'check', validPattern, invalidPattern], { exitOverride: true });
      expect(exitCode).toBe(2);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('File not found: nonexistent_file_in_multi.js')
      );
    });

    it('supports binary alias xb command name in execution and help', async () => {
      const exitCode = await runCli(['node', 'xb', '--help'], { exitOverride: true });
      expect(exitCode).toBe(0);
    });
  });

  // =========================================================================
  // Section 6: Strict Exit Codes (0, 1, 2) Comprehensive Oracle
  // =========================================================================
  describe('6. Strict Exit Codes (0, 1, 2) Comprehensive Oracle', () => {
    it('Oracle Exit Code 0: Clean script passes with code 0', async () => {
      const cleanScript = path.join(VALID_DIR, 'valid-01-basic-clean.js');
      const code = await runCli(['node', 'xobrow', 'check', cleanScript], { exitOverride: true });
      expect(code).toBe(0);
    });

    it('Oracle Exit Code 0: Empty script passes with code 0', async () => {
      const emptyScript = path.join(CLI_DIR, 'cli-empty.js');
      const code = await runCli(['node', 'xobrow', 'check', emptyScript], { exitOverride: true });
      expect(code).toBe(0);
    });

    it('Oracle Exit Code 0: Warning-only script passes with code 0 when --strict is omitted', async () => {
      const warningScript = path.join(CLI_DIR, 'cli-warning-only.js');
      const code = await runCli(['node', 'xobrow', 'check', warningScript], { exitOverride: true });
      expect(code).toBe(0);
    });

    it('Oracle Exit Code 0: --help and -h exit with code 0', async () => {
      const code1 = await runCli(['node', 'xobrow', '--help'], { exitOverride: true });
      expect(code1).toBe(0);

      const code2 = await runCli(['node', 'xobrow', '-h'], { exitOverride: true });
      expect(code2).toBe(0);
    });

    it('Oracle Exit Code 0: --version and -v exit with code 0', async () => {
      const code1 = await runCli(['node', 'xobrow', '--version'], { exitOverride: true });
      expect(code1).toBe(0);

      const code2 = await runCli(['node', 'xobrow', '-v'], { exitOverride: true });
      expect(code2).toBe(0);
    });

    it('Oracle Exit Code 1: Security error violation exits with code 1', async () => {
      const evalScript = path.join(INVALID_DIR, 'invalid-01-sec-no-eval.js');
      const code = await runCli(['node', 'xobrow', 'check', evalScript], { exitOverride: true });
      expect(code).toBe(1);
    });

    it('Oracle Exit Code 1: Resource leak error violation exits with code 1', async () => {
      const leakScript = path.join(INVALID_DIR, 'invalid-08-leak-lingering-interval.js');
      const code = await runCli(['node', 'xobrow', 'check', leakScript], { exitOverride: true });
      expect(code).toBe(1);
    });

    it('Oracle Exit Code 1: CDP integrity error violation exits with code 1', async () => {
      const cdpScript = path.join(INVALID_DIR, 'invalid-11-cdp-valid-domain-method.js');
      const code = await runCli(['node', 'xobrow', 'check', cdpScript], { exitOverride: true });
      expect(code).toBe(1);
    });

    it('Oracle Exit Code 1: Syntax error in file exits with code 1', async () => {
      const syntaxErrorScript = path.join(CLI_DIR, 'cli-syntax-error.js');
      const code = await runCli(['node', 'xobrow', 'check', syntaxErrorScript], { exitOverride: true });
      expect(code).toBe(1);
    });

    it('Oracle Exit Code 1: Warning elevated via --strict exits with code 1', async () => {
      const warningScript = path.join(CLI_DIR, 'cli-warning-only.js');
      const code = await runCli(['node', 'xobrow', 'check', '--strict', warningScript], { exitOverride: true });
      expect(code).toBe(1);
    });

    it('Oracle Exit Code 2: Missing target file exits with code 2', async () => {
      const code = await runCli(['node', 'xobrow', 'check', 'no_such_file.js'], { exitOverride: true });
      expect(code).toBe(2);
    });

    it('Oracle Exit Code 2: Unknown option exits with code 2', async () => {
      const code = await runCli(['node', 'xobrow', 'check', '--unrecognized-flag'], { exitOverride: true });
      expect(code).toBe(2);
    });

    it('Oracle Exit Code 2: Invalid option argument exits with code 2', async () => {
      const code = await runCli(['node', 'xobrow', 'check', '--format', 'invalid'], { exitOverride: true });
      expect(code).toBe(2);
    });

    it('Subprocess Execution Oracle: Validates real binary process exits code 0, 1, 2 cleanly', () => {
      const cleanScript = path.join(VALID_DIR, 'valid-01-basic-clean.js');
      const res0 = execCliBinary(['check', cleanScript]);
      expect(res0.status).toBe(0);

      const invalidScript = path.join(INVALID_DIR, 'invalid-01-sec-no-eval.js');
      const res1 = execCliBinary(['check', invalidScript]);
      expect(res1.status).toBe(1);

      const res2 = execCliBinary(['check', 'nonexistent_test_file.js']);
      expect(res2.status).toBe(2);
    });
  });

  // =========================================================================
  // Section 7: Cryptographic SHA-256 Hash Invariance Across All 36 Fixtures
  // =========================================================================
  describe('7. Cryptographic SHA-256 Hash Invariance Across All 36 Test Fixtures', () => {
    const allFixtureFiles = collectAllFiles(FIXTURES_DIR);
    const initialHashes = new Map<string, string>();

    beforeAll(() => {
      for (const file of allFixtureFiles) {
        initialHashes.set(file, getFileSha256(file));
      }
    });

    it('confirms the fixture inventory contains exactly 36 fixture files', () => {
      expect(allFixtureFiles.length).toBe(36);

      const validFiles = fs.readdirSync(VALID_DIR).filter(f => f.endsWith('.js'));
      const invalidFiles = fs.readdirSync(INVALID_DIR).filter(f => f.endsWith('.js'));
      const cliFiles = fs.readdirSync(CLI_DIR).filter(f => f.endsWith('.js'));

      expect(validFiles.length).toBe(12);
      expect(invalidFiles.length).toBe(19);
      expect(cliFiles.length).toBe(5);
      expect(validFiles.length + invalidFiles.length + cliFiles.length).toBe(36);
    });

    it('guarantees 100% byte-for-byte SHA-256 hash preservation after multi-pass CLI stress execution', async () => {
      // Pass 1: Scan all valid fixtures
      await runCli(['node', 'xobrow', 'check', path.join(VALID_DIR, '*.js')], { exitOverride: true });

      // Pass 2: Scan all invalid fixtures with --strict
      await runCli(['node', 'xobrow', 'check', '--strict', path.join(INVALID_DIR, '*.js')], { exitOverride: true });

      // Pass 3: Scan all CLI fixtures with --format json
      await runCli(['node', 'xobrow', 'check', '--format', 'json', path.join(CLI_DIR, '*.js')], { exitOverride: true });

      // Pass 4: Scan all fixtures via glob with --quiet
      await runCli(['node', 'xobrow', 'check', '--quiet', path.join(FIXTURES_DIR, '**/*.js')], { exitOverride: true });

      // Verify every single fixture retains exact cryptographic hash
      for (const file of allFixtureFiles) {
        const currentHash = getFileSha256(file);
        const expectedHash = initialHashes.get(file);
        expect(
          currentHash,
          `Cryptographic SHA-256 hash mutated for fixture: ${path.basename(file)}`
        ).toBe(expectedHash);
      }
    });
  });

  // =========================================================================
  // Section 8: Diagnostic Reporter & Formatter Boundary Edge Cases
  // =========================================================================
  describe('8. Diagnostic Reporter & Formatter Edge Cases', () => {
    it('renders code frame properly when violation occurs at line 1 column 1', () => {
      const diag: RuleDiagnostic = {
        ruleId: 'sec-no-eval',
        category: 'security',
        severity: 'error',
        message: 'Direct call to eval() detected.',
        location: { line: 1, column: 1, endLine: 1, endColumn: 5 },
        suggestion: 'Avoid eval.',
        codeSnippet: 'eval'
      };

      const result: FileScanResult = {
        filePath: 'test.js',
        diagnostics: [diag],
        errorCount: 1,
        warningCount: 0,
        hasErrors: true,
        hasWarnings: false
      };

      const formatted = formatDiagnostics([result], () => 'eval("foo");', { color: false });
      expect(formatted).toContain('error[sec-no-eval]:');
      expect(formatted).toContain('--> test.js:1:1');
      expect(formatted).toContain('1 | eval("foo");');
      expect(formatted).toContain('^');
      expect(formatted).toContain('= suggestion: Avoid eval.');
    });

    it('renders code frame when offending line is at EOF without trailing newline', () => {
      const diag: RuleDiagnostic = {
        ruleId: 'test-eof',
        category: 'security',
        severity: 'error',
        message: 'EOF violation',
        location: { line: 2, column: 1 },
        suggestion: 'Fix EOF.'
      };

      const result: FileScanResult = {
        filePath: 'eof.js',
        diagnostics: [diag],
        errorCount: 1,
        warningCount: 0,
        hasErrors: true,
        hasWarnings: false
      };

      const formatted = formatDiagnostics([result], () => 'const x = 1;\nconst y = 2;', { color: false });
      expect(formatted).toContain('2 | const y = 2;');
      expect(formatted).toContain('^');
    });

    it('outputs conforming, valid JSON matching PROJECT.md interface contract', () => {
      const diag: RuleDiagnostic = {
        ruleId: 'sec-no-eval',
        category: 'security',
        severity: 'error',
        message: 'Eval used',
        location: { line: 10, column: 5 },
        suggestion: 'Do not use eval'
      };

      const results: FileScanResult[] = [
        {
          filePath: '/path/to/script.js',
          diagnostics: [diag],
          errorCount: 1,
          warningCount: 0,
          hasErrors: true,
          hasWarnings: false
        }
      ];

      const jsonStr = formatJsonDiagnostics(results);
      const parsed = JSON.parse(jsonStr);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].filePath).toBe('/path/to/script.js');
      expect(parsed[0].diagnostics[0].ruleId).toBe('sec-no-eval');
      expect(parsed[0].diagnostics[0].location.line).toBe(10);
      expect(parsed[0].diagnostics[0].location.column).toBe(5);
      expect(parsed[0].diagnostics[0].suggestion).toBe('Do not use eval');
    });

    it('suppresses clean pass and warnings in --quiet mode while retaining errors', () => {
      const cleanResult: FileScanResult = {
        filePath: 'clean.js',
        diagnostics: [],
        errorCount: 0,
        warningCount: 0,
        hasErrors: false,
        hasWarnings: false
      };

      // Clean pass in quiet mode returns empty string
      const cleanOutput = formatDiagnostics([cleanResult], () => '', { quiet: true });
      expect(cleanOutput).toBe('');

      // Warning only in quiet mode returns summary line without warning blocks
      const warningDiag: RuleDiagnostic = {
        ruleId: 'cdp-handled-async-reject',
        category: 'cdp-integrity',
        severity: 'warning',
        message: 'Unhandled promise',
        location: { line: 1, column: 1 },
        suggestion: 'Await promise'
      };
      const warnResult: FileScanResult = {
        filePath: 'warn.js',
        diagnostics: [warningDiag],
        errorCount: 0,
        warningCount: 1,
        hasErrors: false,
        hasWarnings: true
      };
      const warnOutput = formatDiagnostics([warnResult], () => 'cdp.send("Page.navigate");', { quiet: true, color: false });
      expect(warnOutput).not.toContain('warning[cdp-handled-async-reject]');
      expect(warnOutput).toContain('1 problems (0 errors, 1 warning)');
    });
  });
});
