import { describe, it, expect } from 'vitest';
import { formatDiagnostics, formatJsonDiagnostics } from '../../../src/reporter/formatter.js';
import type { FileScanResult, RuleDiagnostic } from '../../../src/types.js';

describe('Diagnostic Reporter & Code Frame Formatter (reporter/formatter.ts)', () => {
  const sampleSource = [
    '// ==UserScript==',
    '// @name Test Violation',
    '// ==/UserScript==',
    '',
    '(function () {',
    '  const payload = "alert(1)";',
    '  eval(payload);',
    '})();'
  ].join('\n');

  const sampleDiagnostic: RuleDiagnostic = {
    ruleId: 'sec-no-eval',
    category: 'security',
    severity: 'error',
    message: 'Direct call to eval() is strictly prohibited.',
    location: {
      line: 7,
      column: 3,
      endLine: 7,
      endColumn: 16
    },
    suggestion: 'Refactor dynamic code evaluation using JSON.parse().',
    codeSnippet: 'eval(payload);'
  };

  const sampleFileResult: FileScanResult = {
    filePath: '/path/to/userscript.js',
    diagnostics: [sampleDiagnostic],
    errorCount: 1,
    warningCount: 0,
    hasErrors: true,
    hasWarnings: false
  };

  it('renders compiler-grade ASCII code frame with gutters, carets, and suggestion', () => {
    const output = formatDiagnostics([sampleFileResult], () => sampleSource, { color: false });

    // Assert header
    expect(output).toContain('error[sec-no-eval]: Direct call to eval() is strictly prohibited.');
    // Assert file location pointer
    expect(output).toContain('--> /path/to/userscript.js:7:3');
    // Assert right-aligned line number gutter
    expect(output).toContain('7 |   eval(payload);');
    // Assert carets pointing at offending token
    expect(output).toMatch(/\|\s+\^{3,}/);
    // Assert remediation suggestion
    expect(output).toContain('= suggestion: Refactor dynamic code evaluation using JSON.parse().');
    // Assert problem summary
    expect(output).toContain('✖ 1 problems (1 error, 0 warnings)');
  });

  it('renders clean pass banner when no errors or warnings are found', () => {
    const cleanResult: FileScanResult = {
      filePath: '/path/to/clean.js',
      diagnostics: [],
      errorCount: 0,
      warningCount: 0,
      hasErrors: false,
      hasWarnings: false
    };

    const output = formatDiagnostics([cleanResult], () => sampleSource, { color: false });
    expect(output).toContain('✔ Checked 1 file. 0 issues found.');
  });

  it('suppresses passing output when quiet mode is enabled', () => {
    const cleanResult: FileScanResult = {
      filePath: '/path/to/clean.js',
      diagnostics: [],
      errorCount: 0,
      warningCount: 0,
      hasErrors: false,
      hasWarnings: false
    };

    const output = formatDiagnostics([cleanResult], () => sampleSource, { quiet: true });
    expect(output).toBe('');
  });

  it('produces valid machine-readable JSON with format: "json"', () => {
    const output = formatDiagnostics([sampleFileResult], () => sampleSource, { format: 'json' });
    let parsed: any;
    expect(() => {
      parsed = JSON.parse(output);
    }).not.toThrow();

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].filePath).toBe('/path/to/userscript.js');
    expect(parsed[0].diagnostics[0].ruleId).toBe('sec-no-eval');
    expect(parsed[0].diagnostics[0].location.line).toBe(7);
    expect(parsed[0].diagnostics[0].location.column).toBe(3);
    expect(parsed[0].diagnostics[0].suggestion).toContain('JSON.parse');
  });

  it('formatJsonDiagnostics directly produces structured JSON', () => {
    const jsonStr = formatJsonDiagnostics([sampleFileResult]);
    const parsed = JSON.parse(jsonStr);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].errorCount).toBe(1);
  });

  it('handles warning severity with warning header tag', () => {
    const warningDiagnostic: RuleDiagnostic = {
      ruleId: 'cdp-handled-async-reject',
      category: 'cdp-integrity',
      severity: 'warning',
      message: 'Unhandled CDP promise.',
      location: { line: 7, column: 3 },
      suggestion: 'Await the call inside try/catch.'
    };

    const warningResult: FileScanResult = {
      filePath: '/path/to/warning.js',
      diagnostics: [warningDiagnostic],
      errorCount: 0,
      warningCount: 1,
      hasErrors: false,
      hasWarnings: true
    };

    const output = formatDiagnostics([warningResult], () => sampleSource, { color: false });
    expect(output).toContain('warning[cdp-handled-async-reject]: Unhandled CDP promise.');
    expect(output).toContain('✖ 1 problems (0 errors, 1 warning)');
  });

  it('handles missing or empty source code gracefully without throw', () => {
    const output = formatDiagnostics([sampleFileResult], () => '', { color: false });
    expect(output).toContain('error[sec-no-eval]:');
    expect(output).toContain('--> /path/to/userscript.js:7:3');
    expect(output).toContain('= suggestion:');
  });

  it('omits ANSI color codes when color: false is explicitly set', () => {
    const output = formatDiagnostics([sampleFileResult], () => sampleSource, { color: false });
    // Verify no ANSI escape sequence (\u001b[...m)
    expect(output).not.toMatch(/\u001b\[\d+m/);
  });
});
