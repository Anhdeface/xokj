import type { FileScanResult } from '../types.js';

/**
 * Formats scan results as machine-readable JSON matching the CLI specification.
 */
export function formatJsonDiagnostics(results: FileScanResult[]): string {
  return JSON.stringify(results, null, 2);
}
