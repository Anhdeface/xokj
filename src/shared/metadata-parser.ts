/**
 * XOKJ - Userscript Metadata Parser
 * Extracts metadata header block and parses directives including custom @cdp syntax.
 */

import type {
  CdpDeclaration,
  ParsedMetadata,
  ParseResult,
  ParseMetadataResult,
  RunAtTiming
} from './types';

export const DEFAULT_NAME = 'Unnamed Script';
export const DEFAULT_RUN_AT: RunAtTiming = 'document-idle';

export const SUPPORTED_RUN_AT: readonly RunAtTiming[] = [
  'document-start',
  'document-end',
  'document-idle'
] as const;

/**
 * Regex matching the first // ==UserScript== ... // ==/UserScript== block.
 * Uses multiline flag (/m) so ^ matches beginning of line.
 * Allows optional leading spaces/tabs and optional trailing whitespace or comment on delimiter line.
 */
export const HEADER_BLOCK_REGEX =
  /^[ \t]*\/\/[ \t]*==UserScript==[ \t]*(?:\/\/[^\r\n]*)?\r?\n([\s\S]*?)^[ \t]*\/\/[ \t]*==\/UserScript==[ \t]*(?:\/\/[^\r\n]*)?(?:\r?\n|$)/m;

/**
 * Fallback regex to detect an unclosed // ==UserScript== header.
 */
export const UNCLOSED_HEADER_REGEX =
  /^[ \t]*\/\/[ \t]*==UserScript==[ \t]*(?:\/\/[^\r\n]*)?(?:\r?\n|$)([\s\S]*)$/m;

/**
 * Matches a directive line: // @<key>[ <value>]
 */
export const DIRECTIVE_REGEX = /^[ \t]*\/\/[ \t]*@([a-zA-Z0-9_:-]+)(?:[ \t]+(.*))?$/;

/**
 * Matches custom @cdp syntax: <Domain>[.<method>][ <paramsJson>]
 */
export const CDP_DIRECTIVE_REGEX =
  /^([A-Za-z][A-Za-z0-9_]*)(?:\.([A-Za-z0-9_]+))?(?:[ \t]+(.*))?$/;

/**
 * Parses a single @cdp directive value into a structured CdpDeclaration.
 * Normalizes domain shorthand (@cdp Network -> Network.enable with {}).
 * Safely handles malformed JSON without crashing.
 */
export function parseCdpDirective(
  rawVal: string,
  errors: string[]
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
    raw: trimmed
  };
}

/**
 * Normalizes @run-at timing values to standard enum format.
 * Supports underscores and case insensitivity (e.g. "document_start" -> "document-start").
 */
export function normalizeRunAt(val: string, errors: string[]): RunAtTiming {
  const normalized = val.toLowerCase().trim().replace(/_/g, '-');
  if (
    normalized === 'document-start' ||
    normalized === 'document-end' ||
    normalized === 'document-idle'
  ) {
    return normalized as RunAtTiming;
  }
  errors.push(
    `Invalid @run-at value: "${val}". Defaulting to "${DEFAULT_RUN_AT}".`
  );
  return DEFAULT_RUN_AT;
}

/**
 * Parses full userscript source code and returns comprehensive ParseResult.
 */
export function parseUserscript(code: string): ParseResult {
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
      errors.push(
        'Unclosed ==UserScript== metadata block: missing closing ==/UserScript== delimiter.'
      );
      blockContent = unclosedMatch[1];
    } else {
      errors.push('Missing ==UserScript== metadata header block.');
    }
  }

  const metadata: ParsedMetadata = {
    name: DEFAULT_NAME,
    namespace: undefined,
    version: undefined,
    description: undefined,
    author: undefined,
    icon: undefined,
    matches: [],
    matchPatterns: [],
    includes: [],
    excludes: [],
    runAt: DEFAULT_RUN_AT,
    grants: [],
    cdp: [],
    cdpDeclarations: [],
    cdpDomains: [],
    requires: [],
    resources: Object.create(null),
    noframes: false,
    connects: [],
    rawEntries: Object.create(null)
  };

  metadata.matchPatterns = metadata.matches;
  metadata.cdpDeclarations = metadata.cdp;

  if (!hasMetadata || blockContent === null) {
    return {
      hasMetadata: false,
      metadata,
      code: typeof code === 'string' ? code : '',
      errors
    };
  }

  let nameSet = false;
  let runAtSet = false;

  const lines = blockContent.split(/\r?\n/);
  for (const line of lines) {
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

    if (!Object.prototype.hasOwnProperty.call(metadata.rawEntries, key)) {
      metadata.rawEntries[key] = [];
    }
    metadata.rawEntries[key].push(rawVal);

    switch (key) {
      case 'name':
        if (!nameSet && rawVal) {
          metadata.name = rawVal;
          nameSet = true;
        }
        break;
      case 'namespace':
        if (!metadata.namespace && rawVal) {
          metadata.namespace = rawVal;
        }
        break;
      case 'version':
        if (!metadata.version && rawVal) {
          metadata.version = rawVal;
        }
        break;
      case 'description':
        if (!metadata.description && rawVal) {
          metadata.description = rawVal;
        }
        break;
      case 'author':
        if (!metadata.author && rawVal) {
          metadata.author = rawVal;
        }
        break;
      case 'icon':
        if (!metadata.icon && rawVal) {
          metadata.icon = rawVal;
        }
        break;
      case 'match':
        if (rawVal) {
          metadata.matches.push(rawVal);
        }
        break;
      case 'include':
        if (rawVal) {
          metadata.includes.push(rawVal);
        }
        break;
      case 'exclude':
        if (rawVal) {
          metadata.excludes.push(rawVal);
        }
        break;
      case 'run-at':
        if (!runAtSet) {
          metadata.runAt = normalizeRunAt(rawVal, errors);
          runAtSet = true;
        }
        break;
      case 'grant':
        if (rawVal) {
          metadata.grants.push(rawVal);
        }
        break;
      case 'cdp': {
        const decl = parseCdpDirective(rawVal, errors);
        if (decl) {
          metadata.cdp.push(decl);
          if (!metadata.cdpDomains.includes(decl.domain)) {
            metadata.cdpDomains.push(decl.domain);
          }
        }
        break;
      }
      case 'require':
        if (rawVal) {
          metadata.requires.push(rawVal);
        }
        break;
      case 'resource': {
        const parts = rawVal.split(/[ \t]+/);
        if (parts.length >= 2) {
          const resName = parts[0];
          const resUrl = parts.slice(1).join(' ');
          metadata.resources[resName] = resUrl;
        } else if (parts.length === 1 && parts[0]) {
          errors.push(
            `Invalid @resource declaration: "${rawVal}". Expected "<name> <url>"`
          );
        }
        break;
      }
      case 'noframes':
        metadata.noframes = true;
        break;
      case 'connect':
        if (rawVal) {
          metadata.connects.push(rawVal);
        }
        break;
      default:
        break;
    }
  }

  return {
    hasMetadata: true,
    metadata,
    code: typeof code === 'string' ? code : '',
    errors
  };
}

/**
 * Convenience helper returning ParsedMetadata combined with ParseResult fields.
 * Fulfills both PROJECT.md ParsedMetadata return contract and explorer test expectations.
 */
export function parseMetadata(code: string): ParseMetadataResult {
  const result = parseUserscript(code);
  return Object.assign({}, result.metadata, {
    hasMetadata: result.hasMetadata,
    metadata: result.metadata,
    code: result.code,
    errors: result.errors
  });
}
