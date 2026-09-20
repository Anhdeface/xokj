import { describe, it, expect } from 'vitest';
import {
  compileMatchPattern,
  isValidMatchPattern,
  matchesUrl,
  matchesAny,
  isRestrictedUrl,
  normalizeUrl
} from '@/shared/match-pattern';

describe('Feature 5: Chromium Match Pattern Compiler & URL Matching', () => {
  describe('Tier 1: Category-Partition Validation', () => {
    it('T1.1: matches wildcard schemes (* matches http and https only)', () => {
      const pattern = '*://example.com/*';
      expect(matchesUrl(pattern, 'http://example.com/foo')).toBe(true);
      expect(matchesUrl(pattern, 'https://example.com/foo')).toBe(true);
      expect(matchesUrl(pattern, 'ftp://example.com/foo')).toBe(false);
      expect(matchesUrl(pattern, 'file:///example.com/foo')).toBe(false);
    });

    it('T1.2: matches wildcard subdomain *.example.com for root and subdomains', () => {
      const pattern = '*://*.example.com/*';
      expect(matchesUrl(pattern, 'https://example.com/')).toBe(true);
      expect(matchesUrl(pattern, 'https://example.com')).toBe(true);
      expect(matchesUrl(pattern, 'https://sub.example.com/foo')).toBe(true);
      expect(matchesUrl(pattern, 'https://a.b.sub.example.com/foo')).toBe(true);
      expect(matchesUrl(pattern, 'https://notexample.com/foo')).toBe(false);
      expect(matchesUrl(pattern, 'https://fakeexample.com/foo')).toBe(false);
      expect(matchesUrl(pattern, 'https://example.com.evil.com/foo')).toBe(false);
    });

    it('T1.3: matches exact hostname without wildcard', () => {
      const pattern = 'https://example.com/*';
      expect(matchesUrl(pattern, 'https://example.com/test')).toBe(true);
      expect(matchesUrl(pattern, 'https://sub.example.com/test')).toBe(false);
      expect(matchesUrl(pattern, 'http://example.com/test')).toBe(false);
    });

    it('T1.4: matches universal host wildcard *', () => {
      const pattern = '*://*/*';
      expect(matchesUrl(pattern, 'https://github.com/repo')).toBe(true);
      expect(matchesUrl(pattern, 'http://localhost:3000/app')).toBe(true);
      expect(matchesUrl(pattern, 'ftp://files.example.com/')).toBe(false);
    });

    it('T1.5: matches <all_urls> across supported Chromium schemes (http, https, file) and rejects ftp', () => {
      expect(matchesUrl('<all_urls>', 'https://google.com')).toBe(true);
      expect(matchesUrl('<all_urls>', 'http://localhost:8080/')).toBe(true);
      expect(matchesUrl('<all_urls>', 'file:///etc/hosts')).toBe(true);
      expect(matchesUrl('<all_urls>', 'ftp://ftp.example.com/file')).toBe(false);
    });

    it('T1.6: matches path wildcards /* across root, single, and nested segments', () => {
      const pattern = '*://example.com/*';
      expect(matchesUrl(pattern, 'https://example.com/')).toBe(true);
      expect(matchesUrl(pattern, 'https://example.com/abc')).toBe(true);
      expect(matchesUrl(pattern, 'https://example.com/abc/def/ghi')).toBe(true);
      expect(matchesUrl(pattern, 'https://example.com/foo.html')).toBe(true);
    });

    it('T1.7: matches path prefixes and mid-path wildcards', () => {
      expect(matchesUrl('https://example.com/foo/*', 'https://example.com/foo/bar')).toBe(true);
      expect(matchesUrl('https://example.com/foo/*', 'https://example.com/foo/')).toBe(true);
      expect(matchesUrl('https://example.com/foo/*', 'https://example.com/foo')).toBe(false);
      expect(matchesUrl('https://example.com/foo*', 'https://example.com/foo')).toBe(true);
      expect(matchesUrl('https://example.com/foo*', 'https://example.com/foobar')).toBe(true);
      expect(matchesUrl('https://example.com/foo/*/bar', 'https://example.com/foo/123/bar')).toBe(true);
    });

    it('T1.8: matches query strings and hash fragments', () => {
      expect(matchesUrl('https://example.com/search?q=*', 'https://example.com/search?q=test')).toBe(true);
      expect(matchesUrl('https://example.com/*', 'https://example.com/path?foo=bar#section')).toBe(true);
    });

    it('T1.9: matches port-agnostic patterns against URLs with custom ports', () => {
      expect(matchesUrl('*://*.example.com/*', 'https://example.com:8443/test')).toBe(true);
      expect(matchesUrl('http://localhost:3000/*', 'http://localhost:3000/api')).toBe(true);
    });

    it('T1.10: matchesAny returns true on first matching pattern', () => {
      const patterns = ['https://github.com/*', 'https://gitlab.com/*'];
      expect(matchesAny(patterns, 'https://github.com/profile')).toBe(true);
      expect(matchesAny(patterns, 'https://gitlab.com/profile')).toBe(true);
      expect(matchesAny(patterns, 'https://bitbucket.org/profile')).toBe(false);
    });

    it('T1.11: compiles and matches explicit IPv6 host pattern http://[::1]/* safely', () => {
      expect(isValidMatchPattern('http://[::1]/*')).toBe(true);
      expect(() => compileMatchPattern('http://[::1]/*')).not.toThrow();
      expect(matchesUrl('http://[::1]/*', 'http://[::1]/path')).toBe(true);
      expect(matchesUrl('http://[::1]/*', 'http://[::1]:8080/path')).toBe(true);
      expect(matchesUrl('http://[::1]/*', 'http://127.0.0.1/path')).toBe(false);
    });

    it('T1.12: compiles and matches IPv6 host with explicit port http://[::1]:8080/*', () => {
      expect(isValidMatchPattern('http://[::1]:8080/*')).toBe(true);
      expect(() => compileMatchPattern('http://[::1]:8080/*')).not.toThrow();
      expect(matchesUrl('http://[::1]:8080/*', 'http://[::1]:8080/api')).toBe(true);
      expect(matchesUrl('http://[::1]:8080/*', 'http://[::1]:9090/api')).toBe(false);
      expect(matchesUrl('http://[::1]:8080/*', 'http://[::1]/api')).toBe(false);
    });

    it('T1.13: universal host wildcard *://*/* matches IPv6 loopback literal', () => {
      expect(matchesUrl('*://*/*', 'http://[::1]:8080/path')).toBe(true);
      expect(matchesUrl('*://*/*', 'https://[::1]/test')).toBe(true);
    });
  });

  describe('Tier 2: Boundary Values & Security Hardening', () => {
    it('T2.1: rejects restricted Chromium internal URLs unconditionally', () => {
      expect(matchesUrl('<all_urls>', 'chrome://extensions')).toBe(false);
      expect(matchesUrl('<all_urls>', 'chrome-extension://abcdef/popup.html')).toBe(false);
      expect(matchesUrl('<all_urls>', 'edge://flags')).toBe(false);
      expect(matchesUrl('<all_urls>', 'devtools://devtools/bundled/inspector.html')).toBe(false);
      expect(matchesUrl('<all_urls>', 'about:blank')).toBe(false);
      expect(matchesUrl('<all_urls>', 'view-source:https://example.com')).toBe(false);
      expect(matchesUrl('<all_urls>', 'javascript:alert(1)')).toBe(false);
      expect(matchesUrl('<all_urls>', 'data:text/html,hello')).toBe(false);
      expect(matchesUrl('<all_urls>', 'https://chromewebstore.google.com/detail/xyz')).toBe(false);
      expect(matchesUrl('<all_urls>', 'https://chrome.google.com/webstore/detail/xyz')).toBe(false);
    });

    it('T2.2: isValidMatchPattern identifies invalid Chromium patterns', () => {
      expect(isValidMatchPattern('http://example.com')).toBe(false); // missing path
      expect(isValidMatchPattern('http://*foo.com/*')).toBe(false); // invalid host wildcard
      expect(isValidMatchPattern('http://foo.*.com/*')).toBe(false); // wildcard in middle
      expect(isValidMatchPattern('file://*/*')).toBe(false); // host in file scheme
      expect(isValidMatchPattern('file://localhost/*')).toBe(false); // non-empty file host
      expect(isValidMatchPattern('ws://example.com/*')).toBe(false); // unsupported scheme
      expect(isValidMatchPattern('')).toBe(false);
      expect(isValidMatchPattern(null)).toBe(false);
    });

    it('T2.3: compileMatchPattern throws descriptive errors for invalid syntax', () => {
      expect(() => compileMatchPattern('invalid-pattern')).toThrowError(/Invalid match pattern/);
      expect(() => compileMatchPattern('http://')).toThrowError(/Invalid match pattern/);
      expect(() => compileMatchPattern(null as any)).toThrowError(/Match pattern must be a string/);
    });

    it('T2.4: matchesUrl safely handles null/undefined/malformed inputs', () => {
      expect(matchesUrl(null as any, 'https://example.com')).toBe(false);
      expect(matchesUrl('*://example.com/*', null as any)).toBe(false);
      expect(matchesUrl(undefined as any, undefined as any)).toBe(false);
      expect(matchesUrl('*://example.com/*', 'not-a-valid-url')).toBe(false);
    });

    it('T2.5: matchesAny safely handles empty arrays or arrays with invalid patterns', () => {
      expect(matchesAny([], 'https://example.com')).toBe(false);
      expect(matchesAny(['not-a-pattern'], 'https://example.com')).toBe(false);
      expect(matchesAny(['not-a-pattern', '*://example.com/*'], 'https://example.com/')).toBe(true);
    });

    it('T2.6: rejects ftp:// scheme in match patterns per Manifest V3 specification', () => {
      expect(isValidMatchPattern('ftp://example.com/*')).toBe(false);
      expect(isValidMatchPattern('ftp://*/*')).toBe(false);
      expect(() => compileMatchPattern('ftp://example.com/*')).toThrowError(/Invalid match pattern syntax/);
      expect(() => compileMatchPattern('ftp://*/*')).toThrowError(/Invalid match pattern syntax/);
    });

    it('T2.7: identifies blob: and chrome-untrusted: URLs as restricted', () => {
      const blobUrl = 'blob:https://example.com/00000000-0000-0000-0000-000000000000';
      const untrustedUrl = 'chrome-untrusted://terminal/index.html';

      expect(isRestrictedUrl(blobUrl)).toBe(true);
      expect(isRestrictedUrl(untrustedUrl)).toBe(true);

      expect(matchesUrl('<all_urls>', blobUrl)).toBe(false);
      expect(matchesUrl('<all_urls>', untrustedUrl)).toBe(false);

      expect(isValidMatchPattern('blob:*')).toBe(false);
      expect(isValidMatchPattern('blob://*/*')).toBe(false);
      expect(isValidMatchPattern('chrome-untrusted://*/*')).toBe(false);
    });

    it('T2.8: collapses redundant path wildcards to prevent ReDoS', () => {
      const t0 = performance.now();
      const re = compileMatchPattern('*://example.com' + '/*'.repeat(30));
      const res = re.test('http://example.com/a/b/c');
      const duration = performance.now() - t0;
      expect(res).toBe(true);
      expect(duration).toBeLessThan(20);
      expect(isValidMatchPattern('https://example.com/*/*/*/*/*')).toBe(true);
      expect(matchesUrl('https://example.com/*/*/*/*/*', 'https://example.com/a/b/c/d/e')).toBe(true);
    });
  });
});
