import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../../../src/cli.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '../../..');

describe('CLI Runner & Argument Parsing (cli.ts)', () => {
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

  it('exits with code 0 on --version and -v', async () => {
    const code1 = await runCli(['node', 'xobrow', '--version'], { exitOverride: true });
    expect(code1).toBe(0);

    const code2 = await runCli(['node', 'xobrow', '-v'], { exitOverride: true });
    expect(code2).toBe(0);
  });

  it('exits with code 0 on --help and check --help', async () => {
    const code1 = await runCli(['node', 'xobrow', '--help'], { exitOverride: true });
    expect(code1).toBe(0);

    const code2 = await runCli(['node', 'xobrow', 'check', '--help'], { exitOverride: true });
    expect(code2).toBe(0);
  });

  it('exits with code 2 when no patterns or arguments are provided', async () => {
    const code = await runCli(['node', 'xobrow'], { exitOverride: true });
    expect(code).toBe(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('No input files or patterns specified')
    );
  });

  it('exits with code 2 on unknown flags', async () => {
    const code = await runCli(['node', 'xobrow', '--unknown-option'], { exitOverride: true });
    expect(code).toBe(2);
  });

  it('exits with code 2 on invalid format choice', async () => {
    const code = await runCli(['node', 'xobrow', 'check', '--format', 'yaml'], { exitOverride: true });
    expect(code).toBe(2);
  });

  it('exits with code 2 when file does not exist', async () => {
    const code = await runCli(['node', 'xobrow', 'check', 'does_not_exist_123.js'], { exitOverride: true });
    expect(code).toBe(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('File not found: does_not_exist_123.js')
    );
  });

  it('exits with code 0 when checking valid file', async () => {
    const validFile = path.resolve(packageRoot, 'bin/xobrow.js');
    const code = await runCli(['node', 'xobrow', 'check', validFile], { exitOverride: true });
    expect(code).toBe(0);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('0 issues found')
    );
  });

  it('supports implicit check command syntax (xobrow <file>)', async () => {
    const validFile = path.resolve(packageRoot, 'bin/xobrow.js');
    const code = await runCli(['node', 'xobrow', validFile], { exitOverride: true });
    expect(code).toBe(0);
  });

  it('supports --format json', async () => {
    const validFile = path.resolve(packageRoot, 'bin/xobrow.js');
    const code = await runCli(['node', 'xobrow', 'check', validFile, '--format', 'json'], { exitOverride: true });
    expect(code).toBe(0);
  });

  it('supports --quiet to suppress output', async () => {
    const validFile = path.resolve(packageRoot, 'bin/xobrow.js');
    const code = await runCli(['node', 'xobrow', 'check', validFile, '--quiet'], { exitOverride: true });
    expect(code).toBe(0);
  });

  it('exits with code 1 when code violations / syntax errors are detected', async () => {
    const invalidFile = path.resolve(packageRoot, 'package.json'); // package.json fails JS parser
    const code = await runCli(['node', 'xobrow', 'check', invalidFile], { exitOverride: true });
    expect(code).toBe(1);
  });
});
