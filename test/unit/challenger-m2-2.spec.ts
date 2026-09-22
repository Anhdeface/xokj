import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { saveScript } from '@/shared/storage';
import type { ScriptRecord } from '@/shared/types';

describe('Empirical Challenger M2-2: Closed Tab & Resource Deallocation Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let manager: TabDebuggerManager;
  let server: CdpBridgeServer;

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
  });

  afterEach(() => {
    server.destroy();
    manager.destroy();
  });

  describe('1. Tab Closed With Zero Inflight Requests (Resource Deallocation)', () => {
    it('1.1: closes single attached tab with zero inflight requests and cleans up all bridge maps', async () => {
      await manager.attachTab(101);
      (server as any).attachedTabs.add(101);

      expect(manager.isAttached(101)).toBe(true);
      expect(server.isTabAttached(101)).toBe(true);
      expect((server as any).attachedTabs.has(101)).toBe(true);

      // Trigger tab removal with zero inflight requests
      await context.mockTabs._emitRemoved(101);

      // Verify bridge internal collections
      expect(server.isTabAttached(101)).toBe(false);
      expect((server as any).attachedTabs.has(101)).toBe(false);
      expect((server as any).tabRequests.has(101)).toBe(false);
      expect((server as any).attachLocks.has(101)).toBe(false);

      // Verify manager internal collections
      expect(manager.getSession(101)).toBeUndefined();
      expect(manager.getTabStatus(101)).toBe('IDLE');
    });

    it('1.2: standalone CdpBridgeServer cleans up attachedTabs, tabRequests, and attachLocks on zero-inflight tab close', async () => {
      const standalone = new CdpBridgeServer({ autoAttach: false });
      standalone.init();

      (standalone as any).attachedTabs.add(202);
      (standalone as any).tabRequests.set(202, new Set());
      (standalone as any).attachLocks.set(202, Promise.resolve());

      expect(standalone.isTabAttached(202)).toBe(true);
      expect((standalone as any).attachedTabs.has(202)).toBe(true);
      expect((standalone as any).tabRequests.has(202)).toBe(true);
      expect((standalone as any).attachLocks.has(202)).toBe(true);

      // Close tab 202 via onRemoved
      standalone.handleTabRemoved(202);

      expect(standalone.isTabAttached(202)).toBe(false);
      expect((standalone as any).attachedTabs.has(202)).toBe(false);
      expect((standalone as any).tabRequests.has(202)).toBe(false);
      expect((standalone as any).attachLocks.has(202)).toBe(false);

      standalone.destroy();
    });

    it('1.3: mass tab closure stress (50 attached tabs, 0 inflight requests) leaves zero map leaks', async () => {
      const tabIds = Array.from({ length: 50 }, (_, i) => 1000 + i);

      // Simulate 50 attached tabs
      for (const tid of tabIds) {
        (server as any).attachedTabs.add(tid);
        (server as any).tabRequests.set(tid, new Set());
        (server as any).attachLocks.set(tid, Promise.resolve());
      }

      expect((server as any).attachedTabs.size).toBe(50);
      expect((server as any).tabRequests.size).toBe(50);
      expect((server as any).attachLocks.size).toBe(50);

      // Close all 50 tabs
      for (const tid of tabIds) {
        server.handleTabRemoved(tid);
      }

      expect((server as any).attachedTabs.size).toBe(0);
      expect((server as any).tabRequests.size).toBe(0);
      expect((server as any).attachLocks.size).toBe(0);
      for (const tid of tabIds) {
        expect(server.isTabAttached(tid)).toBe(false);
      }
    });

    it('1.4: repeated rejectPendingRequestsForTab calls are idempotent and do not recreate map entries', () => {
      expect((server as any).tabRequests.has(999)).toBe(false);

      // Call repeatedly on non-existent tab
      for (let i = 0; i < 5; i++) {
        const count = server.rejectPendingRequestsForTab(999, new Error('Detached'));
        expect(count).toBe(0);
      }

      expect((server as any).attachedTabs.has(999)).toBe(false);
      expect((server as any).tabRequests.has(999)).toBe(false);
      expect((server as any).attachLocks.has(999)).toBe(false);
    });

    it('1.5: tab closed while ensureAttached is pending in CdpBridgeServer does not leak into attachedTabs', async () => {
      const standalone = new CdpBridgeServer({ autoAttach: true });
      standalone.init();

      let resolveAttach!: () => void;
      context.mockDebugger.attach.mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveAttach = resolve; })
      );

      const cmdPromise = standalone.executeCommand(888, 'Runtime.evaluate', { expression: '1+1' });

      // Tab is closed while attach is suspended in chrome.debugger.attach
      standalone.handleTabRemoved(888);

      // Finish attach
      resolveAttach();

      const response = await cmdPromise;
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(1002);

      // Adversarial Oracle: 888 must NOT leak into attachedTabs
      // BUG: ensureAttached unconditionally executes `this.attachedTabs.add(tabId)` upon resolution!
      expect(standalone.isTabAttached(888)).toBe(false);
      expect((standalone as any).attachedTabs.has(888)).toBe(false);

      standalone.destroy();
    });
  });

  describe('2. Closed Tab Resurrection Guard (setTabStatus)', () => {
    it('2.1: calling setTabStatus(tabId, "DETACHED", "target_closed") on unattached/closed tab does NOT create session', async () => {
      expect(manager.getSession(300)).toBeUndefined();
      expect(manager.getTabStatus(300)).toBe('IDLE');

      // Attempt resurrection
      manager.setTabStatus(300, 'DETACHED', 'target_closed');

      // Memory assertions
      expect(manager.getSession(300)).toBeUndefined();
      expect(manager.getTabStatus(300)).toBe('IDLE');
      expect(manager.getAllSessions().some((s) => s.tabId === 300)).toBe(false);

      // Storage assertions
      const sessionStored = await context.sessionStorage.get('tab_session_300');
      expect(sessionStored.tab_session_300).toBeUndefined();

      const localStored = await context.localStorage.get('tab_sessions');
      expect(localStored.tab_sessions?.[300]).toBeUndefined();
    });

    it('2.2: delayed setTabStatus after handleTabRemoved does NOT resurrect session in memory or storage', async () => {
      await manager.attachTab(400);
      expect(manager.getSession(400)).toBeDefined();

      // Tab closed
      await manager.handleTabRemoved(400);
      expect(manager.getSession(400)).toBeUndefined();

      // Delayed detach events
      manager.setTabStatus(400, 'DETACHED', 'target_closed');
      manager.setTabStatus(400, 'DETACHED', 'canceled_by_user');
      manager.setTabStatus(400, 'DETACHED', 'replaced_with_devtools');
      manager.setTabStatus(400, 'DETACHED', undefined);

      expect(manager.getSession(400)).toBeUndefined();
      expect(manager.getTabStatus(400)).toBe('IDLE');
      expect(manager.getAllSessions().some((s) => s.tabId === 400)).toBe(false);

      const sessionStored = await context.sessionStorage.get('tab_session_400');
      expect(sessionStored.tab_session_400).toBeUndefined();

      const localStored = await context.localStorage.get('tab_sessions');
      expect(localStored.tab_sessions?.[400]).toBeUndefined();
    });

    it('2.3: handleDetach with target_closed does NOT resurrect an already-removed tab', async () => {
      await manager.attachTab(500);
      await manager.handleTabRemoved(500);

      // Browser debugger onDetach arrives after tab removal
      context.mockDebugger._emitDetach({ tabId: 500 }, 'target_closed');

      expect(manager.getSession(500)).toBeUndefined();
      expect(manager.getTabStatus(500)).toBe('IDLE');

      const sessionStored = await context.sessionStorage.get('tab_session_500');
      expect(sessionStored.tab_session_500).toBeUndefined();

      const localStored = await context.localStorage.get('tab_sessions');
      expect(localStored.tab_sessions?.[500]).toBeUndefined();
    });

    it('2.4: tab closed while attachTab is pending in chrome.debugger.attach leaves no zombie session or storage', async () => {
      let resolveAttach!: () => void;
      context.mockDebugger.attach.mockImplementationOnce(
        () => new Promise<void>((resolve) => { resolveAttach = resolve; })
      );

      const attachPromise = manager.attachTab(550);
      expect(manager.getTabStatus(550)).toBe('ATTACHING');

      // Tab closed while attach is suspended in chrome.debugger.attach
      await manager.handleTabRemoved(550);

      // Finish attach
      resolveAttach();
      await attachPromise;

      // Adversarial Oracle: 550 must NOT be resurrected in memory or storage
      // BUG: attachAction blindly sets session.status = 'ATTACHED', calls persistSession, and broadcasts lifecycle!
      expect(manager.getSession(550)).toBeUndefined();
      expect(manager.getTabStatus(550)).toBe('IDLE');
      expect((manager as any).sessions.has(550)).toBe(false);

      const sessionStored = await context.sessionStorage.get('tab_session_550');
      expect(sessionStored.tab_session_550).toBeUndefined();

      const localStored = await context.localStorage.get('tab_sessions');
      expect(localStored.tab_sessions?.[550]).toBeUndefined();
    });
  });

  describe('3. Persistent Storage Leak Verification (chrome.storage.local.tab_sessions)', () => {
    it('3.1: tab removal unconditionally purges closed tab from chrome.storage.local.tab_sessions', async () => {
      await manager.attachTab(601);
      await manager.attachTab(602);

      const before = await context.localStorage.get('tab_sessions');
      expect(before.tab_sessions?.[601]).toBeDefined();
      expect(before.tab_sessions?.[602]).toBeDefined();

      await manager.handleTabRemoved(601);

      await vi.waitFor(async () => {
        const after = await context.localStorage.get('tab_sessions');
        expect(after.tab_sessions?.[601]).toBeUndefined();
        expect(after.tab_sessions?.[602]).toBeDefined();
      });

      await manager.handleTabRemoved(602);

      await vi.waitFor(async () => {
        const after2 = await context.localStorage.get('tab_sessions');
        expect(after2.tab_sessions?.[602]).toBeUndefined();
      });
    });

    it('3.2: handleTabRemoved when tab_sessions is undefined does not throw or corrupt storage', async () => {
      await context.localStorage.set({ tab_sessions: undefined });
      await expect(manager.handleTabRemoved(777)).resolves.not.toThrow();
    });

    it('3.3: sequential multi-tab lifecycle test (10 tabs created and removed one by one)', async () => {
      for (let i = 1; i <= 10; i++) {
        await manager.attachTab(700 + i);
      }

      let stored = await context.localStorage.get('tab_sessions');
      for (let i = 1; i <= 10; i++) {
        expect(stored.tab_sessions?.[700 + i]).toBeDefined();
      }

      // Sequentially remove tabs 1..10
      for (let i = 1; i <= 10; i++) {
        await manager.handleTabRemoved(700 + i);
      }

      stored = await context.localStorage.get('tab_sessions');
      for (let i = 1; i <= 10; i++) {
        expect(stored.tab_sessions?.[700 + i]).toBeUndefined();
      }
    });

    it('3.4: concurrent multi-tab removal stress test', async () => {
      // Attach 10 tabs (801..810)
      for (let i = 1; i <= 10; i++) {
        await manager.attachTab(800 + i);
      }

      const initialStored = await context.localStorage.get('tab_sessions');
      for (let i = 1; i <= 10; i++) {
        expect(initialStored.tab_sessions?.[800 + i]).toBeDefined();
      }

      // Concurrently remove all 10 tabs
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => manager.handleTabRemoved(800 + i + 1))
      );

      // Adversarial Oracle: All removed tabs must be purged from storage
      // BUG: Unsynchronized get/set in handleTabRemoved causes lost updates; previous tabs are restored!
      const finalStored = await context.localStorage.get('tab_sessions');
      for (let i = 1; i <= 10; i++) {
        expect(finalStored.tab_sessions?.[800 + i]).toBeUndefined();
      }
    });
  });

  describe('4. Declarative Init Interruption Check', () => {
    it('4.1: detachment during declarative init aborts immediately and does not send further commands', async () => {
      const script: ScriptRecord = {
        id: 'decl-script-interruption',
        name: 'Interruption Script',
        code: '// ==UserScript==\n// @match https://test.com/*\n// @cdp Network\n// @cdp Page\n// @cdp DOM\n// @cdp CSS\n// ==/UserScript==',
        metadata: {
          name: 'Interruption Script',
          matches: ['https://test.com/*'],
          matchPatterns: ['https://test.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} },
            { domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} },
            { domain: 'CSS', method: 'enable', command: 'CSS.enable', params: {} }
          ],
          cdpDeclarations: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} },
            { domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} },
            { domain: 'CSS', method: 'enable', command: 'CSS.enable', params: {} }
          ],
          cdpDomains: ['Network', 'Page', 'DOM', 'CSS'],
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

      const executedCommands: string[] = [];

      context.mockDebugger.sendCommand.mockImplementation(async (_target, cmd) => {
        executedCommands.push(cmd);
        if (cmd === 'Page.enable') {
          // Detach happens right while Page.enable is processing
          context.mockDebugger._emitDetach({ tabId: 901 }, 'canceled_by_user');
        }
        return {};
      });

      await manager.executeDeclarativeInit(901, 'https://test.com/index.html');

      // Network.enable and Page.enable ran, but DOM.enable and CSS.enable must NOT run
      expect(executedCommands).toEqual(['Network.enable', 'Page.enable']);
      expect(executedCommands).not.toContain('DOM.enable');
      expect(executedCommands).not.toContain('CSS.enable');

      expect(manager.getTabStatus(901)).toBe('CONFLICT');
    });

    it('4.2: tab detached before loop execution fast-aborts declarative init without sending any commands', async () => {
      const script: ScriptRecord = {
        id: 'decl-script-pre-abort',
        name: 'Pre Abort Script',
        code: '// ==UserScript==\n// @match https://test2.com/*\n// @cdp Network\n// @cdp Page\n// ==/UserScript==',
        metadata: {
          name: 'Pre Abort Script',
          matches: ['https://test2.com/*'],
          matchPatterns: ['https://test2.com/*'],
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

      // Force attach to detach before returning
      const origAttach = manager.attach.bind(manager);
      vi.spyOn(manager, 'attach').mockImplementationOnce(async (tabId) => {
        const ok = await origAttach(tabId);
        // Force status to DETACHED
        (manager as any).sessions.get(tabId)!.status = 'DETACHED';
        return ok;
      });

      await manager.executeDeclarativeInit(902, 'https://test2.com/page');

      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
    });

    it('4.3: error thrown during sendCommand with simultaneous detachment breaks loop immediately', async () => {
      const script: ScriptRecord = {
        id: 'decl-script-error-abort',
        name: 'Error Abort Script',
        code: '// ==UserScript==\n// @match https://test3.com/*\n// @cdp Network\n// @cdp Page\n// @cdp Fetch\n// ==/UserScript==',
        metadata: {
          name: 'Error Abort Script',
          matches: ['https://test3.com/*'],
          matchPatterns: ['https://test3.com/*'],
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

      const executedCommands: string[] = [];
      context.mockDebugger.sendCommand.mockImplementation(async (_target, cmd) => {
        executedCommands.push(cmd);
        if (cmd === 'Network.enable') {
          // Detach tab and throw
          context.mockDebugger._emitDetach({ tabId: 903 }, 'target_closed');
          throw new Error('Target closed');
        }
        return {};
      });

      await manager.executeDeclarativeInit(903, 'https://test3.com/page');

      expect(executedCommands).toEqual(['Network.enable']);
      expect(executedCommands).not.toContain('Page.enable');
      expect(executedCommands).not.toContain('Fetch.enable');
    });

    it('4.4: tab closed via handleTabRemoved during declarative init loop aborts further commands', async () => {
      const script: ScriptRecord = {
        id: 'decl-script-tab-removed-abort',
        name: 'Tab Removed Abort Script',
        code: '// ==UserScript==\n// @match https://test4.com/*\n// @cdp Network\n// @cdp Page\n// @cdp Fetch\n// ==/UserScript==',
        metadata: {
          name: 'Tab Removed Abort Script',
          matches: ['https://test4.com/*'],
          matchPatterns: ['https://test4.com/*'],
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

      const executedCommands: string[] = [];
      context.mockDebugger.sendCommand.mockImplementation(async (_target, cmd) => {
        executedCommands.push(cmd);
        if (cmd === 'Network.enable') {
          // Tab is closed during declarative init
          await manager.handleTabRemoved(904);
        }
        return {};
      });

      await manager.executeDeclarativeInit(904, 'https://test4.com/page');

      // Adversarial Oracle: Remaining commands must NOT run
      // BUG: handleTabRemoved does not change session.status on the referenced object and loop does not check this.sessions.has(tabId)!
      expect(executedCommands).toEqual(['Network.enable']);
      expect(executedCommands).not.toContain('Page.enable');
      expect(executedCommands).not.toContain('Fetch.enable');
    });
  });
});
