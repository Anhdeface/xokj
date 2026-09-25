/**
 * Chromium Match Pattern Engine
 * Compiles <scheme>://<host><path> and <all_urls> into RegExp
 * supporting wildcard subdomains, path wildcards, IPv6 literal hosts,
 * and restricted URL rejection.
 */

const RESTRICTED_SCHEMES = [
  'chrome:',
  'chrome-extension:',
  'chrome-untrusted:',
  'edge:',
  'devtools:',
  'about:',
  'view-source:',
  'javascript:',
  'data:',
  'blob:'
];

/**
 * Checks if a target URL is restricted by Chromium security policies.
 * Extensions cannot inject scripts into internal or web store pages.
 */
export function isRestrictedUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return true;
  try {
    const parsed = new URL(url);
    if (RESTRICTED_SCHEMES.includes(parsed.protocol)) {
      return true;
    }
    if (
      parsed.hostname === 'chromewebstore.google.com' ||
      (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'))
    ) {
      return true;
    }
    return false;
  } catch {
    const lower = url.toLowerCase().trim();
    for (const scheme of RESTRICTED_SCHEMES) {
      if (lower.startsWith(scheme)) return true;
    }
    return true;
  }
}

/**
 * Normalizes URL string for consistent pattern matching.
 * Resolves root paths (e.g. https://example.com -> https://example.com/)
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.href;
  } catch {
    return url;
  }
}

export const MAX_MATCH_PATTERN_CACHE_SIZE = 1000;
const patternCache = new Map<string, RegExp>();

/**
 * Clears the compiled match pattern cache. Useful for test isolation.
 */
export function clearMatchPatternCache(): void {
  patternCache.clear();
}

/**
 * Compiles a Chromium match pattern into a RegExp.
 * Throws an Error if the pattern violates Chromium match pattern syntax.
 * Results are cached in a bounded Map (max 1000 entries) with LRU eviction.
 */
