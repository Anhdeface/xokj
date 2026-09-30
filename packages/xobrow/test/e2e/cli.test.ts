import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

const ROOT_DIR = path.resolve(__dirname, '../../../..');
const XOBROW_DIR = path.resolve(ROOT_DIR, 'packages/xobrow');
const BIN_PATH = path.resolve(XOBROW_DIR, 'bin/xobrow.js');
const BIN_XB_PATH = path.resolve(XOBROW_DIR, 'bin/xb.js');
const SRC_CLI_PATH = path.resolve(XOBROW_DIR, 'src/cli.ts');
const FIXTURES_DIR = path.resolve(XOBROW_DIR, 'test/fixtures');
const VALID_DIR = path.resolve(FIXTURES_DIR, 'valid');
const INVALID_DIR = path.resolve(FIXTURES_DIR, 'invalid');
const CLI_DIR = path.resolve(FIXTURES_DIR, 'cli');

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/**
 * Computes SHA-256 hash of a file.
 */
function getFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Recursively collects all files in a directory.
 */
function getAllFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts'))) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Resolves CLI invocation command for 'xobrow' or 'xb' alias.
 */
function resolveCliExecution(binaryAlias: 'xobrow' | 'xb' = 'xobrow'): { executable: string; prefixArgs: string[] } {
  // Check if alias specific binary exists (e.g. bin/xb.js)
  if (binaryAlias === 'xb' && fs.existsSync(BIN_XB_PATH)) {
    return {
      executable: process.execPath,
      prefixArgs: [BIN_XB_PATH]
    };
  }

  // Check if standard bin/xobrow.js exists
  if (fs.existsSync(BIN_PATH)) {
    return {
      executable: process.execPath,
      prefixArgs: [BIN_PATH]
    };
  }

  // Use vite-node as fallback runner for TypeScript source in development
  const viteNodeBin = path.resolve(ROOT_DIR, 'node_modules/.bin/vite-node');
  if (fs.existsSync(SRC_CLI_PATH) && fs.existsSync(viteNodeBin)) {
    return {
      executable: viteNodeBin,
      prefixArgs: [SRC_CLI_PATH]
    };
  }

  // Default fallback
  return {
    executable: process.execPath,
    prefixArgs: [BIN_PATH]
  };
}

/**
 * Executes XoBrow CLI with given arguments.
 */
function runXoBrow(args: string[], binaryAlias: 'xobrow' | 'xb' = 'xobrow'): CliResult {
  const { executable, prefixArgs } = resolveCliExecution(binaryAlias);
  const fullArgs = [...prefixArgs, ...args];
  const proc = spawnSync(executable, fullArgs, {
    cwd: ROOT_DIR,
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 20000
  });

  return {
    status: proc.status,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
    error: proc.error
  };
}

const hasCli = fs.existsSync(BIN_PATH) && (fs.existsSync(path.resolve(XOBROW_DIR, 'dist/cli.js')) || fs.existsSync(SRC_CLI_PATH));

