import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { TabDebuggerManager, scriptRequiresCdp } from '@/background/debugger-mgr';
import { saveScript, saveSettings, deleteScript, toggleScript } from '@/shared/storage';
import { DevToolsConflictError } from '@/shared/types';
import type { ScriptRecord, CdpRpcLifecycleMessage } from '@/shared/types';

describe('Feature 7 & 8: Chrome Debugger Session Manager & Declarative Init', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let manager: TabDebuggerManager;

  beforeEach(async () => {
    context = setupChromeMock();
    manager = new TabDebuggerManager();
    await manager.init();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('Tier 1: Per-Tab State Machine Transitions', () => {
    it('T1.1: tab initial state is IDLE', () => {
      expect(manager.getTabStatus(42)).toBe('IDLE');
      expect(manager.isAttached(42)).toBe(false);
    });

    it('T1.2: attachTab transitions IDLE -> ATTACHING -> ATTACHED', async () => {
      const attachPromise = manager.attachTab(42);
      expect(manager.getTabStatus(42)).toBe('ATTACHING');

      await attachPromise;
      expect(manager.getTabStatus(42)).toBe('ATTACHED');
      expect(manager.isAttached(42)).toBe(true);
      expect(context.mockDebugger.attach).toHaveBeenCalledWith({ tabId: 42 }, '1.3');
    });

    it('T1.3: detachTab transitions ATTACHED -> DETACHED', async () => {
      await manager.attachTab(42);
      expect(manager.getTabStatus(42)).toBe('ATTACHED');

      await manager.detachTab(42);
      expect(manager.getTabStatus(42)).toBe('DETACHED');
      expect(manager.isAttached(42)).toBe(false);
      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 42 });
    });

    it('T1.4: attachTab is idempotent on an already ATTACHED tab', async () => {
      await manager.attachTab(42);
      expect(context.mockDebugger.attach).toHaveBeenCalledTimes(1);

      await manager.attachTab(42);
      expect(context.mockDebugger.attach).toHaveBeenCalledTimes(1);
    });

    it('T1.5: concurrent attachTab calls for same tab coalesce to a single promise', async () => {
      let resolveAttach: () => void;
      context.mockDebugger.attach.mockImplementationOnce(
        () =>
          new Promise<void>((res) => {
            resolveAttach = res;
          })
      );

      const p1 = manager.attachTab(42);
      const p2 = manager.attachTab(42);

      await vi.waitFor(() => {
        expect(context.mockDebugger.attach).toHaveBeenCalled();
      });

      resolveAttach!();
      await Promise.all([p1, p2]);

      expect(context.mockDebugger.attach).toHaveBeenCalledTimes(1);
      expect(manager.getTabStatus(42)).toBe('ATTACHED');
    });

    it('T1.6: rapid attach immediately followed by detach results in DETACHED without zombie attachment', async () => {
      let resolveAttach: () => void;
      // Simulate chrome.debugger.attach with asynchronous delay
      context.mockDebugger.attach.mockImplementationOnce(
        () =>
          new Promise<void>((res) => {
            resolveAttach = res;
          })
      );

      // 1. Initiate attach
      const attachPromise = manager.attachTab(42);
      expect(manager.getTabStatus(42)).toBe('ATTACHING');

      // 2. Immediately initiate detach while attach is still in-flight
      const detachPromise = manager.detachTab(42);

      // Wait until attach reaches chrome.debugger.attach
      await vi.waitFor(() => {
        expect(context.mockDebugger.attach).toHaveBeenCalled();
      });

      // 3. Resolve the delayed attach
      resolveAttach!();

      // 4. Await both promises settling
      await Promise.all([attachPromise.catch(() => {}), detachPromise]);

      // 5. Verification: Tab MUST end in DETACHED state, NOT ATTACHED
      expect(manager.getTabStatus(42)).toBe('DETACHED');
      expect(manager.isAttached(42)).toBe(false);
      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 42 });

      const session = manager.getSession(42);
      expect(session?.status).toBe('DETACHED');
      expect(session?.attached).toBe(false);
    });

    it('T1.7: calling detachTab followed by attachTab reliably leaves the tab in ATTACHED state', async () => {
      await manager.attachTab(42);
      expect(manager.getTabStatus(42)).toBe('ATTACHED');
      expect(context.mockDebugger.attach).toHaveBeenCalledTimes(1);

      let resolveDetach: () => void;
      context.mockDebugger.detach.mockImplementationOnce(
        () =>
          new Promise<void>((res) => {
            resolveDetach = res;
          })
      );

      const detachPromise = manager.detachTab(42);
      await vi.waitFor(() => {
        expect(context.mockDebugger.detach).toHaveBeenCalledTimes(1);
      });

      const attachPromise = manager.attachTab(42);

      resolveDetach!();
      await detachPromise;
      await attachPromise;

      expect(manager.getTabStatus(42)).toBe('ATTACHED');
      expect(manager.isAttached(42)).toBe(true);
      expect(context.mockDebugger.attach).toHaveBeenCalledTimes(2);
    });
  });

  describe('Tier 2: Error Handling & Restricted Targets', () => {
    it('T2.1: rejects attachment to restricted internal URLs (chrome://)', async () => {
      context.mockTabs.get.mockResolvedValueOnce({ id: 5, url: 'chrome://extensions' } as any);

      await expect(manager.attachTab(5)).rejects.toThrow(/restricted|chrome:\/\//i);
      expect(context.mockDebugger.attach).not.toHaveBeenCalled();
      expect(manager.getTabStatus(5)).toBe('DETACHED');
    });

    it('T2.2: handles attach errors and transitions tab to DETACHED', async () => {
      context.mockDebugger.attach.mockRejectedValueOnce(new Error('Tab closed during attach'));

      await expect(manager.attachTab(42)).rejects.toThrow('Tab closed during attach');
      expect(manager.getTabStatus(42)).toBe('DETACHED');
    });

    it('T2.3: cleans up tab session state when tab is removed (tabs.onRemoved)', async () => {
      await manager.attachTab(42);
      expect(manager.getTabStatus(42)).toBe('ATTACHED');

      context.mockTabs._emitRemoved(42);
      expect(manager.getTabStatus(42)).toBe('IDLE');
    });

    it('T2.4: transitions to CONFLICT when attach throws Another debugger is already attached', async () => {
      context.mockDebugger.attach.mockRejectedValueOnce(
        new Error('Another debugger is already attached to the tab with id: 42')
      );

      await expect(manager.attachTab(42)).rejects.toThrow(/already attached/i);
      expect(manager.getTabStatus(42)).toBe('CONFLICT');
    });

    it('T2.5: sendCommand on tab in CONFLICT state immediately throws DevToolsConflictError (code 1001)', async () => {
      manager.setTabStatus(42, 'CONFLICT', 'canceled_by_user');
      expect(manager.getTabStatus(42)).toBe('CONFLICT');

      await expect(manager.sendCommand(42, 'Page.reload')).rejects.toThrow(DevToolsConflictError);

      try {
        await manager.sendCommand(42, 'Page.reload');
      } catch (err: any) {
        expect(err).toBeInstanceOf(DevToolsConflictError);
        expect(err.code).toBe(1001);
        expect(err.tabId).toBe(42);
      }

      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
    });

    it('T2.6: attachTab on tab in CONFLICT state immediately rejects with DevToolsConflictError', async () => {
      manager.setTabStatus(42, 'CONFLICT', 'canceled_by_user');
      expect(manager.getTabStatus(42)).toBe('CONFLICT');

      await expect(manager.attachTab(42)).rejects.toThrow(DevToolsConflictError);
      expect(context.mockDebugger.attach).not.toHaveBeenCalled();
    });

    it('T2.7: attachTab rejection on foreign debugger conflict transitions to CONFLICT and throws DevToolsConflictError', async () => {
      context.mockDebugger.attach.mockRejectedValueOnce(
        new Error('Another debugger is already attached to the tab with id: 42')
      );

      await expect(manager.attachTab(42)).rejects.toThrow(DevToolsConflictError);
      expect(manager.getTabStatus(42)).toBe('CONFLICT');
      expect(manager.isAttached(42)).toBe(false);
    });

    it('T2.8: handleTabRemoved followed by debugger.onDetach(target_closed) does not resurrect tab in memory or storage', async () => {
      // 1. Tab 42 attached and populated in session and storage
      await manager.attachTab(42);
      expect(manager.getTabStatus(42)).toBe('ATTACHED');
      expect(manager.getSession(42)).toBeDefined();

      const sessionStored = await context.sessionStorage.get('tab_session_42');
      expect(sessionStored.tab_session_42?.status).toBe('ATTACHED');

      // 2. Tab closed by user (tabs.onRemoved)
      await manager.handleTabRemoved(42);

      // Memory purged
      expect(manager.getSession(42)).toBeUndefined();
      expect(manager.getTabStatus(42)).toBe('IDLE');

      // 3. Browser fires onDetach('target_closed') AFTER tab was removed
      context.mockDebugger._emitDetach({ tabId: 42 }, 'target_closed');

      // Explicitly check setTabStatus call does not recreate session for removed tab
      manager.setTabStatus(42, 'DETACHED', 'target_closed');

      // 4. Verify tab 42 remains dead in memory
      expect(manager.getSession(42)).toBeUndefined();
      expect(manager.getTabStatus(42)).toBe('IDLE');
      expect(manager.getAllSessions().some((s) => s.tabId === 42)).toBe(false);

      // 5. Verify tab 42 is NOT recreated in storage
      const sessionAfter = await context.sessionStorage.get('tab_session_42');
      expect(sessionAfter.tab_session_42).toBeUndefined();

      const localAfter = await context.localStorage.get('tab_sessions');
      expect(localAfter.tab_sessions?.[42]).toBeUndefined();
    });

    it('T2.9: closed tabs are cleanly pruned from chrome.storage.local.tab_sessions and session storage', async () => {
      // 1. Attach tab 10 and tab 20
      await manager.attachTab(10);
      await manager.attachTab(20);

      // Verify both tabs stored in chrome.storage.local.tab_sessions
      const localInitial = await context.localStorage.get('tab_sessions');
      expect(localInitial.tab_sessions?.[10]).toBeDefined();
      expect(localInitial.tab_sessions?.[20]).toBeDefined();

      // 2. Close tab 10
      await manager.handleTabRemoved(10);

      // Assert tab 10 is purged from chrome.storage.local while tab 20 remains
      await vi.waitFor(async () => {
        const localUpdated = await context.localStorage.get('tab_sessions');
        expect(localUpdated.tab_sessions?.[10]).toBeUndefined();
        expect(localUpdated.tab_sessions?.[20]).toBeDefined();
      });

      // Assert tab 10 is purged from chrome.storage.session
      const sessionTab10 = await context.sessionStorage.get('tab_session_10');
      expect(sessionTab10.tab_session_10).toBeUndefined();

      const sessionTab20 = await context.sessionStorage.get('tab_session_20');
      expect(sessionTab20.tab_session_20).toBeDefined();

      // 3. Close tab 20
      await manager.handleTabRemoved(20);

      await vi.waitFor(async () => {
        const localFinal = await context.localStorage.get('tab_sessions');
        expect(localFinal.tab_sessions?.[20]).toBeUndefined();
      });
    });

    it('T2.10: declarative init aborts remaining commands if tab detaches during execution', async () => {
      const script: ScriptRecord = {
        id: 'abort-decl-script',
        name: 'Abort Script',
        code: '// ==UserScript==\n// @match https://example.com/*\n// @cdp Network\n// @cdp Page\n// @cdp Fetch\n// ==/UserScript==',
        metadata: {
          name: 'Abort Script',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} },
            { domain: 'Fetch', method: 'enable', command: 'Fetch.enable', params: {} }
          ],
          cdpDeclarations: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} },
            { domain: 'Fetch', method: 'enable', command: 'Fetch.enable', params: {} }
          ],
          cdpDomains: ['Network', 'Page', 'Fetch'],
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
      await saveScript(script);

      // On the first command (Network.enable), trigger a detachment
      context.mockDebugger.sendCommand.mockImplementation(async (_target, cmd) => {
        if (cmd === 'Network.enable') {
          context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');
        }
        return {};
      });

      await manager.executeDeclarativeInit(42, 'https://example.com/app');

      // Network was called, but Page and Fetch should NOT be called because session detached
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 42 },
        'Network.enable',
        {}
      );
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalledWith(
        { tabId: 42 },
        'Page.enable',
        {}
      );
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalledWith(
        { tabId: 42 },
        'Fetch.enable',
        {}
      );
    });
  });

  describe('Tier 3: Declarative Early Initialization via onBeforeNavigate', () => {
    it('T3.1: ignores subframe navigations (frameId !== 0)', async () => {
      context.mockWebNavigation._emitBeforeNavigate({
        tabId: 42,
        url: 'https://example.com/iframe',
        frameId: 1
      });

      expect(context.mockDebugger.attach).not.toHaveBeenCalled();
    });

    it('T3.2: does NOT attach if no enabled scripts match target URL', async () => {
      context.mockWebNavigation._emitBeforeNavigate({
        tabId: 42,
        url: 'https://nomatch-domain-unique-xyz.org/page',
        frameId: 0
      });

      expect(context.mockDebugger.attach).not.toHaveBeenCalled();
    });

    it('T3.3: attaches and executes declared @cdp domains on top-level navigation', async () => {
      const script: ScriptRecord = {
        id: 'test-cdp-script',
        name: 'CDP Declarative Test',
        code: '// ==UserScript==\n// @match https://example.com/*\n// @cdp Network\n// @cdp Page\n// ==/UserScript==',
        metadata: {
          name: 'CDP Declarative Test',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} }
          ],
          cdpDeclarations: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} }
          ],
          cdpDomains: ['Network', 'Page'],
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
      await saveScript(script);

      context.mockWebNavigation._emitBeforeNavigate({
        tabId: 42,
        url: 'https://example.com/articles',
        frameId: 0
      });

      await vi.waitFor(() => {
        expect(context.mockDebugger.attach).toHaveBeenCalledWith({ tabId: 42 }, '1.3');
        expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
          { tabId: 42 },
          'Network.enable',
          {}
        );
        expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
          { tabId: 42 },
          'Page.enable',
          {}
        );
      });
    });

    it('T3.4: executes @cdp with custom parameters', async () => {
      const scriptWithParams: ScriptRecord = {
        id: 'test-fetch-script',
        name: 'Fetch Interceptor',
        code: '// ==UserScript==\n// @match https://api.example.com/*\n// @cdp Fetch.enable {"patterns":[{"urlPattern":"*"}]}\n// ==/UserScript==',
        metadata: {
          name: 'Fetch Interceptor',
          matches: ['https://api.example.com/*'],
          matchPatterns: ['https://api.example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [
            {
              domain: 'Fetch',
              method: 'enable',
              command: 'Fetch.enable',
              params: { patterns: [{ urlPattern: '*' }] }
            }
          ],
          cdpDeclarations: [
            {
              domain: 'Fetch',
              method: 'enable',
              command: 'Fetch.enable',
              params: { patterns: [{ urlPattern: '*' }] }
            }
          ],
          cdpDomains: ['Fetch'],
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
      await saveScript(scriptWithParams);

      context.mockWebNavigation._emitBeforeNavigate({
        tabId: 100,
        url: 'https://api.example.com/v1/users',
        frameId: 0
      });

      await vi.waitFor(() => {
        expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
          { tabId: 100 },
          'Fetch.enable',
          { patterns: [{ urlPattern: '*' }] }
        );
      });
    });

    it('T3.5: respects exclude patterns during declarative init', async () => {
      const scriptWithExclude: ScriptRecord = {
        id: 'test-excluded-script',
        name: 'Exclude Test',
        code: '// ==UserScript==\n// @match https://exclude-test.com/*\n// @exclude https://exclude-test.com/login\n// @cdp Network\n// ==/UserScript==',
        metadata: {
          name: 'Exclude Test',
          matches: ['https://exclude-test.com/*'],
          matchPatterns: ['https://exclude-test.com/*'],
          includes: [],
          excludes: ['https://exclude-test.com/login'],
          runAt: 'document-start',
          grants: ['GM_cdp'],
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
      await saveScript(scriptWithExclude);

      context.mockWebNavigation._emitBeforeNavigate({
        tabId: 200,
        url: 'https://exclude-test.com/login',
        frameId: 0
      });

      expect(context.mockDebugger.attach).not.toHaveBeenCalled();
    });
  });

  describe('Tier 4: Reconnection & Declared Domain Re-enablement', () => {
    it('T4.1: initializeDeclaredDomains matches scripts and re-enables declared domains', async () => {
      const script: ScriptRecord = {
        id: 'declarative-domain-script',
        name: 'Declarative Domain Script',
        code: '// ==UserScript==\n// @match https://example.com/*\n// @cdp Network\n// @cdp Page\n// ==/UserScript==',
        metadata: {
          name: 'Declarative Domain Script',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} }
          ],
          cdpDeclarations: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} }
          ],
          cdpDomains: ['Network', 'Page'],
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
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 42, url: 'https://example.com/page' } as any);
      await manager.attachTab(42);

      await manager.initializeDeclaredDomains(42);

      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 42 },
        'Network.enable',
        {}
      );
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 42 },
        'Page.enable',
        {}
      );
      expect(manager.getActiveDomains(42)).toContain('Network');
      expect(manager.getActiveDomains(42)).toContain('Page');
    });

    it('T4.2: reconnect re-attaches debugger and re-enables declared domains after CONFLICT', async () => {
      const script: ScriptRecord = {
        id: 'reconnect-domain-script',
        name: 'Reconnect Domain Script',
        code: '// ==UserScript==\n// @match https://example.com/*\n// @cdp Fetch.enable {"patterns":[{"urlPattern":"*"}]}\n// ==/UserScript==',
        metadata: {
          name: 'Reconnect Domain Script',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [
            {
              domain: 'Fetch',
              method: 'enable',
              command: 'Fetch.enable',
              params: { patterns: [{ urlPattern: '*' }] }
            }
          ],
          cdpDeclarations: [
            {
              domain: 'Fetch',
              method: 'enable',
              command: 'Fetch.enable',
              params: { patterns: [{ urlPattern: '*' }] }
            }
          ],
          cdpDomains: ['Fetch'],
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
      await saveScript(script);

      context.mockTabs.get.mockResolvedValue({ id: 42, url: 'https://example.com/api' } as any);
      await manager.attachTab(42);
      await manager.initializeDeclaredDomains(42);

      // DevTools opens -> detach
      context.mockDebugger._emitDetach({ tabId: 42 }, 'canceled_by_user');
      expect(manager.getTabStatus(42)).toBe('CONFLICT');

      context.mockDebugger.sendCommand.mockClear();
      context.mockDebugger.attach.mockClear();

      // DevTools closes -> user reconnects
      const res = await manager.reconnect(42);

      expect(res.success).toBe(true);
      expect(manager.getTabStatus(42)).toBe('ATTACHED');
      expect(context.mockDebugger.attach).toHaveBeenCalledWith({ tabId: 42 }, expect.any(String));
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 42 },
        'Fetch.enable',
        { patterns: [{ urlPattern: '*' }] }
      );
    });
  });

  describe('Tier 5: Milestone 1 Lifecycle & Conflict Robustness (R1, R2, R3)', () => {
    it('T5.1: disabling globalEnabled via saveSettings automatically detaches all attached tabs to IDLE, clears active domains, and broadcasts lifecycle', async () => {
      // 1. Attach tabs 10 and 20
      await manager.attachTab(10);
      await manager.attachTab(20);
      expect(manager.getTabStatus(10)).toBe('ATTACHED');
      expect(manager.getTabStatus(20)).toBe('ATTACHED');

      // Add active domains
      (manager as any).sessions.get(10)?.activeDomains.add('Network');
      (manager as any).sessions.get(20)?.activeDomains.add('Page');
      expect(manager.getActiveDomains(10)).toContain('Network');
      expect(manager.getActiveDomains(20)).toContain('Page');

      // Track lifecycle events
      const events: CdpRpcLifecycleMessage[] = [];
      manager.onLifecycle((evt) => events.push(evt));

      // 2. Disable global engine
      await saveSettings({ globalEnabled: false });

      await vi.waitFor(() => {
        expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 10 });
        expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 20 });
        expect(manager.getTabStatus(10)).toBe('IDLE');
        expect(manager.getTabStatus(20)).toBe('IDLE');
        expect(events.some((e) => e.tabId === 10)).toBe(true);
        expect(events.some((e) => e.tabId === 20)).toBe(true);
      });

      // 3. Verify sessions reset to IDLE and state is cleanly cleared
      expect(manager.getTabStatus(10)).toBe('IDLE');
      expect(manager.getTabStatus(20)).toBe('IDLE');
      expect(manager.isAttached(10)).toBe(false);
      expect(manager.isAttached(20)).toBe(false);
      expect(manager.getActiveDomains(10)).toEqual([]);
      expect(manager.getActiveDomains(20)).toEqual([]);
      expect(manager.getSession(10)?.conflictDetected).toBe(false);
      expect(manager.getSession(20)?.conflictDetected).toBe(false);
      expect(manager.getSession(10)?.conflictReason).toBeUndefined();
      expect(manager.getSession(20)?.conflictReason).toBeUndefined();

      // Verify lifecycle events broadcasted
      const tab10Event = events.find((e) => e.tabId === 10);
      const tab20Event = events.find((e) => e.tabId === 20);
      expect(tab10Event?.status).toBe('DETACHED');
      expect(tab20Event?.status).toBe('DETACHED');

      // Verify storage reflects IDLE status
      const stored = await context.localStorage.get('tab_sessions');
      expect(stored.tab_sessions[10]?.status).toBe('IDLE');
      expect(stored.tab_sessions[20]?.status).toBe('IDLE');
    });

    it('T5.2: detachAll cleanly detaches all active sessions and normalizes targetStatus to IDLE', async () => {
      await manager.attachTab(101);
      await manager.attachTab(102);

      await manager.detachAll('IDLE');

      expect(manager.getTabStatus(101)).toBe('IDLE');
      expect(manager.getTabStatus(102)).toBe('IDLE');
      expect(manager.isAttached(101)).toBe(false);
      expect(manager.isAttached(102)).toBe(false);
      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 101 });
      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 102 });
    });

    it('T5.3: toggling off the only matching CDP script on a tab triggers clean detachment to IDLE', async () => {
      // Clear default scripts
      await context.localStorage.set({ scripts: {} });

      const cdpScript: ScriptRecord = {
        id: 'cdp-toggle-script',
        name: 'CDP Toggle Script',
        code: '// ==UserScript==\n// @match https://example.com/*\n// @grant GM_cdp\n// @cdp Network.enable\n// ==/UserScript==',
        metadata: {
          name: 'CDP Toggle Script',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
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
      await saveScript(cdpScript);

      context.mockTabs.get.mockResolvedValue({ id: 42, url: 'https://example.com/test' } as any);
      await manager.attachTab(42);
      await manager.initializeDeclaredDomains(42, 'https://example.com/test');

      expect(manager.getTabStatus(42)).toBe('ATTACHED');
      expect(manager.getActiveDomains(42)).toContain('Network');

      // Toggle script off
      await toggleScript(cdpScript.id, false);
      await manager.reconcileTabs();

      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 42 });
      expect(manager.getTabStatus(42)).toBe('IDLE');
      expect(manager.getActiveDomains(42)).toEqual([]);
      expect(manager.getSession(42)?.conflictDetected).toBe(false);

      const stored = await context.localStorage.get('tab_sessions');
      expect(stored.tab_sessions[42]?.status).toBe('IDLE');
    });

    it('T5.4: toggling the CDP script back on reconciles and re-attaches the debugger when matching', async () => {
      await context.localStorage.set({ scripts: {} });

      const cdpScript: ScriptRecord = {
        id: 'cdp-toggle-script-2',
        name: 'CDP Toggle Script 2',
        code: '// ==UserScript==\n// @match https://example.com/*\n// @grant GM_cdp\n// @cdp Network.enable\n// ==/UserScript==',
        metadata: {
          name: 'CDP Toggle Script 2',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }],
          cdpDeclarations: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }],
          cdpDomains: ['Network'],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await saveScript(cdpScript);

      context.mockTabs.get.mockResolvedValue({ id: 42, url: 'https://example.com/test' } as any);
      // Register session in IDLE state on tab 42
      manager.setTabStatus(42, 'IDLE');
      (manager as any).sessions.get(42)!.targetUrl = 'https://example.com/test';

      context.mockDebugger.attach.mockClear();
      context.mockDebugger.sendCommand.mockClear();

      // Enable the script
      await toggleScript(cdpScript.id, true);
      await manager.reconcileTabs();

      expect(context.mockDebugger.attach).toHaveBeenCalledWith({ tabId: 42 }, '1.3');
      expect(manager.getTabStatus(42)).toBe('ATTACHED');
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 42 },
        'Network.enable',
        {}
      );
      expect(manager.getActiveDomains(42)).toContain('Network');
    });

    it('T5.5: deleting the only CDP script triggers clean detachment to IDLE', async () => {
      await context.localStorage.set({ scripts: {} });

      const cdpScript: ScriptRecord = {
        id: 'cdp-delete-script',
        name: 'CDP Delete Script',
        code: '// ==UserScript==\n// @match https://example.com/*\n// @grant GM_cdp\n// ==/UserScript==',
        metadata: {
          name: 'CDP Delete Script',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
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
      await saveScript(cdpScript);

      context.mockTabs.get.mockResolvedValue({ id: 55, url: 'https://example.com/page' } as any);
      await manager.attachTab(55);
      expect(manager.getTabStatus(55)).toBe('ATTACHED');

      // Delete the script
      await deleteScript(cdpScript.id);
      await manager.reconcileTabs();

      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 55 });
      expect(manager.getTabStatus(55)).toBe('IDLE');
      expect(manager.getSession(55)?.conflictDetected).toBe(false);
    });

    it('T5.6: script without CDP requirements does not keep debugger attached', async () => {
      await context.localStorage.set({ scripts: {} });

      const nonCdpScript: ScriptRecord = {
        id: 'no-cdp-script',
        name: 'No CDP Script',
        code: '// ==UserScript==\n// @match https://example.com/*\n// @grant none\n// ==/UserScript==',
        metadata: {
          name: 'No CDP Script',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['none'],
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
      await saveScript(nonCdpScript);

      context.mockTabs.get.mockResolvedValue({ id: 66, url: 'https://example.com/page' } as any);
      await manager.attachTab(66);
      expect(manager.getTabStatus(66)).toBe('ATTACHED');

      await manager.reconcileTabs();

      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 66 });
      expect(manager.getTabStatus(66)).toBe('IDLE');
    });

    it('T5.7: canceled_by_user event while engine is disabled (globalEnabled: false) transitions tab to IDLE without CONFLICT', async () => {
      await saveSettings({ globalEnabled: false });

      // Create session on tab 70
      await manager.attachTab(70).catch(() => {});
      (manager as any).sessions.get(70)!.targetUrl = 'https://example.com';

      // Native banner dismissed by user
      context.mockDebugger._emitDetach({ tabId: 70 }, 'canceled_by_user');

      expect(manager.getTabStatus(70)).toBe('IDLE');
      expect(manager.getSession(70)?.conflictDetected).toBe(false);
      expect(manager.getSession(70)?.conflictReason).toBeUndefined();
    });

    it('T5.8: programmatic detachTab followed by canceled_by_user event does not falsely set CONFLICT', async () => {
      await saveSettings({ globalEnabled: true });
      context.mockTabs.get.mockResolvedValue({ id: 80, url: 'https://example.com' } as any);
      await manager.attachTab(80);
      expect(manager.getTabStatus(80)).toBe('ATTACHED');

      // Programmatic clean detach
      await manager.detachTab(80, 'IDLE');
      expect(manager.getTabStatus(80)).toBe('IDLE');

      // Subsequent browser detach event arrives
      context.mockDebugger._emitDetach({ tabId: 80 }, 'canceled_by_user');

      expect(manager.getTabStatus(80)).toBe('IDLE');
      expect(manager.getSession(80)?.conflictDetected).toBe(false);
      expect(manager.getSession(80)?.conflictReason).toBeUndefined();
    });

    it('T5.9: canceled_by_user event on tab with NO matching CDP scripts transitions to IDLE without CONFLICT', async () => {
      await saveSettings({ globalEnabled: true });
      await context.localStorage.set({ scripts: {} });

      context.mockTabs.get.mockResolvedValue({ id: 90, url: 'https://other-domain.org' } as any);
      await manager.attachTab(90);

      // Tab has no matching CDP scripts
      context.mockDebugger._emitDetach({ tabId: 90 }, 'canceled_by_user');

      expect(manager.getTabStatus(90)).toBe('IDLE');
      expect(manager.getSession(90)?.conflictDetected).toBe(false);
      expect(manager.getSession(90)?.conflictReason).toBeUndefined();
    });

    it('T5.10: replaced_with_devtools or unexpected canceled_by_user on tab with active CDP script still transitions to CONFLICT', async () => {
      await saveSettings({ globalEnabled: true });

      const cdpScript: ScriptRecord = {
        id: 'active-cdp-script',
        name: 'Active CDP Script',
        code: '// ==UserScript==\n// @match https://example.com/*\n// @grant GM_cdp\n// ==/UserScript==',
        metadata: {
          name: 'Active CDP Script',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
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
      await saveScript(cdpScript);

      context.mockTabs.get.mockResolvedValue({ id: 42, url: 'https://example.com/app' } as any);
      await manager.attachTab(42);
      expect(manager.getTabStatus(42)).toBe('ATTACHED');

      // Native DevTools opened
      context.mockDebugger._emitDetach({ tabId: 42 }, 'replaced_with_devtools');

      expect(manager.getTabStatus(42)).toBe('CONFLICT');
      expect(manager.getSession(42)?.conflictDetected).toBe(true);
      expect(manager.getSession(42)?.conflictReason).toBe('replaced_with_devtools');
    });

    it('T5.11: scriptRequiresCdp helper accurately identifies CDP requirements', () => {
      const baseScript: ScriptRecord = {
        id: 'test',
        name: 'Test',
        code: '',
        metadata: {
          name: 'Test',
          matches: [],
          matchPatterns: [],
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
        createdAt: 0,
        updatedAt: 0
      };

      // Disabled script
      expect(scriptRequiresCdp({ ...baseScript, enabled: false })).toBe(false);

      // Script with @grant none
      expect(
        scriptRequiresCdp({
          ...baseScript,
          metadata: { ...baseScript.metadata, grants: ['none'], cdpDomains: ['Network'] }
        })
      ).toBe(false);

      // Script with GM_cdp grant
      expect(
        scriptRequiresCdp({
          ...baseScript,
          metadata: { ...baseScript.metadata, grants: ['GM_cdp'] }
        })
      ).toBe(true);

      // Script with cdp grant
      expect(
        scriptRequiresCdp({
          ...baseScript,
          metadata: { ...baseScript.metadata, grants: ['cdp'] }
        })
      ).toBe(true);

      // Script with * grant
      expect(
        scriptRequiresCdp({
          ...baseScript,
          metadata: { ...baseScript.metadata, grants: ['*'] }
        })
      ).toBe(true);

      // Script with @cdp declarations
      expect(
        scriptRequiresCdp({
          ...baseScript,
          metadata: {
            ...baseScript.metadata,
            cdpDeclarations: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }]
          }
        })
      ).toBe(true);

      // Script with cdpDomains
      expect(
        scriptRequiresCdp({
          ...baseScript,
          metadata: { ...baseScript.metadata, cdpDomains: ['Page'] }
        })
      ).toBe(true);

      // Script without any CDP indicators
      expect(scriptRequiresCdp(baseScript)).toBe(false);
    });
  });
});
