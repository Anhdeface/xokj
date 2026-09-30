/**
 * XoBrow Static Analysis & Security Audit Tool
 * Core Interface Contracts & Domain Types
 */

// ==========================================
// 1. Severity & Categories
// ==========================================

export type Severity = 'error' | 'warning' | 'info';

export type RuleCategory = 'security' | 'resource-leak' | 'cdp-integrity';

export const VALID_SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'] as const;

export const VALID_CATEGORIES: readonly RuleCategory[] = [
  'security',
  'resource-leak',
  'cdp-integrity'
] as const;

export function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && VALID_SEVERITIES.includes(value as Severity);
}

export function isRuleCategory(value: unknown): value is RuleCategory {
  return typeof value === 'string' && VALID_CATEGORIES.includes(value as RuleCategory);
}

// ==========================================
// 2. Code Location & Diagnostics
// ==========================================

export interface CodeLocation {
  /** 1-indexed line number where the violation starts */
  line: number;
  /** 1-indexed column number where the violation starts */
  column: number;
  /** Optional 1-indexed line number where the violation ends */
  endLine?: number;
  /** Optional 1-indexed column number where the violation ends */
  endColumn?: number;
}

export interface RuleDiagnostic {
  /** Unique rule identifier, e.g. 'sec-no-eval' */
  ruleId: string;
  /** Rule category */
  category: RuleCategory;
  /** Diagnostic severity */
  severity: Severity;
  /** Human-readable explanation of the violation */
  message: string;
  /** 1-indexed source code coordinate */
  location: CodeLocation;
  /** Actionable remediation recommendation (rendered as `= suggestion: ...`) */
  suggestion: string;
  /** Optional verbatim code snippet or offending token string */
  codeSnippet?: string;
}

export interface ReportDescriptor {
  /** Human-readable explanation of the violation */
  message: string;
  /** 1-indexed source code coordinate */
  location: CodeLocation;
  /** Actionable remediation recommendation */
  suggestion: string;
  /** Optional severity override (defaults to rule's defaultSeverity) */
  severity?: Severity;
  /** Optional verbatim code snippet or offending token string */
  codeSnippet?: string;
}

// ==========================================
// 3. Userscript Metadata Types
// ==========================================

export interface CdpDeclaration {
  domain: string;
  method: string;
  command: string;
  params: Record<string, unknown>;
  raw?: string;
  location?: CodeLocation;
}

export interface ParsedMetadata {
  /** Script name from @name, or default 'Unnamed Script' */
  name?: string;
  /** Namespace from @namespace */
  namespace?: string;
  /** Version from @version */
  version?: string;
  /** Description from @description */
  description?: string;
  /** Author from @author */
  author?: string;
  /** Icon from @icon */
  icon?: string;
  /** Declared @grant privileges (e.g. ['none'], ['GM_cdp'], ['GM_setValue']) */
  grants: string[];
  /** Declared CDP domains (e.g. ['Network', 'Page', 'Fetch']) */
  cdpDomains: string[];
  /** Declared CDP methods (e.g. ['Page.navigate', 'Network.enable']) */
  cdpMethods: string[];
  /** Structured @cdp declarations */
  cdpDeclarations?: CdpDeclaration[];
  /** @cdp declarations alias */
  cdp?: CdpDeclaration[];
  /** Target match patterns */
  matches?: string[];
  matchPatterns?: string[];
  /** Included URL patterns */
  includes?: string[];
  /** Excluded URL patterns */
  excludes?: string[];
  /** Run-at execution timing */
  runAt?: 'document-start' | 'document-end' | 'document-idle';
  /** External script URLs from @require */
  requires?: string[];
  /** Named resources from @resource */
  resources?: Record<string, string>;
  /** Noframes flag */
  noframes?: boolean;
  /** Allowed connect domains */
  connects?: string[];
  /** Raw header directive map */
  rawHeaders: Record<string, string[]>;
  /** Raw header entries alias for compatibility */
  rawEntries?: Record<string, string[]>;
  /** True if a valid // ==UserScript== header block was detected */
  hasHeader: boolean;
  /** Alias for hasHeader */
  hasMetadata?: boolean;
  /** Header extraction warnings or errors */
  errors?: string[];
}

// ==========================================
// 4. Rule Context & Visitor Framework
// ==========================================

