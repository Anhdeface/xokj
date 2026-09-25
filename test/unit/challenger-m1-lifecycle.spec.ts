import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { UiIpcServer } from '@/background/ui-ipc';
import { DevToolsConflictHandler } from '@/background/conflict-mgr';
import { saveScript, saveSettings, deleteScript, toggleScript, getScriptList } from '@/shared/storage';
import type { ScriptRecord } from '@/shared/types';

describe('Adversarial Challenger M1: CDP Lifecycle, Concurrency & Ghost Session Prevention', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let manager: TabDebuggerManager;
  let uiIpc: UiIpcServer;
  let conflictHandler: DevToolsConflictHandler;

  const createTestScript = (
    id: string,
    name: string,
    match: string,
    cdpDomain: string | null = null,
    enabled = true
  ): ScriptRecord => ({
    id,
    name,
    code: `// ==UserScript==\n// @match ${match}\n${cdpDomain ? `// @grant GM_cdp\n// @cdp ${cdpDomain}.enable` : '// @grant none'}\n// ==/UserScript==`,
    metadata: {
      name,
      matches: [match],
      matchPatterns: [match],
      includes: [],
      excludes: [],
      runAt: 'document-start',
      grants: cdpDomain ? ['GM_cdp'] : ['none'],
      cdp: cdpDomain ? [{ domain: cdpDomain, method: 'enable', command: `${cdpDomain}.enable`, params: {} }] : [],
      cdpDeclarations: cdpDomain ? [{ domain: cdpDomain, method: 'enable', command: `${cdpDomain}.enable`, params: {} }] : [],
      cdpDomains: cdpDomain ? [cdpDomain] : [],
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
    // Clear default scripts so only explicitly registered scripts are active in each test
    await context.localStorage.set({ scripts: {} });

    manager = new TabDebuggerManager();
    await manager.init();

    conflictHandler = new DevToolsConflictHandler(null, manager);
    conflictHandler.init();

    uiIpc = new UiIpcServer(manager);
    uiIpc.init();
  });

  afterEach(() => {
    uiIpc.destroy();
    conflictHandler.destroy();
    manager.destroy();
  });

  describe('Adversarial Subsystem 1: Rapid Toggle of globalEnabled', () => {
    it('C1.1: Rapid ping-pong toggle (true -> false -> true) converges to ATTACHED with declared domains active', async () => {
      await saveSettings({ globalEnabled: true, autoAttachDebugger: true });

      const script1 = createTestScript('s1', 'Script 1', 'https://site-a.com/*', 'Network');
      const script2 = createTestScript('s2', 'Script 2', 'https://site-b.com/*', 'Page');
      await saveScript(script1);
      await saveScript(script2);

      context.mockTabs.get.mockImplementation(async (tabId: number) => {
        if (tabId === 10) return { id: 10, url: 'https://site-a.com/page' } as any;
        if (tabId === 20) return { id: 20, url: 'https://site-b.com/page' } as any;
        return { id: tabId, url: 'https://example.com' } as any;
      });

      await manager.attachTab(10);
      await manager.attachTab(20);
      expect(manager.getTabStatus(10)).toBe('ATTACHED');
      expect(manager.getTabStatus(20)).toBe('ATTACHED');

      // Trigger rapid toggle true -> false -> true concurrently without awaiting in-between
      const pOff = new Promise((resolve) => {
        uiIpc.handleMessage({ type: 'TOGGLE_GLOBAL', enabled: false }, {}, resolve);
      });
      const pOn = new Promise((resolve) => {
        uiIpc.handleMessage({ type: 'TOGGLE_GLOBAL', enabled: true }, {}, resolve);
      });

      await Promise.all([pOff, pOn]);

      // Ensure all queued reconciles and mutexes have resolved
      await manager.reconcileTabs();

      expect(manager.getTabStatus(10)).toBe('ATTACHED');
      expect(manager.getTabStatus(20)).toBe('ATTACHED');
      expect(manager.getActiveDomains(10)).toContain('Network');
      expect(manager.getActiveDomains(20)).toContain('Page');
      expect(manager.getSession(10)?.conflictDetected).toBe(false);
      expect(manager.getSession(20)?.conflictDetected).toBe(false);
    });

    it('C1.2: Rapid ping-pong toggle (false -> true -> false) converges to IDLE with active domains cleared and zero CONFLICT', async () => {
      await saveSettings({ globalEnabled: false, autoAttachDebugger: true });

      const script1 = createTestScript('s1', 'Script 1', 'https://site-a.com/*', 'Network');
      await saveScript(script1);

      context.mockTabs.get.mockImplementation(async (tabId: number) => ({
        id: tabId,
        url: 'https://site-a.com/page'
      } as any));

      await manager.attachTab(10);

      // Trigger rapid toggle false -> true -> false concurrently
      const pOn = new Promise((resolve) => {
        uiIpc.handleMessage({ type: 'TOGGLE_GLOBAL', enabled: true }, {}, resolve);
      });
      const pOff = new Promise((resolve) => {
        uiIpc.handleMessage({ type: 'TOGGLE_GLOBAL', enabled: false }, {}, resolve);
      });

      await Promise.all([pOn, pOff]);

      await manager.reconcileTabs();

      expect(manager.getTabStatus(10)).toBe('IDLE');
      expect(manager.getActiveDomains(10)).toHaveLength(0);
      expect(manager.getSession(10)?.conflictDetected).toBe(false);
      expect(manager.getSession(10)?.conflictReason).toBeUndefined();
    });

    it('C1.3: High-frequency alternating burst of 20 toggles does not deadlock or corrupt session state', async () => {
      const script = createTestScript('s1', 'Script 1', 'https://site.com/*', 'DOM');
      await saveScript(script);

      context.mockTabs.get.mockImplementation(async (tabId: number) => ({
        id: tabId,
        url: 'https://site.com/home'
      } as any));

      await manager.attachTab(30);

      // Burst of 20 rapid toggles alternating false and true, ending with false
      const toggles: Promise<any>[] = [];
      for (let i = 0; i < 20; i++) {
        const enabled = i % 2 !== 0; // i=19 => true
        toggles.push(
          new Promise((resolve) => {
            uiIpc.handleMessage({ type: 'TOGGLE_GLOBAL', enabled }, {}, resolve);
          })
        );
      }
      await Promise.all(toggles);

      // Final desired state: set to false
      await new Promise((resolve) => {
        uiIpc.handleMessage({ type: 'TOGGLE_GLOBAL', enabled: false }, {}, resolve);
      });

      expect(manager.getTabStatus(30)).toBe('IDLE');
      expect(manager.getActiveDomains(30)).toHaveLength(0);
      expect(manager.getSession(30)?.conflictDetected).toBe(false);
    });

    it('C1.4: In-flight slow attach interrupted by immediate global disable cleanly detaches to IDLE', async () => {
      await saveSettings({ globalEnabled: true, autoAttachDebugger: true });
      const script = createTestScript('s-slow', 'Slow Script', 'https://slow.com/*', 'Network');
      await saveScript(script);

      let finishAttach!: () => void;
      context.mockDebugger.attach.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishAttach = resolve;
          })
      );

      context.mockTabs.get.mockImplementation(async (tabId: number) => ({
        id: tabId,
        url: 'https://slow.com/page'
      } as any));

      // 1. Start attach
      const attachPromise = manager.attachTab(40);
      expect(manager.getTabStatus(40)).toBe('ATTACHING');

      // Wait until chrome.debugger.attach is reached
      await vi.waitFor(() => {
        expect(context.mockDebugger.attach).toHaveBeenCalled();
      });

      // 2. Global disable arrives while attach is still awaiting in-flight
      const disablePromise = manager.detachAll('IDLE');

      // 3. Complete browser attach
      finishAttach();

      await Promise.all([attachPromise, disablePromise]);

      expect(manager.getTabStatus(40)).toBe('IDLE');
      expect(manager.getActiveDomains(40)).toHaveLength(0);
      expect(manager.getSession(40)?.conflictDetected).toBe(false);
    });

    it('C1.5: Interleaved concurrent script toggles and global toggle converge safely', async () => {
      await saveSettings({ globalEnabled: true, autoAttachDebugger: true });
      const script = createTestScript('mix-s', 'Mix Script', 'https://mix.com/*', 'Network', true);
      await saveScript(script);

      context.mockTabs.get.mockImplementation(async (tabId: number) => ({
        id: tabId,
        url: 'https://mix.com/page'
      } as any));

      await manager.attachTab(50);
      expect(manager.getTabStatus(50)).toBe('ATTACHED');

      // Interleave toggleScript and toggleGlobal simultaneously
      await Promise.all([
        toggleScript('mix-s', false),
        new Promise((resolve) => uiIpc.handleMessage({ type: 'TOGGLE_GLOBAL', enabled: false }, {}, resolve)),
        toggleScript('mix-s', true),
        new Promise((resolve) => uiIpc.handleMessage({ type: 'TOGGLE_GLOBAL', enabled: true }, {}, resolve))
      ]);

      await manager.reconcileTabs();

      expect(manager.getTabStatus(50)).toBe('ATTACHED');
      expect(manager.getActiveDomains(50)).toContain('Network');
    });

    it('C1.6: Global disable resets mixed tabs (ATTACHED, CONFLICT, DETACHED) to IDLE without stale conflict residue', async () => {
      await saveSettings({ globalEnabled: true });
      const script = createTestScript('mixed-s', 'Mixed Script', 'https://mixed.com/*', 'Network', true);
      await saveScript(script);

      context.mockTabs.get.mockImplementation(async (tabId: number) => ({
        id: tabId,
        url: 'https://mixed.com/page'
      } as any));

      // Tab 61: ATTACHED
      await manager.attachTab(61);
      // Tab 62: CONFLICT
      (manager as any).sessions.set(62, {
        tabId: 62,
        status: 'CONFLICT',
        attached: false,
        activeDomains: new Set(['Network']),
        conflictDetected: true,
        conflictReason: 'replaced_with_devtools',
        updatedAt: Date.now(),
        operationLock: null,
        currentOp: null,
        targetUrl: 'https://mixed.com/page'
      });
      // Tab 63: DETACHED
      (manager as any).sessions.set(63, {
        tabId: 63,
        status: 'DETACHED',
        attached: false,
        activeDomains: new Set(),
        conflictDetected: false,
        updatedAt: Date.now(),
        operationLock: null,
        currentOp: null,
        targetUrl: 'https://mixed.com/page'
      });

      // Global disable
      await manager.detachAll('IDLE');

      // All 3 tabs must now be IDLE with zero conflict flags
      for (const tabId of [61, 62, 63]) {
        expect(manager.getTabStatus(tabId)).toBe('IDLE');
        expect(manager.getActiveDomains(tabId)).toHaveLength(0);
        expect(manager.getSession(tabId)?.conflictDetected).toBe(false);
        expect(manager.getSession(tabId)?.conflictReason).toBeUndefined();
      }
    });
  });

  describe('Adversarial Subsystem 2: Rapid Script Toggles on Multiple Tabs Concurrently', () => {
    it('C2.1: Concurrent script toggles across 4 distinct tabs converge to matching CDP requirements', async () => {
      await saveSettings({ globalEnabled: true, autoAttachDebugger: true });

      const scriptA = createTestScript('sa', 'Script A', 'https://alpha.com/*', 'Network', false);
      const scriptB = createTestScript('sb', 'Script B', 'https://beta.com/*', 'Page', true);
      const scriptC = createTestScript('sc', 'Script C', 'https://gamma.com/*', 'DOM', false);
      const scriptD = createTestScript('sd', 'Script D', 'https://delta.com/*', null, true); // non-CDP

      await saveScript(scriptA);
      await saveScript(scriptB);
      await saveScript(scriptC);
      await saveScript(scriptD);

      context.mockTabs.get.mockImplementation(async (tabId: number) => {
        if (tabId === 101) return { id: 101, url: 'https://alpha.com/home' } as any;
        if (tabId === 102) return { id: 102, url: 'https://beta.com/home' } as any;
        if (tabId === 103) return { id: 103, url: 'https://gamma.com/home' } as any;
        if (tabId === 104) return { id: 104, url: 'https://delta.com/home' } as any;
        return { id: tabId, url: 'https://example.com' } as any;
      });

      // Track all tabs
      await manager.attachTab(101);
      await manager.attachTab(102);
      await manager.attachTab(103);
      await manager.attachTab(104);

      // Concurrently:
      // Enable A (Alpha should attach Network)
      // Disable B (Beta should detach to IDLE)
      // Enable C (Gamma should attach DOM)
      // Toggle D on and off (Delta has no CDP anyway -> IDLE)
      await Promise.all([
        toggleScript('sa', true).then(() => manager.reconcileTabs()),
        toggleScript('sb', false).then(() => manager.reconcileTabs()),
        toggleScript('sc', true).then(() => manager.reconcileTabs()),
        toggleScript('sd', false).then(() => manager.reconcileTabs())
      ]);

      // Final reconciliation pass
      await manager.reconcileTabs();

      expect(manager.getTabStatus(101)).toBe('ATTACHED');
      expect(manager.getActiveDomains(101)).toContain('Network');

      expect(manager.getTabStatus(102)).toBe('IDLE');
      expect(manager.getActiveDomains(102)).toHaveLength(0);

      expect(manager.getTabStatus(103)).toBe('ATTACHED');
      expect(manager.getActiveDomains(103)).toContain('DOM');

      expect(manager.getTabStatus(104)).toBe('IDLE');
      expect(manager.getActiveDomains(104)).toHaveLength(0);
    });

    it('C2.2: Concurrent multi-tab toggles sharing an overlapping script converge cleanly without domain pollution', async () => {
      await saveSettings({ globalEnabled: true, autoAttachDebugger: true });

      const universalScript = createTestScript('u1', 'Universal CDP', 'https://*.domain.com/*', 'Network', true);
      const specificScript = createTestScript('s1', 'Specific CDP', 'https://sub1.domain.com/*', 'Page', true);
      await saveScript(universalScript);
      await saveScript(specificScript);

      context.mockTabs.get.mockImplementation(async (tabId: number) => {
        if (tabId === 201) return { id: 201, url: 'https://sub1.domain.com/app' } as any;
        if (tabId === 202) return { id: 202, url: 'https://sub2.domain.com/app' } as any;
        return { id: tabId, url: 'https://other.com' } as any;
      });

      await manager.attachTab(201);
      await manager.attachTab(202);
      await manager.reconcileTabs();

      // Tab 201 has Network + Page
      expect(manager.getActiveDomains(201)).toContain('Network');
      expect(manager.getActiveDomains(201)).toContain('Page');
      // Tab 202 has only Network
      expect(manager.getActiveDomains(202)).toContain('Network');
      expect(manager.getActiveDomains(202)).not.toContain('Page');

      // Now toggle specificScript off while leaving universalScript on
      await toggleScript('s1', false);
      await manager.reconcileTabs();

      // Tab 201 remains ATTACHED but re-evaluates declared domains
      expect(manager.getTabStatus(201)).toBe('ATTACHED');
      expect(manager.getTabStatus(202)).toBe('ATTACHED');

      // Now toggle universalScript off too
      await toggleScript('u1', false);
      await manager.reconcileTabs();

      // Both tabs must now be IDLE
      expect(manager.getTabStatus(201)).toBe('IDLE');
      expect(manager.getTabStatus(202)).toBe('IDLE');
      expect(manager.getActiveDomains(201)).toHaveLength(0);
      expect(manager.getActiveDomains(202)).toHaveLength(0);
    });

    it('C2.3: Reconcile race between UI IPC message and storage.onChanged serializes safely via reconcileMutex', async () => {
      await saveSettings({ globalEnabled: true, autoAttachDebugger: true });
      const script = createTestScript('race-s', 'Race Script', 'https://race.com/*', 'Network', true);
      await saveScript(script);

      context.mockTabs.get.mockImplementation(async (tabId: number) => ({
        id: tabId,
        url: 'https://race.com/test'
      } as any));

      await manager.attachTab(301);

      // Simulate simultaneous trigger from UI IPC toggle and storage.onChanged
      const ipcTrigger = new Promise((resolve) => {
        uiIpc.handleMessage({ type: 'TOGGLE_SCRIPT', scriptId: 'race-s', enabled: false }, {}, resolve);
      });
      const storageTrigger = context.storageOnChanged._emit(
        {
          scripts: {
            oldValue: { 'race-s': script },
            newValue: { 'race-s': { ...script, enabled: false } }
          }
        },
        'local'
      );

      await Promise.all([ipcTrigger, storageTrigger]);

      expect(manager.getTabStatus(301)).toBe('IDLE');
      expect(manager.getActiveDomains(301)).toHaveLength(0);
      expect(manager.getSession(301)?.conflictDetected).toBe(false);
    });

    it('C2.4: Editing script to remove CDP capability cleanly reconciles attached tab to IDLE', async () => {
      await saveSettings({ globalEnabled: true, autoAttachDebugger: true });
      const originalScript = createTestScript('edit-s', 'Edit Script', 'https://edit.com/*', 'Network', true);
      await saveScript(originalScript);

      context.mockTabs.get.mockImplementation(async (tabId: number) => ({
        id: tabId,
        url: 'https://edit.com/home'
      } as any));

      await manager.attachTab(350);
      expect(manager.getTabStatus(350)).toBe('ATTACHED');

      // Update script with code that does not grant CDP and has no CDP domains
      const nonCdpVersion: ScriptRecord = {
        ...originalScript,
        code: '// ==UserScript==\n// @match https://edit.com/*\n// @grant none\n// ==/UserScript==',
        metadata: {
          ...originalScript.metadata,
          grants: ['none'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: []
        },
        updatedAt: Date.now()
      };
      await saveScript(nonCdpVersion);
      await manager.reconcileTabs();

      expect(manager.getTabStatus(350)).toBe('IDLE');
      expect(manager.getActiveDomains(350)).toHaveLength(0);
      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 350 });
    });

    it('C2.5: Deleting the only CDP userscript cleanly reconciles attached tab to IDLE', async () => {
      await saveSettings({ globalEnabled: true, autoAttachDebugger: true });
      const script = createTestScript('del-s', 'Delete Script', 'https://del.com/*', 'Page', true);
      await saveScript(script);

      context.mockTabs.get.mockImplementation(async (tabId: number) => ({
        id: tabId,
        url: 'https://del.com/home'
      } as any));

      await manager.attachTab(360);
      expect(manager.getTabStatus(360)).toBe('ATTACHED');

      // Delete the userscript
      await deleteScript('del-s');
      await manager.reconcileTabs();

      expect(manager.getTabStatus(360)).toBe('IDLE');
      expect(manager.getActiveDomains(360)).toHaveLength(0);
      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 360 });
    });
  });

  describe('Adversarial Subsystem 3: Closed Tab Cleanup & Ghost Session Prevention', () => {
    it('C3.1: Tab closed while attachTab is pending in-flight does not resurrect as attached or idle session', async () => {
      let finishAttach!: () => void;
      context.mockDebugger.attach.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishAttach = resolve;
          })
      );

      // Tab 401 starts attaching
      const attachPromise = manager.attachTab(401);
      expect(manager.getTabStatus(401)).toBe('ATTACHING');

      // User closes tab 401 before attach completes
      await manager.handleTabRemoved(401);
      expect(manager.getSession(401)).toBeUndefined();

      // chrome.debugger.attach completes
      finishAttach();
      await attachPromise;

      // Assert tab 401 is NOT resurrected in memory
      expect(manager.getSession(401)).toBeUndefined();
      expect(manager.getTabStatus(401)).toBe('IDLE');

      // Assert chrome.debugger.detach was called to clean up browser-side
      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId: 401 });

      // Assert session storage does not have ghost entry
      const sessionData = await context.sessionStorage.get('tab_session_401');
      expect(sessionData['tab_session_401']).toBeUndefined();
    });

    it('C3.2: Tab closed while reconcileTabs is querying tabs does not throw unhandled rejection or resurrect ghost session', async () => {
      await saveSettings({ globalEnabled: true, autoAttachDebugger: true });
      const script = createTestScript('ghost-s', 'Ghost Script', 'https://ghost.com/*', 'Network', true);
      await saveScript(script);

      // Track tabs 501 and 502
      (manager as any).sessions.set(501, {
        tabId: 501,
        status: 'ATTACHED',
        attached: true,
        activeDomains: new Set(['Network']),
        conflictDetected: false,
        updatedAt: Date.now(),
        operationLock: null,
        currentOp: null,
        targetUrl: undefined // forces chrome.tabs.get
      });
      (manager as any).sessions.set(502, {
        tabId: 502,
        status: 'IDLE',
        attached: false,
        activeDomains: new Set(),
        conflictDetected: false,
        updatedAt: Date.now(),
        operationLock: null,
        currentOp: null,
        targetUrl: 'https://ghost.com/live'
      });

      // Tab 501 is closed in browser: chrome.tabs.get throws
      context.mockTabs.get.mockImplementation(async (tabId: number) => {
        if (tabId === 501) {
          throw new Error('No tab with given id: 501');
        }
        return { id: tabId, url: 'https://ghost.com/live' } as any;
      });

      // Run tab removed on 501
      await manager.handleTabRemoved(501);

      // Reconcile across remaining tabs
      await expect(manager.reconcileTabs()).resolves.not.toThrow();

      // Tab 501 must be completely absent (no resurrection)
      expect(manager.getSession(501)).toBeUndefined();

      // Tab 502 must be successfully attached
      expect(manager.getTabStatus(502)).toBe('ATTACHED');
    });

    it('C3.3: Native browser onDetach (target_closed) arriving after tab removal does NOT resurrect session', async () => {
      await saveSettings({ globalEnabled: true });
      context.mockTabs.get.mockImplementation(async (tabId: number) => ({
        id: tabId,
        url: 'https://example.com'
      } as any));

      await manager.attachTab(601);
      expect(manager.getTabStatus(601)).toBe('ATTACHED');

      // Tab is removed from Chrome
      await manager.handleTabRemoved(601);
      expect(manager.getSession(601)).toBeUndefined();

      // Later, browser onDetach event arrives with reason 'target_closed'
      context.mockDebugger._emitDetach({ tabId: 601 }, 'target_closed');

      // Verify Tab 601 was not resurrected into sessions map
      expect(manager.getSession(601)).toBeUndefined();
      expect(manager.getTabStatus(601)).toBe('IDLE');
    });

    it('C3.4: Browser onDetach (canceled_by_user) arriving after tab removal does NOT mark conflict or resurrect ghost session', async () => {
      await saveSettings({ globalEnabled: true });
      context.mockTabs.get.mockImplementation(async (tabId: number) => ({
        id: tabId,
        url: 'https://example.com'
      } as any));

      await manager.attachTab(701);

      // Tab closed and removed
      await manager.handleTabRemoved(701);
      expect(manager.getSession(701)).toBeUndefined();

      // Banner dismissed event arrives for closed tab
      context.mockDebugger._emitDetach({ tabId: 701 }, 'canceled_by_user');

      expect(manager.getSession(701)).toBeUndefined();
      expect(manager.getTabStatus(701)).toBe('IDLE');
    });

    it('C3.5: setTabStatus with DETACHED on an untracked tab does not resurrect or save ghost session', async () => {
      expect(manager.getSession(801)).toBeUndefined();

      // Conflict handler or external caller sets DETACHED on closed tab 801
      manager.setTabStatus(801, 'DETACHED');

      expect(manager.getSession(801)).toBeUndefined();

      const stored = await context.sessionStorage.get('tab_session_801');
      expect(stored['tab_session_801']).toBeUndefined();
    });

    it('C3.6: Mass closure of 10 out of 20 tracked tabs during reconcile cleanly removes closed tabs and preserves survivors', async () => {
      await saveSettings({ globalEnabled: true, autoAttachDebugger: true });
      const script = createTestScript('survive-s', 'Survive Script', 'https://survive.com/*', 'Network', true);
      await saveScript(script);

      context.mockTabs.get.mockImplementation(async (tabId: number) => {
        if (tabId <= 10) {
          throw new Error(`Tab ${tabId} closed`);
        }
        return { id: tabId, url: 'https://survive.com/page' } as any;
      });

      // Track tabs 1 through 20
      for (let i = 1; i <= 20; i++) {
        await manager.attachTab(i);
      }

      // Close tabs 1 through 10
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => manager.handleTabRemoved(i + 1))
      );

      // Reconcile remaining
      await manager.reconcileTabs();

      // Tabs 1 through 10 must be gone
      for (let i = 1; i <= 10; i++) {
        expect(manager.getSession(i)).toBeUndefined();
      }

      // Tabs 11 through 20 must remain attached with Network domain
      for (let i = 11; i <= 20; i++) {
        expect(manager.getTabStatus(i)).toBe('ATTACHED');
        expect(manager.getActiveDomains(i)).toContain('Network');
      }
    });
  });

  describe('Adversarial Subsystem 4: Inflight Request Rejection & Error Classification', () => {
    it('C4.1: Inflight requests rejected with code 1002 on clean detachAll, but code 1001 on genuine DevTools conflict', async () => {
      await saveSettings({ globalEnabled: true });
      const cdpScript = createTestScript('cdp-s', 'CDP Script', 'https://app.com/*', 'Network', true);
      await saveScript(cdpScript);

      context.mockTabs.get.mockImplementation(async (tabId: number) => ({
        id: tabId,
        url: 'https://app.com/main'
      } as any));

      const rejectedErrors: any[] = [];
      const mockTracker = {
        rejectPendingRequestsForTab: vi.fn((tabId: number, err: any) => {
          rejectedErrors.push({ tabId, err });
          return 1;
        })
      };
      manager.setInflightTracker(mockTracker);

      // Tab 901 attached
      await manager.attachTab(901);

      // Clean detachAll
      await manager.detachAll('IDLE');
      expect(mockTracker.rejectPendingRequestsForTab).toHaveBeenCalledWith(
        901,
        expect.objectContaining({ code: 1002 })
      );

      // Re-attach Tab 901
      await manager.attachTab(901);
      mockTracker.rejectPendingRequestsForTab.mockClear();

      // Genuine DevTools opens on tab 901
      context.mockDebugger._emitDetach({ tabId: 901 }, 'replaced_with_devtools');

      expect(mockTracker.rejectPendingRequestsForTab).toHaveBeenCalledWith(
        901,
        expect.objectContaining({ code: 1001 })
      );
      expect(manager.getTabStatus(901)).toBe('CONFLICT');
    });
  });
});
