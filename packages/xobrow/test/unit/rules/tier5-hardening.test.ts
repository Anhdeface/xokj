/**
 * Tier 5 White-Box Adversarial Coverage Hardening Test Suite
 * Target: packages/xobrow
 * Scope: Security Policy Enforcement & Resource Leak Rules
 * Author: Challenger M3-1 & Worker M3-2
 *
 * This suite conducts white-box adversarial stress tests probing and validating:
 * 1. Member expression function calls (.call, .apply, .bind) on eval, Function, timers, DOM sinks, and listeners.
 * 2. Sequence expressions ((0, fn)(...)) on function invocations, timers, and cleanup calls.
 * 3. Prototype pollution vectors via Object.assign, Reflect.set, and non-literal prototype access.
 * 4. Nested loops with switch statements, labeled breaks, and non-literal unbounded loop predicates.
 * 5. Computed member access (bracket notation) across event listeners, intervals, and CDP calls.
 * 6. Cross-target reconciliation soundness in event listener lifecycle tracking.
 * 7. Destructuring assignments and string concatenation in DOM sinks and element creation.
 */

import { describe, it, expect } from 'vitest';
import { scanFile } from '../../../src/engine/scanner.js';

describe('Tier 5 Adversarial Coverage Hardening: Security & Leak Rules', () => {

  // =========================================================================
  // GROUP 1: Member Expression Function Calls (.call, .apply, .bind)
  // =========================================================================
  describe('Group 1: Member Expression Function Calls (.call, .apply, .bind)', () => {
    describe('sec-no-eval dispatches', () => {
      it('catches direct eval.call(null, "...") and eval.apply(null, ["..."])', () => {
        const resCall = scanFile('test.js', 'eval.call(null, "2 + 2");');
        expect(resCall.errorCount).toBe(1);
        expect(resCall.diagnostics[0].ruleId).toBe('sec-no-eval');

        const resApply = scanFile('test.js', 'eval.apply(null, ["2 + 2"]);');
        expect(resApply.errorCount).toBe(1);
        expect(resApply.diagnostics[0].ruleId).toBe('sec-no-eval');
      });

      it('probes window.eval.call(null, "...") [BYPASS-SEC-01]', () => {
        const res = scanFile('test.js', 'window.eval.call(null, "2 + 2");');
        // Hardened: unwrapCall unwraps .call and recognizes window.eval
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-eval');
      });

      it('probes globalThis.eval.apply(null, ["..."]) [BYPASS-SEC-02]', () => {
        const res = scanFile('test.js', 'globalThis.eval.apply(null, ["2 + 2"]);');
        // Hardened: unwrapCall unwraps .apply and recognizes globalThis.eval
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-eval');
      });
    });

    describe('sec-no-new-function dispatches', () => {
      it('catches Function.call(null, "...") and Function.apply(null, ["..."])', () => {
        const resCall = scanFile('test.js', 'Function.call(null, "return 1")();');
        expect(resCall.errorCount).toBe(1);
        expect(resCall.diagnostics[0].ruleId).toBe('sec-no-new-function');

        const resApply = scanFile('test.js', 'Function.apply(null, ["return 1"])();');
        expect(resApply.errorCount).toBe(1);
        expect(resApply.diagnostics[0].ruleId).toBe('sec-no-new-function');
      });

      it('probes window.Function.call(null, "...") [BYPASS-SEC-03]', () => {
        const res = scanFile('test.js', 'window.Function.call(null, "return 1")();');
        // Hardened: unwrapCall unwraps .call and checks window.Function
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-new-function');
      });
    });

    describe('sec-no-string-timers dispatches', () => {
      it('probes setTimeout.call(null, "alert(1)", 100) [BYPASS-SEC-04]', () => {
        const res = scanFile('test.js', 'setTimeout.call(null, "alert(1)", 100);');
        // Hardened: unwrapCall shifts arguments and checks timer name
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-string-timers');
      });

      it('probes window.setTimeout.call(null, "alert(1)", 100) [BYPASS-SEC-05]', () => {
        const res = scanFile('test.js', 'window.setTimeout.call(null, "alert(1)", 100);');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-string-timers');
      });
    });

    describe('sec-no-unsafe-dom-sink dispatches', () => {
      it('probes document.write.call(document, payload) [BYPASS-SEC-06]', () => {
        const res = scanFile('test.js', 'document.write.call(document, "<h1>evil</h1>");');
        // Hardened: unwrapCall recognizes document.write under .call
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');
      });

      it('probes element.insertAdjacentHTML.call(el, position, payload) [BYPASS-SEC-07]', () => {
        const res = scanFile('test.js', 'el.insertAdjacentHTML.call(el, "afterbegin", "<b>evil</b>");');
        // Hardened: insertAdjacentHTML recognized under .call
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');
      });
    });

    describe('sec-no-script-injection dispatches', () => {
      it('probes document.createElement.call(document, "script") [BYPASS-SEC-08]', () => {
        const res = scanFile('test.js', 'document.createElement.call(document, "script");');
        // Hardened: createElement under .call recognized
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-script-injection');
      });

      it('probes document.createElementNS.call(document, ns, "script") [BYPASS-SEC-09]', () => {
        const res = scanFile('test.js', 'document.createElementNS.call(document, "http://www.w3.org/1999/xhtml", "script");');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-script-injection');
      });
    });

    describe('leak rules member dispatches', () => {
      it('probes window.addEventListener.call(window, "click", handler) [BYPASS-LEAK-01]', () => {
        const res = scanFile('test.js', 'window.addEventListener.call(window, "click", () => {});');
        // Hardened: addEventListener recognized under .call
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('leak-uncleaned-event-listener');
      });

      it('probes window.setInterval.call(window, fn, 1000) [BYPASS-LEAK-02]', () => {
        const res = scanFile('test.js', 'window.setInterval.call(window, () => {}, 1000);');
        // Hardened: setInterval recognized under .call
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('leak-lingering-interval');
      });

      it('probes cdp.on unbind invoked via unbind.call(null) [FP-LEAK-01]', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          const unbind = cdp.on("Page.loadEventFired", () => {});
          unbind.call(null);
        `;
        const res = scanFile('test.js', code);
        // Hardened: unbind.call(null) unwraps to 'unbind', eliminating false positive
        expect(res.errorCount).toBe(0);
      });
    });
  });

  // =========================================================================
  // GROUP 2: Sequence Expressions & Parenthesized Operators
  // =========================================================================
  describe('Group 2: Sequence Expressions & Parenthesized Operators', () => {
    it('catches indirect sequence eval: (0, eval)("...") and (0, window.eval)("...")', () => {
      const res1 = scanFile('test.js', '(0, eval)("2 + 2");');
      expect(res1.errorCount).toBe(1);
      expect(res1.diagnostics[0].ruleId).toBe('sec-no-eval');

      const res2 = scanFile('test.js', '(0, window.eval)("2 + 2");');
      expect(res2.errorCount).toBe(1);
      expect(res2.diagnostics[0].ruleId).toBe('sec-no-eval');

      const res3 = scanFile('test.js', '((0, 1), eval)("2 + 2");');
      expect(res3.errorCount).toBe(1);
      expect(res3.diagnostics[0].ruleId).toBe('sec-no-eval');
    });

    it('catches (0, Function)("...") but probes (0, window.Function)("...") [BYPASS-SEC-10]', () => {
      const res1 = scanFile('test.js', '(0, Function)("return 1")();');
      expect(res1.errorCount).toBe(1);
      expect(res1.diagnostics[0].ruleId).toBe('sec-no-new-function');

      const res2 = scanFile('test.js', '(0, window.Function)("return 1")();');
      // Hardened: SequenceExpression unwrapped, window.Function caught
      expect(res2.errorCount).toBe(1);
      expect(res2.diagnostics[0].ruleId).toBe('sec-no-new-function');
    });

    it('probes sequence expression on timer (0, setTimeout)("alert(1)", 100) [BYPASS-SEC-11]', () => {
      const res = scanFile('test.js', '(0, setTimeout)("alert(1)", 100);');
      // Hardened: SequenceExpression unwrapped, setTimeout caught
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-string-timers');
    });

    it('probes sequence expression on interval (0, setInterval)(fn, 1000) [BYPASS-LEAK-03]', () => {
      const res = scanFile('test.js', '(0, setInterval)(() => {}, 1000);');
      // Hardened: SequenceExpression unwrapped, setInterval caught
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('leak-lingering-interval');
    });

    it('probes clearInterval invoked via sequence expression (0, clearInterval)(id) [FP-LEAK-02]', () => {
      const code = `
        const id = setInterval(() => {}, 1000);
        (0, clearInterval)(id);
      `;
      const res = scanFile('test.js', code);
      // Hardened: (0, clearInterval)(id) unwrapped, registered in clearedHandles, false positive eliminated
      expect(res.errorCount).toBe(0);
    });

    it('probes sequence expression on createElement (0, document.createElement)("script") [BYPASS-SEC-12]', () => {
      const res = scanFile('test.js', '(0, document.createElement)("script");');
      // Hardened: SequenceExpression unwrapped, document.createElement caught
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-script-injection');
    });

    it('probes sequence expression on addEventListener (0, window.addEventListener) [BYPASS-LEAK-04]', () => {
      const res = scanFile('test.js', '(0, window.addEventListener)("click", () => {});');
      // Hardened: SequenceExpression unwrapped, addEventListener caught
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('leak-uncleaned-event-listener');
    });

    it('probes sequence expression on cdp.send inside async loop [BYPASS-LEAK-05]', () => {
      const code = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await (0, cdp.send)("Page.navigate", {});
        }
      `;
      const res = scanFile('test.js', code);
      // Hardened: (0, cdp.send) unwrapped, recognized by isCdpCall & matchCdpCall
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('leak-unbounded-async-loop');
    });
  });

  // =========================================================================
  // GROUP 3: Prototype Pollution via Object.assign, Reflect & Indirect Mutators
  // =========================================================================
  describe('Group 3: Prototype Pollution via Object.assign, Reflect & Indirect Mutators', () => {
    it('catches direct mutations to __proto__ and Object.prototype', () => {
      const res1 = scanFile('test.js', 'obj.__proto__.polluted = true;');
      expect(res1.errorCount).toBe(1);
      expect(res1.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');

      const res2 = scanFile('test.js', 'Object.prototype.isAdmin = true;');
      expect(res2.errorCount).toBe(1);
      expect(res2.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');

      const res3 = scanFile('test.js', 'a.b.c.__proto__.deep = true;');
      expect(res3.errorCount).toBe(1);
      expect(res3.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');
    });

    it('catches Object.setPrototypeOf and Object.defineProperty on Object.prototype', () => {
      const res1 = scanFile('test.js', 'Object.setPrototypeOf(child, parent);');
      expect(res1.errorCount).toBe(1);
      expect(res1.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');

      const res2 = scanFile('test.js', 'Object.defineProperty(Object.prototype, "p", { value: 1 });');
      expect(res2.errorCount).toBe(1);
      expect(res2.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');

      const res3 = scanFile('test.js', 'Object.defineProperties(Object.prototype, { p: { value: 1 } });');
      expect(res3.errorCount).toBe(1);
      expect(res3.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');
    });

    it('permits safe Object.create(null) and Object.assign({}, ...)', () => {
      const res = scanFile('test.js', 'const dict = Object.create(null); const copy = Object.assign({}, source);');
      expect(res.errorCount).toBe(0);
    });

    it('probes Object.assign targeting Object.prototype [BYPASS-SEC-13]', () => {
      const res = scanFile('test.js', 'Object.assign(Object.prototype, { isAdmin: true });');
      // Hardened: Object.assign on Object.prototype caught
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');
    });

    it('probes Object.assign targeting obj.__proto__ [BYPASS-SEC-14]', () => {
      const res = scanFile('test.js', 'Object.assign(obj.__proto__, { isAdmin: true });');
      // Hardened: Object.assign on obj.__proto__ caught
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');
    });

    it('probes Reflect.set targeting Object.prototype [BYPASS-SEC-15]', () => {
      const res = scanFile('test.js', 'Reflect.set(Object.prototype, "isAdmin", true);');
      // Hardened: Reflect.set on Object.prototype caught
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');
    });

    it('probes Reflect.defineProperty targeting Object.prototype [BYPASS-SEC-16]', () => {
      const res = scanFile('test.js', 'Reflect.defineProperty(Object.prototype, "p", { value: 1 });');
      // Hardened: Reflect.defineProperty on Object.prototype caught
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');
    });

    it('probes Object.defineProperty targeting obj.__proto__ [BYPASS-SEC-17]', () => {
      const res = scanFile('test.js', 'Object.defineProperty(obj.__proto__, "p", { value: 1 });');
      // Hardened: Object.defineProperty on obj.__proto__ caught
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');
    });
  });

  // =========================================================================
  // GROUP 4: Asynchronous Loop Structures, Switches, Labeled Jumps & Unbounded Loops
  // =========================================================================
  describe('Group 4: Asynchronous Loop Structures, Switches, Labeled Jumps & Unbounded Loops', () => {
    it('catches while(true) with break inside switch that fails to break outer loop', () => {
      const code = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await cdp.send("Page.navigate", {});
          switch (state) {
            case 1: break;
          }
          await delay(500);
        }
      `;
      const res = scanFile('test.js', code);
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('leak-unbounded-async-loop');
      expect(res.diagnostics[0].message).toContain('lacks an exit condition');
    });

    it('catches while(true) with break inside inner nested loop that does not break outer loop', () => {
      const code = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await cdp.send("Page.navigate", {});
          for (let i = 0; i < 5; i++) {
            if (i === 2) break;
          }
          await delay(500);
        }
      `;
      const res = scanFile('test.js', code);
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('leak-unbounded-async-loop');
      expect(res.diagnostics[0].message).toContain('lacks an exit condition');
    });

    it('passes while(true) loop with genuine throttling delay and outer break condition', () => {
      const code = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (true) {
          await cdp.send("Page.navigate", {});
          await delay(500);
          if (done) break;
        }
      `;
      const res = scanFile('test.js', code);
      expect(res.errorCount).toBe(0);
    });

    it('probes labeled break outer from switch statement [FP-LEAK-03]', () => {
      const code = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        outer: while (true) {
          await cdp.send("Page.navigate", {});
          switch (x) {
            case 1: break outer;
          }
          await delay(500);
        }
      `;
      const res = scanFile('test.js', code);
      // Hardened: labeled break 'break outer;' recognized, false positive eliminated
      expect(res.errorCount).toBe(0);
    });

    it('probes labeled break outer from nested loop [FP-LEAK-04]', () => {
      const code = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        outer: while (true) {
          await cdp.send("Page.navigate", {});
          for (let i = 0; i < 10; i++) {
            if (i === 5) break outer;
          }
          await delay(500);
        }
      `;
      const res = scanFile('test.js', code);
      // Hardened: labeled break 'break outer;' recognized, false positive eliminated
      expect(res.errorCount).toBe(0);
    });

    it('probes infinite loop with truthy unary expression while (!0) [BYPASS-LEAK-06]', () => {
      const code = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (!0) {
          await cdp.send("Page.navigate", {});
          await delay(500);
        }
      `;
      const res = scanFile('test.js', code);
      // Hardened: !0 evaluated statically as true, caught as lacking exit condition
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('leak-unbounded-async-loop');
    });

    it('probes infinite loop with truthy binary expression while (1 === 1) [BYPASS-LEAK-07]', () => {
      const code = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        while (1 === 1) {
          await cdp.send("Page.navigate", {});
          await delay(500);
        }
      `;
      const res = scanFile('test.js', code);
      // Hardened: 1 === 1 evaluated statically as true, caught as lacking exit condition
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('leak-unbounded-async-loop');
    });
  });

  // =========================================================================
  // GROUP 5: Computed Member Access & Bracket Notation Evasions
  // =========================================================================
  describe('Group 5: Computed Member Access & Bracket Notation Evasions', () => {
    it('catches bracket notation on global eval window["eval"]("...") and globalThis["eval"]("...")', () => {
      const res1 = scanFile('test.js', 'window["eval"]("2 + 2");');
      expect(res1.errorCount).toBe(1);
      expect(res1.diagnostics[0].ruleId).toBe('sec-no-eval');

      const res2 = scanFile('test.js', 'globalThis["eval"]("2 + 2");');
      expect(res2.errorCount).toBe(1);
      expect(res2.diagnostics[0].ruleId).toBe('sec-no-eval');
    });

    it('probes computed bracket notation window["addEventListener"](...) [BYPASS-LEAK-08]', () => {
      const res = scanFile('test.js', 'window["addEventListener"]("click", () => {});');
      // Hardened: window["addEventListener"] recognized via getStaticPropertyName
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('leak-uncleaned-event-listener');
    });

    it('probes computed bracket notation window["setInterval"](...) [BYPASS-LEAK-09]', () => {
      const res = scanFile('test.js', 'window["setInterval"](() => {}, 1000);');
      // Hardened: window["setInterval"] recognized via getStaticPropertyName
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('leak-lingering-interval');
    });

    it('probes computed bracket notation cdp["on"](...) [BYPASS-LEAK-10]', () => {
      const code = `
        // ==UserScript==
        // @grant GM_cdp
        // ==/UserScript==
        cdp["on"]("Page.loadEventFired", () => {});
      `;
      const res = scanFile('test.js', code);
      // Hardened: cdp["on"] recognized via getStaticPropertyName
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('leak-unclosed-cdp-listener');
    });

    it('probes computed bracket notation cdp["send"](...) in loop and permission check [BYPASS-LEAK-11]', () => {
      const code = `
        // ==UserScript==
        // @grant none
        // ==/UserScript==
        while (true) {
          await cdp["send"]("InvalidDomain.fakeMethod", "invalid-payload");
        }
      `;
      const res = scanFile('test.js', code);
      // Hardened: matchCdpCall handles cdp["send"], triggering all rules
      expect(res.errorCount).toBe(4);
      const ruleIds = res.diagnostics.map((d) => d.ruleId);
      expect(ruleIds).toContain('cdp-header-permission');
      expect(ruleIds).toContain('cdp-valid-domain-method');
      expect(ruleIds).toContain('cdp-valid-payload');
      expect(ruleIds).toContain('leak-unbounded-async-loop');
    });
  });

  // =========================================================================
  // GROUP 6: Event Listener Cross-Target Reconciliation & Option Boundary Evasions
  // =========================================================================
  describe('Group 6: Event Listener Cross-Target Reconciliation & Option Boundary Evasions', () => {
    it('properly reconciles matching addEventListener and removeEventListener on window', () => {
      const code = `
        function onResize() {}
        window.addEventListener('resize', onResize);
        window.removeEventListener('resize', onResize);
      `;
      const res = scanFile('test.js', code);
      expect(res.errorCount).toBe(0);
    });

    it('exempts event listener with { once: true } and AbortSignal { signal }', () => {
      const res1 = scanFile('test.js', 'window.addEventListener("click", () => {}, { once: true });');
      expect(res1.errorCount).toBe(0);

      const res2 = scanFile('test.js', 'window.addEventListener("click", () => {}, { signal: controller.signal });');
      expect(res2.errorCount).toBe(0);

      const res3 = scanFile('test.js', 'const signal = c.signal; window.addEventListener("click", () => {}, { signal });');
      expect(res3.errorCount).toBe(0);
    });

    it('probes cross-target leak masking: btn listener masked by window removeEventListener [SOUNDNESS-LEAK-01]', () => {
      const code = `
        function onClick() {}
        btn.addEventListener('click', onClick);
        window.removeEventListener('click', onClick);
      `;
      const res = scanFile('test.js', code);
      // Hardened: window.removeEventListener does not match btn.addEventListener, leak correctly reported
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('leak-uncleaned-event-listener');
    });

    it('probes inverse cross-target leak masking: window listener masked by btn removeEventListener [SOUNDNESS-LEAK-02]', () => {
      const code = `
        function onClick() {}
        window.addEventListener('click', onClick);
        btn.removeEventListener('click', onClick);
      `;
      const res = scanFile('test.js', code);
      // Hardened: btn.removeEventListener does not match window.addEventListener, leak correctly reported
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('leak-uncleaned-event-listener');
    });

    it('probes unary expression in options { once: !0 } [FP-LEAK-05]', () => {
      const res = scanFile('test.js', 'window.addEventListener("click", () => {}, { once: !0 });');
      // Hardened: !0 evaluated as true, exempting the listener, false positive eliminated
      expect(res.errorCount).toBe(0);
    });
  });

  // =========================================================================
  // GROUP 7: DOM Sink Destructuring & Dynamic Concatenation Evasions
  // =========================================================================
  describe('Group 7: DOM Sink Destructuring & Dynamic Concatenation Evasions', () => {
    it('catches assignments to innerHTML, outerHTML, and document.write', () => {
      const res1 = scanFile('test.js', 'el.innerHTML = payload;');
      expect(res1.errorCount).toBe(1);
      expect(res1.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');

      const res2 = scanFile('test.js', 'el["outerHTML"] = payload;');
      expect(res2.errorCount).toBe(1);
      expect(res2.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');

      const res3 = scanFile('test.js', 'document.write(payload);');
      expect(res3.errorCount).toBe(1);
      expect(res3.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');
    });

    it('probes array destructuring assignment to innerHTML [BYPASS-SEC-18]', () => {
      const res = scanFile('test.js', '[el.innerHTML] = ["<img src=x>"];');
      // Hardened: extractLValues extracts el.innerHTML from ArrayPattern
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');
    });

    it('probes object destructuring assignment to innerHTML [BYPASS-SEC-19]', () => {
      const res = scanFile('test.js', '({ innerHTML: el.innerHTML } = { innerHTML: "<img src=x>" });');
      // Hardened: extractLValues extracts el.innerHTML from ObjectPattern
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');
    });

    it('probes string concatenation in createElement("scr" + "ipt") [BYPASS-SEC-20]', () => {
      const res = scanFile('test.js', 'document.createElement("scr" + "ipt");');
      // Hardened: "scr" + "ipt" statically evaluated to "script"
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-script-injection');
    });

    it('probes conditional expression in setTimeout(condition ? "alert(1)" : "alert(2)", 100) [BYPASS-SEC-21]', () => {
      const res = scanFile('test.js', 'setTimeout(true ? "alert(1)" : "alert(2)", 100);');
      // Hardened: ConditionalExpression branches checked for string values
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-string-timers');
    });

    it('probes chained global window.window.eval("2 + 2") [BYPASS-SEC-22]', () => {
      const res = scanFile('test.js', 'window.window.eval("2 + 2");');
      // Hardened: isGlobalObject supports chained globals (window.window)
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-eval');
    });
  });

  // =========================================================================
  // GROUP 8: Obfuscated Composite Exploits
  // =========================================================================
  describe('Group 8: Obfuscated Composite Exploits', () => {
    it('catches complex parenthesized and multi-line eval patterns', () => {
      const code = `
        /* comment */
        (((
          eval
        )))("payload");
      `;
      const res = scanFile('test.js', code);
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-eval');
    });

    it('catches string timer with deep binary concatenation and template expressions', () => {
      const code = `
        setTimeout("al" + ("er" + \`t(\${1+1})\`), 100);
      `;
      const res = scanFile('test.js', code);
      expect(res.errorCount).toBe(1);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-string-timers');
    });

    it('catches multiple chained prototype mutations in single AST statement', () => {
      const code = `
        a.__proto__.b = c.__proto__.d = true;
      `;
      const res = scanFile('test.js', code);
      expect(res.errorCount).toBe(2);
      expect(res.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');
      expect(res.diagnostics[1].ruleId).toBe('sec-no-prototype-pollution');
    });
  });
});
