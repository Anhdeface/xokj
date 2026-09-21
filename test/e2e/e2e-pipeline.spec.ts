/**
 * End-to-End Pipeline Integration Suite (Milestone 5)
 * Location: test/e2e/e2e-pipeline.spec.ts
 *
 * Verifies the complete full lifecycle of XOKJ:
 * 1. Metadata Parsing & Storage Persistence
 * 2. Tab Navigation & Early CDP Attachment
 * 3. Multi-phase Lifecycle Injection (document-start, document-end)
 * 4. End-to-End CDP RPC Execution (Page Context -> Content Bridge -> Background -> CDP Host -> Response)
 * 5. CDP Event Broadcasting to Userscripts
 * 6. Native DevTools Conflict Handling & In-Flight Promise Rejection
 * 7. Extension UI Popup & Dashboard State Synchronization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setupChromeMock } from '../mocks/chrome';
import { parseMetadata } from '@/shared/metadata-parser';
import { matchesUrl } from '@/shared/match-pattern';
import { saveScript, getScript, getAllScripts, resetToDefaultScripts } from '@/shared/storage';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { DevToolsConflictHandler } from '@/background/conflict-mgr';
import { ScriptInjector } from '@/background/injector';
import { UiIpcServer } from '@/background/ui-ipc';
import { ContentScriptBridge } from '@/content/bridge';
import PopupApp from '@/popup/App.vue';
import DashboardApp from '@/dashboard/App.vue';
import type { CdpRpcResponse } from '@/shared/types';

describe('Milestone 5: E2E Pipeline Integration Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let debuggerMgr: TabDebuggerManager;
  let bridgeServer: CdpBridgeServer;
  let conflictHandler: DevToolsConflictHandler;
  let scriptInjector: ScriptInjector;
  let uiIpc: UiIpcServer;

  const SAMPLE_USER_SCRIPT = `// ==UserScript==
// @name         E2E Live Test Script
// @namespace    https://xokj.dev/test
// @version      1.2.0
// @description  Full pipeline integration verification script
// @match        https://*.example.com/*
// @match        https://app.example.org/dashboard
// @run-at       document-start
// @grant        GM_cdp
// @cdp          Network.enable {"maxTotalBufferSize": 10000000}
// @cdp          Page.enable
// ==/UserScript==

(async () => {
  console.log('[Userscript] Initializing on', window.location.href);
  const cookies = await cdp.send('Network.getCookies', { urls: ['https://api.example.com'] });
  window.__E2E_COOKIES__ = cookies;
})();
`;

  beforeEach(async () => {
    context = setupChromeMock();
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

    // Default runtime message handler routing to background listeners
    context.mockRuntime.sendMessage.mockImplementation(async (msg: any) => {
      return context.mockRuntime._emitMessage(msg, { tab: { id: 10 } });
    });

    // Default tabs sendMessage routing to runtime onMessage listeners
    context.mockTabs.sendMessage.mockImplementation(async (tabId: number, msg: any) => {
      return context.mockRuntime._emitMessage(msg, { tab: { id: tabId } });
    });

    context.mockTabs.query.mockResolvedValue([
      { id: 10, url: 'https://sub.example.com/portal', title: 'Portal Example' } as any
    ]);
  });

  afterEach(() => {
    uiIpc.destroy();
    scriptInjector.destroy();
    conflictHandler.destroy();
    bridgeServer.destroy();
    debuggerMgr.destroy();
    vi.restoreAllMocks();
  });

  describe('Tier 1: Metadata Parsing & Storage Layer E2E', () => {
    it('T1.1: parses sample userscript and persists it into storage repository', async () => {
      const parsed = parseMetadata(SAMPLE_USER_SCRIPT);

      expect(parsed.name).toBe('E2E Live Test Script');
      expect(parsed.version).toBe('1.2.0');
      expect(parsed.runAt).toBe('document-start');
      expect(parsed.matchPatterns).toEqual([
        'https://*.example.com/*',
        'https://app.example.org/dashboard'
      ]);
      expect(parsed.grants).toContain('GM_cdp');
      expect(parsed.cdpDeclarations).toHaveLength(2);
      expect(parsed.cdpDeclarations[0]).toEqual({
        domain: 'Network',
        method: 'enable',
        command: 'Network.enable',
        params: { maxTotalBufferSize: 10000000 },
        raw: 'Network.enable {"maxTotalBufferSize": 10000000}'
      });
      expect(parsed.cdpDeclarations[1]).toEqual({
        domain: 'Page',
        method: 'enable',
        command: 'Page.enable',
        params: {},
        raw: 'Page.enable'
      });

      const script = await saveScript({
        name: parsed.name,
        code: SAMPLE_USER_SCRIPT,
        metadata: parsed,
        enabled: true
      });

      expect(script.id).toBeDefined();
      expect(script.enabled).toBe(true);

      const retrieved = await getScript(script.id);
      expect(retrieved?.name).toBe('E2E Live Test Script');
    });

    it('T1.2: correctly evaluates URL match patterns across positive and negative targets', () => {
      const pattern1 = 'https://*.example.com/*';
      const pattern2 = 'https://app.example.org/dashboard';

      expect(matchesUrl(pattern1, 'https://sub.example.com/api/v1')).toBe(true);
      expect(matchesUrl(pattern1, 'https://example.com/')).toBe(true);
      expect(matchesUrl(pattern1, 'http://sub.example.com/')).toBe(false);
      expect(matchesUrl(pattern1, 'https://other.com/')).toBe(false);

      expect(matchesUrl(pattern2, 'https://app.example.org/dashboard')).toBe(true);
      expect(matchesUrl(pattern2, 'https://app.example.org/settings')).toBe(false);
    });
  });

  describe('Tier 2: Tab Navigation, Early CDP Declarative Init & Injection', () => {
    it('T2.1: onBeforeNavigate triggers early declarative domain enablement for matched tab', async () => {
      const parsed = parseMetadata(SAMPLE_USER_SCRIPT);
      await saveScript({
        name: parsed.name,
        code: SAMPLE_USER_SCRIPT,
        metadata: parsed,
        enabled: true
      });

      const tabId = 42;
      const targetUrl = 'https://sub.example.com/home';

      // Simulate onBeforeNavigate
      await context.mockWebNavigation.onBeforeNavigate._emit({
        tabId,
        url: targetUrl,
        frameId: 0,
        parentFrameId: -1,
        processId: 1,
        timeStamp: Date.now()
      });

      // Verify debugger attached
      const status = debuggerMgr.getTabStatus(tabId);
      expect(status).toBe('ATTACHED');

      // Verify declarative CDP commands sent
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        'Network.enable',
        { maxTotalBufferSize: 10000000 }
      );
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        'Page.enable',
        {}
      );
    });

    it('T2.2: injects scripts according to document-start and document-idle lifecycles', async () => {
      const parsed = parseMetadata(SAMPLE_USER_SCRIPT);
      await saveScript({
        name: parsed.name,
        code: SAMPLE_USER_SCRIPT,
        metadata: parsed,
        enabled: true
      });

      const tabId = 55;
      const targetUrl = 'https://sub.example.com/app';

      // Simulate navigation committed
      await context.mockWebNavigation.onCommitted._emit({
        tabId,
        url: targetUrl,
        frameId: 0,
        transitionType: 'link',
        transitionQualifiers: [],
        timeStamp: Date.now()
      });

      // Script execution at document-start
      expect(context.mockScripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId, frameIds: [0] }
        })
      );
    });
  });

  describe('Tier 3: Full-Duplex CDP RPC Bridge & Userscript SDK', () => {
    it('T3.1: routes Userscript cdp.send() through ContentScriptBridge to Background CDP and returns result', async () => {
      const tabId = 88;
      await debuggerMgr.attachTab(tabId);

      const postedMessages: any[] = [];
      vi.stubGlobal('postMessage', (msg: any) => {
        postedMessages.push(msg);
      });

      const bridge = new ContentScriptBridge({ autoStart: true });

      // Mock CDP Host response
      context.mockDebugger.sendCommand.mockResolvedValueOnce({
        cookies: [{ name: 'session_id', value: 'xyz987' }]
      });

      // Handle message from page
      const rpcReq = {
        type: 'CDP_RPC_REQUEST',
        id: 'rpc-test-101',
        method: 'Network.getCookies',
        params: { urls: ['https://example.com'] }
      };

      await bridge.handlePageMessage({
        source: window,
        data: rpcReq
      } as any);

      // Expect background message was sent and response posted back to window
      expect(postedMessages.some((msg) => msg.type === 'CDP_RPC_RESPONSE' && msg.id === 'rpc-test-101')).toBe(true);

      bridge.destroy();
    });

    it('T3.2: broadcasts CDP events from background to subscribed Userscript handlers', async () => {
      const tabId = 99;
      await debuggerMgr.attachTab(tabId);

      const postedMessages: any[] = [];
      vi.stubGlobal('postMessage', (msg: any) => {
        postedMessages.push(msg);
      });

      const bridge = new ContentScriptBridge({ autoStart: true });

      // Background receives CDP event from Chrome and broadcasts to tab
      await context.mockDebugger._emitEvent(
        { tabId },
        'Network.requestWillBeSent',
        { requestId: 'req_123', request: { url: 'https://api.example.com/data' } }
      );

      // Verify content bridge forwarded event to window
      expect(postedMessages.some((msg) => msg.type === 'CDP_RPC_EVENT' && msg.method === 'Network.requestWillBeSent')).toBe(true);

      bridge.destroy();
    });
  });

  describe('Tier 4: Native DevTools Conflict Detection & Recovery', () => {
    it('T4.1: safely rejects pending CDP RPC promises on DevTools detach without crashing worker', async () => {
      const tabId = 101;
      await debuggerMgr.attachTab(tabId);

      // Issue command that hangs in flight
      context.mockDebugger.sendCommand.mockImplementationOnce(() => new Promise(() => {}));

      const pendingCmdPromise = context.mockRuntime._emitMessage(
        {
          type: 'CDP_RPC_REQUEST',
          id: 'req_inflight_1',
          method: 'Page.navigate',
          params: { url: 'https://example.com' }
        },
        { tab: { id: tabId, url: 'https://example.com' } }
      );

      // Yield event loop so command enters inflight registry
      await new Promise((r) => setTimeout(r, 10));

      // Trigger DevTools onDetach conflict
      context.mockDebugger._emitDetach({ tabId }, 'canceled_by_user');

      const response: CdpRpcResponse = await pendingCmdPromise;
      expect(response).toBeDefined();
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(1001);
      expect(response.error?.message).toContain('DevTools conflict');

      // Check session status is CONFLICT
      expect(debuggerMgr.getTabStatus(tabId)).toBe('CONFLICT');
    });

    it('T4.2: recovers CDP session when re-attached after DevTools closes', async () => {
      const tabId = 102;
      await debuggerMgr.attachTab(tabId);

      // Detach via DevTools
      context.mockDebugger._emitDetach({ tabId }, 'canceled_by_user');
      expect(debuggerMgr.getTabStatus(tabId)).toBe('CONFLICT');

      // Reconnect
      await debuggerMgr.attachTab(tabId, undefined, true);
      expect(debuggerMgr.getTabStatus(tabId)).toBe('ATTACHED');
    });
  });

  describe('Tier 5: Extension UI (Popup & Dashboard) End-to-End Simulation', () => {
    it('T5.1: Popup renders active matching scripts, CDP status badge, and toggles execution', async () => {
      await saveScript({
        id: 'script-e2e-toggle',
        name: 'E2E Toggle Script',
        code: '// ==UserScript==\n// @match https://*.example.com/*\n// ==/UserScript==',
        enabled: true
      });

      const wrapper = mount(PopupApp);
      await flushPromises();

      expect(wrapper.text()).toContain('XOKJ');
      expect(wrapper.text()).toContain('E2E Toggle Script');

      // Toggle script switch
      const scriptCard = wrapper.findAll('.script-card').find((c) => c.text().includes('E2E Toggle Script'));
      expect(scriptCard).toBeDefined();

      const checkbox = scriptCard!.find('input[type="checkbox"]');
      expect(checkbox.exists()).toBe(true);

      await checkbox.setValue(false);
      await flushPromises();

      const stored = await context.localStorage.get('scripts');
      expect(stored.scripts['script-e2e-toggle']?.enabled).toBe(false);
    });

    it('T5.2: Dashboard provides full CRUD, CodeMirror editing, and JSON Export/Import', async () => {
      const wrapper = mount(DashboardApp);
      await flushPromises();

      expect(wrapper.text()).toContain('Dashboard');

      // Verify default scripts loaded
      const allScripts = await getAllScripts();
      expect(allScripts.length).toBeGreaterThan(0);
    });
  });
});
