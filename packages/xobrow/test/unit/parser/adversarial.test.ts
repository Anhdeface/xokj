import { describe, it, expect, vi } from 'vitest';
import { parseScriptAst } from '../../../src/parser/ast.js';
import {
  parseUserscriptMetadata,
  parseCdpDirective,
  normalizeRunAt,
  DEFAULT_NAME,
  DEFAULT_RUN_AT
} from '../../../src/parser/metadata.js';
import { traverseAst } from '../../../src/parser/visitor.js';
import { scanFile } from '../../../src/engine/scanner.js';
import type { NodeVisitor, RuleDefinition, RuleContext } from '../../../src/types.js';

describe('Adversarial Verification: Milestone 1 AST & Metadata & Visitor', () => {
  // =========================================================================
  // Section 1: Exotic Modern JS/TS Constructs
  // =========================================================================
  describe('1. Exotic Modern JS/TS Constructs', () => {
    it('parses deeply nested template literals without corruption', () => {
      const code = 'const deep = `${`${`${`${`${`${`${`${`${`level-10`}`}`}`}`}`}`}`}`}`;';
      const { ast, syntaxErrors } = parseScriptAst(code, 'template-literals.js');
      expect(ast).not.toBeNull();
      expect(syntaxErrors).toHaveLength(0);
    });

    it('parses complex optional chaining and nullish coalescing pipelines', () => {
      const code = `
        const res = obj?.data?.users?.[0]?.getName?.() ?? fallback?.() ?? 'anonymous';
        class Client {
          #privateMethod() { return 42; }
          query(a: any, x?: string) {
            return a?.b?.c?.[x ?? 'default']?.(this?.#privateMethod?.());
          }
        }
      `;
      const { ast, syntaxErrors } = parseScriptAst(code, 'optional-chaining.js');
      expect(ast).not.toBeNull();
      expect(syntaxErrors).toHaveLength(0);
    });

    it('reports 1-indexed syntax error when private identifier is accessed outside class', () => {
      const code = `const invalid = #orphanField;`;
      const { ast, syntaxErrors } = parseScriptAst(code, 'orphan-private.js');
      // With errorRecovery: true, Babel recovers an AST and captures the syntax errors
      expect(ast).not.toBeNull();
      expect(syntaxErrors.length).toBeGreaterThanOrEqual(1);
      expect(syntaxErrors[0].ruleId).toBe('syntax-error');
      expect(syntaxErrors[0].severity).toBe('error');
      expect(syntaxErrors[0].location.line).toBe(1);
      expect(syntaxErrors[0].location.column).toBe(17);
    });

    it('reports 1-indexed syntax error and returns null AST on fatal unrecoverable syntax error', () => {
      const code = `const x = ;`;
      const { ast, syntaxErrors } = parseScriptAst(code, 'fatal-syntax.js');
      expect(ast).toBeNull();
      expect(syntaxErrors).toHaveLength(1);
      expect(syntaxErrors[0].ruleId).toBe('syntax-error');
      expect(syntaxErrors[0].severity).toBe('error');
      expect(syntaxErrors[0].location.line).toBe(1);
      expect(syntaxErrors[0].location.column).toBe(11);
    });

    it('parses private class fields, private methods, and brand check (#field in obj)', () => {
      const code = `
        class SecretManager {
          #secretKey: string;
          static #registry = new Map<string, any>();

          constructor(key: string) {
            this.#secretKey = key;
          }

          #hash(): string {
            return 'hashed:' + this.#secretKey;
          }

          get #keyVal(): string {
            return this.#secretKey;
          }

          set #keyVal(v: string) {
            this.#secretKey = v;
          }

          static isValidInstance(candidate: unknown): boolean {
            return typeof candidate === 'object' && candidate !== null && #secretKey in candidate;
          }
        }
      `;
      const { ast, syntaxErrors } = parseScriptAst(code, 'private-fields.ts');
      expect(ast).not.toBeNull();
      expect(syntaxErrors).toHaveLength(0);
    });

    it('parses top-level return in conditional and unconditional positions', () => {
      const code = `
        if (typeof window === 'undefined') {
          return;
        }
        const config = { active: true };
        if (!config.active) return config;
        return;
      `;
      const { ast, syntaxErrors } = parseScriptAst(code, 'top-level-return.js');
      expect(ast).not.toBeNull();
      expect(syntaxErrors).toHaveLength(0);
    });

    it('parses top-level await and for-await loops outside async functions', () => {
      const code = `
        const session = await cdp.send('Target.attachToTarget', { targetId: '123' });
        const stream = getAsyncIterable();
        for await (const chunk of stream) {
          console.log(chunk);
        }
      `;
      const { ast, syntaxErrors } = parseScriptAst(code, 'top-level-await.js');
      expect(ast).not.toBeNull();
      expect(syntaxErrors).toHaveLength(0);
    });

    it('parses modern ECMAScript operators: logical assignment, BigInt, numeric separators, regex flags', () => {
      const code = `
        let a = 1;
        a &&= 2;
        a ||= 3;
        a ??= 4;

        const max = 9_007_199_254_740_991n;
        const hex = 0xDEAD_BEEFn;
        const bin = 0b1010_0101;

        const regex = /^[a-z]+$/dgi;
        const dynamic = await import('./module.js');
      `;
      const { ast, syntaxErrors } = parseScriptAst(code, 'modern-operators.js');
      expect(ast).not.toBeNull();
      expect(syntaxErrors).toHaveLength(0);
    });

    it('parses TypeScript satisfies operator and as const assertion', () => {
      const code = `
        type Config = { timeout: number; debug: boolean };
        const myConfig = {
          timeout: 5000,
          debug: true
        } as const satisfies Config;

        enum TargetDomain {
          PAGE = 'Page',
          NETWORK = 'Network'
        }

        interface EventMap {
          [key: string]: unknown;
        }
      `;
      const { ast, syntaxErrors } = parseScriptAst(code, 'ts-advanced.ts');
      expect(ast).not.toBeNull();
      expect(syntaxErrors).toHaveLength(0);
    });

    it('handles script with hashbang / shebang line transparently', () => {
      const code = `#!/usr/bin/env node\nconsole.log('Shebang script');`;
      const { ast, syntaxErrors } = parseScriptAst(code, 'shebang.js');
      expect(ast).not.toBeNull();
      expect(syntaxErrors).toHaveLength(0);
    });
  });

  // =========================================================================
  // Section 2: Malformed Userscript Headers & Directive Edges
  // =========================================================================
  describe('2. Malformed Userscript Headers & Directive Edges', () => {
    it('handles missing closing ==/UserScript== without crashing, flags non-fatal error', () => {
      const code = `
// ==UserScript==
// @name   Incomplete Header
// @grant  GM_cdp
console.log('script body');
      `.trim();

      const meta = parseUserscriptMetadata(code);
      expect(meta.hasHeader).toBe(true);
      expect(meta.name).toBe('Incomplete Header');
      expect(meta.grants).toEqual(['GM_cdp']);
      expect(meta.errors.some((e) => e.includes('Unclosed ==UserScript=='))).toBe(true);
    });

    it('parses files with duplicate ==UserScript== blocks gracefully', () => {
      const code = `
// ==UserScript==
// @name First Header Block
// @grant GM_setValue
// ==/UserScript==

console.log('between blocks');

// ==UserScript==
// @name Second Header Block
// @grant GM_getValue
// ==/UserScript==
      `.trim();

      const meta = parseUserscriptMetadata(code);
      // First header block takes precedence
      expect(meta.hasHeader).toBe(true);
      expect(meta.name).toBe('First Header Block');
      expect(meta.grants).toContain('GM_setValue');
    });

    it('handles malformed @cdp JSON params (incomplete JSON, primitives, arrays, null)', () => {
      const code = `
// ==UserScript==
// @name Malformed CDP Suite
// @cdp Page.enable {unquoted: "broken",
// @cdp Network.enable "plain string"
// @cdp Target.setDiscoverTargets 42
// @cdp Fetch.enable [1, 2, 3]
// @cdp DOM.enable null
// @cdp Runtime.enable {"valid": true}
// ==/UserScript==
      `.trim();

      const meta = parseUserscriptMetadata(code);
      expect(meta.cdpDomains).toEqual(['Page', 'Network', 'Target', 'Fetch', 'DOM', 'Runtime']);
      // Malformed entries produce descriptive error strings without crashing
      expect(meta.errors.length).toBeGreaterThanOrEqual(5);

      // Valid entry succeeds
      const runtimeDecl = meta.cdpDeclarations.find((d) => d.command === 'Runtime.enable');
      expect(runtimeDecl?.params).toEqual({ valid: true });
    });

    it('handles directive with missing values or invalid formats', () => {
      const errors: string[] = [];
      expect(parseCdpDirective('', errors)).toBeNull();
      expect(parseCdpDirective('   \t  ', errors)).toBeNull();
      expect(parseCdpDirective('99InvalidPrefix', errors)).toBeNull();
      expect(parseCdpDirective('Domain.method.extraPart', errors)).toBeNull();
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });

    it('handles conflicting single-value directives with first-wins semantics', () => {
      const code = `
// ==UserScript==
// @name Winner Name
// @name Loser Name
// @version 1.0.0
// @version 2.0.0
// @run-at document-start
// @run-at document-end
// ==/UserScript==
      `.trim();

      const meta = parseUserscriptMetadata(code);
      expect(meta.name).toBe('Winner Name');
      expect(meta.version).toBe('1.0.0');
      expect(meta.runAt).toBe('document-start');
      expect(meta.rawHeaders['name']).toEqual(['Winner Name', 'Loser Name']);
      expect(meta.rawHeaders['version']).toEqual(['1.0.0', '2.0.0']);
      expect(meta.rawHeaders['run-at']).toEqual(['document-start', 'document-end']);
    });

    it('handles Windows CRLF and trailing whitespace on header delimiters', () => {
      const code = "\t // ==UserScript==  // comment\r\n// @name CRLF Script\r\n// @grant GM_cdp\r\n  // ==/UserScript==  \r\nconsole.log(1);";
      const meta = parseUserscriptMetadata(code);
      expect(meta.hasHeader).toBe(true);
      expect(meta.name).toBe('CRLF Script');
      expect(meta.grants).toEqual(['GM_cdp']);
    });
  });

  // =========================================================================
  // Section 3: Deep AST Recursion & Traversal Stress (Depth > 50)
  // =========================================================================
  describe('3. Deep AST Recursion & Traversal Stress', () => {
    it('traverses deeply nested AST structures (depth = 60 blocks) without stack overflow', () => {
      const depth = 60;
      let nestedCode = 'const leaf = "target";';
      for (let i = 0; i < depth; i++) {
        nestedCode = `{\n${nestedCode}\n}`;
      }

      const { ast } = parseScriptAst(nestedCode, 'deep-blocks.js');
      expect(ast).not.toBeNull();

      let blockCount = 0;
      let maxStackDepth = 0;
      let reachedLeaf = false;

      const visitor: NodeVisitor = {
        onEnter(_node, _parent, ancestors) {
          if (ancestors && ancestors.length > maxStackDepth) {
            maxStackDepth = ancestors.length;
          }
        },
        BlockStatement() {
          blockCount++;
        },
        StringLiteral(node) {
          if (node.value === 'target') {
            reachedLeaf = true;
          }
        }
      };

      expect(() => traverseAst(ast, visitor)).not.toThrow();
      expect(blockCount).toBe(depth);
      expect(reachedLeaf).toBe(true);
      expect(maxStackDepth).toBeGreaterThanOrEqual(depth);
    });

    it('traverses deeply nested binary expressions (depth = 100) without stack overflow', () => {
      const depth = 100;
      const operands = Array(depth).fill('1');
      const expression = operands.join(' + ');
      const code = `const result = ${expression};`;

      const { ast } = parseScriptAst(code, 'deep-binary.js');
      expect(ast).not.toBeNull();

      let binaryExprCount = 0;
      const visitor: NodeVisitor = {
        BinaryExpression() {
          binaryExprCount++;
        }
      };

      expect(() => traverseAst(ast, visitor)).not.toThrow();
      expect(binaryExprCount).toBe(depth - 1);
    });

    it('traverses deeply nested function calls (depth = 75) without stack overflow', () => {
      const depth = 75;
      let nestedCall = 'leaf()';
      for (let i = 0; i < depth - 1; i++) {
        nestedCall = `wrap(${nestedCall})`;
      }
      const code = `${nestedCall};`;

      const { ast } = parseScriptAst(code, 'deep-calls.js');
      expect(ast).not.toBeNull();

      let callCount = 0;
      const visitor: NodeVisitor = {
        CallExpression() {
          callCount++;
        }
      };

      expect(() => traverseAst(ast, visitor)).not.toThrow();
      expect(callCount).toBe(depth);
    });

    it('unwinds ancestor stack cleanly back to zero after deep traversal', () => {
      const depth = 55;
      let code = 'const x = 1;';
      for (let i = 0; i < depth; i++) {
        code = `if (true) { ${code} }`;
      }

      const { ast } = parseScriptAst(code, 'ancestor-unwind.js');
      expect(ast).not.toBeNull();

      const observedAncestorLengths: number[] = [];
      const visitor: NodeVisitor = {
        onLeave(_node, _parent, ancestors) {
          observedAncestorLengths.push(ancestors ? ancestors.length : -1);
        }
      };

      traverseAst(ast, visitor);

      // The last onLeave hook should see an ancestor stack of 0 (root node File)
      expect(observedAncestorLengths[observedAncestorLengths.length - 1]).toBe(0);
    });

    it('handles broad AST with 2000 statement siblings efficiently', () => {
      const lines: string[] = [];
      for (let i = 0; i < 2000; i++) {
        lines.push(`const var_${i} = ${i};`);
      }
      const code = lines.join('\n');

      const { ast } = parseScriptAst(code, 'wide-ast.js');
      expect(ast).not.toBeNull();

      let varCount = 0;
      const visitor: NodeVisitor = {
        VariableDeclaration() {
          varCount++;
        }
      };

      const start = performance.now();
      traverseAst(ast, visitor);
      const elapsed = performance.now() - start;

      expect(varCount).toBe(2000);
      expect(elapsed).toBeLessThan(1000); // Must be fast (< 1s for 2000 statements)
    });
  });

  // =========================================================================
  // Section 4: Cyclic AST & Malformed Node Handling
  // =========================================================================
  describe('4. Cyclic AST & Malformed Node Handling', () => {
    it('handles AST with non-object or non-string node types gracefully', () => {
      const malformedAst = {
        type: 'Program',
        body: [
          null,
          undefined,
          123,
          'not a node',
          { type: null },
          { notType: 'foo' },
          { type: 'ExpressionStatement', expression: null }
        ]
      };

      expect(() => traverseAst(malformedAst, {})).not.toThrow();
    });

    it('ignores non-AST metadata properties and does not loop infinitely on visited properties', () => {
      const code = `const a = 1;`;
      const { ast } = parseScriptAst(code, 'props.js');

      // Inject extra cyclic reference that should be ignored by IGNORED_AST_KEYS
      ast.program.loc = { parent: ast };
      ast.program.comments = [{ parent: ast }];
      ast.program.extra = { parent: ast };

      let visitedNodes = 0;
      const visitor: NodeVisitor = {
        onEnter() {
          visitedNodes++;
        }
      };

      expect(() => traverseAst(ast, visitor)).not.toThrow();
      expect(visitedNodes).toBeGreaterThan(0);
    });

    it('does not trigger Object.prototype properties as node visitor hooks', () => {
      const code = `const a = 1;`;
      const { ast } = parseScriptAst(code, 'prototype-hook.js');

      // Craft an AST node with a type that matches Object.prototype methods
      const syntheticAst = {
        type: 'File',
        program: {
          type: 'Program',
          body: [
            { type: 'toString' },
            { type: 'valueOf' },
            { type: 'hasOwnProperty' },
            { type: 'isPrototypeOf' }
          ]
        }
      };

      // Standard plain object inherits toString, valueOf, etc. from Object.prototype
      const plainVisitor: NodeVisitor = {};

      expect(() => traverseAst(syntheticAst, plainVisitor)).not.toThrow();
    });
  });

  // =========================================================================
  // Section 5: Multi-Visitor Lifecycle & postCheck Isolation
  // =========================================================================
  describe('5. Multi-Visitor Lifecycle & postCheck Isolation', () => {
    it('executes Pass 2 postCheck across all visitors strictly AFTER Pass 1 completes', () => {
      const code = `
        const x = 1;
        function test() { return x; }
        test();
      `;
      const { ast } = parseScriptAst(code, 'pass-order.js');

      const trace: string[] = [];

      const visitorA: NodeVisitor = {
        onEnter(node) {
          if (node.type === 'FunctionDeclaration') trace.push('A:enterFunc');
        },
        postCheck() {
          trace.push('A:postCheck');
        }
      };

      const visitorB: NodeVisitor = {
        onEnter(node) {
          if (node.type === 'CallExpression') trace.push('B:enterCall');
        },
        postCheck() {
          trace.push('B:postCheck');
        }
      };

      traverseAst(ast, [visitorA, visitorB]);

      expect(trace).toEqual(['A:enterFunc', 'B:enterCall', 'A:postCheck', 'B:postCheck']);
    });

    it('isolates postCheck exceptions so one visitor failure does not prevent subsequent postChecks', () => {
      const code = `const x = 1;`;
      const { ast } = parseScriptAst(code, 'postcheck-err.js');

      const v1Post = vi.fn(() => {
        throw new Error('Visitor 1 postCheck failed');
      });
      const v2Post = vi.fn();
      const v3Post = vi.fn();

      const visitors: NodeVisitor[] = [
        { postCheck: v1Post },
        { postCheck: v2Post },
        { postCheck: v3Post }
      ];

      expect(() => traverseAst(ast, visitors)).not.toThrow();
      expect(v1Post).toHaveBeenCalledTimes(1);
      expect(v2Post).toHaveBeenCalledTimes(1);
      expect(v3Post).toHaveBeenCalledTimes(1);
    });

    it('captures violations reported in postCheck() via RuleContext and scanFile', () => {
      const code = `
// ==UserScript==
// @name Leak Demo
// ==/UserScript==
const timer = setInterval(() => {}, 1000);
      `.trim();

      // Custom rule mimicking Milestone 2 leak-lingering-interval rule
      const mockLeakRule: RuleDefinition = {
        id: 'test-leak-interval',
        name: 'Mock Lingering Interval Rule',
        category: 'resource-leak',
        defaultSeverity: 'error',
        description: 'Flags intervals not cleared via clearInterval',
        create(context: RuleContext): NodeVisitor {
          let hasInterval = false;
          let hasClear = false;

          return {
            CallExpression(node) {
              if (node.callee?.name === 'setInterval') {
                hasInterval = true;
              }
              if (node.callee?.name === 'clearInterval') {
                hasClear = true;
              }
            },
            postCheck() {
              if (hasInterval && !hasClear) {
                context.report({
                  message: 'setInterval handle is never cleared with clearInterval',
                  location: { line: 4, column: 15 },
                  suggestion: 'Store the interval handle and call clearInterval(handle) on cleanup.'
                });
              }
            }
          };
        }
      };

      const scanResult = scanFile('leak-demo.js', code, {
        rules: [mockLeakRule]
      });

      expect(scanResult.errorCount).toBe(1);
      expect(scanResult.diagnostics).toHaveLength(1);
      expect(scanResult.diagnostics[0].ruleId).toBe('test-leak-interval');
      expect(scanResult.diagnostics[0].category).toBe('resource-leak');
      expect(scanResult.diagnostics[0].location.line).toBe(4);
      expect(scanResult.diagnostics[0].suggestion).toContain('clearInterval');
    });

    it('simulates 15 concurrent rule visitors operating simultaneously in a single AST pass', () => {
      const code = `
// ==UserScript==
// @name Multi Rule Simulation
// @grant GM_cdp
// @cdp Page.enable
// ==/UserScript==

eval('unsafe()');
new Function('return 1')();
setInterval('callback()', 1000);
document.body.innerHTML = '<div>unsafe</div>';
window.__proto__.polluted = true;
const s = document.createElement('script');
window.addEventListener('message', () => {});
const id = setInterval(() => {}, 500);
cdp.on('Page.loadEventFired', () => {});
while (true) { cdp.send('Page.navigate', {}); }
cdp.send('Invalid.method');
      `.trim();

      const mockRules: RuleDefinition[] = Array.from({ length: 15 }, (_, i) => ({
        id: `mock-rule-${i + 1}`,
        name: `Mock Rule ${i + 1}`,
        category: i < 6 ? 'security' : i < 10 ? 'resource-leak' : 'cdp-integrity',
        defaultSeverity: 'error',
        description: `Mock description ${i + 1}`,
        create(context: RuleContext): NodeVisitor {
          return {
            onEnter(_node) {
              // Work across all nodes
            },
            postCheck() {
              context.report({
                message: `Violation reported from mock rule ${i + 1}`,
                location: { line: 1, column: 1 },
                suggestion: `Remediation for rule ${i + 1}`
              });
            }
          };
        }
      }));

      const result = scanFile('multi-sim.js', code, {
        rules: mockRules
      });

      expect(result.diagnostics).toHaveLength(15);
      expect(result.errorCount).toBe(15);
      expect(result.hasErrors).toBe(true);
    });
  });
});
