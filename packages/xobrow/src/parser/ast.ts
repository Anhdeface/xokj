/**
 * XoBrow - Babel AST Parser Engine Wrapper
 * Configured specifically for userscript semantics with 1-indexed diagnostic coordinates.
 */

import { parse, type ParserPlugin, type ParserOptions } from '@babel/parser';
import type { RuleDiagnostic } from '../types.js';

export interface ParseAstOptions {
  sourceType?: 'module' | 'script' | 'unambiguous';
  allowReturnOutsideFunction?: boolean;
  allowAwaitOutsideFunction?: boolean;
  allowImportExportEverywhere?: boolean;
  allowSuperOutsideMethod?: boolean;
  plugins?: ParserPlugin[];
  errorRecovery?: boolean;
}

export interface ParseAstResult {
  ast: any | null;
  syntaxErrors: RuleDiagnostic[];
}

export const DEFAULT_PARSER_PLUGINS: ParserPlugin[] = [
  'typescript',
  'jsx',
  'decorators-legacy',
  'classProperties',
  'asyncGenerators',
  'dynamicImport',
  'objectRestSpread',
  'exportDefaultFrom'
];

export const DEFAULT_PARSER_OPTIONS: ParserOptions = {
  sourceType: 'module',
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: true,
  allowSuperOutsideMethod: true,
  plugins: DEFAULT_PARSER_PLUGINS,
  errorRecovery: true,
  ranges: true,
  tokens: false
};

/**
 * Parses userscript source code into a Babel AST, capturing both fatal and recovered
 * syntax errors as standardized compiler-grade RuleDiagnostics with 1-indexed coordinates.
 */
export function parseScriptAst(
  sourceCode: string,
  filePath: string = '<anonymous>',
  customOptions?: ParseAstOptions
): ParseAstResult {
  const options: ParserOptions = {
    ...DEFAULT_PARSER_OPTIONS,
    ...customOptions,
    plugins: customOptions?.plugins ?? DEFAULT_PARSER_PLUGINS
  };

  const syntaxErrors: RuleDiagnostic[] = [];

  try {
    const ast = parse(sourceCode, options);

    // Collect non-fatal recovered syntax errors
    if (ast.errors && ast.errors.length > 0) {
      for (const err of ast.errors) {
        const cleanMessage = err.message ? err.message.replace(/\s*\(\d+:\d+\)$/, '') : 'Recoverable syntax error';
        const line = err.loc ? err.loc.line : 1;
        const column = err.loc ? err.loc.column + 1 : 1;

        syntaxErrors.push({
          ruleId: 'syntax-error',
          category: 'security',
          severity: 'error',
          message: `Syntax error: ${cleanMessage}`,
          location: { line, column },
          suggestion: 'Correct the syntax error to ensure complete static analysis.'
        });
      }
    }

    return {
      ast,
      syntaxErrors
    };
  } catch (err: any) {
    // Fatal unrecoverable syntax error thrown by parser
    const cleanMessage = err.message ? String(err.message).replace(/\s*\(\d+:\d+\)$/, '') : 'Unrecoverable syntax error';
    const line = err.loc ? err.loc.line : 1;
    const column = err.loc ? err.loc.column + 1 : 1;

    syntaxErrors.push({
      ruleId: 'syntax-error',
      category: 'security',
      severity: 'error',
      message: `Syntax error: ${cleanMessage}`,
      location: { line, column },
      suggestion: 'Fix the syntax error to allow AST parsing.'
    });

    return {
      ast: null,
      syntaxErrors
    };
  }
}