export function compileMatchPattern(pattern: string): RegExp {
  if (typeof pattern !== 'string') {
    throw new Error('Match pattern must be a string');
  }

  const cached = patternCache.get(pattern);
  if (cached) {
    // Refresh LRU order: delete and re-insert
    patternCache.delete(pattern);
    patternCache.set(pattern, cached);
    return cached;
  }

  const trimmed = pattern.trim();

  let compiled: RegExp;
  if (trimmed === '<all_urls>') {
    compiled = /^(?:https?|file):\/\/.+$/;
  } else {
    // Strict structural pattern: <scheme>://<host><path>
    // In Manifest V3 userscripts, valid schemes are *, http, https, file (ftp is disallowed)
    const match = trimmed.match(/^(\*|https?|file):\/\/([^\/]*?)(\/.*)$/);
    if (!match) {
      throw new Error(
        `Invalid match pattern syntax: "${pattern}". Expected "<scheme>://<host><path>" or "<all_urls>"`
      );
    }

  const [, scheme, rawHostWithPort, path] = match;

  let schemeRegex = '';
  if (scheme === '*') {
    // Wildcard scheme matches ONLY http or https in Chromium
    schemeRegex = 'https?';
  } else if (['http', 'https', 'file'].includes(scheme)) {
    schemeRegex = scheme;
  } else {
    throw new Error(`Invalid scheme in match pattern: "${scheme}"`);
  }

  let hostRegex = '';
  if (scheme === 'file') {
    if (rawHostWithPort !== '') {
      throw new Error(`File scheme match pattern host must be empty (e.g. file:///path), got "${rawHostWithPort}"`);
    }
    hostRegex = '';
  } else {
    if (!rawHostWithPort) {
      throw new Error(`Host cannot be empty for scheme "${scheme}"`);
    }

    const hostWithPort = rawHostWithPort.toLowerCase();
    let host = hostWithPort;
    let port = '';

    if (hostWithPort.startsWith('[')) {
      const closeBracketIdx = hostWithPort.indexOf(']');
      if (closeBracketIdx === -1) {
        throw new Error(`Invalid IPv6 host in match pattern: "${hostWithPort}"`);
      }
      host = hostWithPort.slice(0, closeBracketIdx + 1);
      const ipv6Content = hostWithPort.slice(1, closeBracketIdx);
      if (!ipv6Content) {
        throw new Error(`Empty IPv6 host in match pattern: "${hostWithPort}"`);
      }
      if (host.includes('*')) {
        throw new Error(`Wildcard '*' is not allowed in IPv6 host: "${host}"`);
      }
      const rest = hostWithPort.slice(closeBracketIdx + 1);
      if (rest.startsWith(':')) {
        port = rest.slice(1);
        if (port !== '*' && !/^\d+$/.test(port)) {
          throw new Error(`Invalid port in match pattern: "${port}"`);
        }
      } else if (rest !== '') {
        throw new Error(`Invalid characters after IPv6 host in match pattern: "${hostWithPort}"`);
      }
    } else {
      if (hostWithPort.includes('[') || hostWithPort.includes(']')) {
        throw new Error(`Invalid host syntax in match pattern: "${hostWithPort}"`);
      }
      const colonIdx = hostWithPort.lastIndexOf(':');
      if (colonIdx !== -1) {
        host = hostWithPort.slice(0, colonIdx);
        port = hostWithPort.slice(colonIdx + 1);
        if (port !== '*' && !/^\d+$/.test(port)) {
          throw new Error(`Invalid port in match pattern: "${port}"`);
        }
      }
    }

    if (!host) {
      throw new Error(`Host cannot be empty in match pattern: "${pattern}"`);
    }

    if (host === '*') {
      hostRegex = '(?:\\[[^\\]]+\\]|[^/:]+)';
    } else if (host.startsWith('*.')) {
      const rootDomain = host.slice(2);
      if (!rootDomain || rootDomain.includes('*') || rootDomain.startsWith('.')) {
        throw new Error(`Invalid host wildcard in match pattern: "${host}"`);
      }
      const escapedRoot = rootDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      hostRegex = `(?:[^/:]+\\.)?${escapedRoot}`;
    } else {
      if (host.includes('*')) {
        throw new Error(`Wildcard '*' in host is only allowed as standalone '*' or prefix '*.': "${host}"`);
      }
      hostRegex = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    if (port) {
      if (port === '*') {
        hostRegex += '(?::\\d+)?';
      } else {
        hostRegex += `:${port}`;
      }
    } else {
      hostRegex += '(?::\\d+)?';
    }
  }

  if (!path.startsWith('/')) {
    throw new Error(`Path must start with '/': "${path}"`);
  }

  const normalizedPath = path.replace(/\*+/g, '*').replace(/(?:\/\*)+/g, '/*');

  const pathParts = normalizedPath.split('*');
  const escapedParts = pathParts.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  const pathRegex = escapedParts.join('.*');

    compiled = new RegExp(`^${schemeRegex}:\\/\\/${hostRegex}${pathRegex}$`);
  }

  if (patternCache.size >= MAX_MATCH_PATTERN_CACHE_SIZE) {
    const oldestKey = patternCache.keys().next().value;
    if (oldestKey !== undefined) {
      patternCache.delete(oldestKey);
    }
  }
  patternCache.set(pattern, compiled);

  return compiled;
}

/**
 * Validates whether a pattern string is a syntactically valid Chromium match pattern.
 */
export function isValidMatchPattern(pattern: unknown): boolean {
  if (typeof pattern !== 'string' || !pattern.trim()) {
    return false;
  }
  try {
    compileMatchPattern(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tests whether a URL matches a given Chromium match pattern.
 * Safely handles invalid patterns and URLs by returning false.
 */
export function matchesUrl(pattern: string, url: string): boolean {
  if (typeof pattern !== 'string' || typeof url !== 'string') {
    return false;
  }
  if (isRestrictedUrl(url)) {
    return false;
  }

  const normalized = normalizeUrl(url);

  try {
    const re = compileMatchPattern(pattern);
    return re.test(normalized);
  } catch {
    return false;
  }
}

/**
 * Tests whether a URL matches any pattern in a list of Chromium match patterns.
 * Gracefully ignores malformed patterns in the list.
 */
export function matchesAny(patterns: string[], url: string): boolean {
  if (!Array.isArray(patterns) || patterns.length === 0 || typeof url !== 'string') {
    return false;
  }
  if (isRestrictedUrl(url)) {
    return false;
  }

  const normalized = normalizeUrl(url);

  for (const pattern of patterns) {
    if (typeof pattern !== 'string') continue;
    try {
      const re = compileMatchPattern(pattern);
      if (re.test(normalized)) {
        return true;
      }
    } catch {}
  }

  return false;
}
