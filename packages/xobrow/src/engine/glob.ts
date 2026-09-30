import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'glob';

export interface ResolvePatternsOptions {
  cwd?: string;
  supportedExtensions?: string[];
}

const DEFAULT_EXTENSIONS = ['.js', '.ts', '.mjs', '.cjs'];

export function isGlobPattern(pattern: string): boolean {
  return /[*?[\]{}!]/.test(pattern);
}

/**
 * Resolves a list of file paths, directories, or glob patterns into
 * an array of deduplicated absolute file paths.
 * Throws an Error (caught with exit code 2) if a path is missing or a glob has 0 matches.
 */
export function resolvePatterns(
  patterns: string[],
  options: ResolvePatternsOptions = {}
): string[] {
  const cwd = options.cwd ?? process.cwd();
  const extensions = options.supportedExtensions ?? DEFAULT_EXTENSIONS;
  const resolvedFiles = new Set<string>();

  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim();
    if (!pattern) continue;

    const absolutePath = path.resolve(cwd, pattern);

    // Case 1: Plain path that exists on filesystem
    if (!isGlobPattern(pattern) && fs.existsSync(absolutePath)) {
      const stat = fs.statSync(absolutePath);
      if (stat.isFile()) {
        resolvedFiles.add(absolutePath);
        continue;
      } else if (stat.isDirectory()) {
        const extPattern = `**/*{${extensions.join(',')}}`;
        const dirMatches = globSync(extPattern, {
          cwd: absolutePath,
          nodir: true,
          absolute: true,
          ignore: ['**/node_modules/**', '**/.git/**']
        });

        if (dirMatches.length === 0) {
          throw new Error(`No matching script files found in directory: ${pattern}`);
        }

        for (const file of dirMatches) {
          resolvedFiles.add(file);
        }
        continue;
      }
    }

    // Case 2: Glob pattern
    if (isGlobPattern(pattern)) {
      const globMatches = globSync(pattern, {
        cwd,
        nodir: true,
        absolute: true,
        windowsPathsNoEscape: true,
        ignore: ['**/node_modules/**', '**/.git/**']
      });

      if (globMatches.length === 0) {
        throw new Error(`No files matching pattern: ${pattern}`);
      }

      for (const match of globMatches) {
        resolvedFiles.add(match);
      }
      continue;
    }

    // Case 3: Plain path does not exist
    throw new Error(`File not found: ${pattern}`);
  }

  return Array.from(resolvedFiles).sort();
}