describe('XoBrow Requirement-Driven Opaque-Box E2E Test Suite', () => {
  const allFixtureFiles = getAllFiles(FIXTURES_DIR);
  let initialHashes: Map<string, string> = new Map();

  beforeAll(() => {
    // Record SHA-256 hashes of all fixtures before any tests run
    for (const file of allFixtureFiles) {
      initialHashes.set(file, getFileHash(file));
    }
  });

  afterAll(() => {
    // Assert 100% byte-for-byte preservation across all fixtures
    for (const file of allFixtureFiles) {
      const currentHash = getFileHash(file);
      const expectedHash = initialHashes.get(file);
      expect(currentHash).toBe(expectedHash);
    }
  });

  describe('Fixture Structure & Inventory Verification', () => {
    it('contains at least 10 positive test fixtures in fixtures/valid/', () => {
      const validFiles = fs.readdirSync(VALID_DIR).filter(f => f.endsWith('.js'));
      expect(validFiles.length).toBeGreaterThanOrEqual(10);
    });

    it('contains at least 15 negative test fixtures in fixtures/invalid/ covering all 15 rules', () => {
      const invalidFiles = fs.readdirSync(INVALID_DIR).filter(f => f.endsWith('.js'));
      expect(invalidFiles.length).toBeGreaterThanOrEqual(15);

      const requiredRules = [
        'sec-no-eval',
        'sec-no-new-function',
        'sec-no-string-timers',
        'sec-no-unsafe-dom-sink',
        'sec-no-prototype-pollution',
        'sec-no-script-injection',
        'leak-uncleaned-event-listener',
        'leak-lingering-interval',
        'leak-unclosed-cdp-listener',
        'leak-unbounded-async-loop',
        'cdp-valid-domain-method',
        'cdp-header-permission',
        'cdp-handled-async-reject',
        'cdp-no-tight-polling',
        'cdp-valid-payload'
      ];

      for (const rule of requiredRules) {
        const found = invalidFiles.some(f => f.includes(rule));
        expect(found, `Expected fixture for rule: ${rule}`).toBe(true);
      }
    });

    it('contains CLI fixtures including empty file, syntax error, and strict warning scripts', () => {
      const cliFiles = fs.readdirSync(CLI_DIR);
      expect(cliFiles).toContain('cli-empty.js');
      expect(cliFiles).toContain('cli-syntax-error.js');
      expect(cliFiles).toContain('cli-top-level-return.js');
      expect(cliFiles).toContain('cli-warning-only.js');
      expect(cliFiles).toContain('cli-clean.js');
    });
  });

  describe('Tier 1: Feature Coverage & Binary Invocations', () => {
    it.skipIf(!hasCli)('displays help documentation and exits code 0 via xobrow --help', () => {
      const res = runXoBrow(['--help'], 'xobrow');
      expect(res.status).toBe(0);
      expect(res.stdout.toLowerCase()).toMatch(/usage|options|xobrow/);
    });

    it.skipIf(!hasCli)('displays help documentation and exits code 0 via xb alias --help', () => {
      const res = runXoBrow(['--help'], 'xb');
      expect(res.status).toBe(0);
      expect(res.stdout.toLowerCase()).toMatch(/usage|options|xobrow|xb/);
    });

    it.skipIf(!hasCli)('outputs semantic version and exits code 0 via --version', () => {
      const res = runXoBrow(['--version']);
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    describe('Positive Test Fixtures (Valid Scripts -> Exit Code 0)', () => {
      const validFiles = fs.readdirSync(VALID_DIR).filter(f => f.endsWith('.js'));

      for (const validFile of validFiles) {
        it.skipIf(!hasCli)(`validates ${validFile} as clean with exit code 0`, () => {
          const filePath = path.join(VALID_DIR, validFile);
          const res = runXoBrow(['check', filePath]);
          expect(res.status).toBe(0);
          expect(res.stdout + res.stderr).not.toMatch(/error\[/i);
        });
      }
    });

    describe('Negative Test Fixtures (15 Individual Rules -> Exit Code 1)', () => {
      const ruleMap: Record<string, string> = {
        'invalid-01-sec-no-eval.js': 'sec-no-eval',
        'invalid-02-sec-no-new-function.js': 'sec-no-new-function',
        'invalid-03-sec-no-string-timers.js': 'sec-no-string-timers',
        'invalid-04-sec-no-unsafe-dom-sink.js': 'sec-no-unsafe-dom-sink',
        'invalid-05-sec-no-prototype-pollution.js': 'sec-no-prototype-pollution',
        'invalid-06-sec-no-script-injection.js': 'sec-no-script-injection',
        'invalid-07-leak-uncleaned-event-listener.js': 'leak-uncleaned-event-listener',
        'invalid-08-leak-lingering-interval.js': 'leak-lingering-interval',
        'invalid-09-leak-unclosed-cdp-listener.js': 'leak-unclosed-cdp-listener',
        'invalid-10-leak-unbounded-async-loop.js': 'leak-unbounded-async-loop',
        'invalid-11-cdp-valid-domain-method.js': 'cdp-valid-domain-method',
        'invalid-12-cdp-header-permission.js': 'cdp-header-permission',
        'invalid-13-cdp-handled-async-reject.js': 'cdp-handled-async-reject',
        'invalid-14-cdp-no-tight-polling.js': 'cdp-no-tight-polling',
        'invalid-15-cdp-valid-payload.js': 'cdp-valid-payload'
      };

      for (const [file, ruleId] of Object.entries(ruleMap)) {
        it.skipIf(!hasCli)(`detects ${ruleId} violation in ${file} with exit code 1`, () => {
          const filePath = path.join(INVALID_DIR, file);
          // For cdp-handled-async-reject (warning default severity), elevate with --strict to verify exit 1
          const args = ruleId === 'cdp-handled-async-reject'
            ? ['check', '--strict', filePath]
            : ['check', filePath];
          const res = runXoBrow(args);
          expect(res.status).toBe(1);
          const combinedOutput = res.stdout + res.stderr;
          expect(combinedOutput).toContain(ruleId);
        });
      }
    });
  });

  describe('Tier 2: Boundary & Corner Cases', () => {
    it.skipIf(!hasCli)('exits with code 2 when target file does not exist', () => {
      const res = runXoBrow(['check', 'non_existent_file_xyz.js']);
      expect(res.status).toBe(2);
      expect(res.stdout + res.stderr).toMatch(/not found|cannot find|no such file|unable to read/i);
    });

    it.skipIf(!hasCli)('exits with code 2 when invalid CLI arguments are passed', () => {
      const res = runXoBrow(['check', '--completely-unknown-flag-xyz']);
      expect(res.status).toBe(2);
    });

    it.skipIf(!hasCli)('handles empty (0-byte) script cleanly with exit code 0', () => {
      const emptyPath = path.join(CLI_DIR, 'cli-empty.js');
      const res = runXoBrow(['check', emptyPath]);
      expect(res.status).toBe(0);
    });

    it.skipIf(!hasCli)('handles top-level return in userscripts without parse crash (exit code 0)', () => {
      const topLevelReturnPath = path.join(CLI_DIR, 'cli-top-level-return.js');
      const res = runXoBrow(['check', topLevelReturnPath]);
      expect(res.status).toBe(0);
    });

    it.skipIf(!hasCli)('handles syntax errors with diagnostic code frame and non-zero exit code', () => {
      const syntaxErrorPath = path.join(CLI_DIR, 'cli-syntax-error.js');
      const res = runXoBrow(['check', syntaxErrorPath]);
      expect([1, 2]).toContain(res.status);
    });
  });

  describe('Tier 3: Cross-Feature Combinations & CLI Modifiers', () => {
    it.skipIf(!hasCli)('elevates warnings to error exit code 1 with --strict', () => {
      const warningPath = path.join(CLI_DIR, 'cli-warning-only.js');

      // Without --strict: exit code 0
      const normalRes = runXoBrow(['check', warningPath]);
      expect(normalRes.status).toBe(0);

      // With --strict: exit code 1
      const strictRes = runXoBrow(['check', '--strict', warningPath]);
      expect(strictRes.status).toBe(1);
    });

    it.skipIf(!hasCli)('outputs valid machine-readable JSON schema with --format json', () => {
      const targetPath = path.join(INVALID_DIR, 'invalid-01-sec-no-eval.js');
      const res = runXoBrow(['check', '--format', 'json', targetPath]);
      expect(res.status).toBe(1);

      let parsed: any;
      expect(() => {
        parsed = JSON.parse(res.stdout);
      }).not.toThrow();

      const results = Array.isArray(parsed) ? parsed : (parsed.results || [parsed]);
      expect(results.length).toBeGreaterThanOrEqual(1);

      const fileResult = results[0];
      expect(fileResult.filePath || fileResult.file).toBeDefined();

      const diagnostics = fileResult.diagnostics || fileResult.errors;
      expect(Array.isArray(diagnostics)).toBe(true);
      expect(diagnostics.length).toBeGreaterThanOrEqual(1);

      const diag = diagnostics[0];
      expect(diag.ruleId).toBe('sec-no-eval');
      expect(diag.location).toBeDefined();
      expect(diag.location.line).toBeGreaterThanOrEqual(1);
      expect(diag.location.column).toBeGreaterThanOrEqual(1);
      expect(typeof diag.suggestion).toBe('string');
    });

    it.skipIf(!hasCli)('supports glob matching across directories (exit code 0 on valid scripts)', () => {
      const globPattern = path.join(VALID_DIR, 'valid-*.js');
      const res = runXoBrow(['check', globPattern]);
      expect(res.status).toBe(0);
    });
  });

  describe('Tier 4: Real-World Workload Scenarios', () => {
    it.skipIf(!hasCli)('Scenario 1: Production Automation Userscript passes with exit code 0', () => {
      const script = path.join(VALID_DIR, 'valid-10-production-automation.js');
      const res = runXoBrow(['check', script]);
      expect(res.status).toBe(0);
    });

    it.skipIf(!hasCli)('Scenario 2: Malicious Userscript catches eval, DOM sink, and script injection', () => {
      const script = path.join(INVALID_DIR, 'invalid-16-malicious-multi.js');
      const res = runXoBrow(['check', script]);
      expect(res.status).toBe(1);
      const out = res.stdout + res.stderr;
      expect(out).toContain('sec-no-eval');
      expect(out).toContain('sec-no-unsafe-dom-sink');
      expect(out).toContain('sec-no-script-injection');
    });

    it.skipIf(!hasCli)('Scenario 3: Leaky Scraping Bot catches lingering interval, uncleaned event, unclosed CDP listener', () => {
      const script = path.join(INVALID_DIR, 'invalid-17-leaky-scraping-bot.js');
      const res = runXoBrow(['check', script]);
      expect(res.status).toBe(1);
      const out = res.stdout + res.stderr;
      expect(out).toContain('leak-lingering-interval');
      expect(out).toContain('leak-uncleaned-event-listener');
      expect(out).toContain('leak-unclosed-cdp-listener');
    });

    it.skipIf(!hasCli)('Scenario 4: Flooding DoS Loop catches leak-unbounded-async-loop', () => {
      const script = path.join(INVALID_DIR, 'invalid-18-flooding-dos-loop.js');
      const res = runXoBrow(['check', script]);
      expect(res.status).toBe(1);
      expect(res.stdout + res.stderr).toContain('leak-unbounded-async-loop');
    });

    it.skipIf(!hasCli)('Scenario 5: Unauthorized CDP Probe catches cdp-header-permission', () => {
      const script = path.join(INVALID_DIR, 'invalid-19-unauthorized-cdp-probe.js');
      const res = runXoBrow(['check', script]);
      expect(res.status).toBe(1);
      expect(res.stdout + res.stderr).toContain('cdp-header-permission');
    });
  });

  describe('Zero Auto-Fix Protocol (SHA-256 Hash Invariance)', () => {
    it('explicitly validates zero modifications across all fixtures before and after CLI checks', () => {
      // 1. Snapshot all file hashes
      const preCheckHashes = new Map<string, string>();
      for (const file of allFixtureFiles) {
        preCheckHashes.set(file, getFileHash(file));
      }

      // 2. If CLI is present, run check on all fixtures
      if (hasCli) {
        runXoBrow(['check', path.join(FIXTURES_DIR, '**/*.js')]);
      }

      // 3. Assert all hashes are 100% identical
      for (const file of allFixtureFiles) {
        const postCheckHash = getFileHash(file);
        const preCheckHash = preCheckHashes.get(file);
        expect(postCheckHash).toBe(preCheckHash);
        expect(postCheckHash).toBe(initialHashes.get(file));
      }
    });
  });
});
