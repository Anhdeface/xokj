import { describe, it, expect, vi } from 'vitest';
import { parseScriptAst } from '../../../src/parser/ast.js';
import { traverseAst } from '../../../src/parser/visitor.js';
import type { NodeVisitor } from '../../../src/types.js';

describe('Two-Pass Visitor Engine (parser/visitor.ts)', () => {
  it('dispatches to specific node type visitors', () => {
    const code = `
      function hello() {
        console.log('world');
      }
      hello();
    `;
    const { ast } = parseScriptAst(code, 'test.js');

    const callExpressions: any[] = [];
    const visitor: NodeVisitor = {
      CallExpression(node) {
        callExpressions.push(node);
      }
    };

    traverseAst(ast, visitor);
    // console.log(...) and hello()
    expect(callExpressions).toHaveLength(2);
  });

  it('provides parent node to visitor callbacks', () => {
    const code = `const a = 1 + 2;`;
    const { ast } = parseScriptAst(code, 'test.js');

    let parentType = '';
    const visitor: NodeVisitor = {
      BinaryExpression(_node, parent) {
        parentType = parent?.type;
      }
    };

    traverseAst(ast, visitor);
    expect(parentType).toBe('VariableDeclarator');
  });

  it('fires onEnter in preorder and onLeave in postorder', () => {
    const code = `const x = 10;`;
    const { ast } = parseScriptAst(code, 'test.js');

    const sequence: string[] = [];
    const visitor: NodeVisitor = {
      onEnter(node) {
        sequence.push(`enter:${node.type}`);
      },
      onLeave(node) {
        sequence.push(`leave:${node.type}`);
      }
    };

    traverseAst(ast, visitor);

    expect(sequence[0]).toBe('enter:File');
    expect(sequence[sequence.length - 1]).toBe('leave:File');
    expect(sequence).toContain('enter:Program');
    expect(sequence).toContain('enter:VariableDeclaration');
    expect(sequence).toContain('leave:VariableDeclaration');
  });

  it('runs Pass 2 postCheck after complete AST traversal', () => {
    const code = `const x = 1;`;
    const { ast } = parseScriptAst(code, 'test.js');

    const events: string[] = [];
    const visitor: NodeVisitor = {
      VariableDeclaration() {
        events.push('visit-node');
      },
      postCheck() {
        events.push('post-check');
      }
    };

    traverseAst(ast, visitor);
    expect(events).toEqual(['visit-node', 'post-check']);
  });

  it('supports multiple visitors running concurrently in a single traversal pass', () => {
    const code = `
      while (true) {
        cdp.send('Page.reload');
      }
    `;
    const { ast } = parseScriptAst(code, 'test.js');

    const v1While = vi.fn();
    const v2Call = vi.fn();
    const v1Post = vi.fn();
    const v2Post = vi.fn();

    const visitor1: NodeVisitor = {
      WhileStatement: v1While,
      postCheck: v1Post
    };

    const visitor2: NodeVisitor = {
      CallExpression: v2Call,
      postCheck: v2Post
    };

    traverseAst(ast, [visitor1, visitor2]);

    expect(v1While).toHaveBeenCalledTimes(1);
    expect(v2Call).toHaveBeenCalledTimes(1);
    expect(v1Post).toHaveBeenCalledTimes(1);
    expect(v2Post).toHaveBeenCalledTimes(1);
  });

  it('handles null or empty AST gracefully', () => {
    expect(() => traverseAst(null, {})).not.toThrow();
    expect(() => traverseAst({}, [])).not.toThrow();
  });

  it('isolates visitor errors so single failure does not abort traversal', () => {
    const code = `const a = 1; const b = 2;`;
    const { ast } = parseScriptAst(code, 'test.js');

    let visitedSecond = false;
    const failingVisitor: NodeVisitor = {
      onEnter(node) {
        if (node.type === 'VariableDeclaration') {
          throw new Error('Test error inside visitor');
        }
      }
    };
    const resilientVisitor: NodeVisitor = {
      VariableDeclaration() {
        visitedSecond = true;
      }
    };

    traverseAst(ast, [failingVisitor, resilientVisitor]);
    expect(visitedSecond).toBe(true);
  });

  it('preserves visitor "this" context across all hook invocations', () => {
    const code = `const a = 1;`;
    const { ast } = parseScriptAst(code, 'test.js');

    class ContextVisitor implements NodeVisitor {
      name = 'ContextVisitor';
      enteredThis: any = null;
      hookThis: any = null;
      leaveThis: any = null;
      postCheckThis: any = null;

      onEnter() {
        if (!this.enteredThis) this.enteredThis = this.name;
      }

      VariableDeclaration() {
        this.hookThis = this.name;
      }

      onLeave() {
        if (!this.leaveThis) this.leaveThis = this.name;
      }

      postCheck() {
        this.postCheckThis = this.name;
      }
    }

    const visitor = new ContextVisitor();
    traverseAst(ast, visitor);

    expect(visitor.enteredThis).toBe('ContextVisitor');
    expect(visitor.hookThis).toBe('ContextVisitor');
    expect(visitor.leaveThis).toBe('ContextVisitor');
    expect(visitor.postCheckThis).toBe('ContextVisitor');
  });
});
