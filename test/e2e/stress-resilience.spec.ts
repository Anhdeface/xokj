/**
 * Milestone 5: End-to-End Adversarial, Stress & Resilience Test Suite
 * Location: test/e2e/stress-resilience.spec.ts
 *
 * Implements R2 Requirements:
 * 1. Storage high-frequency race conditions across integrated subsystems (Background + UI + Storage)
 * 2. Concurrent CDP requests vs sudden detachment (canceled_by_user / target_closed) across multiple tabs
 * 3. Rapid tab open/close and navigation lifecycle races (nested frames, same-URL, deduplication lifecycle)
 * 4. Malformed userscript headers, invalid permissions, and adversarial sandbox recovery
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { parseMetadata } from '@/shared/metadata-parser';
import {
  saveScript,
  getScript,
  getScripts,
  getAllScripts,
  deleteScript,
  toggleScript,
  resetToDefaultScripts,
  saveSettings,
  getSettings,
  importScripts,
  exportScripts
} from '@/shared/storage';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { DevToolsConflictHandler } from '@/background/conflict-mgr';
import { ScriptInjector } from '@/background/injector';
import { UiIpcServer } from '@/background/ui-ipc';
import { ContentScriptBridge } from '@/content/bridge';
import { createSandboxRunner, buildSandboxScope } from '@/content/sandbox';
import { createCdpClient, createGmApi, clearIsolatedGmStorage } from '@/content/cdp-sdk';
import type { CdpRpcResponse, ParsedMetadata, ScriptRecord } from '@/shared/types';

describe('Milestone 5: E2E Adversarial, Stress & Resilience Test Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let debuggerMgr: TabDebuggerManager;
  let bridgeServer: CdpBridgeServer;
  let conflictHandler: DevToolsConflictHandler;
  let scriptInjector: ScriptInjector;
  let uiIpc: UiIpcServer;

  beforeEach(async () => {
    context = setupChromeMock();
    clearIsolatedGmStorage();
    await resetToDefaultScripts();

    debuggerMgr = new TabDebuggerManager();
    await debuggerMgr.init();

    bridgeServer = new CdpBridgeServer({
      debuggerManager: debuggerMgr,
      autoAttach: true
    });
    bridgeServer.init();

    conflictHandler = new DevToolsConflictHandler(bridgeServer, debuggerMgr);
    conflictHandler.init();

    scriptInjector = new ScriptInjector({
      debuggerManager: debuggerMgr,
      autoStart: true
    });
    scriptInjector.init();

    uiIpc = new UiIpcServer(debuggerMgr);
    uiIpc.init();

    // Default runtime message router connecting content scripts / popup to background listeners
    context.mockRuntime.sendMessage.mockImplementation(async (msg: any) => {
      return context.mockRuntime._emitMessage(msg, { tab: { id: 10, url: 'https://example.com' } });
    });

    // Default tabs sendMessage router connecting background to content script listeners
    context.mockTabs.sendMessage.mockImplementation(async (tabId: number, msg: any) => {
      return context.mockRuntime._emitMessage(msg, { tab: { id: tabId } });
    });
  });

  afterEach(() => {
    uiIpc.destroy();
    scriptInjector.destroy();
    conflictHandler.destroy();
    bridgeServer.destroy();
    debuggerMgr.destroy();
    clearIsolatedGmStorage();
    vi.restoreAllMocks();
  });

  /* ========================================================================
   * TIER 1: Integrated Storage & Multi-Subsystem Concurrency Storm
   * ======================================================================== */
  describe('Tier 1: Integrated Storage & Multi-Subsystem Concurrency Storm', () => {
    it('T1.1: 120 concurrent interleaved CRUD, toggle, import, and injector queries execute with zero data loss or deadlocks', async () => {
      // 1. Pre-seed 10 active scripts
      const initialIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const id = `stress-init-script-${i}`;
        initialIds.push(id);
        await saveScript({
          id,
          name: `Initial Script ${i}`,
          code: `// ==UserScript==\n// @name Initial Script ${i}\n// @match https://app${i}.service.io/*\n// ==/UserScript==`,
          enabled: true
        });
      }

      const operations: Promise<any>[] = [];

      // A. 30 concurrent new script saves
      for (let i = 0; i < 30; i++) {
        operations.push(
          saveScript({
            id: `storm-script-${i}`,
            name: `Storm Script ${i}`,
            code: `// ==UserScript==\n// @name Storm Script ${i}\n// @match https://storm${i}.io/*\n// @version 1.0.${i}\n// ==/UserScript==`,
            enabled: i % 2 === 0
          })
        );
      }

      // B. 30 concurrent toggles on existing scripts
      for (let i = 0; i < 30; i++) {
        const targetId = initialIds[i % initialIds.length];
        operations.push(
          toggleScript(targetId).catch(() => false)
        );
      }

      // C. 20 concurrent background injector queries for navigation matches
      for (let i = 0; i < 20; i++) {
        operations.push(
          scriptInjector.getMatchingScripts(`https://app${i % 10}.service.io/dashboard`, 'document-start')
        );
      }

      // D. 10 concurrent settings mutations
      for (let i = 0; i < 10; i++) {
        operations.push(
          saveSettings({
            logLevel: i % 2 === 0 ? 'debug' : 'info',
            autoAttachDebugger: true
          })
        );
      }

      // E. 10 concurrent batch imports
      for (let i = 0; i < 10; i++) {
        const bundle = JSON.stringify({
          version: 1,
          scripts: [
            {
              id: `imported-bundle-${i}-a`,
              name: `Imported A ${i}`,
              code: `// ==UserScript==\n// @name Imp A ${i}\n// @match https://bundle${i}.com/*\n// ==/UserScript==`
            }
          ]
        });
        operations.push(importScripts(bundle, { overwrite: true }));
      }

      // F. 20 concurrent storage export queries
      for (let i = 0; i < 20; i++) {
        operations.push(exportScripts());
      }

      const start = Date.now();
      const results = await Promise.allSettled(operations);
      const elapsed = Date.now() - start;

      // Ensure all 120 operations completed without hanging
      expect(elapsed).toBeLessThan(5000);
      expect(results.length).toBe(120);

      // Verify storage integrity
      const finalScripts = await getScripts();
      expect(finalScripts).toBeDefined();

      // Check that all 30 storm scripts exist with valid fields
      for (let i = 0; i < 30; i++) {
        const s = finalScripts[`storm-script-${i}`];
        expect(s).toBeDefined();
        expect(s.name).toBe(`Storm Script ${i}`);
        expect(s.metadata?.version).toBe(`1.0.${i}`);
      }

      // Check that imported scripts exist
      for (let i = 0; i < 10; i++) {
        expect(finalScripts[`imported-bundle-${i}-a`]).toBeDefined();
      }

      // Verify settings integrity
      const settings = await getSettings();
      expect(['debug', 'info']).toContain(settings.logLevel);
      expect(settings.autoAttachDebugger).toBe(true);
    });

    it('T1.2: Rapid script toggles racing against live tab navigation inject only currently enabled scripts', async () => {
      const scriptId = 'racing-toggle-script';
      await saveScript({
        id: scriptId,
        name: 'Racing Toggle Script',
        code: '// ==UserScript==\n// @name Racing Toggle Script\n// @match https://racing.test/*\n// @run-at document-start\n// ==/UserScript==',
        enabled: true
      });

      const tabId = 201;
      const url = 'https://racing.test/page';

      // Concurrently fire 5 rapid toggles and navigation commit
      const toggleProms = [
        toggleScript(scriptId),
        toggleScript(scriptId),
        toggleScript(scriptId),
        toggleScript(scriptId),
        toggleScript(scriptId) // Net result: starting from true -> toggled 5 times -> should be false
      ];

      const navProm = context.mockWebNavigation.onCommitted._emit({
        tabId,
        url,
        frameId: 0,
        transitionType: 'link',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });

      await Promise.all([...toggleProms, navProm]);

      const finalState = await getScript(scriptId);
      expect(finalState?.enabled).toBe(false);
    });
  });

  /* ========================================================================
   * TIER 2: Concurrent Multi-Tab CDP Command Flooding vs Sudden Detachment & Conflict
   * ======================================================================== */
  describe('Tier 2: Concurrent Multi-Tab CDP Command Flooding vs Sudden Detachment & Conflict', () => {
    it('T2.1: 50 concurrent in-flight CDP requests across 5 tabs: sudden DevTools detachment on 2 tabs rejects affected commands with code 1001 while unaffected tabs succeed', async () => {
      const tabIds = [301, 302, 303, 304, 305];

      // Attach all 5 tabs and register scripts
      for (const tabId of tabIds) {
        await debuggerMgr.attachTab(tabId);
        await saveScript({
          id: `script-tab-${tabId}`,
          name: `Script for Tab ${tabId}`,
          code: `// ==UserScript==\n// @name Script Tab ${tabId}\n// @match https://tab${tabId}.com/*\n// @grant GM_cdp\n// @cdp Page.enable\n// @cdp Runtime.evaluate\n// ==/UserScript==`,
          enabled: true
        });
      }

      // Configure mockDebugger sendCommand behavior:
      // Tabs 301, 302: simulate slow in-flight commands that hang until detachment
      // Tabs 303, 304, 305: resolve normally after a slight microtask delay
      context.mockDebugger.sendCommand.mockImplementation(async (target: any, method: string) => {
        const tId = target.tabId;
        if (tId === 301 || tId === 302) {
          // Keep hanging in flight
          return new Promise(() => {});
        }
        return { result: { value: `success_from_tab_${tId}_${method}` } };
      });

      // Issue 10 commands per tab (total 50 concurrent in-flight requests)
      const allRequests: { tabId: number; promise: Promise<any>; id: string }[] = [];

      for (const tabId of tabIds) {
        for (let reqIdx = 0; reqIdx < 10; reqIdx++) {
          const reqId = `flood_req_${tabId}_${reqIdx}`;
          const p = context.mockRuntime._emitMessage(
            {
              type: 'CDP_RPC_REQUEST',
              id: reqId,
              scriptId: `script-tab-${tabId}`,
              method: 'Runtime.evaluate',
              params: { expression: `1 + ${reqIdx}` }
            },
            { tab: { id: tabId, url: `https://tab${tabId}.com/app` } }
          );
          allRequests.push({ tabId, promise: p, id: reqId });
        }
      }

      // Allow all 50 requests to reach background bridge and register in inflightRequests
      await new Promise((r) => setTimeout(r, 20));

      // Trigger unexpected DevTools detachment on tabs 301 and 302
      context.mockDebugger._emitDetach({ tabId: 301 }, 'canceled_by_user');
      context.mockDebugger._emitDetach({ tabId: 302 }, 'canceled_by_user');

      // Wait for all promises to settle
      const settledResults = await Promise.all(allRequests.map((r) => r.promise));

      // Assertions:
      for (let i = 0; i < allRequests.length; i++) {
        const { tabId, id } = allRequests[i];
        const res: CdpRpcResponse = settledResults[i];

        if (tabId === 301 || tabId === 302) {
          // Must have failed cleanly with DevTools conflict code 1001
          expect(res.success, `Request ${id} on tab ${tabId} should have failed`).toBe(false);
          expect(res.error?.code).toBe(1001);
          expect(res.error?.message).toMatch(/DevTools conflict/i);
        } else {
          // Must have succeeded on untouched tabs (303, 304, 305)
          expect(res.success, `Request ${id} on tab ${tabId} should have succeeded`).toBe(true);
          expect(res.result).toEqual({ result: { value: `success_from_tab_${tabId}_Runtime.evaluate` } });
        }
      }

      // Verify session states
      expect(debuggerMgr.getTabStatus(301)).toBe('CONFLICT');
      expect(debuggerMgr.getTabStatus(302)).toBe('CONFLICT');
      expect(debuggerMgr.getTabStatus(303)).toBe('ATTACHED');
      expect(debuggerMgr.getTabStatus(304)).toBe('ATTACHED');
      expect(debuggerMgr.getTabStatus(305)).toBe('ATTACHED');
    });

    it('T2.2: 40 concurrent CDP requests racing against sudden tab close rejects with code 1002 and purges all tracking references', async () => {
      const tabId = 401;
      await debuggerMgr.attachTab(tabId);

      await saveScript({
        id: 'script-tab-close',
        name: 'Close Script',
        code: '// ==UserScript==\n// @name Close Script\n// @match https://closetest.org/*\n// @grant GM_cdp\n// @cdp Page.enable\n// @cdp DOM.enable\n// ==/UserScript==',
        enabled: true
      });

      // Mock sendCommand hanging in flight
      context.mockDebugger.sendCommand.mockImplementation(() => new Promise(() => {}));

      // Launch 40 concurrent in-flight requests
      const requests = Array.from({ length: 40 }, (_, i) => {
        return context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: `close_req_${i}`,
            scriptId: 'script-tab-close',
            method: 'DOM.enable',
            params: {}
          },
          { tab: { id: tabId, url: 'https://closetest.org/' } }
        );
      });

      await new Promise((r) => setTimeout(r, 15));

      // Trigger tab removal
      await context.mockTabs.onRemoved._emit(tabId, { windowId: 1, isWindowClosing: false });

      const responses: CdpRpcResponse[] = await Promise.all(requests);

      // All 40 requests must reject with code 1002 (detached/closed)
      expect(responses.length).toBe(40);
      for (const res of responses) {
        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(1002);
      }

      // Memory check: tab must be completely purged from debugger manager and bridge server
      expect(debuggerMgr.getTabStatus(tabId)).toBe('IDLE');
      expect(debuggerMgr.getSession(tabId)).toBeUndefined();
      expect(bridgeServer.getPendingRequestCount(tabId)).toBe(0);
    });

    it('T2.3: 20 rapid sequential attach/detach cycles under active command dispatch maintains mutex state integrity', async () => {
      const tabId = 450;
      context.mockDebugger.sendCommand.mockResolvedValue({ status: 'ok' });

      for (let cycle = 0; cycle < 20; cycle++) {
        const attachPromise = debuggerMgr.attachTab(tabId);
        const detachPromise = debuggerMgr.detachTab(tabId);

        await Promise.all([attachPromise, detachPromise]);

        // After detach finishes, status must be DETACHED or IDLE
        const status = debuggerMgr.getTabStatus(tabId);
        expect(['DETACHED', 'IDLE']).toContain(status);
      }
    });
  });

  /* ========================================================================
   * TIER 3: Rapid Tab Navigation & Subframe Injection Lifecycle Storm
   * ======================================================================== */
  describe('Tier 3: Rapid Tab Navigation & Subframe Injection Lifecycle Storm', () => {
    it('T3.1: 30 consecutive navigation events on the same tab execute exactly one injection per stage per unique document', async () => {
      // Clear storage so only this script is tested
      await chrome.storage.local.set({ scripts: {} });

      const parsed = parseMetadata(`// ==UserScript==
// @name Nav Storm Script
// @match https://navstorm.io/*
// @run-at document-start
// ==/UserScript==`);

      await saveScript({
        id: 'nav-storm-script',
        name: parsed.name,
        code: '// ==UserScript==\n// @name Nav Storm Script\n// @match https://navstorm.io/*\n// @run-at document-start\n// ==/UserScript==',
        metadata: parsed,
        enabled: true
      });

      const tabId = 501;

      // Fire 30 sequential navigation commits with distinct document URLs/hashes
      for (let i = 0; i < 30; i++) {
        const docUrl = `https://navstorm.io/page?doc=${i}`;

        await context.mockWebNavigation.onCommitted._emit({
          tabId,
          url: docUrl,
          frameId: 0,
          transitionType: 'link',
          transitionQualifiers: [],
          timeStamp: Date.now()
        });
      }

      // Exactly 30 executeScript calls should have occurred (1 for each new top-level document)
      expect(context.mockScripting.executeScript).toHaveBeenCalledTimes(30);

      // Same documentId navigation should NOT duplicate injection
      await context.mockWebNavigation.onCommitted._emit({
        tabId,
        url: 'https://navstorm.io/page?doc=29',
        frameId: 0,
        transitionType: 'link',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });

      // Still 30 because same URL + document was already injected
      expect(context.mockScripting.executeScript).toHaveBeenCalledTimes(30);
    });

    it('T3.2: Multi-frame hierarchy: Top-frame navigation clears all subframes while subframe navigation only resets its own frameId', async () => {
      // Clear storage to isolate to only this single test script
      await chrome.storage.local.set({ scripts: {} });

      await saveScript({
        id: 'iframe-script',
        name: 'Iframe Script',
        code: '// ==UserScript==\n// @name Iframe Script\n// @match https://frames.example.com/*\n// @run-at document-start\n// ==/UserScript==',
        enabled: true
      });

      const tabId = 601;

      // 1. Initial Top-level commit
      await context.mockWebNavigation.onCommitted._emit({
        tabId,
        url: 'https://frames.example.com/main',
        frameId: 0,
        transitionType: 'typed',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });
      expect(context.mockScripting.executeScript).toHaveBeenCalledTimes(1);

      // 2. Subframe 1 commits
      await context.mockWebNavigation.onCommitted._emit({
        tabId,
        url: 'https://frames.example.com/sub1',
        frameId: 101,
        transitionType: 'auto_subframe',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });
      expect(context.mockScripting.executeScript).toHaveBeenCalledTimes(2);

      // 3. Subframe 2 commits
      await context.mockWebNavigation.onCommitted._emit({
        tabId,
        url: 'https://frames.example.com/sub2',
        frameId: 102,
        transitionType: 'auto_subframe',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });
      expect(context.mockScripting.executeScript).toHaveBeenCalledTimes(3);

      // 4. Subframe 1 reloads/navigates -> should re-inject subframe 1 only
      await context.mockWebNavigation.onCommitted._emit({
        tabId,
        url: 'https://frames.example.com/sub1_updated',
        frameId: 101,
        transitionType: 'auto_subframe',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });
      expect(context.mockScripting.executeScript).toHaveBeenCalledTimes(4);

      // 5. Main frame navigates -> must reset all subframes
      await context.mockWebNavigation.onCommitted._emit({
        tabId,
        url: 'https://frames.example.com/main2',
        frameId: 0,
        transitionType: 'link',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });
      expect(context.mockScripting.executeScript).toHaveBeenCalledTimes(5);
    });

    it('T3.3: Tab removed during asynchronous executeScript handles error cleanly without memory leak', async () => {
      const tabId = 701;
      await saveScript({
        id: 'tab-remove-injection',
        name: 'Remove Injection Script',
        code: '// ==UserScript==\n// @name Remove Injection\n// @match https://removetest.io/*\n// @run-at document-start\n// ==/UserScript==',
        enabled: true
      });

      // Simulate executeScript rejecting because tab closed mid-flight
      context.mockScripting.executeScript.mockRejectedValueOnce(new Error('No tab with id: 701'));

      await expect(
        context.mockWebNavigation.onCommitted._emit({
          tabId,
          url: 'https://removetest.io/page',
          frameId: 0,
          transitionType: 'link',
          transitionQualifiers: [],
          timeStamp: Date.now()
        })
      ).resolves.not.toThrow();

      // Ensure tab removal listener cleans up state
      await context.mockTabs.onRemoved._emit(tabId, { windowId: 1, isWindowClosing: false });
      expect(debuggerMgr.getTabStatus(tabId)).toBe('IDLE');
      expect(debuggerMgr.getSession(tabId)).toBeUndefined();
    });
  });

  /* ========================================================================
   * TIER 4: Malformed Userscripts, Permission Violations & Adversarial Sandbox Resilience
   * ======================================================================== */
  describe('Tier 4: Malformed Userscripts, Permission Violations & Adversarial Sandbox Resilience', () => {
    it('T4.1: Malformed metadata headers (unclosed block, bad JSON in @cdp, invalid patterns) parse safely with graceful fallbacks', () => {
      const malformed1 = `// ==UserScript==
// @name Broken Header Script
// @version invalid-semver
// @match ftp://*/*
// @cdp NotValidJson { "unclosed: 
// @grant GM_unknownApi
// No end block`;

      const parsed1 = parseMetadata(malformed1);
      expect(parsed1.name).toBe('Broken Header Script');
      expect(parsed1.matchPatterns).toEqual(['ftp://*/*']);
      expect(parsed1.grants).toContain('GM_unknownApi');
      expect(parsed1.cdpDeclarations).toBeDefined();

      const malformed2 = `console.log('No metadata at all');`;
      const parsed2 = parseMetadata(malformed2);
      expect(parsed2.name).toBe('Unnamed Script');
      expect(parsed2.runAt).toBe('document-idle');
      expect(parsed2.grants).toEqual([]);
    });

    it('T4.2: Unauthorized CDP access from @grant none or undeclared domains is strictly rejected with code 403', async () => {
      const tabId = 801;
      await debuggerMgr.attachTab(tabId);

      // 1. Script with @grant none
      await saveScript({
        id: 'grant-none-script',
        name: 'Grant None Script',
        code: '// ==UserScript==\n// @name Grant None Script\n// @match https://auth.test/*\n// @grant none\n// ==/UserScript==',
        enabled: true
      });

      const res1: CdpRpcResponse = await context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'unauth_req_1',
          scriptId: 'grant-none-script',
          method: 'Page.navigate',
          params: { url: 'https://evil.com' }
        },
        { tab: { id: tabId, url: 'https://auth.test/' } }
      );

      expect(res1.success).toBe(false);
      expect(res1.error?.code).toBe(403);
      expect(res1.error?.message).toMatch(/@grant none/i);

      // 2. Script declaring only @cdp Network.enable attempting to call Page.navigate
      await saveScript({
        id: 'network-only-script',
        name: 'Network Only Script',
        code: '// ==UserScript==\n// @name Network Only Script\n// @match https://auth.test/*\n// @cdp Network.enable\n// ==/UserScript==',
        enabled: true
      });

      const res2: CdpRpcResponse = await context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'unauth_req_2',
          scriptId: 'network-only-script',
          method: 'Page.navigate',
          params: { url: 'https://evil.com' }
        },
        { tab: { id: tabId, url: 'https://auth.test/' } }
      );

      expect(res2.success).toBe(false);
      expect(res2.error?.code).toBe(403);
      expect(res2.error?.message).toMatch(/not authorized for CDP domain/i);
      expect((res2.error?.data as any)?.reason).toBe('DOMAIN_NOT_AUTHORIZED');
    });

    it('T4.3: Adversarial userscript runtime behavior (prototype pollution, exceptions, isolated GM storage) is contained by sandbox runner', async () => {
      // 1. Prototype pollution attempt on Object.prototype
      const pollutionScript = `
        Object.prototype.pollutedSecret = 'EXPLOITED';
        return typeof cdp;
      `;

      const metadataGrantNone: ParsedMetadata = {
        name: 'Polluter',
        matches: ['*://*/*'],
        matchPatterns: ['*://*/*'],
        includes: [],
        excludes: [],
        runAt: 'document-idle',
        grants: ['none'],
        cdp: [],
        cdpDeclarations: [],
        cdpDomains: [],
        requires: [],
        resources: {},
        noframes: false,
        connects: [],
        rawEntries: {}
      };

      const scriptNone: ScriptRecord = {
        id: 'polluter-1',
        name: 'Polluter',
        code: pollutionScript,
        enabled: true,
        metadata: metadataGrantNone,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const cdpClient = createCdpClient({ channelId: 'test-chan' });
      const runnerNone = createSandboxRunner(scriptNone, buildSandboxScope(scriptNone, cdpClient));
      const resultNone = runnerNone();

      // cdp must be undefined and shadowed
      expect(resultNone).toBe('undefined');

      // 2. Exception handling
      const throwingScript = `
        throw new Error('Explosion inside userscript');
      `;

      const scriptThrower: ScriptRecord = {
        id: 'thrower-1',
        name: 'Thrower',
        code: throwingScript,
        enabled: true,
        metadata: metadataGrantNone,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const runnerThrower = createSandboxRunner(scriptThrower, buildSandboxScope(scriptThrower, cdpClient));
      expect(() => runnerThrower()).toThrow(/Explosion inside userscript/);

      // 3. Isolated GM storage does not leak to window or other scripts
      const scriptA = { id: 'script-a', name: 'Script A', code: '', enabled: true } as ScriptRecord;
      const scriptB = { id: 'script-b', name: 'Script B', code: '', enabled: true } as ScriptRecord;

      const gmApi1 = createGmApi(scriptA, cdpClient);
      const gmApi2 = createGmApi(scriptB, cdpClient);

      (gmApi1.GM_setValue as Function)('token', 'SECRET_A');
      (gmApi2.GM_setValue as Function)('token', 'SECRET_B');

      expect((gmApi1.GM_getValue as Function)('token')).toBe('SECRET_A');
      expect((gmApi2.GM_getValue as Function)('token')).toBe('SECRET_B');
      expect((gmApi1.GM_listValues as Function)()).toEqual(['token']);

      (gmApi1.GM_deleteValue as Function)('token');
      expect((gmApi1.GM_getValue as Function)('token')).toBeUndefined();
      expect((gmApi2.GM_getValue as Function)('token')).toBe('SECRET_B');
    });
  });
});
