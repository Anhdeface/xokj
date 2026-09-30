import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scanFile, scanFiles } from '../../../src/engine/scanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '../../..');

function computeSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

describe('Zero Auto-Fix & Hash Invariance (read-only assurance)', () => {
  it('preserves SHA-256 hash across clean files during scanFiles', async () => {
    const targetFile = path.resolve(packageRoot, 'bin/xobrow.js');

    const hashBefore = computeSha256(targetFile);
    const mtimeBefore = fs.statSync(targetFile).mtimeMs;

    const summary = await scanFiles([targetFile]);
    expect(summary.clean).toBe(true);

    const hashAfter = computeSha256(targetFile);
    const mtimeAfter = fs.statSync(targetFile).mtimeMs;

    expect(hashAfter).toBe(hashBefore);
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it('preserves SHA-256 hash across violating/error files during scanFiles', async () => {
    const targetFile = path.resolve(packageRoot, 'package.json');

    const hashBefore = computeSha256(targetFile);
    const mtimeBefore = fs.statSync(targetFile).mtimeMs;

    const summary = await scanFiles([targetFile]);
    expect(summary.totalErrors).toBeGreaterThan(0);

    const hashAfter = computeSha256(targetFile);
    const mtimeAfter = fs.statSync(targetFile).mtimeMs;

    expect(hashAfter).toBe(hashBefore);
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it('verifies scanFile in-memory scanner does not alter source code string', () => {
    const originalCode = `// ==UserScript==\n// @name Test\n// ==/UserScript==\nconst x = 1;`;
    const copy = originalCode.slice();

    const result = scanFile('test.js', copy);
    expect(copy).toBe(originalCode);
    expect(result.filePath).toBe('test.js');
  });
});
