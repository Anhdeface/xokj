import fs from 'node:fs';
import type {
  RuleDefinition,
  RuleDiagnostic,
  RuleContext,
  ReportDescriptor,
  ScanOptions,
  FileScanResult,
  ScanSummary
} from '../types.js';
import { defaultRegistry } from '../rules/registry.js';
import { parseUserscriptMetadata } from '../parser/metadata.js';
import { parseScriptAst } from '../parser/ast.js';
import { traverseAst } from '../parser/visitor.js';

export { ScanOptions, FileScanResult, ScanSummary };

/**
 * Scans a single userscript file in memory by parsing its metadata, building its AST,
 * and running all active rule visitors in a two-pass traversal.
 */
export function scanFile(
  filePath: string,
  sourceCode: string,
  options: ScanOptions = {}
): FileScanResult {
  const diagnostics: RuleDiagnostic[] = [];
  const lines = sourceCode.split(/\r?\n/);
  const metadata = parseUserscriptMetadata(sourceCode);
  const hasMetadata = metadata.hasHeader;

  // 1. Parse AST and collect syntax errors
  const { ast, syntaxErrors } = parseScriptAst(sourceCode, filePath);
  diagnostics.push(...syntaxErrors);

  // 2. Resolve rules to run
  let rulesToRun: RuleDefinition[] = options.rules ?? defaultRegistry.getAll();
  if (options.ruleFilter) {
    rulesToRun = rulesToRun.filter(options.ruleFilter);
  }

  // 3. If AST parsed successfully, invoke visitor engine across all rules
  if (ast) {
    const visitors = rulesToRun.map((rule) => {
      const context: RuleContext = {
        filePath,
        sourceCode,
        lines,
        metadata,
        hasMetadata,
        report: (desc: ReportDescriptor) => {
          diagnostics.push({
            ruleId: rule.id,
            category: rule.category,
            severity: desc.severity ?? rule.defaultSeverity,
            message: desc.message,
            location: desc.location,
            suggestion: desc.suggestion,
            codeSnippet: desc.codeSnippet
          });
        }
      };

      return rule.create(context);
    });

    traverseAst(ast, visitors);
  }

  let errorCount = 0;
  let warningCount = 0;

  for (const diag of diagnostics) {
    if (diag.severity === 'error') {
      errorCount++;
    } else if (diag.severity === 'warning') {
      warningCount++;
    }
  }

  return {
    filePath,
    diagnostics,
    errorCount,
    warningCount,
    hasErrors: errorCount > 0,
    hasWarnings: warningCount > 0
  };
}

/**
 * Scans a list of files sequentially using strictly read-only access (fs.readFileSync).
 * Never mutates or alters user code.
 */
export async function scanFiles(
  filePaths: string[],
  options: ScanOptions = {}
): Promise<ScanSummary> {
  const results: FileScanResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const filePath of filePaths) {
    let sourceCode: string;
    try {
      sourceCode = fs.readFileSync(filePath, 'utf-8');
    } catch (err: any) {
      if (err.code === 'EACCES') {
        throw new Error(`Unable to read file: ${filePath} (EACCES: permission denied)`);
      }
      throw new Error(`Unable to read file: ${filePath} (${err.message})`);
    }

    const fileResult = scanFile(filePath, sourceCode, options);
    results.push(fileResult);
    totalErrors += fileResult.errorCount;
    totalWarnings += fileResult.warningCount;
  }

  const clean = totalErrors === 0 && (!options.strict || totalWarnings === 0);
  const exitCode = totalErrors > 0 || (options.strict && totalWarnings > 0) ? 1 : 0;

  return {
    results,
    totalFiles: filePaths.length,
    totalErrors,
    totalWarnings,
    clean,
    exitCode
  };
}
