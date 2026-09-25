import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { ScriptInjector } from '@/background/injector';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { DevToolsConflictHandler } from '@/background/conflict-mgr';
import {
  saveScript,
  saveSettings,
  storageMutex,
  resetToDefaultScripts,
  STORAGE_KEYS
} from '@/shared/storage';
import type { ScriptRecord, CdpRpcRequest, CdpRpcResponse } from '@/shared/types';

describe('Empirical Challenger Opt-M2-1: Background Runtime & Pipeline Optimization Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
  });

  describe('Subsystem 1: CDP Bridge In-Memory Script Cache & Permission Validation', () => {
    it('1.1: validateScriptPermissions uses in-memory cache and avoids redundant storage disk queries', async () => {
      const server = new CdpBridgeServer({ autoAttach: false, enforcePermissions: true });
      server.init();

      const testScript: ScriptRecord = {
        id: 'opt-cache-script',
        name: 'Optimized Cache Script',
        code: '// ==UserScript==\n// @match https://cached.example.com/*\n// @grant GM_cdp\n// ==/UserScript==',
        metadata: {
          name: 'Optimized Cache Script',
          matches: ['https://cached.example.com/*'],
          matchPatterns: ['https://cached.example.com/*'],
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
      await saveScript(testScript);

      const req: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'req-1',
        scriptId: 'opt-cache-script',
        method: 'DOM.getDocument'
      };

      // Spy on chrome.storage.local.get
      const storageGetSpy = vi.spyOn(context.localStorage, 'get');

      // First call warms up or queries
      const err1 = await server.validateScriptPermissions(req, {
        tab: { id: 10, url: 'https://cached.example.com/test' }
      } as any);
      expect(err1).toBeNull();

      storageGetSpy.mockClear();

      // Subsequent 100 calls must all resolve from in-memory cache with ZERO storage reads
      for (let i = 0; i < 100; i++) {
        const err = await server.validateScriptPermissions(req, {
          tab: { id: 10, url: 'https://cached.example.com/test' }
        } as any);
        expect(err).toBeNull();
      }

      expect(storageGetSpy).not.toHaveBeenCalled();
      server.destroy();
    });

    it('1.2: script cache dynamically invalidates on storage modification via onScriptsChanged', async () => {
      const server = new CdpBridgeServer({ autoAttach: false, enforcePermissions: true });
      server.init();

      const testScript: ScriptRecord = {
        id: 'dynamic-script',
        name: 'Dynamic Script',
        code: '',
        metadata: {
          name: 'Dynamic Script',
          matches: ['https://dyn.example.com/*'],
          matchPatterns: ['https://dyn.example.com/*'],
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
      await saveScript(testScript);

      const req: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'req-dyn-1',
        scriptId: 'dynamic-script',
        method: 'Network.enable'
      };

      const errAllowed = await server.validateScriptPermissions(req, {
        tab: { id: 10, url: 'https://dyn.example.com/' }
      } as any);
      expect(errAllowed).toBeNull();

      // Now disable the script in storage
      testScript.enabled = false;
      await saveScript(testScript);

      // In-memory cache must now reflect disabled status immediately
      const errDisabled = await server.validateScriptPermissions(req, {
        tab: { id: 10, url: 'https://dyn.example.com/' }
      } as any);
      expect(errDisabled).not.toBeNull();
      expect((errDisabled?.data as any)?.reason).toBe('SCRIPT_DISABLED');

      server.destroy();
    });
  });

  describe('Subsystem 2: CDP tabRequests Map Key Pruning & Deallocation', () => {
    it('2.1: tabRequests map key is deleted when all requests for a tab complete', async () => {
      const server = new CdpBridgeServer({ autoAttach: false });
      server.init();

      context.mockDebugger.sendCommand.mockResolvedValue({ success: true });

      const tabId = 77;
      const resPromise = server.executeCommand(tabId, 'Page.enable', {}, 'req-77-1');

      // In-flight: tabRequests must have entry for tab 77
      expect((server as any).tabRequests.has(tabId)).toBe(true);
      expect((server as any).tabRequests.get(tabId).size).toBe(1);

      await resPromise;

      // Completed: tabRequests must have completely deleted the tabId key
      expect((server as any).tabRequests.has(tabId)).toBe(false);
      expect((server as any).tabRequests.get(tabId)).toBeUndefined();

      server.destroy();
    });

    it('2.2: tabRequests map key is pruned on request timeout', async () => {
      const server = new CdpBridgeServer({ autoAttach: false, timeoutMs: 20 });
      server.init();

      context.mockDebugger.sendCommand.mockImplementation(
        () => new Promise(() => {}) // never resolves
      );

      const tabId = 88;
      const resPromise = server.executeCommand(tabId, 'Page.captureScreenshot', {}, 'req-88-1');

      expect((server as any).tabRequests.has(tabId)).toBe(true);

      const res = await resPromise;
      expect(res.success).toBe(false);
      expect(res.error?.message).toContain('timed out');

      // tabRequests map key must be pruned
      expect((server as any).tabRequests.has(tabId)).toBe(false);

      server.destroy();
    });

    it('2.3: markTabDetached prunes tabRequests map key immediately', () => {
      const server = new CdpBridgeServer({ autoAttach: false });
      server.init();

      const tabId = 99;
      (server as any).tabRequests.set(tabId, new Set(['req-orphan']));
      (server as any).attachedTabs.add(tabId);

      server.markTabDetached(tabId);

      expect((server as any).tabRequests.has(tabId)).toBe(false);
      expect((server as any).attachedTabs.has(tabId)).toBe(false);

      server.destroy();
    });
  });

  describe('Subsystem 3: ScriptInjector In-Memory Caching & History Pruning', () => {
    it('3.1: getMatchingScripts uses in-memory cache across multi-frame queries without repeated disk reads', async () => {
      const injector = new ScriptInjector({ autoStart: true });

      const storageGetSpy = vi.spyOn(context.localStorage, 'get');

      // First query loads into cache
      const scriptsFrame0 = await injector.getMatchingScripts('https://httpbin.org/get', 'document-start', 0);
      expect(scriptsFrame0.length).toBeGreaterThanOrEqual(1);

      storageGetSpy.mockClear();

      // Next queries for frame 1, frame 2, and frame 3 must NOT query storage
      await injector.getMatchingScripts('https://httpbin.org/get', 'document-start', 1);
      await injector.getMatchingScripts('https://httpbin.org/get', 'document-end', 2);
      await injector.getMatchingScripts('https://httpbin.org/get', 'document-idle', 3);

      expect(storageGetSpy).not.toHaveBeenCalled();

      injector.destroy();
    });

    it('3.2: settings change via saveSettings immediately updates injector cache', async () => {
      const injector = new ScriptInjector({ autoStart: true });

      const before = await injector.getMatchingScripts('https://httpbin.org/get');
      expect(before.length).toBeGreaterThanOrEqual(1);

      // Disable globally
      await saveSettings({ globalEnabled: false });

      // Cache must immediately reflect globalEnabled: false without restart
      const after = await injector.getMatchingScripts('https://httpbin.org/get');
      expect(after.length).toBe(0);

      injector.destroy();
    });

    it('3.3: clearFrameHistory prunes tabId from injectionHistory when all subframes are cleared', async () => {
      const injector = new ScriptInjector({ autoStart: true });
      const tabId = 200;

      // Populate history for frame 1
      let tabMap = (injector as any).injectionHistory.get(tabId);
      if (!tabMap) {
        tabMap = new Map();
        (injector as any).injectionHistory.set(tabId, tabMap);
      }
      tabMap.set(1, new Set(['script-1:document-start']));

      expect((injector as any).injectionHistory.has(tabId)).toBe(true);

      // Clear frame 1
      injector.clearFrameHistory(tabId, 1);

      // Since frameMap is now empty, tabId must be pruned
      expect((injector as any).injectionHistory.has(tabId)).toBe(false);

      injector.destroy();
    });

    it('3.4: handleTabRemoved purges all history and tracking maps completely', async () => {
      const injector = new ScriptInjector({ autoStart: true });
      const tabId = 300;

      (injector as any).tabUrls.set(tabId, 'https://example.com');
      (injector as any).tabDocumentIds.set(tabId, 'doc-300');
      const frameMap = new Map();
      frameMap.set(0, new Set(['s1:document-start']));
      (injector as any).injectionHistory.set(tabId, frameMap);

      injector.handleTabRemoved(tabId);

      expect((injector as any).injectionHistory.has(tabId)).toBe(false);
      expect((injector as any).tabUrls.has(tabId)).toBe(false);
      expect((injector as any).tabDocumentIds.has(tabId)).toBe(false);

      injector.destroy();
    });
  });

  describe('Subsystem 4: Parallel Declarative CDP Init & Storage Mutex Decoupling', () => {
    it('4.1: executeDeclarativeInit runs multiple domains concurrently via Promise.allSettled', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();

      const multiDomainScript: ScriptRecord = {
        id: 'multi-domain-cdp',
        name: 'Multi Domain CDP',
        code: '',
        metadata: {
          name: 'Multi Domain',
          matches: ['https://parallel.example.com/*'],
          matchPatterns: ['https://parallel.example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} },
            { domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} }
          ],
          cdpDomains: ['Network', 'Page', 'DOM'],
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
      await saveScript(multiDomainScript);

      const dispatchedCommands: string[] = [];
      context.mockDebugger.sendCommand.mockImplementation(async (_target, cmd) => {
        dispatchedCommands.push(cmd);
        return {};
      });

      await manager.executeDeclarativeInit(500, 'https://parallel.example.com/page');

      expect(dispatchedCommands).toContain('Network.enable');
      expect(dispatchedCommands).toContain('Page.enable');
      expect(dispatchedCommands).toContain('DOM.enable');

      const session = (manager as any).sessions.get(500);
      expect(session.activeDomains.has('Network')).toBe(true);
      expect(session.activeDomains.has('Page')).toBe(true);
      expect(session.activeDomains.has('DOM')).toBe(true);

      manager.destroy();
    });

    it('4.2: declarative command failure does not prevent sibling commands from enabling in parallel', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();

      const faultScript: ScriptRecord = {
        id: 'faulty-parallel-cdp',
        name: 'Faulty Parallel CDP',
        code: '',
        metadata: {
          name: 'Faulty Parallel',
          matches: ['https://fault.example.com/*'],
          matchPatterns: ['https://fault.example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'FailingDomain', method: 'enable', command: 'FailingDomain.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} }
          ],
          cdpDomains: ['Network', 'FailingDomain', 'Page'],
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
      await saveScript(faultScript);

      context.mockDebugger.sendCommand.mockImplementation(async (_target, cmd) => {
        if (cmd === 'FailingDomain.enable') {
          throw new Error('Domain not found');
        }
        return {};
      });

      await manager.executeDeclarativeInit(501, 'https://fault.example.com/page');

      const session = (manager as any).sessions.get(501);
      expect(session.activeDomains.has('Network')).toBe(true);
      expect(session.activeDomains.has('Page')).toBe(true);
      expect(session.activeDomains.has('FailingDomain')).toBe(false);

      manager.destroy();
    });

    it('4.3: TabDebuggerManager session persistence does not block userscript storageMutex', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();

      // Hold global storageMutex
      let releaseMutex!: () => void;
      const mutexHeldPromise = new Promise<void>((resolve) => {
        storageMutex.runExclusive(async () => {
          resolve();
          await new Promise<void>((res) => {
            releaseMutex = res;
          });
        });
      });

      await mutexHeldPromise;
      expect(storageMutex.isLocked()).toBe(true);

      // While storageMutex is locked by another thread, attachTab and persistSession must complete without deadlock
      const attachPromise = manager.attachTab(600);

      // Should resolve quickly without waiting for storageMutex
      await expect(attachPromise).resolves.toBeUndefined();

      const session = (manager as any).sessions.get(600);
      expect(session.status).toBe('ATTACHED');

      // Release global mutex
      releaseMutex();
      await new Promise((r) => setTimeout(r, 10));
      expect(storageMutex.isLocked()).toBe(false);

      manager.destroy();
    });
  });

  describe('Subsystem 5: Conflict Manager Reconnect Deduplication', () => {
    it('5.1: reconnectTab in integrated mode executes exactly one lifecycle broadcast and one persist', async () => {
      const debuggerMgr = new TabDebuggerManager();
      const cdpBridge = new CdpBridgeServer({ autoAttach: false });
      const conflictHandler = new DevToolsConflictHandler(cdpBridge, debuggerMgr);

      await debuggerMgr.init();
      cdpBridge.init();
      conflictHandler.init();

      await debuggerMgr.attachTab(700);

      // Simulate DevTools conflict
      context.mockDebugger._emitDetach({ tabId: 700 }, 'canceled_by_user');
      expect(debuggerMgr.getTabStatus(700)).toBe('CONFLICT');

      context.mockTabs.sendMessage.mockClear();
      context.mockRuntime.sendMessage.mockClear();

      context.mockDebugger.attach.mockResolvedValueOnce();

      const res = await conflictHandler.reconnectTab(700);
      expect(res.success).toBe(true);
      expect(debuggerMgr.getTabStatus(700)).toBe('ATTACHED');

      // Exactly ONE lifecycle event for tab 700
      const tabCalls = context.mockTabs.sendMessage.mock.calls.filter(([tabId]) => tabId === 700);
      expect(tabCalls.length).toBe(1);

      conflictHandler.destroy();
      cdpBridge.destroy();
      debuggerMgr.destroy();
    });
  });
});
