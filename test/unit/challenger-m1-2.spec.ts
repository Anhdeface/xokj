/**
 * Empirical Challenger M1-2: R3 Detach Reason Classification & Script Matching Suite
 * Location: test/unit/challenger-m1-2.spec.ts
 *
 * Adversarially stress-tests:
 * 1. Genuine DevTools conflict: `replaced_with_devtools` triggers CONFLICT.
 * 2. Unexpected `canceled_by_user` while engine is active and matching CDP script is attached triggers CONFLICT.
 * 3. Clean transitions to IDLE without CONFLICT (programmatic detach, engine disabled, script-absent tabs, excluded URLs).
 * 4. Comprehensive script matching matrix: @grant none, @cdp, @grant GM_cdp, @grant *, @grant combinations.
 * 5. Reconnection lifecycle and tab reconciliation under multi-script configurations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { TabDebuggerManager, scriptRequiresCdp } from '@/background/debugger-mgr';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { DevToolsConflictHandler } from '@/background/conflict-mgr';
import { saveScript, saveSettings, toggleScript } from '@/shared/storage';
import { DevToolsConflictError } from '@/shared/types';
import type { ScriptRecord, CdpRpcLifecycleMessage, CdpRpcResponse } from '@/shared/types';

describe('Empirical Challenger M1-2: R3 Detach Reason Classification & Script Matching', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let manager: TabDebuggerManager;
  let server: CdpBridgeServer;
  let conflictHandler: DevToolsConflictHandler;

  const helperCreateCdpScript = (
    id: string,
    matchPattern: string,
    grants: string[] = ['GM_cdp'],
    cdpDomains: string[] = ['Network'],
    enabled = true,
    excludes: string[] = []
  ): ScriptRecord => ({
    id,
    name: `Script ${id}`,
    code: '// ==UserScript==\n// ==/UserScript==',
    metadata: {
      name: `Script ${id}`,
      matches: [matchPattern],
      matchPatterns: [matchPattern],
      includes: [],
      excludes,
      runAt: 'document-start',
      grants,
      cdp: cdpDomains.map((d) => ({ domain: d, method: 'enable', command: `${d}.enable`, params: {}, raw: `${d}.enable` })),
      cdpDeclarations: cdpDomains.map((d) => ({ domain: d, method: 'enable', command: `${d}.enable`, params: {}, raw: `${d}.enable` })),
      cdpDomains,
      requires: [],
      resources: {},
      noframes: false,
      connects: [],
      rawEntries: {}
    },
    enabled,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  beforeEach(async () => {
    context = setupChromeMock();
    manager = new TabDebuggerManager();
    await manager.init();

    server = new CdpBridgeServer({
      debuggerManager: manager,
      autoAttach: true
    });
    server.init();
    manager.setInflightTracker(server);

    conflictHandler = new DevToolsConflictHandler(server, manager);
    conflictHandler.init();
  });

  afterEach(() => {
    conflictHandler.destroy();
    server.destroy();
    manager.destroy();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Section 1: Genuine DevTools Conflict Verification (replaced_with_devtools)
  // =========================================================================
  describe('1. Genuine DevTools Conflict (replaced_with_devtools)', () => {
    it('1.1: replaced_with_devtools on attached tab with active CDP script transitions to CONFLICT state', async () => {
      await saveSettings({ globalEnabled: true });
      const script = helperCreateCdpScript('cdp-dt-1', 'https://example.com/*');
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 101, url: 'https://example.com/app' } as any);
      await manager.attachTab(101);
      expect(manager.getTabStatus(101)).toBe('ATTACHED');
      expect(manager.isAttached(101)).toBe(true);

      // DevTools genuinely opened on tab
      await context.mockDebugger._emitDetach({ tabId: 101 }, 'replaced_with_devtools');

      expect(manager.getTabStatus(101)).toBe('CONFLICT');
      expect(manager.isAttached(101)).toBe(false);
      const session = manager.getSession(101);
      expect(session?.conflictDetected).toBe(true);
      expect(session?.conflictReason).toBe('replaced_with_devtools');
    });

    it('1.2: inflight CDP commands on tab encountering replaced_with_devtools are rejected with code 1001', async () => {
      await saveSettings({ globalEnabled: true });
      const script = helperCreateCdpScript('cdp-dt-2', 'https://example.com/*');
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 102, url: 'https://example.com/app' } as any);
      await manager.attachTab(102);

      // Simulate inflight command
      context.mockDebugger.sendCommand.mockImplementationOnce(
        () => new Promise(() => {}) // hangs inflight
      );

      const inflightPromise = context.mockRuntime._emitMessage(
        { type: 'CDP_RPC_REQUEST', id: 'req-dt-102', method: 'DOM.getDocument' },
        { tab: { id: 102, url: 'https://example.com/app' } }
      );

      // Detach event fires with replaced_with_devtools
      await context.mockDebugger._emitDetach({ tabId: 102 }, 'replaced_with_devtools');

      const response: CdpRpcResponse = await inflightPromise;
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(1001);
      expect(response.error?.message).toContain('DevTools conflict');
    });

    it('1.3: broadcasts CDP_LIFECYCLE_EVENT with status CONFLICT and reason replaced_with_devtools', async () => {
      await saveSettings({ globalEnabled: true });
      const script = helperCreateCdpScript('cdp-dt-3', 'https://example.com/*');
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 103, url: 'https://example.com/app' } as any);
      await manager.attachTab(103);

      context.mockRuntime.sendMessage.mockClear();

      await context.mockDebugger._emitDetach({ tabId: 103 }, 'replaced_with_devtools');

      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CDP_LIFECYCLE_EVENT',
          tabId: 103,
          status: 'CONFLICT',
          reason: 'replaced_with_devtools'
        })
      );
    });

    it('1.4: subsequent sendCommand and attachTab on CONFLICT tab reject with DevToolsConflictError', async () => {
      await saveSettings({ globalEnabled: true });
      const script = helperCreateCdpScript('cdp-dt-4', 'https://example.com/*');
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 104, url: 'https://example.com/app' } as any);
      await manager.attachTab(104);
      await context.mockDebugger._emitDetach({ tabId: 104 }, 'replaced_with_devtools');

      // Subsequent sendCommand immediately throws DevToolsConflictError
      await expect(manager.sendCommand(104, 'Page.reload')).rejects.toThrow(DevToolsConflictError);

      // Subsequent attachTab without force immediately rejects with DevToolsConflictError
      await expect(manager.attachTab(104)).rejects.toThrow(DevToolsConflictError);
    });
  });

  // =========================================================================
  // Section 2: Unexpected canceled_by_user with Active CDP Script
  // =========================================================================
  describe('2. Unexpected canceled_by_user while Engine Active & CDP Script Attached', () => {
    it('2.1: canceled_by_user on attached tab with matching CDP script and globalEnabled = true transitions to CONFLICT', async () => {
      await saveSettings({ globalEnabled: true });
      const script = helperCreateCdpScript('cdp-cancel-1', 'https://example.com/*');
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 201, url: 'https://example.com/dashboard' } as any);
      await manager.attachTab(201);
      expect(manager.getTabStatus(201)).toBe('ATTACHED');

      // Native Chrome debugging banner closed by user
      await context.mockDebugger._emitDetach({ tabId: 201 }, 'canceled_by_user');

      expect(manager.getTabStatus(201)).toBe('CONFLICT');
      const session = manager.getSession(201);
      expect(session?.conflictDetected).toBe(true);
      expect(session?.conflictReason).toBe('canceled_by_user');
    });

    it('2.2: inflight command rejected with code 1001 when canceled_by_user arrives unexpectedly', async () => {
      await saveSettings({ globalEnabled: true });
      const script = helperCreateCdpScript('cdp-cancel-2', 'https://example.com/*');
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 202, url: 'https://example.com/app' } as any);
      await manager.attachTab(202);

      context.mockDebugger.sendCommand.mockImplementationOnce(() => new Promise(() => {}));

      const inflightPromise = context.mockRuntime._emitMessage(
        { type: 'CDP_RPC_REQUEST', id: 'req-cancel-202', method: 'Network.getCookies' },
        { tab: { id: 202, url: 'https://example.com/app' } }
      );

      await context.mockDebugger._emitDetach({ tabId: 202 }, 'canceled_by_user');

      const response: CdpRpcResponse = await inflightPromise;
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(1001);
      expect(response.error?.message).toContain('DevTools conflict');
    });

    it('2.3: reconnecting with force restores ATTACHED state and clears conflict flags', async () => {
      await saveSettings({ globalEnabled: true });
      const script = helperCreateCdpScript('cdp-cancel-3', 'https://example.com/*');
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 203, url: 'https://example.com/app' } as any);
      await manager.attachTab(203);
      await context.mockDebugger._emitDetach({ tabId: 203 }, 'canceled_by_user');
      expect(manager.getTabStatus(203)).toBe('CONFLICT');

      // Reconnect with force = true
      await manager.attachTab(203, 'https://example.com/app', true);
      expect(manager.getTabStatus(203)).toBe('ATTACHED');
      expect(manager.getSession(203)?.conflictDetected).toBe(false);
      expect(manager.getSession(203)?.conflictReason).toBeUndefined();
    });
  });

  // =========================================================================
  // Section 3: Clean Transitions to IDLE without False CONFLICT
  // =========================================================================
  describe('3. Clean Transitions to IDLE without CONFLICT', () => {
    it('3.1: programmatic detachTab(tabId, "IDLE") transitions to IDLE and subsequent canceled_by_user stays IDLE', async () => {
      await saveSettings({ globalEnabled: true });
      const script = helperCreateCdpScript('cdp-clean-1', 'https://example.com/*');
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 301, url: 'https://example.com/app' } as any);
      await manager.attachTab(301);
      expect(manager.getTabStatus(301)).toBe('ATTACHED');

      // Explicit clean detach
      await manager.detachTab(301, 'IDLE');
      expect(manager.getTabStatus(301)).toBe('IDLE');
      expect(manager.getSession(301)?.conflictDetected).toBe(false);

      // Delayed browser detach event arrives
      await context.mockDebugger._emitDetach({ tabId: 301 }, 'canceled_by_user');

      expect(manager.getTabStatus(301)).toBe('IDLE');
      expect(manager.getSession(301)?.conflictDetected).toBe(false);
      expect(manager.getSession(301)?.conflictReason).toBeUndefined();
    });

    it('3.2: programmatic detachTab(tabId, "IDLE") followed by replaced_with_devtools stays IDLE without CONFLICT', async () => {
      await saveSettings({ globalEnabled: true });
      const script = helperCreateCdpScript('cdp-clean-2', 'https://example.com/*');
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 302, url: 'https://example.com/app' } as any);
      await manager.attachTab(302);

      await manager.detachTab(302, 'IDLE');
      expect(manager.getTabStatus(302)).toBe('IDLE');

      // Browser event arrives with replaced_with_devtools
      await context.mockDebugger._emitDetach({ tabId: 302 }, 'replaced_with_devtools');

      expect(manager.getTabStatus(302)).toBe('IDLE');
      expect(manager.getSession(302)?.conflictDetected).toBe(false);
      expect(manager.getSession(302)?.conflictReason).toBeUndefined();
    });

    it('3.3: detachAll("IDLE") detaches multiple tabs and subsequent detach events do not trigger CONFLICT', async () => {
      await saveSettings({ globalEnabled: true });
      const script = helperCreateCdpScript('cdp-clean-3', 'https://example.com/*');
      await saveScript(script);

      context.mockTabs.get.mockImplementation(async (id: number) => ({ id, url: 'https://example.com/page' }) as any);

      await manager.attachTab(310);
      await manager.attachTab(311);
      expect(manager.getTabStatus(310)).toBe('ATTACHED');
      expect(manager.getTabStatus(311)).toBe('ATTACHED');

      await manager.detachAll('IDLE');
      expect(manager.getTabStatus(310)).toBe('IDLE');
      expect(manager.getTabStatus(311)).toBe('IDLE');

      // Emit detach events for both tabs
      await context.mockDebugger._emitDetach({ tabId: 310 }, 'canceled_by_user');
      await context.mockDebugger._emitDetach({ tabId: 311 }, 'replaced_with_devtools');

      expect(manager.getTabStatus(310)).toBe('IDLE');
      expect(manager.getTabStatus(311)).toBe('IDLE');
      expect(manager.getSession(310)?.conflictDetected).toBe(false);
      expect(manager.getSession(311)?.conflictDetected).toBe(false);
    });

    it('3.4: canceled_by_user while globalEnabled = false transitions tab to IDLE without CONFLICT', async () => {
      await saveSettings({ globalEnabled: false });
      const script = helperCreateCdpScript('cdp-clean-4', 'https://example.com/*');
      await saveScript(script);

      // Force session entry
      await manager.attachTab(304).catch(() => {});
      const session = (manager as any).sessions.get(304);
      session.targetUrl = 'https://example.com/page';
      session.status = 'ATTACHED';

      await context.mockDebugger._emitDetach({ tabId: 304 }, 'canceled_by_user');

      expect(manager.getTabStatus(304)).toBe('IDLE');
      expect(manager.getSession(304)?.conflictDetected).toBe(false);
      expect(manager.getSession(304)?.conflictReason).toBeUndefined();
    });

    it('3.5: replaced_with_devtools while globalEnabled = false transitions tab to IDLE without CONFLICT', async () => {
      await saveSettings({ globalEnabled: false });
      const script = helperCreateCdpScript('cdp-clean-5', 'https://example.com/*');
      await saveScript(script);

      await manager.attachTab(305).catch(() => {});
      const session = (manager as any).sessions.get(305);
      session.targetUrl = 'https://example.com/page';
      session.status = 'ATTACHED';

      await context.mockDebugger._emitDetach({ tabId: 305 }, 'replaced_with_devtools');

      expect(manager.getTabStatus(305)).toBe('IDLE');
      expect(manager.getSession(305)?.conflictDetected).toBe(false);
      expect(manager.getSession(305)?.conflictReason).toBeUndefined();
    });

    it('3.6: canceled_by_user on tab with NO matching CDP scripts transitions to IDLE without CONFLICT', async () => {
      await saveSettings({ globalEnabled: true });
      await context.localStorage.set({ scripts: {} }); // no scripts stored

      context.mockTabs.get.mockResolvedValue({ id: 306, url: 'https://other-site.org' } as any);
      await manager.attachTab(306);
      expect(manager.getTabStatus(306)).toBe('ATTACHED');

      await context.mockDebugger._emitDetach({ tabId: 306 }, 'canceled_by_user');

      expect(manager.getTabStatus(306)).toBe('IDLE');
      expect(manager.getSession(306)?.conflictDetected).toBe(false);
      expect(manager.getSession(306)?.conflictReason).toBeUndefined();
    });

    it('3.7: canceled_by_user on tab where URL matches script @exclude transitions to IDLE without CONFLICT', async () => {
      await saveSettings({ globalEnabled: true });
      await context.localStorage.set({ scripts: {} });
      const scriptWithExclude = helperCreateCdpScript(
        'cdp-exclude-script',
        'https://example.com/*',
        ['GM_cdp'],
        ['Network'],
        true,
        ['https://example.com/excluded/*']
      );
      await saveScript(scriptWithExclude);

      context.mockTabs.get.mockResolvedValue({ id: 307, url: 'https://example.com/excluded/admin' } as any);
      await manager.attachTab(307);
      expect(manager.getTabStatus(307)).toBe('ATTACHED');

      await context.mockDebugger._emitDetach({ tabId: 307 }, 'canceled_by_user');

      expect(manager.getTabStatus(307)).toBe('IDLE');
      expect(manager.getSession(307)?.conflictDetected).toBe(false);
      expect(manager.getSession(307)?.conflictReason).toBeUndefined();
    });

    it('3.8: target_closed detach reason transitions tab cleanly without CONFLICT', async () => {
      await saveSettings({ globalEnabled: true });
      const script = helperCreateCdpScript('cdp-tc-1', 'https://example.com/*');
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 308, url: 'https://example.com/page' } as any);
      await manager.attachTab(308);

      await context.mockDebugger._emitDetach({ tabId: 308 }, 'target_closed');

      expect(manager.getTabStatus(308)).toBe('DETACHED');
      expect(manager.getSession(308)?.conflictDetected).toBe(false);
      expect(manager.getSession(308)?.conflictReason).toBeUndefined();
    });
  });

  // =========================================================================
  // Section 4: Script Matching Variations & scriptRequiresCdp Matrix
  // =========================================================================
  describe('4. Comprehensive Script Matching Matrix', () => {
    it('4.1: script with @grant none always returns false, overriding @cdp declarations', () => {
      const script: ScriptRecord = {
        id: 'grant-none-cdp',
        name: 'Grant None With CDP',
        code: '',
        metadata: {
          name: 'Grant None With CDP',
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['none'],
          cdp: [{ domain: 'Page', method: 'enable', command: 'Page.enable', params: {}, raw: 'Page.enable' }],
          cdpDeclarations: [{ domain: 'Page', method: 'enable', command: 'Page.enable', params: {}, raw: 'Page.enable' }],
          cdpDomains: ['Page'],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      expect(scriptRequiresCdp(script)).toBe(false);
    });

    it('4.2: script with @grant none and @grant GM_cdp returns false because none forbids elevated APIs', () => {
      const script: ScriptRecord = {
        id: 'grant-none-and-gmcdp',
        name: 'Contradictory Grants',
        code: '',
        metadata: {
          name: 'Contradictory Grants',
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['none', 'GM_cdp'],
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
        createdAt: 0,
        updatedAt: 0
      };

      expect(scriptRequiresCdp(script)).toBe(false);
    });

    it('4.3: script with @grant * returns true', () => {
      const script: ScriptRecord = {
        id: 'wildcard-grant',
        name: 'Wildcard Grant',
        code: '',
        metadata: {
          name: 'Wildcard Grant',
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
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
        createdAt: 0,
        updatedAt: 0
      };

      expect(scriptRequiresCdp(script)).toBe(true);
    });

    it('4.4: script with standard GM grants only without CDP returns false', () => {
      const script: ScriptRecord = {
        id: 'standard-gm-grants',
        name: 'Standard GM Grants',
        code: '',
        metadata: {
          name: 'Standard GM Grants',
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_setValue', 'GM_getValue', 'GM_xmlhttpRequest'],
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
        createdAt: 0,
        updatedAt: 0
      };

      expect(scriptRequiresCdp(script)).toBe(false);
    });

    it('4.5: script with @cdp in cdpDeclarations only returns true', () => {
      const script: ScriptRecord = {
        id: 'cdp-declarations-only',
        name: 'CDP Declarations Only',
        code: '',
        metadata: {
          name: 'CDP Declarations Only',
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
          cdp: [],
          cdpDeclarations: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }],
          cdpDomains: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      expect(scriptRequiresCdp(script)).toBe(true);
    });

    it('4.6: disabled script (enabled = false) always returns false regardless of grants or directives', () => {
      const script: ScriptRecord = {
        id: 'disabled-cdp',
        name: 'Disabled CDP Script',
        code: '',
        metadata: {
          name: 'Disabled CDP Script',
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp', '*'],
          cdp: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {}, raw: 'Network.enable' }],
          cdpDeclarations: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {}, raw: 'Network.enable' }],
          cdpDomains: ['Network'],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: false,
        createdAt: 0,
        updatedAt: 0
      };

      expect(scriptRequiresCdp(script)).toBe(false);
    });

    it('4.7: multi-script tab: disabling the only CDP script reconciles and cleanly detaches tab to IDLE', async () => {
      await saveSettings({ globalEnabled: true });
      await context.localStorage.set({ scripts: {} });

      const normalScript: ScriptRecord = {
        id: 'normal-userscript',
        name: 'Normal Userscript',
        code: '',
        metadata: {
          name: 'Normal Userscript',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_setValue'],
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
        createdAt: 0,
        updatedAt: 0
      };

      const cdpScript = helperCreateCdpScript('multi-cdp-script', 'https://example.com/*');
      await saveScript(normalScript);
      await saveScript(cdpScript);

      context.mockTabs.get.mockResolvedValue({ id: 407, url: 'https://example.com/page' } as any);
      await manager.attachTab(407);
      expect(manager.getTabStatus(407)).toBe('ATTACHED');

      // Disable the CDP script
      await toggleScript(cdpScript.id, false);
      await manager.reconcileTabs();

      // Debugger is cleanly detached because remaining script does not require CDP
      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 407 });
      expect(manager.getTabStatus(407)).toBe('IDLE');
      expect(manager.getSession(407)?.conflictDetected).toBe(false);
    });

    it('4.8: multi-script tab: with two CDP scripts, disabling one keeps debugger ATTACHED', async () => {
      await saveSettings({ globalEnabled: true });
      await context.localStorage.set({ scripts: {} });

      const cdpScript1 = helperCreateCdpScript('cdp-multi-1', 'https://example.com/*', ['GM_cdp'], ['Network']);
      const cdpScript2 = helperCreateCdpScript('cdp-multi-2', 'https://example.com/*', ['cdp'], ['Page']);
      await saveScript(cdpScript1);
      await saveScript(cdpScript2);

      context.mockTabs.get.mockResolvedValue({ id: 408, url: 'https://example.com/page' } as any);
      await manager.attachTab(408);
      expect(manager.getTabStatus(408)).toBe('ATTACHED');

      context.mockDebugger.detach.mockClear();

      // Disable only the first CDP script
      await toggleScript(cdpScript1.id, false);
      await manager.reconcileTabs();

      // Still attached because cdpScript2 is active
      expect(context.mockDebugger.detach).not.toHaveBeenCalled();
      expect(manager.getTabStatus(408)).toBe('ATTACHED');
    });

    it('4.9: script with @grant none combined with @cdp does NOT trigger auto-attachment during reconcile', async () => {
      await saveSettings({ globalEnabled: true });
      await context.localStorage.set({ scripts: {} });

      const noneWithCdpScript: ScriptRecord = {
        id: 'none-with-cdp',
        name: 'None with CDP',
        code: '',
        metadata: {
          name: 'None with CDP',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['none'],
          cdp: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {}, raw: 'Network.enable' }],
          cdpDeclarations: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {}, raw: 'Network.enable' }],
          cdpDomains: ['Network'],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };
      await saveScript(noneWithCdpScript);

      context.mockTabs.get.mockResolvedValue({ id: 409, url: 'https://example.com/page' } as any);

      // Reconcile tabs
      await manager.reconcileTabs();

      expect(context.mockDebugger.attach).not.toHaveBeenCalledWith({ tabId: 409 }, expect.anything());
      expect(manager.getTabStatus(409)).toBe('IDLE');
    });

    it('4.10: tab in CONFLICT state resets cleanly to IDLE when CDP script is toggled off during reconcile', async () => {
      await saveSettings({ globalEnabled: true });
      await context.localStorage.set({ scripts: {} });

      const cdpScript = helperCreateCdpScript('conflict-recovery-script', 'https://example.com/*');
      await saveScript(cdpScript);

      context.mockTabs.get.mockResolvedValue({ id: 410, url: 'https://example.com/page' } as any);
      await manager.attachTab(410);

      // DevTools conflict occurs
      await context.mockDebugger._emitDetach({ tabId: 410 }, 'replaced_with_devtools');
      expect(manager.getTabStatus(410)).toBe('CONFLICT');
      expect(manager.getSession(410)?.conflictDetected).toBe(true);

      // User toggles off the conflicting CDP script
      await toggleScript(cdpScript.id, false);
      await manager.reconcileTabs();

      // Session cleanly transitions to IDLE and clears conflict
      expect(manager.getTabStatus(410)).toBe('IDLE');
      expect(manager.getSession(410)?.conflictDetected).toBe(false);
      expect(manager.getSession(410)?.conflictReason).toBeUndefined();
    });
  });
});
