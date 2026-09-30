import { describe, it, expect } from 'vitest';
import { scanFile } from '../../../src/engine/scanner.js';
import {
  CDP_DOMAINS,
  isKnownCdpDomain,
  isKnownCdpMethod,
  validateCdpCommand,
  cdpValidDomainMethod,
  cdpHeaderPermission,
  cdpHandledAsyncReject,
  cdpNoTightPolling,
  cdpValidPayload
} from '../../../src/rules/cdp/index.js';

describe('Category 3: CDP Integrity Rules & Catalog Unit Test Suite', () => {
  describe('CDP Catalog (cdp-catalog.ts)', () => {
    it('contains standard core CDP domains', () => {
      expect(isKnownCdpDomain('Page')).toBe(true);
      expect(isKnownCdpDomain('DOM')).toBe(true);
      expect(isKnownCdpDomain('Network')).toBe(true);
      expect(isKnownCdpDomain('Runtime')).toBe(true);
      expect(isKnownCdpDomain('Target')).toBe(true);
      expect(isKnownCdpDomain('Fetch')).toBe(true);
      expect(isKnownCdpDomain('Storage')).toBe(true);
      expect(isKnownCdpDomain('Browser')).toBe(true);
      expect(isKnownCdpDomain('InvalidDomainXYZ')).toBe(false);
    });

    it('validates official methods on standard domains', () => {
      expect(isKnownCdpMethod('Page', 'navigate')).toBe(true);
      expect(isKnownCdpMethod('DOM', 'getDocument')).toBe(true);
      expect(isKnownCdpMethod('Network', 'enable')).toBe(true);
      expect(isKnownCdpMethod('Runtime', 'evaluate')).toBe(true);
      expect(isKnownCdpMethod('Page', 'nonExistentMethod')).toBe(false);
    });

    it('provides Levenshtein typo suggestion for misspelled methods', () => {
      const result = validateCdpCommand('Page.navgate');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('UNKNOWN_METHOD');
      expect(result.suggestion).toContain('Did you mean "Page.navigate"?');
    });

    it('provides Levenshtein typo suggestion for misspelled domains', () => {
      const result = validateCdpCommand('Pge.navigate');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('UNKNOWN_DOMAIN');
      expect(result.suggestion).toContain('Did you mean domain "Page"?');
    });

    it('rejects commands without Domain.method format', () => {
      const result = validateCdpCommand('noDotCommand');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('INVALID_FORMAT');
    });
  });

  describe('Rule: cdp-valid-domain-method', () => {
    it('flags unknown domain in cdp.send', () => {
      const code = `
        async function test() {
          await cdp.send('InvalidDomain.fakeMethod', {});
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpValidDomainMethod] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-valid-domain-method');
      expect(result.diagnostics[0].message).toContain('Unknown CDP domain "InvalidDomain"');
    });

    it('flags unknown method on valid domain in cdp.send', () => {
      const code = `
        async function test() {
          await cdp.send('Page.nonExistentAction', {});
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpValidDomainMethod] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-valid-domain-method');
      expect(result.diagnostics[0].message).toContain('Unknown CDP method "nonExistentAction" on domain "Page"');
    });

    it('flags unknown domain in GM_cdp', () => {
      const code = `
        GM_cdp('FakeDomain.method', {});
      `;
      const result = scanFile('test.js', code, { rules: [cdpValidDomainMethod] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-valid-domain-method');
    });

    it('allows valid CDP domain and method invocations', () => {
      const code = `
        async function test() {
          await cdp.send('Page.navigate', { url: 'https://example.com' });
          await cdp.send('DOM.getDocument', {});
          await cdp.send('Network.enable');
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpValidDomainMethod] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('safely ignores dynamic expressions to prevent false positives', () => {
      const code = `
        async function test(dynamicCmd) {
          await cdp.send(dynamicCmd, {});
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpValidDomainMethod] });
      expect(result.errorCount).toBe(0);
    });

    it('flags invalid domain/method in optional call cdp?.send?.(...)', () => {
      const code = `
        async function test() {
          await cdp?.send?.('InvalidDomain.fakeMethod', {});
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpValidDomainMethod] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-valid-domain-method');
      expect(result.diagnostics[0].message).toContain('Unknown CDP domain "InvalidDomain"');
    });
  });

  describe('Rule: cdp-header-permission', () => {
    it('flags CDP calls when metadata declares @grant none', () => {
      const code = `// ==UserScript==
// @name Test
// @grant none
// ==/UserScript==
cdp.send('Page.navigate', { url: 'https://example.com' });
`;
      const result = scanFile('test.js', code, { rules: [cdpHeaderPermission] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-header-permission');
      expect(result.diagnostics[0].message).toContain('@grant none');
    });

    it('flags CDP calls when invoked domain is not declared in @cdp', () => {
      const code = `// ==UserScript==
// @name Test
// @cdp Page
// ==/UserScript==
cdp.send('Network.enable', {});
`;
      const result = scanFile('test.js', code, { rules: [cdpHeaderPermission] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-header-permission');
      expect(result.diagnostics[0].message).toContain('Unauthorized CDP domain');
    });

    it('flags CDP calls when metadata header is missing entirely', () => {
      const code = `
        cdp.send('Page.navigate', { url: 'https://example.com' });
      `;
      const result = scanFile('test.js', code, { rules: [cdpHeaderPermission] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-header-permission');
      expect(result.diagnostics[0].message).toContain('Missing userscript metadata header');
    });

    it('allows CDP calls when @grant GM_cdp is declared', () => {
      const code = `// ==UserScript==
// @name Test
// @grant GM_cdp
// ==/UserScript==
cdp.send('Page.navigate', { url: 'https://example.com' });
cdp.send('Network.enable', {});
`;
      const result = scanFile('test.js', code, { rules: [cdpHeaderPermission] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('allows CDP calls matching declared @cdp domains', () => {
      const code = `// ==UserScript==
// @name Test
// @cdp Page
// @cdp DOM
// ==/UserScript==
cdp.send('Page.navigate', { url: 'https://example.com' });
cdp.send('DOM.getDocument', {});
`;
      const result = scanFile('test.js', code, { rules: [cdpHeaderPermission] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('flags unauthorized domain in optional call cdp?.send?.(...)', () => {
      const code = `// ==UserScript==
// @name Test
// @cdp Page
// ==/UserScript==
cdp?.send?.('Network.enable', {});
`;
      const result = scanFile('test.js', code, { rules: [cdpHeaderPermission] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-header-permission');
    });
  });

  describe('Rule: cdp-handled-async-reject', () => {
    it('flags naked floating cdp.send promise with warning severity', () => {
      const code = `
        function run() {
          cdp.send('Page.navigate', { url: 'https://example.com' });
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpHandledAsyncReject] });
      expect(result.errorCount).toBe(0);
      expect(result.warningCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-handled-async-reject');
      expect(result.diagnostics[0].severity).toBe('warning');
      expect(result.diagnostics[0].message).toContain('Unhandled CDP promise');
    });

    it('flags unawaited cdp.send inside try/catch because sync try/catch misses promise rejections', () => {
      const code = `
        function run() {
          try {
            cdp.send('Page.navigate', {});
          } catch (err) {
            console.error(err);
          }
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpHandledAsyncReject] });
      expect(result.warningCount).toBe(1);
    });

    it('allows awaited cdp.send call', () => {
      const code = `
        async function run() {
          try {
            await cdp.send('Page.navigate', { url: 'https://example.com' });
          } catch (err) {
            console.error(err);
          }
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpHandledAsyncReject] });
      expect(result.warningCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('allows cdp.send with chained .catch() error handler', () => {
      const code = `
        cdp.send('Page.navigate', { url: 'https://example.com' })
          .catch((err) => console.error('Failed:', err));
      `;
      const result = scanFile('test.js', code, { rules: [cdpHandledAsyncReject] });
      expect(result.warningCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('allows cdp.send returned from a function or inside Promise.all', () => {
      const code = `
        function navigate(url) {
          return cdp.send('Page.navigate', { url });
        }
        function batch() {
          return Promise.all([
            cdp.send('Page.enable'),
            cdp.send('DOM.enable')
          ]);
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpHandledAsyncReject] });
      expect(result.warningCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('flags unhandled promise in optional call cdp?.send?.(...)', () => {
      const code = `
        function run() {
          cdp?.send?.('Page.navigate', { url: 'https://example.com' });
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpHandledAsyncReject] });
      expect(result.warningCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-handled-async-reject');
    });
  });

  describe('Rule: cdp-no-tight-polling', () => {
    it('flags setInterval with delay < 100ms containing CDP calls', () => {
      const code = `
        const timer = setInterval(async () => {
          await cdp.send('Page.getLayoutMetrics', {});
        }, 10);
      `;
      const result = scanFile('test.js', code, { rules: [cdpNoTightPolling] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-no-tight-polling');
      expect(result.diagnostics[0].message).toContain('10ms');
    });

    it('flags setInterval with omitted interval (0ms default)', () => {
      const code = `
        setInterval(() => {
          cdp.send('DOM.getDocument', {});
        });
      `;
      const result = scanFile('test.js', code, { rules: [cdpNoTightPolling] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-no-tight-polling');
    });

    it('flags loops with backoff delay < 100ms containing CDP calls', () => {
      const code = `
        async function poll() {
          while (true) {
            await cdp.send('Page.captureScreenshot', {});
            await delay(50);
          }
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpNoTightPolling] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-no-tight-polling');
      expect(result.diagnostics[0].message).toContain('50ms');
    });

    it('allows intervals and loop delays >= 100ms (e.g. 500ms, 1000ms)', () => {
      const code = `
        const timer = setInterval(async () => {
          await cdp.send('Page.getLayoutMetrics', {});
        }, 1000);

        async function poll() {
          while (attempts < max) {
            await cdp.send('Page.captureScreenshot', {});
            await delay(500);
          }
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpNoTightPolling] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('flags tight loop with optional call cdp?.send?.(...)', () => {
      const code = `
        async function poll() {
          while (true) {
            await cdp?.send?.('Page.reload');
            await delay(50);
          }
        }
      `;
      const result = scanFile('test.js', code, { rules: [cdpNoTightPolling] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-no-tight-polling');
    });
  });

  describe('Rule: cdp-valid-payload', () => {
    it('flags primitive string literal passed as parameters argument', () => {
      const code = `
        cdp.send('Page.navigate', 'https://example.com');
      `;
      const result = scanFile('test.js', code, { rules: [cdpValidPayload] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-valid-payload');
      expect(result.diagnostics[0].message).toContain('expected an object dictionary, but received string');
      expect(result.diagnostics[0].suggestion).toContain('Pass parameters as an object dictionary');
    });

    it('flags numbers, booleans, and arrays passed as parameters', () => {
      const code = `
        cdp.send('Page.navigate', 12345);
        cdp.send('Page.navigate', true);
        cdp.send('Page.navigate', ['https://example.com']);
      `;
      const result = scanFile('test.js', code, { rules: [cdpValidPayload] });
      expect(result.errorCount).toBe(3);
      expect(result.diagnostics[0].message).toContain('number');
      expect(result.diagnostics[1].message).toContain('boolean');
      expect(result.diagnostics[2].message).toContain('array');
    });

    it('allows object dictionary parameters and omitted arguments', () => {
      const code = `
        cdp.send('Page.navigate', { url: 'https://example.com' });
        cdp.send('Page.enable');
        cdp.send('DOM.getDocument', {});
      `;
      const result = scanFile('test.js', code, { rules: [cdpValidPayload] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('flags invalid payload in optional call cdp?.send?.(...)', () => {
      const code = `
        cdp?.send?.('Page.navigate', 'invalid-string-payload');
      `;
      const result = scanFile('test.js', code, { rules: [cdpValidPayload] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('cdp-valid-payload');
      expect(result.diagnostics[0].message).toContain('expected an object dictionary, but received string');
    });
  });
});
