/**
 * XOKJ Engine - Requirement-Driven Opaque-Box E2E Test Suite (Tiers 1-4)
 * Location: test/e2e/e2e-opaque-requirements.spec.ts
 *
 * Implements authoritative opaque-box tests derived directly from:
 * - ORIGINAL_REQUEST.md (Requirements R1, R2, R3, R4, R5)
 * - PROJECT.md (Interface Contracts, CDP Lifecycle, GM Storage, Event Pipeline)
 *
 * Tier 1: Feature Coverage (Happy Path for all core capabilities)
 * Tier 2: Boundary & Corner Cases (Extreme sizes, rapid detachment, empty inputs, timeouts)
 * Tier 3: Cross-Feature Combinations (Pairwise interactions: CDP + Storage, Conflict + Reconnect)
 * Tier 4: Real-World Workload Scenarios (Full production telemetry & security auditor userscript)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { setupChromeMock } from '../mocks/chrome';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { DevToolsConflictHandler } from '@/background/conflict-mgr';
import { ScriptInjector } from '@/background/injector';
import { ContentScriptBridge } from '@/content/bridge';
import {
  CdpClient,
  createGmApi,
  clearIsolatedGmStorage,
  getIsolatedScriptStore
} from '@/content/cdp-sdk';
import { buildSandboxScope, createSandboxRunner } from '@/content/sandbox';
import { parseMetadata } from '@/shared/metadata-parser';
import { matchesUrl, isRestrictedUrl } from '@/shared/match-pattern';
import {
  saveScript,
  getScript,
  getAllScripts,
  resetToDefaultScripts
} from '@/shared/storage';
import { DevToolsConflictError } from '@/shared/types';
import { scanFile } from '../../packages/xobrow/src/engine/scanner';
import { defaultRegistry } from '../../packages/xobrow/src/rules/registry';

describe('XOKJ Requirement-Driven Opaque-Box E2E Test Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let debuggerMgr: TabDebuggerManager;
  let bridgeServer: CdpBridgeServer;
  let conflictHandler: DevToolsConflictHandler;
  let scriptInjector: ScriptInjector;
  let contentBridge: ContentScriptBridge;
  let cdpClient: CdpClient;

  const TEST_TAB_ID = 42;

  beforeEach(async () => {
    // 1. Initialize Headless Chrome Mock Suite
    context = setupChromeMock();
    clearIsolatedGmStorage();
    await resetToDefaultScripts();

    // 2. Initialize Background Engine Subsystems
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

    // 3. Connect Chrome Runtime messaging between Content Script & Service Worker
    context.mockRuntime.sendMessage.mockImplementation(async (msg: any) => {
      return context.mockRuntime._emitMessage(msg, {
        tab: { id: TEST_TAB_ID, url: 'https://app.example.com/portal' }
      });
    });

    // 4. Connect Chrome Tabs messaging from Service Worker to Content Script
    context.mockTabs.sendMessage.mockImplementation(async (tabId: number, msg: any): Promise<void> => {
      if (contentBridge) {
        contentBridge.handleRuntimeMessage(msg);
      }
    });

    // 5. Initialize Content Bridge in Content Script world
    contentBridge = new ContentScriptBridge({
      autoStart: true,
      tabId: TEST_TAB_ID
    });

    // 6. Connect window.postMessage synchronously via DOM Custom MessageEvent dispatching
    vi.stubGlobal('postMessage', (data: any) => {
      const event = new MessageEvent('message', {
        data,
        source: window,
        origin: window.location?.origin || 'https://app.example.com'
      });
      window.dispatchEvent(event);
    });

    // 7. Initialize CdpClient in Page context
    cdpClient = new CdpClient({
      tabId: TEST_TAB_ID,
      autoStart: true,
      timeoutMs: 5000
    });
  });

  afterEach(() => {
    cdpClient?.destroy();
    contentBridge?.destroy();
    scriptInjector?.destroy();
    conflictHandler?.destroy();
    bridgeServer?.destroy();
    debuggerMgr?.destroy();
    clearIsolatedGmStorage();
    vi.restoreAllMocks();
  });

  /* ========================================================================
   * TIER 1: Feature Coverage (Happy Path for All Core Capabilities)
   * ======================================================================== */
  describe('Tier 1: Feature Coverage (Core Capabilities)', () => {
    it('T1.1: Manifest MV3 Declaration & Permissions conform to security specifications', async () => {
      const manifestPath = path.resolve(__dirname, '../../manifest.config.ts');
      const manifestSource = fs.readFileSync(manifestPath, 'utf-8');

      // Verify static declaration properties
      expect(manifestSource).toContain('manifest_version: 3');
      expect(manifestSource).toContain("'debugger'");
      expect(manifestSource).toContain("'storage'");
      expect(manifestSource).toContain("'tabs'");
      expect(manifestSource).toContain("'activeTab'");
      expect(manifestSource).toContain("'webNavigation'");
      expect(manifestSource).toContain("'scripting'");
      expect(manifestSource).toContain("service_worker: 'src/background/index.ts'");
      expect(manifestSource).toContain("type: 'module'");
      expect(manifestSource).toContain("run_at: 'document_start'");
      expect(manifestSource).toContain("matches: ['<all_urls>']");

      // Verify dynamic manifest generation
      const manifestModule: any = await import(manifestPath);
      const manifest = await (manifestModule.default || manifestModule)();

      expect(manifest.manifest_version).toBe(3);
      expect(manifest.name).toBeDefined();
      expect(manifest.version).toBeDefined();

      // Service worker background module
      expect(manifest.background?.service_worker).toBe('src/background/index.ts');
      expect(manifest.background?.type).toBe('module');

      // Content script injection at document_start
      expect(manifest.content_scripts).toBeDefined();
      expect(manifest.content_scripts.length).toBeGreaterThan(0);
      const mainContentScript = manifest.content_scripts[0];
      expect(mainContentScript.run_at).toBe('document_start');
      expect(mainContentScript.matches).toContain('<all_urls>');

      // Permissions inventory
      const perms = manifest.permissions || [];
      expect(perms).toContain('debugger');
      expect(perms).toContain('storage');
      expect(perms).toContain('tabs');
      expect(perms).toContain('activeTab');
      expect(perms).toContain('webNavigation');
      expect(perms).toContain('scripting');

      // Host permissions
      expect(manifest.host_permissions).toContain('<all_urls>');
    });

    it('T1.2: Authoritative TabDebuggerManager attaches target tab and creates session', async () => {
      const tabId = 101;
      await debuggerMgr.attachTab(tabId);
      const session = debuggerMgr.getSession(tabId);

      expect(session).toBeDefined();
      expect(session?.tabId).toBe(tabId);
      expect(session?.status).toBe('ATTACHED');
      expect(debuggerMgr.isAttached(tabId)).toBe(true);
      expect(debuggerMgr.getTabStatus(tabId)).toBe('ATTACHED');

      // Verified chrome.debugger.attach invocation with CDP version 1.3
      expect(context.mockDebugger.attach).toHaveBeenCalledWith({ tabId }, '1.3');
    });

    it('T1.3: Clean TabDebuggerManager detaches target tab and updates status to DETACHED', async () => {
      const tabId = 102;
      await debuggerMgr.attachTab(tabId);
      expect(debuggerMgr.isAttached(tabId)).toBe(true);

      await debuggerMgr.detachTab(tabId);

      expect(debuggerMgr.isAttached(tabId)).toBe(false);
      expect(debuggerMgr.getTabStatus(tabId)).toBe('DETACHED');
      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId });
    });

    it('T1.4: Bidirectional CDP RPC Execution (Page -> Bridge -> Background -> Host -> Response)', async () => {
      await debuggerMgr.attachTab(TEST_TAB_ID);

      // Mock host return value
      const expectedCookies = [
        { name: 'session_id', value: 'secret_abc_123', domain: '.example.com' }
      ];
      context.mockDebugger.sendCommand.mockResolvedValueOnce({ cookies: expectedCookies });

      const result = await cdpClient.send<{ cookies: typeof expectedCookies }>(
        'Network.getCookies',
        { urls: ['https://app.example.com'] }
      );

      expect(result).toBeDefined();
      expect(result.cookies).toEqual(expectedCookies);
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: TEST_TAB_ID },
        'Network.getCookies',
        { urls: ['https://app.example.com'] }
      );
    });

    it('T1.5: Live CDP Event Streaming (cdp.on & cdp.off subscription lifecycle)', async () => {
      await debuggerMgr.attachTab(TEST_TAB_ID);

      const receivedEvents: any[] = [];
      const unsubscribe = cdpClient.on('Network.requestWillBeSent', (params) => {
        receivedEvents.push(params);
      });

      // 1. Simulate live event pushed from Chrome Debugger host
      const eventPayload1 = {
        requestId: 'req_101',
        request: { url: 'https://api.example.com/v1/auth', method: 'POST' }
      };
      await context.mockDebugger._emitEvent(
        { tabId: TEST_TAB_ID },
        'Network.requestWillBeSent',
        eventPayload1
      );

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0]).toEqual(eventPayload1);

      // 2. Unsubscribe and verify subsequent events are discarded
      unsubscribe();

      const eventPayload2 = {
        requestId: 'req_102',
        request: { url: 'https://api.example.com/v1/data', method: 'GET' }
      };
      await context.mockDebugger._emitEvent(
        { tabId: TEST_TAB_ID },
        'Network.requestWillBeSent',
        eventPayload2
      );

      expect(receivedEvents).toHaveLength(1);
    });

    it('T1.6: Greasemonkey Key-Value Storage (GM_setValue, GM_getValue, GM_deleteValue, GM_listValues)', () => {
      const scriptId = 'script_kv_test';
      const gm = createGmApi(scriptId, [
        'GM_setValue',
        'GM_getValue',
        'GM_deleteValue',
        'GM_listValues'
      ]) as any;

      // Primitive types
      gm.GM_setValue('numKey', 42);
      gm.GM_setValue('strKey', 'xokj_engine');
      gm.GM_setValue('boolKey', true);

      // Complex structures
      const complexObj = { version: '2.0.0', flags: [1, 2, 3], nested: { valid: true } };
      gm.GM_setValue('objKey', complexObj);

      expect(gm.GM_getValue('numKey')).toBe(42);
      expect(gm.GM_getValue('strKey')).toBe('xokj_engine');
      expect(gm.GM_getValue('boolKey')).toBe(true);
      expect(gm.GM_getValue('objKey')).toEqual(complexObj);

      // Default value fallback for nonexistent keys
      expect(gm.GM_getValue('nonexistent', 'fallback_val')).toBe('fallback_val');

      // Key listing
      const keys = gm.GM_listValues();
      expect(keys).toContain('numKey');
      expect(keys).toContain('strKey');
      expect(keys).toContain('boolKey');
      expect(keys).toContain('objKey');

      // Deletion
      gm.GM_deleteValue('strKey');
      expect(gm.GM_getValue('strKey')).toBeUndefined();
      expect(gm.GM_listValues()).not.toContain('strKey');
    });

    it('T1.7: URL Match Pattern Evaluation & Restricted Scheme Filtering', () => {
      // Standard Chromium Match Patterns
      expect(matchesUrl('https://*.example.com/*', 'https://sub.example.com/api')).toBe(true);
      expect(matchesUrl('https://*.example.com/*', 'https://example.com/')).toBe(true);
      expect(matchesUrl('https://*.example.com/*', 'http://sub.example.com/')).toBe(false);
      expect(matchesUrl('*://*.google.com/search*', 'https://www.google.com/search?q=xokj')).toBe(true);

      // Restricted Chromium URL filtering
      expect(isRestrictedUrl('chrome://settings')).toBe(true);
      expect(isRestrictedUrl('chrome-extension://abcdef/popup.html')).toBe(true);
      expect(isRestrictedUrl('https://chrome.google.com/webstore')).toBe(true);
      expect(isRestrictedUrl('https://app.example.com/dashboard')).toBe(false);
    });

    it('T1.8: Userscript Metadata Header Parsing & @cdp Directive Extraction', () => {
      const userscriptCode = `// ==UserScript==
// @name         Full Opaque Test Script
// @namespace    https://xokj.dev
// @version      3.1.4
// @description  Validates complete metadata parsing
// @match        https://*.example.com/*
// @match        https://app.service.org/login
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_cdp
// @cdp          Network.enable {"maxTotalBufferSize": 5000000}
// @cdp          Page.enable
// ==/UserScript==

console.log('Script body');
`;

      const parsed = parseMetadata(userscriptCode);

      expect(parsed.name).toBe('Full Opaque Test Script');
      expect(parsed.version).toBe('3.1.4');
      expect(parsed.runAt).toBe('document-start');
      expect(parsed.matchPatterns).toEqual([
        'https://*.example.com/*',
        'https://app.service.org/login'
      ]);
      expect(parsed.grants).toContain('GM_setValue');
      expect(parsed.grants).toContain('GM_getValue');
      expect(parsed.grants).toContain('GM_cdp');

      // Verify declarative CDP directives
      expect(parsed.cdpDeclarations).toHaveLength(2);
      expect(parsed.cdpDeclarations[0]).toEqual({
        domain: 'Network',
        method: 'enable',
        command: 'Network.enable',
        params: { maxTotalBufferSize: 5000000 },
        raw: 'Network.enable {"maxTotalBufferSize": 5000000}'
      });
      expect(parsed.cdpDeclarations[1]).toEqual({
        domain: 'Page',
        method: 'enable',
        command: 'Page.enable',
        params: {},
        raw: 'Page.enable'
      });
    });

    it('T1.9: XoBrow AST Rule Validation catches violations and approves clean scripts', () => {
      // 1. Script with prohibited eval
      const badEvalScript = `// ==UserScript==
// @name Insecure Eval Script
// @match https://example.com/*
// ==/UserScript==
const data = eval("JSON.parse('{}')");
`;
      const evalResult = scanFile('test-eval.user.js', badEvalScript);
      expect(evalResult.diagnostics.some((d) => d.ruleId === 'sec-no-eval')).toBe(true);

      // 2. Script with unsafe innerHTML sink
      const badDomScript = `// ==UserScript==
// @name Insecure DOM Script
// @match https://example.com/*
// ==/UserScript==
document.body.innerHTML = '<div>' + window.location.search + '</div>';
`;
      const domResult = scanFile('test-dom.user.js', badDomScript);
      expect(domResult.diagnostics.some((d) => d.ruleId === 'sec-no-unsafe-dom-sink')).toBe(true);

      // 3. Clean userscript passes with 0 diagnostics
      const cleanScript = `// ==UserScript==
// @name Clean Compliant Script
// @match https://example.com/*
// @grant none
// ==/UserScript==
console.log('Clean execution');
`;
      const cleanResult = scanFile('test-clean.user.js', cleanScript);
      expect(cleanResult.diagnostics).toHaveLength(0);
    });
  });

  /* ========================================================================
   * TIER 2: Boundary & Corner Cases (Adversarial, Extreme & Defensive Scenarios)
   * ======================================================================== */
  describe('Tier 2: Boundary & Corner Cases', () => {
    it('T2.1: Empty and Comment-Only Userscripts parse and initialize safely', () => {
      // Empty string
      const emptyParsed = parseMetadata('');
      expect(emptyParsed.name).toBe('Unnamed Script');
      expect(emptyParsed.matchPatterns).toEqual([]);
      expect(emptyParsed.grants).toEqual([]);

      // Comment only
      const commentParsed = parseMetadata('// ==UserScript==\n// Just a comment\n// ==/UserScript==');
      expect(commentParsed.name).toBe('Unnamed Script');

      // Runner execution with empty code
      const emptyRecord = {
        id: 'empty_script',
        name: 'Empty Script',
        code: '',
        enabled: true,
        metadata: emptyParsed,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const scope = buildSandboxScope(emptyRecord, cdpClient);
      const runner = createSandboxRunner(emptyRecord, scope);
      expect(() => runner()).not.toThrow();
    });

    it('T2.2: Extreme Payload Sizes (2 MB buffer) execute without truncation or memory corruption', async () => {
      await debuggerMgr.attachTab(TEST_TAB_ID);

      // Construct 2 MB string payload
      const chunk = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(100);
      const largePayload = chunk.repeat(500); // ~1.8 MB
      expect(largePayload.length).toBeGreaterThan(1_500_000);

      context.mockDebugger.sendCommand.mockResolvedValueOnce({
        receivedLength: largePayload.length,
        status: 'OK'
      });

      const response = await cdpClient.send<{ receivedLength: number; status: string }>(
        'Network.setExtraHTTPHeaders',
        { headers: { 'X-Large-Header': largePayload } }
      );

      expect(response.status).toBe('OK');
      expect(response.receivedLength).toBe(largePayload.length);
    });

    it('T2.3: Invalid Method Names and Malformed Requests reject with descriptive errors', async () => {
      await expect(cdpClient.send('')).rejects.toThrow(
        'Invalid CDP command: method must be a non-empty string'
      );
      await expect(cdpClient.send('   ')).rejects.toThrow(
        'Invalid CDP command: method must be a non-empty string'
      );
      await expect(cdpClient.send(null as any)).rejects.toThrow(
        'Invalid CDP command: method must be a non-empty string'
      );
    });

    it('T2.4: Concurrent Attachments on Same Tab resolve idempotently without race corruption', async () => {
      const tabId = 202;

      // Trigger 5 simultaneous attach calls for same tab
      const attachPromises = [
        debuggerMgr.attachTab(tabId),
        debuggerMgr.attachTab(tabId),
        debuggerMgr.attachTab(tabId),
        debuggerMgr.attachTab(tabId),
        debuggerMgr.attachTab(tabId)
      ];

      await Promise.all(attachPromises);

      // Session exists and is attached
      const session = debuggerMgr.getSession(tabId);
      expect(session).toBeDefined();
      expect(session?.tabId).toBe(tabId);
      expect(session?.status).toBe('ATTACHED');
      expect(debuggerMgr.isAttached(tabId)).toBe(true);

      // Authoritative underlying attach was called only once for this tab
      expect(
        context.mockDebugger.attach.mock.calls.filter((c: any) => c[0]?.tabId === tabId)
      ).toHaveLength(1);
    });

    it('T2.5: Rapid Detach Mid-Flight Request Invalidation settles pending promises without unhandled rejections', async () => {
      await debuggerMgr.attachTab(TEST_TAB_ID);

      // Program mock command to hang indefinitely
      context.mockDebugger.sendCommand.mockImplementationOnce(() => new Promise(() => {}));

      // Issue command through bridge
      const inFlightPromise = contentBridge.send('Page.captureScreenshot', { format: 'png' });

      // Yield event loop so command enters in-flight registry
      await new Promise((r) => setTimeout(r, 10));

      // Trigger rapid detach on bridge
      contentBridge.handleDetached('closed_by_browser');

      await expect(inFlightPromise).rejects.toThrow(/detached/i);
    });

    it('T2.6: Unresponsive CDP Host & Timeout Guard fires cleanly and drains request registry', async () => {
      await debuggerMgr.attachTab(TEST_TAB_ID);

      const fastTimeoutClient = new CdpClient({
        tabId: TEST_TAB_ID,
        autoStart: true,
        timeoutMs: 60 // 60ms timeout guard
      });

      // Host never resolves
      context.mockDebugger.sendCommand.mockImplementationOnce(() => new Promise(() => {}));

      const hangingPromise = fastTimeoutClient.send('Runtime.evaluate', {
        expression: 'while(true){}'
      });

      await expect(hangingPromise).rejects.toThrow(/timed out after 60ms/i);

      fastTimeoutClient.destroy();
    });
  });

  /* ========================================================================
   * TIER 3: Cross-Feature Combinations (Pairwise Subsystem Interactions)
   * ======================================================================== */
  describe('Tier 3: Cross-Feature Combinations', () => {
    it('T3.1: Live CDP Event Ingestion Paired with GM Storage Persistence', async () => {
      await debuggerMgr.attachTab(TEST_TAB_ID);

      const scriptId = 'network_monitor_script';
      const gm = createGmApi(scriptId, ['GM_setValue', 'GM_getValue', 'GM_listValues']) as any;

      // Seed baseline storage
      gm.GM_setValue('totalResponses', 0);
      gm.GM_setValue('accumulatedBytes', 0);

      // Subscribe to Network.responseReceived
      cdpClient.on('Network.responseReceived', (params: any) => {
        const currentCount = gm.GM_getValue('totalResponses', 0);
        const currentBytes = gm.GM_getValue('accumulatedBytes', 0);
        const encodedLength = params.response?.encodedDataLength || 0;

        gm.GM_setValue('totalResponses', currentCount + 1);
        gm.GM_setValue('accumulatedBytes', currentBytes + encodedLength);
      });

      // Dispatch 5 sequential mock CDP response events
      const mockResponses = [
        { encodedDataLength: 512 },
        { encodedDataLength: 1024 },
        { encodedDataLength: 2048 },
        { encodedDataLength: 4096 },
        { encodedDataLength: 256 }
      ];

      for (let i = 0; i < mockResponses.length; i++) {
        await context.mockDebugger._emitEvent(
          { tabId: TEST_TAB_ID },
          'Network.responseReceived',
          { response: mockResponses[i] }
        );
      }

      // Verify storage reflects exact combined aggregation
      expect(gm.GM_getValue('totalResponses')).toBe(5);
      expect(gm.GM_getValue('accumulatedBytes')).toBe(512 + 1024 + 2048 + 4096 + 256); // 7936
    });

    it('T3.2: Native DevTools Conflict Invalidation, Reconnection & Event Stream Resumption', async () => {
      const tabId = TEST_TAB_ID;
      await debuggerMgr.attachTab(tabId);

      const receivedEvents: string[] = [];
      cdpClient.on('Page.loadEventFired', (params: any) => {
        receivedEvents.push(params.timestamp);
      });

      // 1. Initial event arrives normally
      await context.mockDebugger._emitEvent({ tabId }, 'Page.loadEventFired', { timestamp: 't1' });
      expect(receivedEvents).toEqual(['t1']);

      // 2. Hanging command in flight
      context.mockDebugger.sendCommand.mockImplementationOnce(() => new Promise(() => {}));
      const hangingCmd = cdpClient.send('Page.reload');

      await new Promise((r) => setTimeout(r, 10));

      // 3. User opens DevTools -> Detach conflict event emitted
      await context.mockDebugger._emitDetach({ tabId }, 'canceled_by_user');

      // Command in flight rejects with DevToolsConflictError
      await expect(hangingCmd).rejects.toThrow(DevToolsConflictError);
      expect(debuggerMgr.getTabStatus(tabId)).toBe('CONFLICT');

      // Subsequent commands in conflict state are rejected immediately
      await expect(cdpClient.send('Page.reload')).rejects.toThrow(DevToolsConflictError);

      // 4. DevTools closes -> User or Auto-reconnect triggered
      await debuggerMgr.attachTab(tabId, undefined, true);
      expect(debuggerMgr.getTabStatus(tabId)).toBe('ATTACHED');

      // Notify Content Bridge and Client of reconnection
      contentBridge.handleRuntimeMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId,
        status: 'ATTACHED'
      });

      // 5. Subsequent commands and event streaming resume cleanly
      context.mockDebugger.sendCommand.mockResolvedValueOnce({ success: true });
      const postConflictCmd = await cdpClient.send('Page.navigate', { url: 'https://example.com' });
      expect(postConflictCmd).toEqual({ success: true });

      await context.mockDebugger._emitEvent({ tabId }, 'Page.loadEventFired', { timestamp: 't2' });
      expect(receivedEvents).toEqual(['t1', 't2']);
    });

    it('T3.3: Declarative @cdp Header Initialization Combined with Dynamic cdp.on', async () => {
      const scriptCode = `// ==UserScript==
// @name         Declarative + Dynamic CDP Integration Script
// @match        https://app.example.com/*
// @grant        GM_cdp
// @cdp          Network.enable {"maxTotalBufferSize": 10000000}
// @cdp          Page.enable
// ==/UserScript==
`;
      const parsed = parseMetadata(scriptCode);
      await saveScript({
        name: parsed.name,
        code: scriptCode,
        metadata: parsed,
        enabled: true
      });

      // 1. Simulate onBeforeNavigate triggering early declarative domain initialization
      await context.mockWebNavigation.onBeforeNavigate._emit({
        tabId: TEST_TAB_ID,
        url: 'https://app.example.com/dashboard',
        frameId: 0,
        timeStamp: Date.now()
      });

      // Assert debugger attached and declarative commands executed
      expect(debuggerMgr.getTabStatus(TEST_TAB_ID)).toBe('ATTACHED');
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: TEST_TAB_ID },
        'Network.enable',
        { maxTotalBufferSize: 10000000 }
      );
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: TEST_TAB_ID },
        'Page.enable',
        {}
      );

      // 2. Main world script initializes dynamic event listener and sends command
      const capturedRequests: string[] = [];
      cdpClient.on('Network.requestWillBeSent', (params: any) => {
        capturedRequests.push(params.request.url);
      });

      await context.mockDebugger._emitEvent(
        { tabId: TEST_TAB_ID },
        'Network.requestWillBeSent',
        { request: { url: 'https://app.example.com/api/user' } }
      );

      expect(capturedRequests).toContain('https://app.example.com/api/user');
    });
  });

  /* ========================================================================
   * TIER 4: Real-World Workload Scenarios
   * ======================================================================== */
  describe('Tier 4: Real-World Workload Scenarios', () => {
    it('T4.1: Production Network Interceptor & Telemetry Auditor Userscript Workflow', async () => {
      /**
       * Realistic production userscript that:
       * 1. Listens to live CDP network request & response events.
       * 2. Computes bandwidth, mimeType distribution, and identifies slow endpoints.
       * 3. Audits session authentication cookies via active CDP command.
       * 4. Persists the aggregated telemetry report into GM storage.
       * 5. Demonstrates persistence preservation across re-execution.
       */
      const scriptId = 'prod_network_telemetry_auditor';
      await debuggerMgr.attachTab(TEST_TAB_ID);

      const gm = createGmApi(scriptId, [
        'GM_setValue',
        'GM_getValue',
        'GM_listValues',
        'GM_cdp'
      ]) as any;

      interface TelemetryReport {
        totalRequests: number;
        totalBytes: number;
        endpointsByMime: Record<string, number>;
        slowRequests: string[];
        cookiesAudited: boolean;
        auditTimestamp: number;
      }

      // Initialize state in userscript
      const initialReport: TelemetryReport = {
        totalRequests: 0,
        totalBytes: 0,
        endpointsByMime: {},
        slowRequests: [],
        cookiesAudited: false,
        auditTimestamp: Date.now()
      };
      gm.GM_setValue('telemetry_summary', initialReport);

      // Set up live event listeners
      cdpClient.on('Network.requestWillBeSent', (params: any) => {
        const report = gm.GM_getValue('telemetry_summary') as TelemetryReport;
        report.totalRequests += 1;

        const mime = params.type || 'Other';
        report.endpointsByMime[mime] = (report.endpointsByMime[mime] || 0) + 1;

        gm.GM_setValue('telemetry_summary', report);
      });

      cdpClient.on('Network.loadingFinished', (params: any) => {
        const report = gm.GM_getValue('telemetry_summary') as TelemetryReport;
        report.totalBytes += params.encodedDataLength || 0;

        if ((params.duration || 0) > 100) {
          report.slowRequests.push(params.requestId);
        }

        gm.GM_setValue('telemetry_summary', report);
      });

      // Stream 50 realistic requests through the CDP event pipeline
      const mimeTypes = ['XHR', 'Fetch', 'Stylesheet', 'Script', 'Image'];
      for (let i = 1; i <= 50; i++) {
        const mime = mimeTypes[i % mimeTypes.length];
        const bytes = 100 * (i % 10 + 1);
        const duration = (i % 7 === 0) ? 150 : 25; // Every 7th request is slow (>100ms)

        // 1. Request initiated
        await context.mockDebugger._emitEvent(
          { tabId: TEST_TAB_ID },
          'Network.requestWillBeSent',
          {
            requestId: `req_${i}`,
            type: mime,
            request: { url: `https://app.example.com/api/resource_${i}` }
          }
        );

        // 2. Loading completed
        await context.mockDebugger._emitEvent(
          { tabId: TEST_TAB_ID },
          'Network.loadingFinished',
          {
            requestId: `req_${i}`,
            encodedDataLength: bytes,
            duration
          }
        );
      }

      // Active audit: Query cookies using cdp.send
      context.mockDebugger.sendCommand.mockResolvedValueOnce({
        cookies: [
          { name: 'X-Session-Token', value: 'valid_jwt_token', secure: true, httpOnly: true }
        ]
      });

      const cookieResult = await cdpClient.send<{ cookies: any[] }>('Network.getCookies', {
        urls: ['https://app.example.com']
      });

      expect(cookieResult.cookies[0].name).toBe('X-Session-Token');

      // Finalize telemetry report
      const finalReport = gm.GM_getValue('telemetry_summary') as TelemetryReport;
      finalReport.cookiesAudited = cookieResult.cookies.length > 0;
      gm.GM_setValue('telemetry_summary', finalReport);

      // Verify exact aggregates
      expect(finalReport.totalRequests).toBe(50);
      expect(finalReport.totalBytes).toBeGreaterThan(10000);
      expect(finalReport.slowRequests.length).toBe(7); // Requests 7, 14, 21, 28, 35, 42, 49
      expect(finalReport.cookiesAudited).toBe(true);
      expect(Object.keys(finalReport.endpointsByMime).sort()).toEqual(mimeTypes.slice().sort());

      // Simulate re-execution / navigation: telemetry state persists intact
      const freshGm = createGmApi(scriptId, ['GM_getValue']) as any;
      const rehydratedReport = freshGm.GM_getValue('telemetry_summary') as TelemetryReport;
      expect(rehydratedReport).toEqual(finalReport);
      expect(rehydratedReport.totalRequests).toBe(50);
    });
  });
});
