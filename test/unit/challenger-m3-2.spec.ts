/**
 * Empirical Challenger M3-2 Test Suite:
 * Multi-Stage Declarative CDP Readiness, Grant Scope Evaluation,
 * Execution Timeout Protection & Partial Batch Failure Rollback.
 *
 * Location: test/unit/challenger-m3-2.spec.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { ScriptInjector, pageSandboxRunner } from '@/background/injector';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { saveScript, resetToDefaultScripts, deleteScript } from '@/shared/storage';
import type { ScriptRecord } from '@/shared/types';

describe('Empirical Challenger M3-2: Multi-Stage CDP & Error Rollback Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let debuggerMgr: TabDebuggerManager;
  let injector: ScriptInjector;
  let executedScripts: any[] = [];

  beforeEach(async () => {
    context = setupChromeMock();
    executedScripts = [];

    context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
      executedScripts.push(opts);
      if (typeof opts.func === 'function') {
        const res = opts.func(...opts.args);
        return [{ result: res }];
      }
      return [{ result: { success: true } }];
    });

    await resetToDefaultScripts();

    debuggerMgr = new TabDebuggerManager();
    await debuggerMgr.init();

    injector = new ScriptInjector({
      debuggerManager: debuggerMgr,
      autoStart: true
    });
  });

  afterEach(() => {
    injector.destroy();
    debuggerMgr.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // =========================================================================
  // Group 1: Multi-Stage Declarative CDP Readiness (document-end & document-idle)
  // =========================================================================
  describe('Group 1: Multi-Stage Declarative CDP Readiness', () => {
    it('1.1: script at document-end with @grant GM_cdp triggers attachTab & initializeDeclaredDomains', async () => {
      const docEndScript: ScriptRecord = {
        id: 'gm-cdp-doc-end',
        name: 'GM_cdp at document-end',
        code: '// ==UserScript==\n// @name GM_cdp Doc End\n// @run-at document-end\n// @grant GM_cdp\n// ==/UserScript==',
        metadata: {
          name: 'GM_cdp Doc End',
          matches: ['*://example.com/stage-end*'],
          matchPatterns: ['*://example.com/stage-end*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await deleteScript('sample-dom-highlighter');
      await saveScript(docEndScript);

      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');
      const initSpy = vi.spyOn(debuggerMgr, 'initializeDeclaredDomains');

      await injector.handleDOMContentLoaded({
        tabId: 501,
        frameId: 0,
        url: 'https://example.com/stage-end',
        processId: 1,
        timeStamp: Date.now()
      });

      expect(attachSpy).toHaveBeenCalledWith(501);
      expect(initSpy).toHaveBeenCalledWith(501, 'https://example.com/stage-end');
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('gm-cdp-doc-end');
      expect(injector.hasInjected(501, 0, 'gm-cdp-doc-end', 'document-end')).toBe(true);
    });

    it('1.2: script at document-idle with @grant GM_cdp triggers attachTab & initializeDeclaredDomains', async () => {
      const docIdleScript: ScriptRecord = {
        id: 'gm-cdp-doc-idle',
        name: 'GM_cdp at document-idle',
        code: '// ==UserScript==\n// @name GM_cdp Doc Idle\n// @run-at document-idle\n// @grant GM_cdp\n// ==/UserScript==',
        metadata: {
          name: 'GM_cdp Doc Idle',
          matches: ['*://example.com/stage-idle*'],
          matchPatterns: ['*://example.com/stage-idle*'],
          includes: [],
          excludes: [],
          runAt: 'document-idle',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await deleteScript('sample-cookie-inspector');
      await saveScript(docIdleScript);

      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');
      const initSpy = vi.spyOn(debuggerMgr, 'initializeDeclaredDomains');

      await injector.handleCompleted({
        tabId: 502,
        frameId: 0,
        url: 'https://example.com/stage-idle',
        processId: 1,
        timeStamp: Date.now()
      });

      expect(attachSpy).toHaveBeenCalledWith(502);
      expect(initSpy).toHaveBeenCalledWith(502, 'https://example.com/stage-idle');
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('gm-cdp-doc-idle');
      expect(injector.hasInjected(502, 0, 'gm-cdp-doc-idle', 'document-idle')).toBe(true);
    });

    it('1.3: script at document-end with @cdp directive (no explicit grant) triggers attachTab & init', async () => {
      const cdpDirectiveScript: ScriptRecord = {
        id: 'cdp-dir-end',
        name: 'CDP Directive Doc End',
        code: '// ==UserScript==\n// @name CDP Directive Doc End\n// @run-at document-end\n// @cdp DOM.enable\n// ==/UserScript==',
        metadata: {
          name: 'CDP Directive Doc End',
          matches: ['*://example.com/dir-end*'],
          matchPatterns: ['*://example.com/dir-end*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: [],
          cdp: [{ domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} }],
          cdpDeclarations: [{ domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} }],
          cdpDomains: ['DOM'],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await deleteScript('sample-dom-highlighter');
      await saveScript(cdpDirectiveScript);

      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');
      const initSpy = vi.spyOn(debuggerMgr, 'initializeDeclaredDomains');

      await injector.handleDOMContentLoaded({
        tabId: 503,
        frameId: 0,
        url: 'https://example.com/dir-end',
        processId: 1,
        timeStamp: Date.now()
      });

      expect(attachSpy).toHaveBeenCalledWith(503);
      expect(initSpy).toHaveBeenCalledWith(503, 'https://example.com/dir-end');
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('cdp-dir-end');
    });

    it('1.4: progressive stages across start, end, and idle attach once and maintain attachment', async () => {
      const tabId = 504;
      const url = 'https://httpbin.org/get'; // Default sample-cdp-logger at start

      const endScript: ScriptRecord = {
        id: 'prog-end',
        name: 'Prog End',
        code: '// ==UserScript==\n// @name Prog End\n// @match https://httpbin.org/get*\n// @run-at document-end\n// @grant GM_cdp\n// ==/UserScript==',
        metadata: {
          name: 'Prog End',
          matches: ['https://httpbin.org/get*'],
          matchPatterns: ['https://httpbin.org/get*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const idleScript: ScriptRecord = {
        id: 'prog-idle',
        name: 'Prog Idle',
        code: '// ==UserScript==\n// @name Prog Idle\n// @match https://httpbin.org/get*\n// @run-at document-idle\n// @grant GM_cdp\n// ==/UserScript==',
        metadata: {
          name: 'Prog Idle',
          matches: ['https://httpbin.org/get*'],
          matchPatterns: ['https://httpbin.org/get*'],
          includes: [],
          excludes: [],
          runAt: 'document-idle',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await deleteScript('sample-dom-highlighter');
      await deleteScript('sample-cookie-inspector');
      await saveScript(endScript);
      await saveScript(idleScript);

      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');

      // 1. document-start
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });
      const callsAfterStart = attachSpy.mock.calls.length;
      expect(callsAfterStart).toBeGreaterThanOrEqual(1);

      // 2. document-end: tab is already attached, attachTab must NOT be called again
      await injector.handleDOMContentLoaded({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        timeStamp: Date.now()
      });
      expect(attachSpy).toHaveBeenCalledTimes(callsAfterStart);

      // 3. document-idle: tab is still attached, attachTab must NOT be called again
      await injector.handleCompleted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        timeStamp: Date.now()
      });
      expect(attachSpy).toHaveBeenCalledTimes(callsAfterStart);

      expect(executedScripts.length).toBe(3);
      expect(executedScripts[0].args[2]).toBe('sample-cdp-logger');
      expect(executedScripts[1].args[2]).toBe('prog-end');
      expect(executedScripts[2].args[2]).toBe('prog-idle');
    });

    it('1.5: injection in CONFLICT status does not block script execution or attempt attachTab', async () => {
      debuggerMgr.setTabStatus(505, 'CONFLICT', 'canceled_by_user');
      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');

      const endScript: ScriptRecord = {
        id: 'conflict-end-script',
        name: 'Conflict End Script',
        code: '// ==UserScript==\n// @name Conflict End Script\n// @match *://example.com/conflict*\n// @run-at document-end\n// @grant GM_cdp\n// ==/UserScript==',
        metadata: {
          name: 'Conflict End Script',
          matches: ['*://example.com/conflict*'],
          matchPatterns: ['*://example.com/conflict*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await deleteScript('sample-dom-highlighter');
      await saveScript(endScript);

      await injector.handleDOMContentLoaded({
        tabId: 505,
        frameId: 0,
        url: 'https://example.com/conflict',
        processId: 1,
        timeStamp: Date.now()
      });

      expect(attachSpy).not.toHaveBeenCalled();
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('conflict-end-script');
    });

    it('1.6: script at document-end with newly declared @cdp domains initializes domains even if tab was already attached at document-start', async () => {
      const tabId = 506;
      const url = 'https://example.com/progressive-cdp';

      // 1. Script at document-start with @grant GM_cdp (no declarative domains)
      const startScript: ScriptRecord = {
        id: 'start-cdp-grant-only',
        name: 'Start CDP Grant Only',
        code: '// ==UserScript==\n// @name Start CDP Grant Only\n// @match https://example.com/progressive-cdp*\n// @run-at document-start\n// @grant GM_cdp\n// ==/UserScript==',
        metadata: {
          name: 'Start CDP Grant Only',
          matches: ['https://example.com/progressive-cdp*'],
          matchPatterns: ['https://example.com/progressive-cdp*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // 2. Script at document-end with declarative @cdp DOM.enable
      const endCdpScript: ScriptRecord = {
        id: 'end-cdp-declarations',
        name: 'End CDP Declarations',
        code: '// ==UserScript==\n// @name End CDP Declarations\n// @match https://example.com/progressive-cdp*\n// @run-at document-end\n// @grant GM_cdp\n// @cdp DOM.enable\n// ==/UserScript==',
        metadata: {
          name: 'End CDP Declarations',
          matches: ['https://example.com/progressive-cdp*'],
          matchPatterns: ['https://example.com/progressive-cdp*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['GM_cdp'],
          cdp: [{ domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} }],
          cdpDeclarations: [{ domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} }],
          cdpDomains: ['DOM'],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await deleteScript('sample-cdp-logger');
      await deleteScript('sample-dom-highlighter');
      await deleteScript('sample-cookie-inspector');
      await saveScript(startScript);
      await saveScript(endCdpScript);

      const sendCommandSpy = vi.spyOn(chrome.debugger, 'sendCommand');

      // Stage: document-start (attaches tab, no commands sent)
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });
      expect(debuggerMgr.isAttached(tabId)).toBe(true);

      // Stage: document-end (script requires DOM.enable!)
      await injector.handleDOMContentLoaded({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        timeStamp: Date.now()
      });

      // Assert that DOM.enable was sent
      expect(sendCommandSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tabId }),
        'DOM.enable',
        expect.anything()
      );
    });
  });

  // =========================================================================
  // Group 2: Grant Scope Evaluation (@grant cdp, @grant *, @grant none, etc.)
  // =========================================================================
  describe('Group 2: Grant Scope Evaluation & hasCdpNeeds', () => {
    it('2.1: script with @grant cdp triggers CDP readiness at document-start', async () => {
      const grantCdpScript: ScriptRecord = {
        id: 'grant-cdp-script',
        name: 'Grant CDP Script',
        code: '// ==UserScript==\n// @name Grant CDP Script\n// @match *://example.com/grant-cdp*\n// @run-at document-start\n// @grant cdp\n// ==/UserScript==',
        metadata: {
          name: 'Grant CDP Script',
          matches: ['*://example.com/grant-cdp*'],
          matchPatterns: ['*://example.com/grant-cdp*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await deleteScript('sample-cdp-logger');
      await saveScript(grantCdpScript);

      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');
      const initSpy = vi.spyOn(debuggerMgr, 'initializeDeclaredDomains');

      await injector.handleCommitted({
        tabId: 601,
        frameId: 0,
        url: 'https://example.com/grant-cdp',
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });

      expect(attachSpy).toHaveBeenCalledWith(601);
      expect(initSpy).toHaveBeenCalledWith(601, 'https://example.com/grant-cdp');
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('grant-cdp-script');
    });

    it('2.2: script with @grant * triggers CDP readiness at document-end', async () => {
      const grantWildcardScript: ScriptRecord = {
        id: 'grant-wildcard-script',
        name: 'Grant Wildcard Script',
        code: '// ==UserScript==\n// @name Grant Wildcard Script\n// @match *://example.com/grant-wildcard*\n// @run-at document-end\n// @grant *\n// ==/UserScript==',
        metadata: {
          name: 'Grant Wildcard Script',
          matches: ['*://example.com/grant-wildcard*'],
          matchPatterns: ['*://example.com/grant-wildcard*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: ['*'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await deleteScript('sample-dom-highlighter');
      await saveScript(grantWildcardScript);

      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');
      const initSpy = vi.spyOn(debuggerMgr, 'initializeDeclaredDomains');

      await injector.handleDOMContentLoaded({
        tabId: 602,
        frameId: 0,
        url: 'https://example.com/grant-wildcard',
        processId: 1,
        timeStamp: Date.now()
      });

      expect(attachSpy).toHaveBeenCalledWith(602);
      expect(initSpy).toHaveBeenCalledWith(602, 'https://example.com/grant-wildcard');
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('grant-wildcard-script');
    });

    it('2.3: script with standard non-CDP grants (GM_setValue) does NOT trigger CDP readiness', async () => {
      const nonCdpScript: ScriptRecord = {
        id: 'non-cdp-grant-script',
        name: 'Non CDP Grant Script',
        code: '// ==UserScript==\n// @name Non CDP Grant Script\n// @match *://example.com/standard-gm*\n// @run-at document-start\n// @grant GM_setValue\n// ==/UserScript==',
        metadata: {
          name: 'Non CDP Grant Script',
          matches: ['*://example.com/standard-gm*'],
          matchPatterns: ['*://example.com/standard-gm*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_setValue', 'GM_getValue'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await deleteScript('sample-cdp-logger');
      await saveScript(nonCdpScript);

      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');

      await injector.handleCommitted({
        tabId: 603,
        frameId: 0,
        url: 'https://example.com/standard-gm',
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });

      expect(attachSpy).not.toHaveBeenCalled();
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('non-cdp-grant-script');
    });

    it('2.4: script with @grant none overrides any @cdp directives and suppresses CDP attachment', async () => {
      const grantNoneWithCdp: ScriptRecord = {
        id: 'grant-none-with-cdp',
        name: 'Grant None With CDP',
        code: '// ==UserScript==\n// @name Grant None With CDP\n// @match *://example.com/none-override*\n// @run-at document-start\n// @grant none\n// @cdp Network.enable\n// ==/UserScript==',
        metadata: {
          name: 'Grant None With CDP',
          matches: ['*://example.com/none-override*'],
          matchPatterns: ['*://example.com/none-override*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['none'],
          cdp: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }],
          cdpDeclarations: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }],
          cdpDomains: ['Network'],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await deleteScript('sample-cdp-logger');
      await saveScript(grantNoneWithCdp);

      const attachSpy = vi.spyOn(debuggerMgr, 'attachTab');

      await injector.handleCommitted({
        tabId: 604,
        frameId: 0,
        url: 'https://example.com/none-override',
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });

      expect(attachSpy).not.toHaveBeenCalled();
      expect(executedScripts.length).toBe(1);
    });

    it('2.5: pageSandboxRunner exposes cdp and GM_cdp bindings when @grant cdp or @grant * is specified', () => {
      (window as any).cdp = { send: vi.fn(), on: vi.fn() };

      // Case A: @grant cdp
      let probeA: any = null;
      (window as any).__probeA = (val: any) => { probeA = val; };
      const codeA = `window.__probeA({ hasCdp: typeof cdp !== 'undefined', hasGmCdp: typeof GM_cdp !== 'undefined' });`;

      const resA = pageSandboxRunner(codeA, 'Test A', 'test-a', { grants: ['cdp'] });
      expect(resA.success).toBe(true);
      expect(probeA).toEqual({ hasCdp: true, hasGmCdp: true });

      // Case B: @grant *
      let probeB: any = null;
      (window as any).__probeB = (val: any) => { probeB = val; };
      const codeB = `window.__probeB({ hasCdp: typeof cdp !== 'undefined', hasGmCdp: typeof GM_cdp !== 'undefined' });`;

      const resB = pageSandboxRunner(codeB, 'Test B', 'test-b', { grants: ['*'] });
      expect(resB.success).toBe(true);
      expect(probeB).toEqual({ hasCdp: true, hasGmCdp: true });

      delete (window as any).cdp;
      delete (window as any).__probeA;
      delete (window as any).__probeB;
    });
  });

  // =========================================================================
  // Group 3: Partial Failure Rollback in Multi-Script Batches
  // =========================================================================
  describe('Group 3: Partial Failure Rollback in Multi-Script Batches', () => {
    it('3.1: 3-script batch where script 2 fails rolls back only script 2 while scripts 1 & 3 remain committed', async () => {
      const tabId = 701;
      const targetUrl = 'https://example.com/batch-3';

      const script1: ScriptRecord = {
        id: 'batch-script-1',
        name: 'Batch Script 1',
        code: '// ==UserScript==\n// @name Batch Script 1\n// @match *://example.com/batch-3*\n// @run-at document-start\n// ==/UserScript==',
        metadata: {
          name: 'Batch Script 1',
          matches: ['*://example.com/batch-3*'],
          matchPatterns: ['*://example.com/batch-3*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const script2: ScriptRecord = {
        id: 'batch-script-2',
        name: 'Batch Script 2',
        code: '// ==UserScript==\n// @name Batch Script 2\n// @match *://example.com/batch-3*\n// @run-at document-start\n// ==/UserScript==',
        metadata: {
          name: 'Batch Script 2',
          matches: ['*://example.com/batch-3*'],
          matchPatterns: ['*://example.com/batch-3*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const script3: ScriptRecord = {
        id: 'batch-script-3',
        name: 'Batch Script 3',
        code: '// ==UserScript==\n// @name Batch Script 3\n// @match *://example.com/batch-3*\n// @run-at document-start\n// ==/UserScript==',
        metadata: {
          name: 'Batch Script 3',
          matches: ['*://example.com/batch-3*'],
          matchPatterns: ['*://example.com/batch-3*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await deleteScript('sample-cdp-logger');
      await saveScript(script1);
      await saveScript(script2);
      await saveScript(script3);

      context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
        const id = opts.args[2];
        if (id === 'batch-script-2') {
          throw new Error('Script 2 injection failed');
        }
        executedScripts.push(opts);
        return [{ result: { success: true } }];
      });

      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });

      // Scripts 1 and 3 succeeded; Script 2 failed and was rolled back
      expect(injector.hasInjected(tabId, 0, 'batch-script-1', 'document-start')).toBe(true);
      expect(injector.hasInjected(tabId, 0, 'batch-script-2', 'document-start')).toBe(false);
      expect(injector.hasInjected(tabId, 0, 'batch-script-3', 'document-start')).toBe(true);
      expect(executedScripts.length).toBe(2);

      // Subsequent retry: Script 2 now succeeds, Scripts 1 & 3 are not re-executed
      context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
        executedScripts.push(opts);
        return [{ result: { success: true } }];
      });

      await injector.processStage(tabId, 0, targetUrl, 'document-start');

      expect(injector.hasInjected(tabId, 0, 'batch-script-2', 'document-start')).toBe(true);
      expect(executedScripts.length).toBe(3);
      expect(executedScripts[2].args[2]).toBe('batch-script-2');
    });

    it('3.2: document-idle multi-script partial failure rolls back correctly', async () => {
      const tabId = 702;
      const targetUrl = 'https://example.com/idle-batch';

      const idleFail: ScriptRecord = {
        id: 'idle-fail-1',
        name: 'Idle Fail',
        code: '// ==UserScript==\n// @name Idle Fail\n// @match *://example.com/idle-batch*\n// @run-at document-idle\n// ==/UserScript==',
        metadata: {
          name: 'Idle Fail',
          matches: ['*://example.com/idle-batch*'],
          matchPatterns: ['*://example.com/idle-batch*'],
          includes: [],
          excludes: [],
          runAt: 'document-idle',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const idlePass: ScriptRecord = {
        id: 'idle-pass-2',
        name: 'Idle Pass',
        code: '// ==UserScript==\n// @name Idle Pass\n// @match *://example.com/idle-batch*\n// @run-at document-idle\n// ==/UserScript==',
        metadata: {
          name: 'Idle Pass',
          matches: ['*://example.com/idle-batch*'],
          matchPatterns: ['*://example.com/idle-batch*'],
          includes: [],
          excludes: [],
          runAt: 'document-idle',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await deleteScript('sample-cookie-inspector');
      await saveScript(idleFail);
      await saveScript(idlePass);

      context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
        if (opts.args[2] === 'idle-fail-1') {
          return [{ result: { success: false, error: 'Eval exception' } }];
        }
        executedScripts.push(opts);
        return [{ result: { success: true } }];
      });

      await injector.handleCompleted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        timeStamp: Date.now()
      });

      expect(injector.hasInjected(tabId, 0, 'idle-fail-1', 'document-idle')).toBe(false);
      expect(injector.hasInjected(tabId, 0, 'idle-pass-2', 'document-idle')).toBe(true);
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('idle-pass-2');
    });
  });

  // =========================================================================
  // Group 4: Script Execution Timeout Protection & Deadlock Resistance
  // =========================================================================
  describe('Group 4: Script Execution Timeout Protection & Deadlock Resistance', () => {
    it('4.1: executeScriptInTab times out when executeScript hangs and returns false without throwing', async () => {
      const script: ScriptRecord = {
        id: 'hanging-script-test',
        name: 'Hanging Script Test',
        code: '// ==UserScript==\n// @name Hanging Script Test\n// @match <all_urls>\n// @run-at document-start\n// ==/UserScript==',
        metadata: {
          name: 'Hanging Script Test',
          matches: ['<all_urls>'],
          matchPatterns: ['<all_urls>'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // executeScript returns a promise that never resolves
      context.mockScripting.executeScript.mockImplementation(
        () => new Promise(() => {})
      );

      // Call executeScriptInTab with explicit timeout of 50ms
      const startTime = Date.now();
      const success = await injector.executeScriptInTab(801, 0, script, 'document-start', 50);
      const elapsed = Date.now() - startTime;

      expect(success).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(45);
    });

    it('4.2: hanging script in multi-script batch rolls back reservation and does NOT deadlock subsequent scripts', async () => {
      const tabId = 802;
      const targetUrl = 'https://example.com/timeout-batch';

      const hangingScript: ScriptRecord = {
        id: 'script-hang',
        name: 'Script Hang',
        code: '// ==UserScript==\n// @name Script Hang\n// @match *://example.com/timeout-batch*\n// @run-at document-start\n// ==/UserScript==',
        metadata: {
          name: 'Script Hang',
          matches: ['*://example.com/timeout-batch*'],
          matchPatterns: ['*://example.com/timeout-batch*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const fastScript: ScriptRecord = {
        id: 'script-fast',
        name: 'Script Fast',
        code: '// ==UserScript==\n// @name Script Fast\n// @match *://example.com/timeout-batch*\n// @run-at document-start\n// ==/UserScript==',
        metadata: {
          name: 'Script Fast',
          matches: ['*://example.com/timeout-batch*'],
          matchPatterns: ['*://example.com/timeout-batch*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await deleteScript('sample-cdp-logger');
      await saveScript(hangingScript);
      await saveScript(fastScript);

      // Mock executeScript: hangingScript hangs, fastScript succeeds immediately
      context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
        if (opts.args[2] === 'script-hang') {
          // Never resolve
          return new Promise(() => {});
        }
        executedScripts.push(opts);
        return [{ result: { success: true } }];
      });

      // Override executeScriptInTab to use 50ms timeout for test speed
      const originalExec = injector.executeScriptInTab.bind(injector);
      vi.spyOn(injector, 'executeScriptInTab').mockImplementation(
        (tId, fId, scr, stg) => originalExec(tId, fId, scr, stg, 50)
      );

      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });

      // Hanging script rolled back; Fast script successfully injected!
      expect(injector.hasInjected(tabId, 0, 'script-hang', 'document-start')).toBe(false);
      expect(injector.hasInjected(tabId, 0, 'script-fast', 'document-start')).toBe(true);
      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('script-fast');
    });

    it('4.3: 10-second default timeout triggers properly via fake timers and cleans up timer reference', async () => {
      vi.useFakeTimers();

      const script: ScriptRecord = {
        id: 'script-10s-hang',
        name: 'Script 10s Hang',
        code: '// ==UserScript==\n// @name Script 10s Hang\n// @match <all_urls>\n// @run-at document-start\n// ==/UserScript==',
        metadata: {
          name: 'Script 10s Hang',
          matches: ['<all_urls>'],
          matchPatterns: ['<all_urls>'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Mock executeScript to hang
      context.mockScripting.executeScript.mockImplementation(
        () => new Promise(() => {})
      );

      // Invoke with default 10,000ms timeout
      const execPromise = injector.executeScriptInTab(803, 0, script, 'document-start');

      // Fast-forward fake timers by 10,000ms
      await vi.advanceTimersByTimeAsync(10000);

      const result = await execPromise;
      expect(result).toBe(false);

      vi.useRealTimers();
    });
  });

  // =========================================================================
  // Group 5: Userscript Syntax / Runtime Error Handling in Sandbox Runner
  // =========================================================================
  describe('Group 5: Userscript Syntax & Runtime Error Handling', () => {
    it('5.1: syntax error in userscript returns { success: false } and logs error', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const badCode = `const x = ;`; // Syntax error
      const result = pageSandboxRunner(badCode, 'Bad Syntax Script', 'bad-syntax-id', {});

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/SyntaxError|Unexpected token/i);
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('5.2: immediate runtime exception in userscript returns { success: false }', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const throwCode = `throw new TypeError('Fatal runtime crash in userscript');`;
      const result = pageSandboxRunner(throwCode, 'Throw Script', 'throw-script-id', {});

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Fatal runtime crash in userscript/);
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('5.3: runtime exception during processStage rolls back reservation and allows fixed re-injection', async () => {
      const tabId = 901;
      const targetUrl = 'https://example.com/runtime-error';

      const faultyCode = `// ==UserScript==\n// @name Runtime Fault Script\n// @match *://example.com/runtime-error*\n// @run-at document-start\n// ==/UserScript==\nthrow new Error('Crash on initialization');`;
      const fixedCode = `// ==UserScript==\n// @name Runtime Fault Script\n// @match *://example.com/runtime-error*\n// @run-at document-start\n// ==/UserScript==\nwindow.__faultFixed = true;`;

      const faultyScript: ScriptRecord = {
        id: 'runtime-fault-script',
        name: 'Runtime Fault Script',
        code: faultyCode,
        metadata: {
          name: 'Runtime Fault Script',
          matches: ['*://example.com/runtime-error*'],
          matchPatterns: ['*://example.com/runtime-error*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await deleteScript('sample-cdp-logger');
      await saveScript(faultyScript);

      // Execute through executeScript with pageSandboxRunner
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: targetUrl,
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });

      // Deduplication reservation should have been rolled back
      expect(injector.hasInjected(tabId, 0, 'runtime-fault-script', 'document-start')).toBe(false);

      // Now fix the script
      const fixedScript = {
        ...faultyScript,
        code: fixedCode,
        updatedAt: Date.now()
      };
      await saveScript(fixedScript);

      await injector.processStage(tabId, 0, targetUrl, 'document-start');

      expect(injector.hasInjected(tabId, 0, 'runtime-fault-script', 'document-start')).toBe(true);
      expect(executedScripts.length).toBe(2);
    });

    it('5.4: subframe syntax error rolls back only subframe reservation while top frame stays intact', async () => {
      const tabId = 902;

      const goodTopScript: ScriptRecord = {
        id: 'top-good',
        name: 'Top Good',
        code: `// ==UserScript==\n// @name Top Good\n// @match *://example.com/*\n// @run-at document-start\n// ==/UserScript==\nwindow.__topLoaded = true;`,
        metadata: {
          name: 'Top Good',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const badSubframeScript: ScriptRecord = {
        id: 'subframe-bad',
        name: 'Subframe Bad',
        code: `// ==UserScript==\n// @name Subframe Bad\n// @match *://example.com/*\n// @run-at document-start\n// ==/UserScript==\nvar invalid = %%%;`, // syntax error
        metadata: {
          name: 'Subframe Bad',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      await deleteScript('sample-cdp-logger');
      await saveScript(goodTopScript);
      await saveScript(badSubframeScript);

      // Top frame commits navigation: goodTopScript succeeds, badSubframeScript fails
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: 'https://example.com/main',
        processId: 1,
        transitionType: 'link',
        timeStamp: Date.now()
      });

      expect(injector.hasInjected(tabId, 0, 'top-good', 'document-start')).toBe(true);
      expect(injector.hasInjected(tabId, 0, 'subframe-bad', 'document-start')).toBe(false);

      // Subframe 1 commits navigation
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: 'https://example.com/subframe',
        processId: 1,
        transitionType: 'auto_subframe',
        timeStamp: Date.now()
      });

      expect(injector.hasInjected(tabId, 1, 'top-good', 'document-start')).toBe(true);
      expect(injector.hasInjected(tabId, 1, 'subframe-bad', 'document-start')).toBe(false);
    });
  });
});
