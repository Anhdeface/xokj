import { describe, it, expect } from 'vitest';
import { scanFile } from '../../../src/engine/scanner.js';
import {
  secNoEval,
  secNoNewFunction,
  secNoStringTimers,
  secNoUnsafeDomSink,
  secNoPrototypePollution,
  secNoScriptInjection
} from '../../../src/rules/security/index.js';

describe('Category 1: Security Rules Unit Test Suite', () => {
  describe('Rule: sec-no-eval', () => {
    it('flags direct eval() invocation', () => {
      const code = `
        const payload = 'alert(1)';
        eval(payload);
      `;
      const result = scanFile('test.js', code, { rules: [secNoEval] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('sec-no-eval');
      expect(result.diagnostics[0].severity).toBe('error');
      expect(result.diagnostics[0].location.line).toBe(3);
      expect(result.diagnostics[0].message).toContain('eval()');
      expect(result.diagnostics[0].suggestion).toContain('JSON.parse');
    });

    it('flags window.eval() and globalThis.eval() invocations', () => {
      const code = `
        window.eval('1 + 1');
        globalThis.eval('2 + 2');
        globalThis['eval']('3 + 3');
      `;
      const result = scanFile('test.js', code, { rules: [secNoEval] });
      expect(result.errorCount).toBe(3);
      for (const diag of result.diagnostics) {
        expect(diag.ruleId).toBe('sec-no-eval');
      }
    });

    it('flags indirect sequence expression (0, eval)(code)', () => {
      const code = `
        const x = (0, eval)('unboundGlobal()');
      `;
      const result = scanFile('test.js', code, { rules: [secNoEval] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('sec-no-eval');
      expect(result.diagnostics[0].message).toContain('Indirect call to eval()');
    });

    it('flags eval.call(null, code) and eval.apply(null, [code])', () => {
      const code = `
        eval.call(null, 'console.log(1)');
        eval.apply(null, ['console.log(2)']);
      `;
      const result = scanFile('test.js', code, { rules: [secNoEval] });
      expect(result.errorCount).toBe(2);
    });

    it('allows safe alternatives: JSON.parse, custom object methods, and typeof check', () => {
      const code = `
        const data = JSON.parse('{"valid": true}');
        const parser = { eval(code) { return 42; } };
        parser.eval('someExpr');
        const isEvalPresent = typeof eval === 'function';
      `;
      const result = scanFile('test.js', code, { rules: [secNoEval] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('Rule: sec-no-new-function', () => {
    it('flags new Function(...) and direct Function(...) call', () => {
      const code = `
        const add = new Function('a', 'b', 'return a + b');
        const sub = Function('a', 'b', 'return a - b');
      `;
      const result = scanFile('test.js', code, { rules: [secNoNewFunction] });
      expect(result.errorCount).toBe(2);
      expect(result.diagnostics[0].ruleId).toBe('sec-no-new-function');
      expect(result.diagnostics[0].location.line).toBe(2);
      expect(result.diagnostics[1].location.line).toBe(3);
    });

    it('flags window.Function(...) and Function.call(...)', () => {
      const code = `
        const f1 = window.Function('return 1');
        const f2 = Function.call(null, 'return 2');
        const f3 = (0, Function)('return 3')();
      `;
      const result = scanFile('test.js', code, { rules: [secNoNewFunction] });
      expect(result.errorCount).toBe(3);
    });

    it('allows safe function declarations, closures, and method calls', () => {
      const code = `
        function standardAdd(a, b) { return a + b; }
        const arrow = (x) => x * 2;
        const isFunc = standardAdd instanceof Function;
        const builder = { Function(x) { return x; } };
        builder.Function(10);
      `;
      const result = scanFile('test.js', code, { rules: [secNoNewFunction] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('Rule: sec-no-string-timers', () => {
    it('flags string callback in setTimeout and setInterval with exact string coordinates', () => {
      const code = `
        setTimeout('console.log("bad")', 1000);
        setInterval('doPoll()', 500);
      `;
      const result = scanFile('test.js', code, { rules: [secNoStringTimers] });
      expect(result.errorCount).toBe(2);
      expect(result.diagnostics[0].ruleId).toBe('sec-no-string-timers');
      expect(result.diagnostics[0].location.line).toBe(2);
      expect(result.diagnostics[1].location.line).toBe(3);
      expect(result.diagnostics[0].suggestion).toContain('callback function');
    });

    it('flags template literals and string concatenation in timer arguments', () => {
      const code = `
        const id = 123;
        setTimeout(\`runTask(\${id})\`, 200);
        setInterval('poll(' + id + ')', 300);
        window.setTimeout('cleanup()', 100);
      `;
      const result = scanFile('test.js', code, { rules: [secNoStringTimers] });
      expect(result.errorCount).toBe(3);
    });

    it('allows safe function and identifier callbacks', () => {
      const code = `
        function handler() {}
        setTimeout(handler, 500);
        setInterval(() => { console.log('tick'); }, 1000);
        const obj = { run() {} };
        setTimeout(obj.run.bind(obj), 200);
        const customTimer = { setTimeout(str, delay) {} };
        customTimer.setTimeout('custom string', 100);
      `;
      const result = scanFile('test.js', code, { rules: [secNoStringTimers] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('Rule: sec-no-unsafe-dom-sink', () => {
    it('flags assignments to .innerHTML and .outerHTML', () => {
      const code = `
        const div = document.getElementById('app');
        div.innerHTML = '<p>danger</p>';
        div.outerHTML = '<span>replace</span>';
        div.innerHTML += '<b>append</b>';
        div['innerHTML'] = '<i>computed</i>';
      `;
      const result = scanFile('test.js', code, { rules: [secNoUnsafeDomSink] });
      expect(result.errorCount).toBe(4);
      expect(result.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');
      expect(result.diagnostics[0].location.line).toBe(3);
    });

    it('flags document.write, document.writeln, and insertAdjacentHTML', () => {
      const code = `
        document.write('<h1>Danger</h1>');
        document.writeln('<p>More danger</p>');
        window.document.write('<div>Win doc</div>');
        element.insertAdjacentHTML('beforeend', '<p>injected</p>');
      `;
      const result = scanFile('test.js', code, { rules: [secNoUnsafeDomSink] });
      expect(result.errorCount).toBe(4);
      expect(result.diagnostics[0].message).toContain('document.write()');
      expect(result.diagnostics[3].message).toContain('insertAdjacentHTML()');
    });

    it('flags optional call expressions (e.g. el?.insertAdjacentHTML?.(...))', () => {
      const code = `
        el?.insertAdjacentHTML?.('afterbegin', html);
        document?.write?.('<p>evil</p>');
        window?.document?.writeln?.('<p>evil2</p>');
      `;
      const result = scanFile('test.js', code, { rules: [secNoUnsafeDomSink] });
      expect(result.errorCount).toBe(3);
      for (const diag of result.diagnostics) {
        expect(diag.ruleId).toBe('sec-no-unsafe-dom-sink');
      }
    });

    it('allows safe text properties, reading innerHTML, and non-document writes', () => {
      const code = `
        const div = document.createElement('div');
        div.textContent = 'Safe content';
        div.innerText = 'Safe text';
        const html = div.innerHTML; // read-only is safe!
        const stream = { write(chunk) {} };
        stream.write('chunk'); // non-document write
      `;
      const result = scanFile('test.js', code, { rules: [secNoUnsafeDomSink] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('Rule: sec-no-prototype-pollution', () => {
    it('flags direct mutation of __proto__', () => {
      const code = `
        const user = {};
        user.__proto__.isAdmin = true;
        obj.__proto__ = evil;
        obj['__proto__'] = evil;
      `;
      const result = scanFile('test.js', code, { rules: [secNoPrototypePollution] });
      expect(result.errorCount).toBe(3);
      expect(result.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');
      expect(result.diagnostics[0].location.line).toBe(3);
      expect(result.diagnostics[0].message).toContain('__proto__');
    });

    it('flags mutations to Object.prototype', () => {
      const code = `
        Object.prototype.isAdmin = true;
        Object.prototype = {};
        window.Object.prototype.polluted = true;
      `;
      const result = scanFile('test.js', code, { rules: [secNoPrototypePollution] });
      expect(result.errorCount).toBe(3);
      expect(result.diagnostics[0].message).toContain('Object.prototype');
    });

    it('flags Object.setPrototypeOf, Reflect.setPrototypeOf, and Object.defineProperty on Object.prototype', () => {
      const code = `
        Object.setPrototypeOf(target, proto);
        Reflect.setPrototypeOf(target, proto);
        Object.defineProperty(Object.prototype, 'pollutedProp', { value: 1 });
      `;
      const result = scanFile('test.js', code, { rules: [secNoPrototypePollution] });
      expect(result.errorCount).toBe(3);
    });

    it('flags optional call expressions (e.g. Object?.setPrototypeOf?.(...))', () => {
      const code = `
        Object?.setPrototypeOf?.(target, proto);
        Reflect?.setPrototypeOf?.(target, proto);
        Object?.defineProperty?.(Object.prototype, 'bad', { value: 1 });
      `;
      const result = scanFile('test.js', code, { rules: [secNoPrototypePollution] });
      expect(result.errorCount).toBe(3);
      for (const diag of result.diagnostics) {
        expect(diag.ruleId).toBe('sec-no-prototype-pollution');
      }
    });

    it('allows safe object operations: Object.create(null), Map, Object.assign, reading proto', () => {
      const code = `
        const cleanMap = Object.create(null);
        const map = new Map();
        const clone = Object.assign({}, { a: 1 });
        const proto = Object.getPrototypeOf(cleanMap);
        const inspectProto = cleanMap.__proto__; // reading is safe
        function MyClass() {}
        MyClass.prototype.render = function() {}; // class prototype is safe
      `;
      const result = scanFile('test.js', code, { rules: [secNoPrototypePollution] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('Rule: sec-no-script-injection', () => {
    it('flags document.createElement("script") with case-insensitivity and templates', () => {
      const code = `
        const s1 = document.createElement('script');
        const s2 = document.createElement('SCRIPT');
        const s3 = document.createElement(\`script\`);
        const s4 = window.document.createElement('script');
      `;
      const result = scanFile('test.js', code, { rules: [secNoScriptInjection] });
      expect(result.errorCount).toBe(4);
      expect(result.diagnostics[0].ruleId).toBe('sec-no-script-injection');
      expect(result.diagnostics[0].location.line).toBe(2);
      expect(result.diagnostics[0].suggestion).toContain('// @require');
    });

    it('flags document.createElementNS for script elements', () => {
      const code = `
        const s = document.createElementNS('http://www.w3.org/1999/xhtml', 'script');
      `;
      const result = scanFile('test.js', code, { rules: [secNoScriptInjection] });
      expect(result.errorCount).toBe(1);
    });

    it('allows safe element creation: div, button, canvas, svg, style', () => {
      const code = `
        const btn = document.createElement('button');
        const div = document.createElement('div');
        const canvas = document.createElement('canvas');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const reactEl = { createElement(tag) { return tag; } };
        reactEl.createElement('script'); // non-document object
      `;
      const result = scanFile('test.js', code, { rules: [secNoScriptInjection] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });
  });
});
