import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePatterns, isGlobPattern } from '../../../src/engine/glob.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '../../..');

describe('Glob & Path Resolution Engine (engine/glob.ts)', () => {
  describe('isGlobPattern', () => {
    it('detects wildcard characters correctly', () => {
      expect(isGlobPattern('src/**/*.js')).toBe(true);
      expect(isGlobPattern('file?.ts')).toBe(true);
      expect(isGlobPattern('scripts/[a-z].js')).toBe(true);
      expect(isGlobPattern('file.{js,ts}')).toBe(true);
      expect(isGlobPattern('!exclude.js')).toBe(true);
      expect(isGlobPattern('normal/file.js')).toBe(false);
      expect(isGlobPattern('plain.ts')).toBe(false);
    });
  });

  describe('resolvePatterns', () => {
    it('resolves a single existing file to its absolute path', () => {
      const target = path.resolve(packageRoot, 'bin/xobrow.js');
      const resolved = resolvePatterns(['bin/xobrow.js'], { cwd: packageRoot });

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toBe(target);
    });

    it('deduplicates identical file paths in patterns', () => {
      const resolved = resolvePatterns(['bin/xobrow.js', 'bin/xobrow.js', './bin/xobrow.js'], { cwd: packageRoot });
      expect(resolved).toHaveLength(1);
    });

    it('expands directory path to all script files inside', () => {
      const srcDir = path.resolve(packageRoot, 'src/parser');
      const resolved = resolvePatterns([srcDir], { cwd: packageRoot });

      expect(resolved.length).toBeGreaterThanOrEqual(3);
      expect(resolved.some((f) => f.endsWith('metadata.ts'))).toBe(true);
      expect(resolved.some((f) => f.endsWith('ast.ts'))).toBe(true);
      expect(resolved.some((f) => f.endsWith('visitor.ts'))).toBe(true);
    });

    it('expands glob patterns across subdirectories', () => {
      const pattern = 'src/**/*.ts';
      const resolved = resolvePatterns([pattern], { cwd: packageRoot });

      expect(resolved.length).toBeGreaterThanOrEqual(5);
      for (const f of resolved) {
        expect(f.endsWith('.ts')).toBe(true);
        expect(path.isAbsolute(f)).toBe(true);
      }
    });

    it('throws Error when plain file path does not exist', () => {
      expect(() => {
        resolvePatterns(['non_existent_file_xyz.js'], { cwd: packageRoot });
      }).toThrowError('File not found: non_existent_file_xyz.js');
    });

    it('throws Error when glob pattern matches zero files', () => {
      expect(() => {
        resolvePatterns(['non_existent_dir/**/*.js'], { cwd: packageRoot });
      }).toThrowError('No files matching pattern: non_existent_dir/**/*.js');
    });

    it('ignores empty pattern strings', () => {
      const target = path.resolve(packageRoot, 'bin/xobrow.js');
      const resolved = resolvePatterns(['', '   ', 'bin/xobrow.js'], { cwd: packageRoot });
      expect(resolved).toEqual([target]);
    });
  });
});
