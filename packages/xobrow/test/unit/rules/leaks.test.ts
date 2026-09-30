import { describe, it, expect } from 'vitest';
import { scanFile } from '../../../src/engine/scanner.js';
import {
  leakUncleanedEventListener,
  leakLingeringInterval,
  leakUnclosedCdpListener,
  leakUnboundedAsyncLoop
} from '../../../src/rules/leaks/index.js';

describe('Category 2: Resource Leak Rules Unit Test Suite', () => {
  describe('Rule: leak-uncleaned-event-listener', () => {
    it('flags anonymous handler lacking { once: true } or signal', () => {
      const code = `
        window.addEventListener('resize', (event) => {
          console.log('resize');
        });
      `;
      const result = scanFile('test.js', code, { rules: [leakUncleanedEventListener] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('leak-uncleaned-event-listener');
      expect(result.diagnostics[0].message).toContain('anonymous inline function');
      expect(result.diagnostics[0].suggestion).toContain('{ once: true }');
    });

    it('flags named handler that is never removed via removeEventListener', () => {
      const code = `
        function onMessage(e) {}
        window.addEventListener('message', onMessage);
      `;
      const result = scanFile('test.js', code, { rules: [leakUncleanedEventListener] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('leak-uncleaned-event-listener');
      expect(result.diagnostics[0].message).toContain('never cleaned up with removeEventListener');
    });

    it('allows named handler paired with removeEventListener', () => {
      const code = `
        function onResize(e) {}
        window.addEventListener('resize', onResize);
        window.removeEventListener('resize', onResize);
      `;
      const result = scanFile('test.js', code, { rules: [leakUncleanedEventListener] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('allows listeners using { once: true } option', () => {
      const code = `
        document.addEventListener('DOMContentLoaded', () => {
          init();
        }, { once: true });
      `;
      const result = scanFile('test.js', code, { rules: [leakUncleanedEventListener] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('allows listeners bound to AbortSignal via { signal }', () => {
      const code = `
        const controller = new AbortController();
        window.addEventListener('keydown', (e) => {
          handleKey(e);
        }, { signal: controller.signal });
      `;
      const result = scanFile('test.js', code, { rules: [leakUncleanedEventListener] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('Rule: leak-lingering-interval', () => {
    it('flags setInterval whose return handle is discarded', () => {
      const code = `
        setInterval(() => {
          console.log('lingering tick');
        }, 1000);
      `;
      const result = scanFile('test.js', code, { rules: [leakLingeringInterval] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('leak-lingering-interval');
      expect(result.diagnostics[0].message).toContain('return handle is discarded');
    });

    it('flags setInterval whose handle is stored but never cleared', () => {
      const code = `
        const timerId = setInterval(() => {
          checkStatus();
        }, 2000);
      `;
      const result = scanFile('test.js', code, { rules: [leakLingeringInterval] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('leak-lingering-interval');
      expect(result.diagnostics[0].message).toContain("timer handle 'timerId' is never cleared");
    });

    it('allows setInterval paired with clearInterval(handle)', () => {
      const code = `
        const timerId = setInterval(() => {
          clearInterval(timerId);
        }, 1000);
      `;
      const result = scanFile('test.js', code, { rules: [leakLingeringInterval] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('allows member handle this.timer paired with clearInterval(this.timer)', () => {
      const code = `
        class Poller {
          start() {
            this.timer = setInterval(() => this.poll(), 500);
          }
          stop() {
            clearInterval(this.timer);
          }
        }
      `;
      const result = scanFile('test.js', code, { rules: [leakLingeringInterval] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('Rule: leak-unclosed-cdp-listener', () => {
    it('flags anonymous cdp.on without capturing unbind callback', () => {
      const code = `
        cdp.on('Page.loadEventFired', (params) => {
          console.log('loaded', params);
        });
      `;
      const result = scanFile('test.js', code, { rules: [leakUnclosedCdpListener] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('leak-unclosed-cdp-listener');
      expect(result.diagnostics[0].message).toContain('without capturing the unbind callback');
    });

    it('flags captured unbind callback that is never invoked', () => {
      const code = `
        const unbind = cdp.on('Page.domContentEventFired', onEvent);
        function onEvent() {}
      `;
      const result = scanFile('test.js', code, { rules: [leakUnclosedCdpListener] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('leak-unclosed-cdp-listener');
      expect(result.diagnostics[0].message).toContain("unbind callback 'unbind'");
    });

    it('allows cdp.on when unbind callback is invoked during teardown', () => {
      const code = `
        const unbind = cdp.on('Page.loadEventFired', onPageLoad);
        function onPageLoad() {
          unbind();
        }
      `;
      const result = scanFile('test.js', code, { rules: [leakUnclosedCdpListener] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('allows cdp.on paired with cdp.off(event, handler)', () => {
      const code = `
        function handler(data) {}
        cdp.on('Network.requestWillBeSent', handler);
        cdp.off('Network.requestWillBeSent', handler);
      `;
      const result = scanFile('test.js', code, { rules: [leakUnclosedCdpListener] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('Rule: leak-unbounded-async-loop', () => {
    it('flags while(true) containing CDP call lacking both exit and delay', () => {
      const code = `
        async function run() {
          while (true) {
            await cdp.send('Page.captureScreenshot', {});
          }
        }
      `;
      const result = scanFile('test.js', code, { rules: [leakUnboundedAsyncLoop] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('leak-unbounded-async-loop');
      expect(result.diagnostics[0].message).toContain('lacks both an exit condition');
    });

    it('flags while(true) containing CDP call with delay but without exit condition', () => {
      const code = `
        async function run() {
          while (true) {
            await cdp.send('Page.captureScreenshot', {});
            await delay(500);
          }
        }
      `;
      const result = scanFile('test.js', code, { rules: [leakUnboundedAsyncLoop] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('leak-unbounded-async-loop');
      expect(result.diagnostics[0].message).toContain('lacks an exit condition (break or return)');
    });

    it('flags loop containing CDP call with exit condition but without backoff delay', () => {
      const code = `
        async function run() {
          while (true) {
            const data = await cdp.send('DOM.getDocument', {});
            if (data.root) break;
          }
        }
      `;
      const result = scanFile('test.js', code, { rules: [leakUnboundedAsyncLoop] });
      expect(result.errorCount).toBe(1);
      expect(result.diagnostics[0].ruleId).toBe('leak-unbounded-async-loop');
      expect(result.diagnostics[0].message).toContain('lacks a throttling backoff delay');
    });

    it('allows properly throttled loop with exit condition and backoff delay', () => {
      const code = `
        async function run() {
          while (attempts < maxAttempts) {
            const res = await cdp.send('Page.getLayoutMetrics', {});
            if (res) break;
            await delay(500);
          }
        }
      `;
      const result = scanFile('test.js', code, { rules: [leakUnboundedAsyncLoop] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('ignores while(true) loops that do not invoke CDP commands', () => {
      const code = `
        while (true) {
          console.log('standard loop');
          if (done) break;
        }
      `;
      const result = scanFile('test.js', code, { rules: [leakUnboundedAsyncLoop] });
      expect(result.errorCount).toBe(0);
      expect(result.diagnostics).toHaveLength(0);
    });
  });
});
