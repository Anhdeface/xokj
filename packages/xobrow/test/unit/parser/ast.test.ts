import { describe, it, expect } from 'vitest';
import { parseScriptAst } from '../../../src/parser/ast.js';

describe('Babel AST Parser Wrapper (parser/ast.ts)', () => {
  it('parses modern JavaScript cleanly', () => {
    const code = `
      const a = 1;
      const b = a?.toString() ?? 'default';
      const fn = (...args) => args.map(x => x * 2);
    `;

    const { ast, syntaxErrors } = parseScriptAst(code, 'test.js');
    expect(ast).not.toBeNull();
    expect(ast.type).toBe('File');
    expect(syntaxErrors).toHaveLength(0);
  });

  it('allows top-level return statement outside functions', () => {
    const code = `
      const enabled = false;
      if (!enabled) return;
      console.log('Running');
    `;

    const { ast, syntaxErrors } = parseScriptAst(code, 'toplevel-return.js');
    expect(ast).not.toBeNull();
    expect(syntaxErrors).toHaveLength(0);

    const body = ast.program.body;
    expect(body.some((n: any) => n.type === 'IfStatement')).toBe(true);
  });

  it('allows top-level await outside async functions', () => {
    const code = `
      const res = await cdp.send('Page.navigate', { url: 'https://example.com' });
      console.log(res);
    `;

    const { ast, syntaxErrors } = parseScriptAst(code, 'toplevel-await.js');
    expect(ast).not.toBeNull();
    expect(syntaxErrors).toHaveLength(0);
  });

  it('parses TypeScript syntax annotations', () => {
    const code = `
      interface Config {
        timeout: number;
        debug?: boolean;
      }

      function init<T extends Config>(cfg: T): Promise<T> {
        return Promise.resolve(cfg);
      }

      const x: number = 42;
    `;

    const { ast, syntaxErrors } = parseScriptAst(code, 'typescript.ts');
    expect(ast).not.toBeNull();
    expect(syntaxErrors).toHaveLength(0);
  });

  it('parses JSX expressions and modern class features', () => {
    const code = `
      class Component {
        state = { count: 0 };
        render() {
          return <div className="card">{this.state.count}</div>;
        }
      }
    `;

    const { ast, syntaxErrors } = parseScriptAst(code, 'jsx.jsx');
    expect(ast).not.toBeNull();
    expect(syntaxErrors).toHaveLength(0);
  });

  it('catches fatal syntax error and converts to 1-indexed RuleDiagnostic', () => {
    const code = `
      const x = ;
    `;

    const { ast, syntaxErrors } = parseScriptAst(code, 'syntax-err.js');
    expect(ast).toBeNull();
    expect(syntaxErrors).toHaveLength(1);

    const diag = syntaxErrors[0];
    expect(diag.ruleId).toBe('syntax-error');
    expect(diag.severity).toBe('error');
    expect(diag.category).toBe('security');
    expect(diag.location.line).toBe(2);
    expect(diag.location.column).toBeGreaterThanOrEqual(1);
    expect(diag.suggestion).toContain('syntax error');
  });

  it('handles empty code string without error', () => {
    const { ast, syntaxErrors } = parseScriptAst('', 'empty.js');
    expect(ast).not.toBeNull();
    expect(ast.program.body).toHaveLength(0);
    expect(syntaxErrors).toHaveLength(0);
  });
});
