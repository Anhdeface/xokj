/**
 * XoBrow - Standalone Userscript Metadata Header Parser
 * Extracts metadata header block and parses directives including custom @cdp syntax.
 */

import type { CodeLocation, ParsedMetadata, CdpDeclaration } from '../types.js';

export interface ParseMetadataResult extends ParsedMetadata {
  namespace?: string;
  version?: string;
  description?: string;
  author?: string;
  icon?: string;
  matches: string[];
  matchPatterns: string[];
  includes: string[];
  excludes: string[];
  runAt: 'document-start' | 'document-end' | 'document-idle';
  cdp: CdpDeclaration[];
  cdpDeclarations: CdpDeclaration[];
  requires: string[];
  resources: Record<string, string>;
  noframes: boolean;
  connects: string[];
  rawEntries: Record<string, string[]>;
  hasMetadata: boolean;
  errors: string[];
}

export const DEFAULT_NAME = 'Unnamed Script';
export const DEFAULT_RUN_AT = 'document-idle';

export const HEADER_BLOCK_REGEX =
  /^[ \t]*\/\/[ \t]*==UserScript==[ \t]*(?:\/\/[^\r\n]*)?\r?\n([\s\S]*?)^[ \t]*\/\/[ \t]*==\/UserScript==[ \t]*(?:\/\/[^\r\n]*)?(?:\r?\n|$)/m;

export const UNCLOSED_HEADER_REGEX =
  /^[ \t]*\/\/[ \t]*==UserScript==[ \t]*(?:\/\/[^\r\n]*)?(?:\r?\n|$)([\s\S]*)$/m;

export const DIRECTIVE_REGEX = /^[ \t]*\/\/[ \t]*@([a-zA-Z0-9_:-]+)(?:[ \t]+(.*))?$/;

export const CDP_DIRECTIVE_REGEX =
  /^([A-Za-z][A-Za-z0-9_]*)(?:\.([A-Za-z0-9_]+))?(?:[ \t]+(.*))?$/;

/**
 * Parses a single @cdp directive value into a structured CdpDeclaration.
 */
export function parseCdpDirective(
  rawVal: string,
  errors: string[],
  lineIndex?: number
): CdpDeclaration | null {
  const trimmed = rawVal.trim();
  if (!trimmed) {
    errors.push('Empty @cdp directive');
    return null;
  }

  const match = trimmed.match(CDP_DIRECTIVE_REGEX);
  if (!match) {
    errors.push(
      `Invalid @cdp syntax: "${trimmed}". Expected "@cdp <Domain>[.<method>] [paramsJson]"`
    );
    return null;
  }

  const domain = match[1];
  const method = match[2] || 'enable';
  const command = `${domain}.${method}`;
  const rawParams = match[3] ? match[3].trim() : '';

  let params: Record<string, unknown> = {};
  if (rawParams) {
    try {
      const parsed = JSON.parse(rawParams);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        errors.push(
          `Invalid @cdp params for "${command}": must be a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`
        );
      } else {
        params = parsed as Record<string, unknown>;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`JSON parse error in @cdp directive "${trimmed}": ${message}`);
    }
  }

  return {
    domain,
    method,
    command,
    params,
    raw: trimmed,
    location: lineIndex !== undefined ? { line: lineIndex, column: 1 } : undefined
  };
}

/**
 * Normalizes @run-at timing values.
 */
export function normalizeRunAt(val: string, errors: string[]): 'document-start' | 'document-end' | 'document-idle' {
  const normalized = val.toLowerCase().trim().replace(/_/g, '-');
  if (
    normalized === 'document-start' ||
    normalized === 'document-end' ||
    normalized === 'document-idle'
  ) {
    return normalized as 'document-start' | 'document-end' | 'document-idle';
  }
  errors.push(`Invalid @run-at value: "${val}". Defaulting to "${DEFAULT_RUN_AT}".`);
  return DEFAULT_RUN_AT;
}

/**
 * Parses userscript source code and returns ParseMetadataResult conforming
 * to both ParsedMetadata in PROJECT.md and extended fields.
 */
