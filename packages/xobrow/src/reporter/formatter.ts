import pc from 'picocolors';
import type { FileScanResult, FormatterOptions, RuleDiagnostic } from '../types.js';
import { formatJsonDiagnostics } from './json-formatter.js';

export { formatJsonDiagnostics };

/**
 * Creates colorizer functions respecting color option and NO_COLOR environment variable.
 */
function createColorizer(enabled: boolean) {
  if (!enabled) {
    return {
      bold: (s: string) => s,
      dim: (s: string) => s,
      red: (s: string) => s,
      yellow: (s: string) => s,
      green: (s: string) => s,
      cyan: (s: string) => s,
      blue: (s: string) => s,
      magenta: (s: string) => s
    };
  }
  return pc;
}

/**
 * Renders an ASCII code frame for a diagnostic with right-aligned line numbers,
 * vertical gutters, and exact token pointer carets (^^^^^).
 */
function renderCodeFrame(
  diag: RuleDiagnostic,
  filePath: string,
  sourceCode: string,
  colorizer: ReturnType<typeof createColorizer>
): string[] {
  const targetLine = Math.max(1, diag.location.line);
  const targetCol = Math.max(1, diag.location.column);

  const isError = diag.severity === 'error';
  const isWarning = diag.severity === 'warning';

  const output: string[] = [];

  // 1. Diagnostic Header: error[rule-id]: message
  const sevTag = isError
    ? colorizer.bold(colorizer.red(`error[${diag.ruleId}]:`))
    : isWarning
      ? colorizer.bold(colorizer.yellow(`warning[${diag.ruleId}]:`))
      : colorizer.bold(colorizer.blue(`info[${diag.ruleId}]:`));

  output.push(`${sevTag} ${colorizer.bold(diag.message)}`);

  // 2. Location pointer: --> file:line:col
  const locArrow = colorizer.cyan('  --> ');
  const locCoords = colorizer.dim(`${filePath}:${targetLine}:${targetCol}`);
  output.push(`${locArrow}${locCoords}`);

  const lines = sourceCode ? sourceCode.split(/\r?\n/) : [];

  if (lines.length > 0 && targetLine <= lines.length) {
    const startLine = Math.max(1, targetLine - 1);
    const endLine = Math.min(lines.length, targetLine + 1);
    const gutterWidth = Math.max(2, String(endLine).length);

    // 3. Top spacer gutter
    output.push(`${' '.repeat(gutterWidth)} ${colorizer.dim('|')}`);

    // 4. Source lines with gutter and pointer carets
    for (let lineNum = startLine; lineNum <= endLine; lineNum++) {
      const rawLine = lines[lineNum - 1] ?? '';
      const lineNumStr = String(lineNum).padStart(gutterWidth, ' ');

      if (lineNum === targetLine) {
        // Offending line
        output.push(`${colorizer.dim(`${lineNumStr} | `)}${rawLine}`);

        // Pointer caret line
        const colIndex = targetCol - 1;
        const prefixSpaces = ' '.repeat(Math.max(0, colIndex));

        let caretLength = 1;
        if (diag.location.endLine === targetLine && diag.location.endColumn && diag.location.endColumn > targetCol) {
          caretLength = diag.location.endColumn - targetCol;
        } else if (diag.codeSnippet) {
          caretLength = diag.codeSnippet.length;
        } else {
          const tokenMatch = rawLine.slice(colIndex).match(/^[a-zA-Z0-9_$.]+/);
          caretLength = tokenMatch ? tokenMatch[0].length : 1;
        }

        const carets = '^'.repeat(Math.max(1, caretLength));
        const coloredCarets = isError
          ? colorizer.red(carets)
          : isWarning
            ? colorizer.yellow(carets)
            : colorizer.blue(carets);

        output.push(`${' '.repeat(gutterWidth)} ${colorizer.dim('|')} ${prefixSpaces}${coloredCarets}`);
      } else {
        // Context line
        output.push(`${colorizer.dim(`${lineNumStr} | `)}${rawLine}`);
      }
    }

    // 5. Bottom spacer gutter
    output.push(`${' '.repeat(gutterWidth)} ${colorizer.dim('|')}`);
  }

  // 6. Actionable remediation suggestion
  if (diag.suggestion) {
    output.push(`${colorizer.cyan('  = suggestion: ')}${diag.suggestion}`);
  }

  return output;
}

/**
 * Formats scan diagnostics into compiler-grade ASCII code frames or JSON.
 */
export function formatDiagnostics(
  results: FileScanResult[],
  sourceProvider: (path: string) => string,
  options: FormatterOptions = {}
): string {
  // Machine-readable JSON output
  if (options.format === 'json') {
    return formatJsonDiagnostics(results);
  }

  const noColor = typeof process !== 'undefined' && Boolean(process.env.NO_COLOR);
  const useColor = options.color ?? (typeof process !== 'undefined' && Boolean(process.stdout?.isTTY) && !noColor);
  const colorizer = createColorizer(Boolean(useColor && !noColor));

  let totalErrors = 0;
  let totalWarnings = 0;
  const blocks: string[] = [];

  for (const fileResult of results) {
    totalErrors += fileResult.errorCount;
    totalWarnings += fileResult.warningCount;

    if (fileResult.diagnostics.length === 0) {
      continue;
    }

    let sourceCode = '';
    try {
      sourceCode = sourceProvider(fileResult.filePath);
    } catch {
      sourceCode = '';
    }

    for (const diag of fileResult.diagnostics) {
      if (options.quiet && diag.severity === 'warning') {
        continue;
      }
      const frameLines = renderCodeFrame(diag, fileResult.filePath, sourceCode, colorizer);
      blocks.push(frameLines.join('\n'));
    }
  }

  // Clean pass output
  if (totalErrors === 0 && totalWarnings === 0) {
    if (options.quiet) return '';
    const checkIcon = colorizer.green('✔');
    const fileCount = results.length;
    return `${checkIcon} Checked ${fileCount} file${fileCount === 1 ? '' : 's'}. 0 issues found.`;
  }

  // Problem summary line
  const totalProblems = totalErrors + totalWarnings;
  const failIcon = colorizer.red('✖');
  const summaryLine = `${failIcon} ${totalProblems} problems (${totalErrors} error${totalErrors === 1 ? '' : 's'}, ${totalWarnings} warning${totalWarnings === 1 ? '' : 's'})`;

  return `\n${blocks.join('\n\n')}\n\n${summaryLine}`;
}
