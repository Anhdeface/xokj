import { describe, it, expect } from 'vitest';
import {
  parseUserscriptMetadata,
  parseCdpDirective,
  normalizeRunAt,
  DEFAULT_NAME,
  DEFAULT_RUN_AT
} from '../../../src/parser/metadata.js';

describe('Userscript Metadata Parser (parser/metadata.ts)', () => {
  describe('parseUserscriptMetadata', () => {
    it('parses a standard well-formed metadata block', () => {
      const code = `
// ==UserScript==
// @name         Test Script
// @namespace    https://example.com/
// @version      1.2.3
// @description  A test userscript
// @author       Tester
// @match        https://example.com/*
// @grant        GM_cdp
// @grant        GM_setValue
// @run-at       document-start
// ==/UserScript==

console.log('Script body');
      `.trim();

      const meta = parseUserscriptMetadata(code);
      expect(meta.hasHeader).toBe(true);
      expect(meta.hasMetadata).toBe(true);
      expect(meta.name).toBe('Test Script');
      expect(meta.namespace).toBe('https://example.com/');
      expect(meta.version).toBe('1.2.3');
      expect(meta.description).toBe('A test userscript');
      expect(meta.author).toBe('Tester');
      expect(meta.matches).toEqual(['https://example.com/*']);
      expect(meta.grants).toEqual(['GM_cdp', 'GM_setValue']);
      expect(meta.runAt).toBe('document-start');
      expect(meta.errors).toHaveLength(0);
    });

    it('handles multiple matches, includes, excludes, requires, and connects', () => {
      const code = `
// ==UserScript==
// @name         Multi Directives
// @match        *://*.google.com/*
// @match        *://*.github.com/*
// @include      https://site.org/*
// @exclude      https://site.org/secret/*
// @require      https://cdn.example.com/lib.js
// @connect      api.example.com
// @noframes
// ==/UserScript==
      `.trim();

      const meta = parseUserscriptMetadata(code);
      expect(meta.matches).toEqual(['*://*.google.com/*', '*://*.github.com/*']);
      expect(meta.includes).toEqual(['https://site.org/*']);
      expect(meta.excludes).toEqual(['https://site.org/secret/*']);
      expect(meta.requires).toEqual(['https://cdn.example.com/lib.js']);
      expect(meta.connects).toEqual(['api.example.com']);
      expect(meta.noframes).toBe(true);
    });

    it('extracts custom @cdp directives with domain and methods', () => {
      const code = `
// ==UserScript==
// @name         CDP Script
// @grant        GM_cdp
// @cdp          Page
// @cdp          Network.enable {"maxTotalBufferSize": 10485760}
// @cdp          DOM.getDocument
// ==/UserScript==
      `.trim();

      const meta = parseUserscriptMetadata(code);
      expect(meta.cdpDomains).toEqual(['Page', 'Network', 'DOM']);
      expect(meta.cdpMethods).toEqual(['Page.enable', 'Network.enable', 'DOM.getDocument']);
      expect(meta.cdpDeclarations).toHaveLength(3);

      const networkDecl = meta.cdpDeclarations.find((d) => d.domain === 'Network');
      expect(networkDecl).toBeDefined();
      expect(networkDecl?.command).toBe('Network.enable');
      expect(networkDecl?.params).toEqual({ maxTotalBufferSize: 10485760 });
    });

    it('safely captures malformed @cdp JSON params without throwing fatal error', () => {
      const code = `
// ==UserScript==
// @name         Malformed CDP Script
// @cdp          Network.enable {invalid json
// ==/UserScript==
      `.trim();

      const meta = parseUserscriptMetadata(code);
      expect(meta.errors.some((e) => e.includes('JSON parse error'))).toBe(true);
      expect(meta.cdpDomains).toContain('Network');
    });

    it('rejects @cdp params that are arrays or primitives', () => {
      const code = `
// ==UserScript==
// @name         Array CDP Script
// @cdp          Network.enable [1, 2, 3]
// ==/UserScript==
      `.trim();

      const meta = parseUserscriptMetadata(code);
      expect(meta.errors.some((e) => e.includes('must be a JSON object'))).toBe(true);
    });

    it('handles script without metadata header', () => {
      const code = `console.log('Plain script with no header');`;

      const meta = parseUserscriptMetadata(code);
      expect(meta.hasHeader).toBe(false);
      expect(meta.hasMetadata).toBe(false);
      expect(meta.name).toBe(DEFAULT_NAME);
      expect(meta.grants).toEqual([]);
      expect(meta.cdpDomains).toEqual([]);
      expect(meta.errors).toContain('Missing ==UserScript== metadata header block.');
    });

    it('handles unclosed metadata header block with non-fatal warning', () => {
      const code = `
// ==UserScript==
// @name         Unclosed Script
// @grant        GM_cdp
console.log('No closing tag');
      `.trim();

      const meta = parseUserscriptMetadata(code);
      expect(meta.hasHeader).toBe(true);
      expect(meta.name).toBe('Unclosed Script');
      expect(meta.grants).toContain('GM_cdp');
      expect(meta.errors.some((e) => e.includes('Unclosed ==UserScript=='))).toBe(true);
    });

    it('enforces first-wins semantics for single-value headers like @name and @version', () => {
      const code = `
// ==UserScript==
// @name First Name
// @name Second Name
// @version 1.0.0
// @version 2.0.0
// ==/UserScript==
      `.trim();

      const meta = parseUserscriptMetadata(code);
      expect(meta.name).toBe('First Name');
      expect(meta.version).toBe('1.0.0');
    });

    it('handles UTF-8 BOM prefix transparently', () => {
      const code = `\uFEFF// ==UserScript==\n// @name BOM Script\n// ==/UserScript==`;
      const meta = parseUserscriptMetadata(code);
      expect(meta.hasHeader).toBe(true);
      expect(meta.name).toBe('BOM Script');
    });
  });

  describe('normalizeRunAt', () => {
    it('normalizes document-start, document-end, and document-idle', () => {
      const errors: string[] = [];
      expect(normalizeRunAt('document-start', errors)).toBe('document-start');
      expect(normalizeRunAt('document_start', errors)).toBe('document-start');
      expect(normalizeRunAt('DOCUMENT-END', errors)).toBe('document-end');
      expect(normalizeRunAt('document_idle', errors)).toBe('document-idle');
      expect(errors).toHaveLength(0);
    });

    it('falls back to default for invalid run-at and records warning', () => {
      const errors: string[] = [];
      const res = normalizeRunAt('document-ready', errors);
      expect(res).toBe(DEFAULT_RUN_AT);
      expect(errors).toHaveLength(1);
    });
  });

  describe('parseCdpDirective', () => {
    it('defaults method to enable when omitted', () => {
      const errors: string[] = [];
      const decl = parseCdpDirective('Page', errors);
      expect(decl?.domain).toBe('Page');
      expect(decl?.method).toBe('enable');
      expect(decl?.command).toBe('Page.enable');
      expect(errors).toHaveLength(0);
    });

    it('reports error on empty directive string', () => {
      const errors: string[] = [];
      const decl = parseCdpDirective('   ', errors);
      expect(decl).toBeNull();
      expect(errors).toContain('Empty @cdp directive');
    });

    it('reports error on invalid directive format', () => {
      const errors: string[] = [];
      const decl = parseCdpDirective('123InvalidDomain', errors);
      expect(decl).toBeNull();
      expect(errors.some((e) => e.includes('Invalid @cdp syntax'))).toBe(true);
    });
  });
});