export function parseUserscriptMetadata(code: string): ParseMetadataResult {
  const cleanCode = typeof code === 'string' ? code.replace(/^\uFEFF/, '') : '';
  const errors: string[] = [];
  let blockContent: string | null = null;
  let hasMetadata = false;

  const blockMatch = cleanCode.match(HEADER_BLOCK_REGEX);
  if (blockMatch) {
    hasMetadata = true;
    blockContent = blockMatch[1];
  } else {
    const unclosedMatch = cleanCode.match(UNCLOSED_HEADER_REGEX);
    if (unclosedMatch) {
      hasMetadata = true;
      errors.push('Unclosed ==UserScript== metadata block: missing closing ==/UserScript== delimiter.');
      blockContent = unclosedMatch[1];
    } else {
      errors.push('Missing ==UserScript== metadata header block.');
    }
  }

  const rawHeaders: Record<string, string[]> = Object.create(null);
  const grants: string[] = [];
  const cdpDomains: string[] = [];
  const cdpMethods: string[] = [];
  const cdpDeclarations: CdpDeclaration[] = [];
  const matches: string[] = [];
  const includes: string[] = [];
  const excludes: string[] = [];
  const requires: string[] = [];
  const connects: string[] = [];
  const resources: Record<string, string> = Object.create(null);

  let scriptName = DEFAULT_NAME;
  let namespace: string | undefined;
  let version: string | undefined;
  let description: string | undefined;
  let author: string | undefined;
  let icon: string | undefined;
  let runAt: 'document-start' | 'document-end' | 'document-idle' = DEFAULT_RUN_AT;
  let noframes = false;
  let nameSet = false;
  let runAtSet = false;

  if (hasMetadata && blockContent !== null) {
    const lines = blockContent.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('//')) {
        continue;
      }

      const match = line.match(DIRECTIVE_REGEX);
      if (!match) {
        continue;
      }

      const key = match[1].toLowerCase();
      const rawVal = match[2] !== undefined ? match[2].trim() : '';

      if (!rawHeaders[key]) {
        rawHeaders[key] = [];
      }
      rawHeaders[key].push(rawVal);

      switch (key) {
        case 'name':
          if (!nameSet && rawVal) {
            scriptName = rawVal;
            nameSet = true;
          }
          break;
        case 'namespace':
          if (!namespace && rawVal) namespace = rawVal;
          break;
        case 'version':
          if (!version && rawVal) version = rawVal;
          break;
        case 'description':
          if (!description && rawVal) description = rawVal;
          break;
        case 'author':
          if (!author && rawVal) author = rawVal;
          break;
        case 'icon':
          if (!icon && rawVal) icon = rawVal;
          break;
        case 'match':
          if (rawVal) matches.push(rawVal);
          break;
        case 'include':
          if (rawVal) includes.push(rawVal);
          break;
        case 'exclude':
          if (rawVal) excludes.push(rawVal);
          break;
        case 'run-at':
          if (!runAtSet) {
            runAt = normalizeRunAt(rawVal, errors);
            runAtSet = true;
          }
          break;
        case 'grant':
          if (rawVal) grants.push(rawVal);
          break;
        case 'cdp': {
          const decl = parseCdpDirective(rawVal, errors, i + 1);
          if (decl) {
            cdpDeclarations.push(decl);
            if (!cdpDomains.includes(decl.domain)) {
              cdpDomains.push(decl.domain);
            }
            if (!cdpMethods.includes(decl.command)) {
              cdpMethods.push(decl.command);
            }
          }
          break;
        }
        case 'require':
          if (rawVal) requires.push(rawVal);
          break;
        case 'resource': {
          const parts = rawVal.split(/[ \t]+/);
          if (parts.length >= 2) {
            resources[parts[0]] = parts.slice(1).join(' ');
          } else if (parts.length === 1 && parts[0]) {
            errors.push(`Invalid @resource declaration: "${rawVal}". Expected "<name> <url>"`);
          }
          break;
        }
        case 'noframes':
          noframes = true;
          break;
        case 'connect':
          if (rawVal) connects.push(rawVal);
          break;
        default:
          break;
      }
    }
  }

  return {
    name: scriptName,
    namespace,
    version,
    description,
    author,
    icon,
    grants,
    cdpDomains,
    cdpMethods,
    matches,
    matchPatterns: matches,
    includes,
    excludes,
    runAt,
    cdp: cdpDeclarations,
    cdpDeclarations,
    requires,
    resources,
    noframes,
    connects,
    rawHeaders,
    rawEntries: rawHeaders,
    hasHeader: hasMetadata,
    hasMetadata,
    errors
  };
}
