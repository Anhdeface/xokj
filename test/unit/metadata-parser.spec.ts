import { describe, it, expect } from 'vitest';
import {
  parseMetadata,
  parseUserscript,
  parseCdpDirective,
  normalizeRunAt,
  DEFAULT_NAME,
  DEFAULT_RUN_AT
} from '@/shared/metadata-parser';

describe('metadata-parser unit tests', () => {
  describe('parseCdpDirective', () => {
    it('parses domain only with default method "enable" and empty params', () => {
      const errors: string[] = [];
      const decl = parseCdpDirective('Network', errors);
      expect(decl).toEqual({
        domain: 'Network',
        method: 'enable',
        command: 'Network.enable',
        params: {},
        raw: 'Network'
      });
      expect(errors).toHaveLength(0);
    });

    it('parses domain.method without params', () => {
      const errors: string[] = [];
      const decl = parseCdpDirective('Fetch.enable', errors);
      expect(decl).toEqual({
        domain: 'Fetch',
        method: 'enable',
        command: 'Fetch.enable',
        params: {},
        raw: 'Fetch.enable'
      });
      expect(errors).toHaveLength(0);
    });

    it('parses domain.method with JSON params', () => {
      const errors: string[] = [];
      const decl = parseCdpDirective(
        'Fetch.enable {"patterns": [{"urlPattern": "*", "requestStage": "Request"}]}',
        errors
      );
      expect(decl).toEqual({
        domain: 'Fetch',
        method: 'enable',
        command: 'Fetch.enable',
        params: {
          patterns: [{ urlPattern: '*', requestStage: 'Request' }]
        },
        raw: 'Fetch.enable {"patterns": [{"urlPattern": "*", "requestStage": "Request"}]}'
      });
      expect(errors).toHaveLength(0);
    });

    it('parses domain with JSON params and infers "enable" method', () => {
      const errors: string[] = [];
      const decl = parseCdpDirective('Fetch {"patterns": [{"urlPattern": "*"}]}', errors);
      expect(decl).toEqual({
        domain: 'Fetch',
        method: 'enable',
        command: 'Fetch.enable',
        params: { patterns: [{ urlPattern: '*' }] },
        raw: 'Fetch {"patterns": [{"urlPattern": "*"}]}'
      });
      expect(errors).toHaveLength(0);
    });

    it('handles malformed JSON parameters safely with fallback empty object', () => {
      const errors: string[] = [];
      const decl = parseCdpDirective('Network.enable {bad-json}', errors);
      expect(decl).toEqual({
        domain: 'Network',
        method: 'enable',
        command: 'Network.enable',
        params: {},
        raw: 'Network.enable {bad-json}'
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('JSON parse error in @cdp directive');
    });

    it('handles non-object JSON parameters safely with fallback empty object', () => {
      const errors: string[] = [];
      const decl = parseCdpDirective('Network.enable [1, 2, 3]', errors);
      expect(decl).toEqual({
        domain: 'Network',
        method: 'enable',
        command: 'Network.enable',
        params: {},
        raw: 'Network.enable [1, 2, 3]'
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('must be a JSON object, got array');
    });

    it('handles empty directive string', () => {
      const errors: string[] = [];
      const decl = parseCdpDirective('', errors);
      expect(decl).toBeNull();
      expect(errors).toContain('Empty @cdp directive');
    });

    it('handles invalid syntax without domain identifier', () => {
      const errors: string[] = [];
      const decl = parseCdpDirective('123.enable', errors);
      expect(decl).toBeNull();
      expect(errors[0]).toContain('Invalid @cdp syntax');
    });
  });

  describe('normalizeRunAt', () => {
    it('accepts valid timings as-is', () => {
      const errors: string[] = [];
      expect(normalizeRunAt('document-start', errors)).toBe('document-start');
      expect(normalizeRunAt('document-end', errors)).toBe('document-end');
      expect(normalizeRunAt('document-idle', errors)).toBe('document-idle');
      expect(errors).toHaveLength(0);
    });

    it('normalizes uppercase and underscores', () => {
      const errors: string[] = [];
      expect(normalizeRunAt('DOCUMENT_START', errors)).toBe('document-start');
      expect(normalizeRunAt('Document_End', errors)).toBe('document-end');
      expect(errors).toHaveLength(0);
    });

    it('falls back to default-idle on invalid input and logs warning', () => {
      const errors: string[] = [];
      expect(normalizeRunAt('invalid-timing', errors)).toBe('document-idle');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Invalid @run-at value');
    });
  });

  describe('parseUserscript (lexical parser & directives)', () => {
    it('extracts complete metadata block with CRLF line endings', () => {
      const code = [
        '// ==UserScript==\r\n',
        '// @name         Full CRLF Script\r\n',
        '// @namespace    https://xokj.dev\r\n',
        '// @version      2.1.0\r\n',
        '// @description  Full metadata test\r\n',
        '// @author       Alice\r\n',
        '// @icon         https://xokj.dev/icon.png\r\n',
        '// @match        *://*.example.com/*\r\n',
        '// @match        https://api.github.com/*\r\n',
        '// @include      http://legacy.site/*\r\n',
        '// @exclude      https://*.example.com/admin/*\r\n',
        '// @run-at       document-start\r\n',
        '// @grant        GM_setValue\r\n',
        '// @grant        GM_cdp\r\n',
        '// @cdp          Network.enable\r\n',
        '// @cdp          Fetch.enable {"patterns": [{"urlPattern": "*"}]}\r\n',
        '// @require      https://cdn.example.com/lib.js\r\n',
        '// @resource     theme https://example.com/theme.css\r\n',
        '// @noframes\r\n',
        '// @connect      api.github.com\r\n',
        '// ==/UserScript==\r\n',
        'console.log("active");\r\n'
      ].join('');

      const res = parseUserscript(code);
      expect(res.hasMetadata).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.metadata.name).toBe('Full CRLF Script');
      expect(res.metadata.namespace).toBe('https://xokj.dev');
      expect(res.metadata.version).toBe('2.1.0');
      expect(res.metadata.description).toBe('Full metadata test');
      expect(res.metadata.author).toBe('Alice');
      expect(res.metadata.icon).toBe('https://xokj.dev/icon.png');
      expect(res.metadata.matches).toEqual([
        '*://*.example.com/*',
        'https://api.github.com/*'
      ]);
      expect(res.metadata.matchPatterns).toEqual(res.metadata.matches);
      expect(res.metadata.includes).toEqual(['http://legacy.site/*']);
      expect(res.metadata.excludes).toEqual(['https://*.example.com/admin/*']);
      expect(res.metadata.runAt).toBe('document-start');
      expect(res.metadata.grants).toEqual(['GM_setValue', 'GM_cdp']);
      expect(res.metadata.noframes).toBe(true);
      expect(res.metadata.requires).toEqual(['https://cdn.example.com/lib.js']);
      expect(res.metadata.resources).toEqual({ theme: 'https://example.com/theme.css' });
      expect(res.metadata.connects).toEqual(['api.github.com']);
      expect(res.metadata.cdpDomains).toEqual(['Network', 'Fetch']);
      expect(res.metadata.cdp).toHaveLength(2);
    });

    it('tolerates arbitrary whitespace before and after delimiters', () => {
      const code = `
        //   ==UserScript==   
        //   @name   Spaced Script   
        //   @match  *://*/*   
        //   ==/UserScript==   
        console.log("spaced");
      `;
      const res = parseUserscript(code);
      expect(res.hasMetadata).toBe(true);
      expect(res.metadata.name).toBe('Spaced Script');
      expect(res.metadata.matches).toEqual(['*://*/*']);
      expect(res.errors).toHaveLength(0);
    });

    it('handles script without any metadata block', () => {
      const code = 'console.log("no header");';
      const res = parseUserscript(code);
      expect(res.hasMetadata).toBe(false);
      expect(res.metadata.name).toBe(DEFAULT_NAME);
      expect(res.metadata.runAt).toBe(DEFAULT_RUN_AT);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]).toContain('Missing ==UserScript==');
    });

    it('handles unclosed metadata header block (missing ==/UserScript==)', () => {
      const code = `
        // ==UserScript==
        // @name Unclosed Script
        // @match https://example.com/*
        console.log("unclosed");
      `;
      const res = parseUserscript(code);
      expect(res.hasMetadata).toBe(true);
      expect(res.metadata.name).toBe('Unclosed Script');
      expect(res.metadata.matches).toEqual(['https://example.com/*']);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]).toContain('Unclosed ==UserScript== metadata block');
    });

    it('handles completely empty header block', () => {
      const code = `
        // ==UserScript==
        // ==/UserScript==
      `;
      const res = parseUserscript(code);
      expect(res.hasMetadata).toBe(true);
      expect(res.metadata.name).toBe(DEFAULT_NAME);
      expect(res.metadata.runAt).toBe(DEFAULT_RUN_AT);
      expect(res.metadata.matches).toEqual([]);
      expect(res.errors).toHaveLength(0);
    });

    it('enforces "first wins" for single-value tags (@name, @version, @run-at)', () => {
      const code = `
        // ==UserScript==
        // @name Primary Title
        // @name Secondary Title
        // @version 1.0.0
        // @version 2.0.0
        // @run-at document-start
        // @run-at document-idle
        // ==/UserScript==
      `;
      const res = parseUserscript(code);
      expect(res.metadata.name).toBe('Primary Title');
      expect(res.metadata.version).toBe('1.0.0');
      expect(res.metadata.runAt).toBe('document-start');
      expect(res.metadata.rawEntries['name']).toEqual(['Primary Title', 'Secondary Title']);
    });

    it('handles multiple @cdp directives and deduplicates cdpDomains', () => {
      const code = `
        // ==UserScript==
        // @name Multi CDP Script
        // @cdp Network.enable
        // @cdp Network.setCacheDisabled {"cacheDisabled": true}
        // @cdp Fetch.enable
        // @cdp Page.enable
        // ==/UserScript==
      `;
      const res = parseUserscript(code);
      expect(res.metadata.cdp).toHaveLength(4);
      expect(res.metadata.cdpDomains).toEqual(['Network', 'Fetch', 'Page']);
    });

    it('strips UTF-8 BOM if present at the start of the file', () => {
      const code = '\uFEFF// ==UserScript==\n// @name BOM Script\n// ==/UserScript==';
      const res = parseUserscript(code);
      expect(res.hasMetadata).toBe(true);
      expect(res.metadata.name).toBe('BOM Script');
    });

    it('parses Unicode characters in metadata values', () => {
      const code = `
        // ==UserScript==
        // @name 🚀 CDP Manager - 自动化测试
        // @description 这是一个测试脚本
        // @author Nguyễn Văn A
        // ==/UserScript==
      `;
      const res = parseUserscript(code);
      expect(res.metadata.name).toBe('🚀 CDP Manager - 自动化测试');
      expect(res.metadata.description).toBe('这是一个测试脚本');
      expect(res.metadata.author).toBe('Nguyễn Văn A');
    });

    it('ignores comments and blank lines within metadata header block', () => {
      const code = `
        // ==UserScript==
        // @name Clean Script
        //
        // NOTE: This is a comment inside header
        // @match https://example.com/*
        // ==/UserScript==
      `;
      const res = parseUserscript(code);
      expect(res.metadata.name).toBe('Clean Script');
      expect(res.metadata.matches).toEqual(['https://example.com/*']);
      expect(res.errors).toHaveLength(0);
    });
  });

  describe('parseMetadata helper', () => {
    it('returns ParsedMetadata properties directly', () => {
      const code = `
        // ==UserScript==
        // @name Helper Test
        // @match *://*/*
        // ==/UserScript==
      `;
      const meta = parseMetadata(code);
      expect(meta.name).toBe('Helper Test');
      expect(meta.matches).toEqual(['*://*/*']);
      expect(meta.runAt).toBe('document-idle');
    });

    it('also exposes hasMetadata, metadata, code, and errors for explorer compatibility', () => {
      const code = `
        // ==UserScript==
        // @name Extended Return
        // @match https://example.com/*
        // ==/UserScript==
      `;
      const res = parseMetadata(code);
      expect(res.hasMetadata).toBe(true);
      expect(res.metadata.name).toBe('Extended Return');
      expect(res.code).toBe(code);
      expect(res.errors).toHaveLength(0);
    });
  });

  describe('Tier 4: Prototype Safety & Directive Precedence', () => {
    it('T4.1: handles @constructor and @__proto__ directives without throwing TypeError', () => {
      const code = `
        // ==UserScript==
        // @name Prototype Collision Script
        // @constructor
        // @__proto__ malicious
        // @toString
        // @valueOf
        // @hasOwnProperty
        // ==/UserScript==
        console.log("safe");
      `;

      expect(() => parseUserscript(code)).not.toThrow();
      const res = parseUserscript(code);
      expect(res.hasMetadata).toBe(true);
      expect(res.metadata.name).toBe('Prototype Collision Script');
      expect(Array.isArray(res.metadata.rawEntries['constructor'])).toBe(true);
      expect(Array.isArray(res.metadata.rawEntries['__proto__'])).toBe(true);
    });

    it('T4.2: prevents prototype pollution via @resource directive', () => {
      const code = `
        // ==UserScript==
        // @name Resource Pollution Script
        // @resource __proto__ https://evil.com/exploit.css
        // @resource constructor https://evil.com/class.css
        // ==/UserScript==
      `;

      expect(() => parseUserscript(code)).not.toThrow();
      const res = parseUserscript(code);
      expect(res.metadata.resources['__proto__']).toBe('https://evil.com/exploit.css');
      expect(res.metadata.resources['constructor']).toBe('https://evil.com/class.css');
      // Verify global Object.prototype is unpolluted
      expect((Object.prototype as any)['exploit.css']).toBeUndefined();
      expect(({} as any)['__proto__']).not.toBe('https://evil.com/exploit.css');
    });

    it('T4.3: enforces strict first-declaration precedence for @run-at even when first matches default', () => {
      const code = `
        // ==UserScript==
        // @name Precedence RunAt Test
        // @run-at document-idle
        // @run-at document-start
        // ==/UserScript==
      `;

      const res = parseUserscript(code);
      // First declaration "document-idle" must win
      expect(res.metadata.runAt).toBe('document-idle');
    });

    it('T4.4: enforces strict first-declaration precedence for @name even when first matches default', () => {
      const code = `
        // ==UserScript==
        // @name Unnamed Script
        // @name Overwritten Title
        // ==/UserScript==
      `;

      const res = parseUserscript(code);
      // First declaration "Unnamed Script" must win
      expect(res.metadata.name).toBe('Unnamed Script');
    });

    it('T4.5: safely handles non-string inputs to parseUserscript and parseMetadata', () => {
      expect(parseUserscript(null as any).hasMetadata).toBe(false);
      expect(parseUserscript(undefined as any).hasMetadata).toBe(false);
      expect(parseUserscript(12345 as any).hasMetadata).toBe(false);
      expect(parseMetadata(null as any).name).toBe(DEFAULT_NAME);
    });
  });
});