export interface RuleContext {
  /** Absolute or normalized relative path to the file being scanned */
  filePath: string;
  /** Entire raw source code string */
  sourceCode: string;
  /** Array of lines split from sourceCode (0-indexed array, lines[0] is line 1) */
  lines: string[];
  /** Parsed userscript header metadata */
  metadata: ParsedMetadata;
  /** True if userscript metadata header block was present */
  hasMetadata: boolean;
  /** Report callback to record a violation */
  report: (descriptor: ReportDescriptor) => void;
}

export interface NodeVisitor {
  /** Specific AST node visitor handlers (e.g. CallExpression, AssignmentExpression, WhileStatement) */
  [nodeType: string]: ((node: any, parent?: any, ancestors?: any[]) => void) | undefined;
  /** Pre-order traversal hook invoked before entering any node */
  onEnter?: (node: any, parent?: any, ancestors?: any[]) => void;
  /** Post-order traversal hook invoked after leaving any node */
  onLeave?: (node: any, parent?: any, ancestors?: any[]) => void;
  /**
   * Lifecycle hook executed after the complete AST traversal finishes.
   * Essential for resource leak rules reconciling paired lifecycles
   * (e.g. addEventListener vs removeEventListener, setInterval vs clearInterval).
   */
  postCheck?: () => void;
}

export interface RuleDefinition {
  /** Unique kebab-case identifier, e.g. 'sec-no-eval' */
  id: string;
  /** Human-readable title of the rule */
  name: string;
  /** Category group */
  category: RuleCategory;
  /** Default severity when reported */
  defaultSeverity: Severity;
  /** Comprehensive description of the security/leak hazard */
  description: string;
  /** Factory creating a per-file NodeVisitor instance */
  create: (context: RuleContext) => NodeVisitor;
}

// ==========================================
// 5. Scanner Engine Contracts
// ==========================================

export interface ScanOptions {
  /** If true, treats all warnings as errors (elevating exit code to 1) */
  strict?: boolean;
  /** Custom list of rules to run (defaults to all registered rules) */
  rules?: RuleDefinition[];
  /** Predicate filter to selectively enable/disable rules */
  ruleFilter?: (rule: RuleDefinition) => boolean;
}

export interface FileScanResult {
  /** Path of the scanned file */
  filePath: string;
  /** All diagnostics collected for this file */
  diagnostics: RuleDiagnostic[];
  /** Number of error-level diagnostics */
  errorCount: number;
  /** Number of warning-level diagnostics */
  warningCount: number;
  /** True if errorCount > 0 */
  hasErrors?: boolean;
  /** True if warningCount > 0 */
  hasWarnings?: boolean;
}

export interface ScanSummary {
  /** Scan results for each individual file */
  results: FileScanResult[];
  /** Total number of files scanned */
  totalFiles: number;
  /** Total error violations across all files */
  totalErrors: number;
  /** Total warning violations across all files */
  totalWarnings: number;
  /** True if 0 errors (and 0 warnings in strict mode) */
  clean: boolean;
  /**
   * Process exit code:
   * 0: clean pass (no errors, no warnings in strict mode)
   * 1: violations detected (errors present, or warnings present with strict mode)
   * 2: operational CLI error (bad flags, file not found, unreadable file, zero glob matches)
   */
  exitCode: number;
}

// ==========================================
// 6. Formatter & CLI Contracts
// ==========================================

export type OutputFormat = 'stylish' | 'json';

export interface FormatterOptions {
  /** Output style: 'stylish' (ASCII code frames with carets) or 'json' (machine readable) */
  format?: OutputFormat;
  /** Suppress non-essential summary and warnings */
  quiet?: boolean;
  /** Force enable or disable ANSI color escape codes */
  color?: boolean;
}

export interface CliOptions {
  command: string;
  patterns: string[];
  strict: boolean;
  format: OutputFormat;
  quiet: boolean;
  version?: boolean;
  help?: boolean;
}

// ==========================================
// 7. Coordinate Mapping Helper Utilities
// ==========================================

/**
 * Normalizes Babel AST node coordinates to 1-indexed CodeLocation.
 * Babel loc format: { line: 1-indexed, column: 0-indexed }.
 */
export function fromBabelLoc(loc?: {
  start?: { line: number; column: number };
  end?: { line: number; column: number };
}): CodeLocation {
  if (!loc || !loc.start) {
    return { line: 1, column: 1 };
  }
  return {
    line: loc.start.line,
    column: loc.start.column + 1, // Babel is 0-indexed, XoBrow is 1-indexed
    endLine: loc.end ? loc.end.line : undefined,
    endColumn: loc.end ? loc.end.column + 1 : undefined
  };
}
