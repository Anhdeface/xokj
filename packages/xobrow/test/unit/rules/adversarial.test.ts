import { describe, it, expect } from 'vitest';
import { scanFile } from '../../../src/engine/scanner.js';
import { validateCdpCommand } from '../../../src/rules/cdp/cdp-catalog.js';

describe('Adversarial Verification: Milestone 2 Multi-Category Rules Engine', () => {
  // =========================================================================
  // 1. Security Rules Adversarial Probing
  // =========================================================================
  describe('1. Security Policy Enforcement', () => {
    describe('sec-no-eval', () => {
      it('catches direct eval() call', () => {
        const res = scanFile('test.js', 'eval("2 + 2");');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-eval');
      });

      it('catches indirect sequence eval: (0, eval)("...")', () => {
        const res = scanFile('test.js', '(0, eval)("2 + 2");');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-eval');
        expect(res.diagnostics[0].message).toContain('Indirect call to eval()');
      });

      it('catches parenthesized eval: (eval)("...")', () => {
        const res = scanFile('test.js', '(eval)("2 + 2");');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-eval');
      });

      it('catches member window["eval"]("...") and globalThis.eval("...")', () => {
        const res1 = scanFile('test.js', 'window["eval"]("2 + 2");');
        expect(res1.errorCount).toBe(1);
        expect(res1.diagnostics[0].ruleId).toBe('sec-no-eval');

        const res2 = scanFile('test.js', 'globalThis.eval("2 + 2");');
        expect(res2.errorCount).toBe(1);
        expect(res2.diagnostics[0].ruleId).toBe('sec-no-eval');
      });

      it('catches indirect (0, window.eval)("...")', () => {
        const res = scanFile('test.js', '(0, window.eval)("2 + 2");');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-eval');
      });

      it('catches eval.call() and eval.apply()', () => {
        const res1 = scanFile('test.js', 'eval.call(null, "2 + 2");');
        expect(res1.errorCount).toBe(1);
        expect(res1.diagnostics[0].ruleId).toBe('sec-no-eval');

        const res2 = scanFile('test.js', 'eval.apply(null, ["2 + 2"]);');
        expect(res2.errorCount).toBe(1);
        expect(res2.diagnostics[0].ruleId).toBe('sec-no-eval');
      });

      it('does NOT flag benign custom eval method on non-global object', () => {
        const res = scanFile('test.js', 'const calc = { eval: (x) => x }; calc.eval("2 + 2");');
        expect(res.errorCount).toBe(0);
      });
    });

    describe('sec-no-new-function', () => {
      it('catches new Function() and dynamic Function() calls', () => {
        const res1 = scanFile('test.js', 'new Function("return 1")();');
        expect(res1.errorCount).toBe(1);
        expect(res1.diagnostics[0].ruleId).toBe('sec-no-new-function');

        const res2 = scanFile('test.js', 'Function("return 1")();');
        expect(res2.errorCount).toBe(1);
        expect(res2.diagnostics[0].ruleId).toBe('sec-no-new-function');
      });

      it('catches indirect (0, Function)() and window.Function()', () => {
        const res1 = scanFile('test.js', '(0, Function)("return 1")();');
        expect(res1.errorCount).toBe(1);
        expect(res1.diagnostics[0].ruleId).toBe('sec-no-new-function');

        const res2 = scanFile('test.js', 'window.Function("return 1")();');
        expect(res2.errorCount).toBe(1);
        expect(res2.diagnostics[0].ruleId).toBe('sec-no-new-function');
      });

      it('does NOT flag standard function calls or closures', () => {
        const res = scanFile('test.js', 'function doSomething() { return 1; } doSomething();');
        expect(res.errorCount).toBe(0);
      });
    });

    describe('sec-no-string-timers', () => {
      it('catches string literal callbacks in setTimeout and setInterval', () => {
        const res1 = scanFile('test.js', 'setTimeout("alert(1)", 100);');
        expect(res1.errorCount).toBe(1);
        expect(res1.diagnostics[0].ruleId).toBe('sec-no-string-timers');

        const res2 = scanFile('test.js', 'const t = setInterval("alert(1)", 100); clearInterval(t);');
        expect(res2.errorCount).toBe(1);
        expect(res2.diagnostics[0].ruleId).toBe('sec-no-string-timers');
      });

      it('catches concatenated and nested string expressions in timers', () => {
        const res = scanFile('test.js', 'setTimeout("al" + ("er" + "t(1)"), 100);');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-string-timers');
      });

      it('catches template literal callbacks in timers', () => {
        const res = scanFile('test.js', 'setTimeout(`alert(${location.href})`, 100);');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-string-timers');
      });

      it('does NOT flag safe function callbacks in timers', () => {
        const res = scanFile('test.js', 'setTimeout(() => console.log("ok"), 100);');
        expect(res.errorCount).toBe(0);
      });
    });

    describe('sec-no-unsafe-dom-sink', () => {
      it('catches assignments to innerHTML and outerHTML', () => {
        const res1 = scanFile('test.js', 'el.innerHTML = payload;');
        expect(res1.errorCount).toBe(1);
        expect(res1.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');

        const res2 = scanFile('test.js', 'el["outerHTML"] = payload;');
        expect(res2.errorCount).toBe(1);
        expect(res2.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');
      });

      it('catches document.write, document.writeln, and insertAdjacentHTML', () => {
        const res1 = scanFile('test.js', 'document.write(payload);');
        expect(res1.errorCount).toBe(1);
        expect(res1.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');

        const res2 = scanFile('test.js', 'window.document.writeln(payload);');
        expect(res2.errorCount).toBe(1);
        expect(res2.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');

        const res3 = scanFile('test.js', 'el.insertAdjacentHTML("afterbegin", payload);');
        expect(res3.errorCount).toBe(1);
        expect(res3.diagnostics[0].ruleId).toBe('sec-no-unsafe-dom-sink');
      });

      it('does NOT flag safe DOM sinks such as textContent and innerText', () => {
        const res = scanFile('test.js', 'el.textContent = payload; el.innerText = payload;');
        expect(res.errorCount).toBe(0);
      });
    });

    describe('sec-no-prototype-pollution', () => {
      it('catches mutations to __proto__ and Object.prototype', () => {
        const res1 = scanFile('test.js', 'obj.__proto__.polluted = true;');
        expect(res1.errorCount).toBe(1);
        expect(res1.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');

        const res2 = scanFile('test.js', 'Object.prototype.isAdmin = true;');
        expect(res2.errorCount).toBe(1);
        expect(res2.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');
      });

      it('catches Object.setPrototypeOf and Reflect.setPrototypeOf', () => {
        const res1 = scanFile('test.js', 'Object.setPrototypeOf(a, b);');
        expect(res1.errorCount).toBe(1);
        expect(res1.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');

        const res2 = scanFile('test.js', 'window.Reflect.setPrototypeOf(a, b);');
        expect(res2.errorCount).toBe(1);
        expect(res2.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');
      });

      it('catches Object.defineProperty on Object.prototype', () => {
        const res = scanFile('test.js', 'Object.defineProperty(Object.prototype, "p", { value: 1 });');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-prototype-pollution');
      });

      it('does NOT flag safe prototype methods Object.create(null) and Object.assign({}, ...)', () => {
        const res = scanFile('test.js', 'const dict = Object.create(null); const copy = Object.assign({}, source);');
        expect(res.errorCount).toBe(0);
      });
    });

    describe('sec-no-script-injection', () => {
      it('catches createElement("script") case-insensitively and with whitespace', () => {
        const res1 = scanFile('test.js', 'document.createElement("script");');
        expect(res1.errorCount).toBe(1);
        expect(res1.diagnostics[0].ruleId).toBe('sec-no-script-injection');

        const res2 = scanFile('test.js', 'document.createElement(" SCRIPT ");');
        expect(res2.errorCount).toBe(1);
        expect(res2.diagnostics[0].ruleId).toBe('sec-no-script-injection');
      });

      it('catches document.createElementNS for script elements', () => {
        const res = scanFile('test.js', 'window.document.createElementNS("http://www.w3.org/1999/xhtml", "script");');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('sec-no-script-injection');
      });

      it('does NOT flag safe elements like div, button, span', () => {
        const res = scanFile('test.js', 'document.createElement("button"); document.createElement("div");');
        expect(res.errorCount).toBe(0);
      });
    });
  });

  // =========================================================================
  // 2. Resource Leak Rules Adversarial Probing
  // =========================================================================
  describe('2. Resource Leak Detection', () => {
    describe('leak-uncleaned-event-listener', () => {
      it('flags anonymous inline event listeners without cleanup exemptions', () => {
        const res = scanFile('test.js', 'window.addEventListener("click", () => {});');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('leak-uncleaned-event-listener');
      });

      it('exempts event listeners with { once: true }', () => {
        const res = scanFile('test.js', 'window.addEventListener("click", () => {}, { once: true });');
        expect(res.errorCount).toBe(0);
      });

      it('exempts event listeners with AbortSignal binding', () => {
        const res = scanFile('test.js', 'window.addEventListener("click", () => {}, { signal: controller.signal });');
        expect(res.errorCount).toBe(0);
      });

      it('reconciles named event listeners paired with removeEventListener', () => {
        const code = `
          function onResize() {}
          window.addEventListener('resize', onResize);
          window.removeEventListener('resize', onResize);
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(0);
      });

      it('flags mismatched targets between add and remove', () => {
        const code = `
          function onClick() {}
          btn1.addEventListener('click', onClick);
          btn2.removeEventListener('click', onClick);
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('leak-uncleaned-event-listener');
        expect(res.diagnostics[0].message).toContain("registered on 'btn1' is never cleaned up");
      });
    });

    describe('leak-lingering-interval', () => {
      it('flags setInterval when return handle is discarded', () => {
        const res = scanFile('test.js', 'setInterval(() => {}, 1000);');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('leak-lingering-interval');
        expect(res.diagnostics[0].message).toContain('return handle is discarded');
      });

      it('flags setInterval when handle is stored but clearInterval is omitted', () => {
        const res = scanFile('test.js', 'const timerId = setInterval(() => {}, 1000);');
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('leak-lingering-interval');
        expect(res.diagnostics[0].message).toContain("timer handle 'timerId' is never cleared");
      });

      it('passes when timer handle is cancelled via clearInterval()', () => {
        const code = `
          const id = setInterval(() => {}, 1000);
          function cleanup() {
            clearInterval(id);
          }
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(0);
      });

      it('flags nested interval when inner interval is uncleaned', () => {
        const code = `
          const id1 = setInterval(() => {
            const id2 = setInterval(() => {}, 500);
          }, 1000);
          clearInterval(id1);
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('leak-lingering-interval');
        expect(res.diagnostics[0].message).toContain("timer handle 'id2' is never cleared");
      });
    });

    describe('leak-unclosed-cdp-listener', () => {
      it('flags cdp.on when unbind callback is not captured or invoked', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          cdp.on("Page.loadEventFired", () => {});
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('leak-unclosed-cdp-listener');
      });

      it('passes when unbind callback is captured and called', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          const unbind = cdp.on("Page.loadEventFired", () => {});
          unbind();
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(0);
      });

      it('passes when cdp.off is invoked with matching event and handler', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          function onPageLoad() {}
          cdp.on("Page.loadEventFired", onPageLoad);
          cdp.off("Page.loadEventFired", onPageLoad);
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(0);
      });

      it('flags when cdp.off event does not match cdp.on event', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          function onPageLoad() {}
          cdp.on("Page.loadEventFired", onPageLoad);
          cdp.off("DOM.documentUpdated", onPageLoad);
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('leak-unclosed-cdp-listener');
      });
    });

    describe('leak-unbounded-async-loop', () => {
      it('flags while(true) invoking CDP without delay and exit condition', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          while (true) {
            await cdp.send("Page.navigate", { url: "https://example.com" });
          }
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('leak-unbounded-async-loop');
      });

      it('flags false throttle await Promise.resolve() in async loop', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          while (true) {
            await cdp.send("Page.navigate", { url: "https://example.com" });
            await Promise.resolve();
            if (done) break;
          }
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('leak-unbounded-async-loop');
        expect(res.diagnostics[0].message).toContain('lacks a throttling backoff delay');
      });

      it('flags break inside switch as not breaking outer loop', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          while (true) {
            await cdp.send("Page.navigate", { url: "https://example.com" });
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

      it('passes when loop contains both genuine delay and break condition', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          while (true) {
            await cdp.send("Page.navigate", { url: "https://example.com" });
            await delay(500);
            if (done) break;
          }
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(0);
      });
    });
  });

  // =========================================================================
  // 3. CDP Integrity Rules Adversarial Probing
  // =========================================================================
  describe('3. CDP Protocol Integrity & Contract Validation', () => {
    describe('cdp-valid-domain-method', () => {
      it('validates canonical CDP domain and method against schema', () => {
        const validRes = validateCdpCommand('Page.navigate', 'method');
        expect(validRes.valid).toBe(true);

        const invalidDomain = validateCdpCommand('InvalidDomain.foo', 'method');
        expect(invalidDomain.valid).toBe(false);
        expect(invalidDomain.reason).toBe('UNKNOWN_DOMAIN');

        const invalidMethod = validateCdpCommand('Page.fakeMethod', 'method');
        expect(invalidMethod.valid).toBe(false);
        expect(invalidMethod.reason).toBe('UNKNOWN_METHOD');
      });

      it('provides Levenshtein distance typo suggestion for mistyped domain and method', () => {
        const domainTypo = validateCdpCommand('Pgae.navigate', 'method');
        expect(domainTypo.valid).toBe(false);
        expect(domainTypo.suggestion).toContain('Page');

        const methodTypo = validateCdpCommand('Page.navgate', 'method');
        expect(methodTypo.valid).toBe(false);
        expect(methodTypo.suggestion).toContain('Page.navigate');
      });

      it('flags CDP method passed to cdp.on (which requires an event)', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          const unbind = cdp.on("Page.navigate", () => {});
          unbind();
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('cdp-valid-domain-method');
        expect(res.diagnostics[0].message).toContain('Unknown CDP event "navigate"');
      });
    });

    describe('cdp-header-permission', () => {
      it('flags CDP call when userscript lacks metadata header entirely', () => {
        const code = 'await cdp.send("Page.navigate", { url: "https://example.com" });';
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('cdp-header-permission');
        expect(res.diagnostics[0].message).toContain('Missing userscript metadata header');
      });

      it('flags CDP call when @grant none is declared', () => {
        const code = `
          // ==UserScript==
          // @grant none
          // ==/UserScript==
          await cdp.send("Page.navigate", { url: "https://example.com" });
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('cdp-header-permission');
        expect(res.diagnostics[0].message).toContain('declared "@grant none" which explicitly prohibits');
      });

      it('permits CDP calls when @grant GM_cdp is declared', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          await cdp.send("Page.navigate", { url: "https://example.com" });
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(0);
      });

      it('permits domain when @cdp <Domain> matches invoked domain', () => {
        const code = `
          // ==UserScript==
          // @cdp Page
          // ==/UserScript==
          await cdp.send("Page.navigate", { url: "https://example.com" });
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(0);
      });

      it('flags domain when @cdp declared does not match invoked domain', () => {
        const code = `
          // ==UserScript==
          // @cdp DOM
          // ==/UserScript==
          await cdp.send("Page.navigate", { url: "https://example.com" });
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('cdp-header-permission');
        expect(res.diagnostics[0].message).toContain('Unauthorized CDP domain');
      });
    });

    describe('cdp-handled-async-reject', () => {
      it('reports warning for floating unawaited cdp.send promise', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          cdp.send("Page.navigate", { url: "https://example.com" });
        `;
        const res = scanFile('test.js', code);
        expect(res.warningCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('cdp-handled-async-reject');
        expect(res.diagnostics[0].severity).toBe('warning');
      });

      it('passes when cdp.send is awaited', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          await cdp.send("Page.navigate", { url: "https://example.com" });
        `;
        const res = scanFile('test.js', code);
        expect(res.warningCount).toBe(0);
      });

      it('passes when cdp.send is caught via .catch()', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          cdp.send("Page.navigate", { url: "https://example.com" }).catch(err => console.error(err));
        `;
        const res = scanFile('test.js', code);
        expect(res.warningCount).toBe(0);
      });
    });

    describe('cdp-no-tight-polling', () => {
      it('flags setInterval under 100ms containing CDP calls', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          let t = setInterval(() => {
            cdp.send("DOM.getDocument", {}).catch(() => {});
          }, 50);
          clearInterval(t);
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(1);
        expect(res.diagnostics[0].ruleId).toBe('cdp-no-tight-polling');
        expect(res.diagnostics[0].message).toContain('below the 100ms minimum threshold');
      });

      it('passes setInterval with >= 100ms interval', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          let t = setInterval(() => {
            cdp.send("DOM.getDocument", {}).catch(() => {});
          }, 500);
          clearInterval(t);
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(0);
      });
    });

    describe('cdp-valid-payload', () => {
      it('flags primitive string, number, boolean, array, and null payloads', () => {
        const payloadTests = [
          'await cdp.send("Page.navigate", "https://example.com");',
          'await cdp.send("Page.navigate", 42);',
          'await cdp.send("Page.navigate", true);',
          'await cdp.send("Page.navigate", ["url"]);',
          'await cdp.send("Page.navigate", null);'
        ];

        for (const pt of payloadTests) {
          const code = `
            // ==UserScript==
            // @grant GM_cdp
            // ==/UserScript==
            ${pt}
          `;
          const res = scanFile('test.js', code);
          expect(res.errorCount).toBe(1);
          expect(res.diagnostics[0].ruleId).toBe('cdp-valid-payload');
        }
      });

      it('passes valid object dictionary payload', () => {
        const code = `
          // ==UserScript==
          // @grant GM_cdp
          // ==/UserScript==
          await cdp.send("Page.navigate", { url: "https://example.com" });
        `;
        const res = scanFile('test.js', code);
        expect(res.errorCount).toBe(0);
      });
    });
  });
});
