import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import {
  saveScript,
  toggleScript,
  deleteScript,
  resetToDefaultScripts
} from '@/shared/storage';
import type { ScriptRecord, CdpRpcRequest } from '@/shared/types';

describe('Empirical Challenger Opt-M2-1 Deep: CdpBridgeServer Caching & TabDebuggerManager Concurrency', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Challenge 1: CdpBridgeServer Script Permission Caching & Immediate Invalidation', () => {
    it('1.1: 500 high-frequency CDP commands across 10 scripts resolve from cache with 0 disk reads', async () => {
      const server = new CdpBridgeServer({ autoAttach: false, enforcePermissions: true });
      server.init();

      // Seed 10 scripts
      for (let s = 1; s <= 10; s++) {
        const script: ScriptRecord = {
          id: `burst-script-${s}`,
          name: `Burst Script ${s}`,
          code: '',
          metadata: {
            name: `Burst Script ${s}`,
            matches: ['https://burst.example.com/*'],
            matchPatterns: ['https://burst.example.com/*'],
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
        await saveScript(script);
      }

      // Warm up each script once
      for (let s = 1; s <= 10; s++) {
        const req: CdpRpcRequest = {
          type: 'CDP_RPC_REQUEST',
          id: `warm-${s}`,
          scriptId: `burst-script-${s}`,
          method: 'Page.enable'
        };
        const err = await server.validateScriptPermissions(req, {
          tab: { id: 10, url: 'https://burst.example.com/app' }
        } as any);
        expect(err).toBeNull();
      }

      // Spy on storage read
      const storageGetSpy = vi.spyOn(context.localStorage, 'get');

      // Dispatch 500 concurrent validation queries
      const queries: Promise<any>[] = [];
      for (let i = 0; i < 500; i++) {
        const scriptIdx = (i % 10) + 1;
        const req: CdpRpcRequest = {
          type: 'CDP_RPC_REQUEST',
          id: `burst-req-${i}`,
          scriptId: `burst-script-${scriptIdx}`,
          method: 'DOM.getDocument'
        };
        queries.push(
          server.validateScriptPermissions(req, {
            tab: { id: 10 + scriptIdx, url: 'https://burst.example.com/app' }
          } as any)
        );
      }

      const results = await Promise.all(queries);
      for (const res of results) {
        expect(res).toBeNull();
      }

      // Must be ZERO storage reads for all 500 cached requests
      expect(storageGetSpy).not.toHaveBeenCalled();

      server.destroy();
    });

    it('1.2: immediate cache invalidation when script @cdp domain permissions are modified', async () => {
      const server = new CdpBridgeServer({ autoAttach: false, enforcePermissions: true });
      server.init();

      const testScript: ScriptRecord = {
        id: 'domain-mod-script',
        name: 'Domain Mod Script',
        code: '',
        metadata: {
          name: 'Domain Mod Script',
          matches: ['https://domain.example.com/*'],
          matchPatterns: ['https://domain.example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [], // No GM_cdp wildcards
          cdp: [],
          cdpDeclarations: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }
          ],
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
      await saveScript(testScript);

      const netReq: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'net-req-1',
        scriptId: 'domain-mod-script',
        method: 'Network.enable'
      };
      const pageReq: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'page-req-1',
        scriptId: 'domain-mod-script',
        method: 'Page.enable'
      };

      const sender = { tab: { id: 20, url: 'https://domain.example.com/' } } as any;

      // 1. Initial: Network allowed, Page denied
      expect(await server.validateScriptPermissions(netReq, sender)).toBeNull();
      const pageErr1 = await server.validateScriptPermissions(pageReq, sender);
      expect((pageErr1?.data as any)?.reason).toBe('DOMAIN_NOT_AUTHORIZED');

      // 2. Modify script: Swap Network for Page
      testScript.metadata!.cdpDomains = ['Page'];
      testScript.metadata!.cdpDeclarations = [
        { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} }
      ];
      await saveScript(testScript);

      // 3. Immediately verify cache reflects swapped domain permissions
      const netErr2 = await server.validateScriptPermissions(netReq, sender);
      expect((netErr2?.data as any)?.reason).toBe('DOMAIN_NOT_AUTHORIZED');
      expect(await server.validateScriptPermissions(pageReq, sender)).toBeNull();

      server.destroy();
    });

    it('1.3: immediate cache invalidation when script enabled state is toggled via toggleScript()', async () => {
      const server = new CdpBridgeServer({ autoAttach: false, enforcePermissions: true });
      server.init();

      const toggleScriptRecord: ScriptRecord = {
        id: 'toggle-test-script',
        name: 'Toggle Test Script',
        code: '',
        metadata: {
          name: 'Toggle Test Script',
          matches: ['https://toggle.example.com/*'],
          matchPatterns: ['https://toggle.example.com/*'],
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
      await saveScript(toggleScriptRecord);

      const req: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'toggle-req-1',
        scriptId: 'toggle-test-script',
        method: 'Runtime.evaluate'
      };
      const sender = { tab: { id: 30, url: 'https://toggle.example.com/' } } as any;

      // Initially enabled
      expect(await server.validateScriptPermissions(req, sender)).toBeNull();

      // Toggle to false
      await toggleScript('toggle-test-script', false);

      // Immediate query must fail with SCRIPT_DISABLED
      const errDisabled = await server.validateScriptPermissions(req, sender);
      expect((errDisabled?.data as any)?.reason).toBe('SCRIPT_DISABLED');

      // Toggle back to true
      await toggleScript('toggle-test-script', true);

      // Immediate query must succeed
      expect(await server.validateScriptPermissions(req, sender)).toBeNull();

      server.destroy();
    });

    it('1.4: immediate cache invalidation when script is deleted via deleteScript()', async () => {
      const server = new CdpBridgeServer({ autoAttach: false, enforcePermissions: true });
      server.init();

      const delScript: ScriptRecord = {
        id: 'delete-target-script',
        name: 'Delete Target Script',
        code: '',
        metadata: {
          name: 'Delete Target Script',
          matches: ['https://delete.example.com/*'],
          matchPatterns: ['https://delete.example.com/*'],
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
      await saveScript(delScript);

      const req: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'del-req-1',
        scriptId: 'delete-target-script',
        method: 'DOM.getDocument'
      };
      const sender = { tab: { id: 40, url: 'https://delete.example.com/' } } as any;

      expect(await server.validateScriptPermissions(req, sender)).toBeNull();

      // Delete from storage
      await deleteScript('delete-target-script');

      // Next query must immediately fail with SCRIPT_NOT_FOUND
      const errDeleted = await server.validateScriptPermissions(req, sender);
      expect((errDeleted?.data as any)?.reason).toBe('SCRIPT_NOT_FOUND');

      server.destroy();
    });

    it('1.5: immediate cache invalidation when match patterns change', async () => {
      const server = new CdpBridgeServer({ autoAttach: false, enforcePermissions: true });
      server.init();

      const urlScript: ScriptRecord = {
        id: 'url-match-script',
        name: 'URL Match Script',
        code: '',
        metadata: {
          name: 'URL Match Script',
          matches: ['https://app-a.com/*'],
          matchPatterns: ['https://app-a.com/*'],
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
      await saveScript(urlScript);

      const req: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'url-req-1',
        scriptId: 'url-match-script',
        method: 'DOM.getDocument'
      };

      const senderA = { tab: { id: 50, url: 'https://app-a.com/page' } } as any;
      const senderB = { tab: { id: 51, url: 'https://app-b.com/page' } } as any;

      // On site A: allowed. On site B: denied.
      expect(await server.validateScriptPermissions(req, senderA)).toBeNull();
      const errB1 = await server.validateScriptPermissions(req, senderB);
      expect((errB1?.data as any)?.reason).toBe('URL_NOT_MATCHED');

      // Update script matches to site B
      urlScript.metadata!.matches = ['https://app-b.com/*'];
      urlScript.metadata!.matchPatterns = ['https://app-b.com/*'];
      await saveScript(urlScript);

      // Now site A is denied, site B is allowed
      const errA2 = await server.validateScriptPermissions(req, senderA);
      expect((errA2?.data as any)?.reason).toBe('URL_NOT_MATCHED');
      expect(await server.validateScriptPermissions(req, senderB)).toBeNull();

      server.destroy();
    });

    it('1.6: immediate cache invalidation when @grant is downgraded to @grant none', async () => {
      const server = new CdpBridgeServer({ autoAttach: false, enforcePermissions: true });
      server.init();

      const grantScript: ScriptRecord = {
        id: 'grant-downgrade-script',
        name: 'Grant Downgrade Script',
        code: '',
        metadata: {
          name: 'Grant Downgrade Script',
          matches: ['https://grant.example.com/*'],
          matchPatterns: ['https://grant.example.com/*'],
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
      await saveScript(grantScript);

      const req: CdpRpcRequest = {
        type: 'CDP_RPC_REQUEST',
        id: 'grant-req-1',
        scriptId: 'grant-downgrade-script',
        method: 'Network.enable'
      };
      const sender = { tab: { id: 60, url: 'https://grant.example.com/' } } as any;

      expect(await server.validateScriptPermissions(req, sender)).toBeNull();

      // Downgrade to @grant none
      grantScript.metadata!.grants = ['none'];
      await saveScript(grantScript);

      const errNone = await server.validateScriptPermissions(req, sender);
      expect((errNone?.data as any)?.reason).toBe('GRANT_NONE');

      server.destroy();
    });

    it('1.7: interleaved high-frequency commands racing against continuous script updates', async () => {
      const server = new CdpBridgeServer({ autoAttach: false, enforcePermissions: true });
      server.init();

      const raceScript: ScriptRecord = {
        id: 'race-script',
        name: 'Race Script',
        code: '',
        metadata: {
          name: 'Race Script',
          matches: ['https://race.example.com/*'],
          matchPatterns: ['https://race.example.com/*'],
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
      await saveScript(raceScript);

      const sender = { tab: { id: 70, url: 'https://race.example.com/test' } } as any;

      // Launch 50 command validations concurrently while alternating enabled state
      const tasks: Promise<any>[] = [];
      for (let i = 0; i < 50; i++) {
        if (i % 5 === 0) {
          tasks.push(toggleScript('race-script', i % 10 === 0));
        }
        tasks.push(
          server.validateScriptPermissions(
            {
              type: 'CDP_RPC_REQUEST',
              id: `race-req-${i}`,
              scriptId: 'race-script',
              method: 'Page.enable'
            },
            sender
          )
        );
      }

      const results = await Promise.all(tasks);
      // Ensure all operations settled without unhandled exceptions
      expect(results.length).toBeGreaterThanOrEqual(50);

      server.destroy();
    });

    it('1.8: tabRequests map completely purges entries on command success, error, timeout, and tab detach', async () => {
      const server = new CdpBridgeServer({ autoAttach: false, timeoutMs: 30 });
      server.init();

      const tabRequestsMap = (server as any).tabRequests as Map<number, Set<string>>;

      // 1. Success case: executeCommand resolves
      context.mockDebugger.sendCommand.mockResolvedValueOnce({ ok: true });
      const p1 = server.executeCommand(101, 'Page.enable', {}, 'req-101');
      expect(tabRequestsMap.has(101)).toBe(true);
      await p1;
      expect(tabRequestsMap.has(101)).toBe(false);

      // 2. Failure case: sendCommand rejects
      context.mockDebugger.sendCommand.mockRejectedValueOnce(new Error('CDP target crashed'));
      const p2 = server.executeCommand(102, 'Page.enable', {}, 'req-102');
      expect(tabRequestsMap.has(102)).toBe(true);
      await p2;
      expect(tabRequestsMap.has(102)).toBe(false);

      // 3. Timeout case: command hangs
      context.mockDebugger.sendCommand.mockImplementationOnce(() => new Promise(() => {}));
      const p3 = server.executeCommand(103, 'Page.enable', {}, 'req-103');
      expect(tabRequestsMap.has(103)).toBe(true);
      await p3;
      expect(tabRequestsMap.has(103)).toBe(false);

      // 4. Detach case: markTabDetached cleans up immediately
      tabRequestsMap.set(104, new Set(['req-orphan']));
      server.markTabDetached(104);
      expect(tabRequestsMap.has(104)).toBe(false);

      server.destroy();
    });
  });

  describe('Challenge 2: TabDebuggerManager Parallel Declarative Domain Initialization Races', () => {
    it('2.1: executes 5 declarative domains in parallel and adds all to activeDomains', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();

      const script: ScriptRecord = {
        id: 'five-domain-script',
        name: 'Five Domain Script',
        code: '',
        metadata: {
          name: 'Five Domain',
          matches: ['https://five.example.com/*'],
          matchPatterns: ['https://five.example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} },
            { domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} },
            { domain: 'Runtime', method: 'enable', command: 'Runtime.enable', params: {} },
            { domain: 'CSS', method: 'enable', command: 'CSS.enable', params: {} }
          ],
          cdpDomains: ['Network', 'Page', 'DOM', 'Runtime', 'CSS'],
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

      const dispatched: string[] = [];
      context.mockDebugger.sendCommand.mockImplementation(async (_target, cmd) => {
        dispatched.push(cmd);
        return {};
      });

      await manager.executeDeclarativeInit(201, 'https://five.example.com/page');

      expect(dispatched).toHaveLength(5);
      expect(dispatched).toEqual(
        expect.arrayContaining([
          'Network.enable',
          'Page.enable',
          'DOM.enable',
          'Runtime.enable',
          'CSS.enable'
        ])
      );

      const session = manager.getSession(201);
      expect(session).toBeDefined();
      expect(session?.status).toBe('ATTACHED');
      expect(session?.activeDomains).toEqual(
        expect.arrayContaining(['Network', 'Page', 'DOM', 'Runtime', 'CSS'])
      );

      manager.destroy();
    });

    it('2.2: rapid detachTab race while parallel declarative commands are in-flight', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();

      const script: ScriptRecord = {
        id: 'race-detach-script',
        name: 'Race Detach Script',
        code: '',
        metadata: {
          name: 'Race Detach',
          matches: ['https://detach-race.example.com/*'],
          matchPatterns: ['https://detach-race.example.com/*'],
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
      await saveScript(script);

      // Simulate a 15ms latency on sendCommand
      context.mockDebugger.sendCommand.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 15))
      );

      const initPromise = manager.executeDeclarativeInit(202, 'https://detach-race.example.com/page');

      // Wait 5ms so attach finishes and commands enter in-flight state
      await new Promise((r) => setTimeout(r, 5));

      // Detach immediately while commands are pending
      const detachPromise = manager.detachTab(202);

      await Promise.all([initPromise, detachPromise]);

      const session = manager.getSession(202);
      expect(session).toBeDefined();
      expect(session?.status).toBe('DETACHED');
      expect(session?.attached).toBe(false);
      // activeDomains MUST NOT have retained domains from the in-flight commands
      expect(session?.activeDomains.length).toBe(0);

      manager.destroy();
    });

    it('2.3: native DevTools conflict race (canceled_by_user) during declarative commands', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();

      const script: ScriptRecord = {
        id: 'devtools-conflict-script',
        name: 'DevTools Conflict Script',
        code: '',
        metadata: {
          name: 'Conflict Script',
          matches: ['https://conflict-race.example.com/*'],
          matchPatterns: ['https://conflict-race.example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [],
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

      context.mockDebugger.sendCommand.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 15))
      );

      const initPromise = manager.executeDeclarativeInit(203, 'https://conflict-race.example.com/page');

      // Wait 5ms, then simulate external DevTools opening
      await new Promise((r) => setTimeout(r, 5));
      context.mockDebugger._emitDetach({ tabId: 203 }, 'canceled_by_user');

      await initPromise;

      const session = manager.getSession(203);
      expect(session).toBeDefined();
      expect(session?.status).toBe('CONFLICT');
      expect(session?.conflictDetected).toBe(true);
      expect(session?.conflictReason).toBe('canceled_by_user');

      manager.destroy();
    });

    it('2.4: tab closed (handleTabRemoved) while declarative commands are pending', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();

      const script: ScriptRecord = {
        id: 'tab-close-script',
        name: 'Tab Close Script',
        code: '',
        metadata: {
          name: 'Close Script',
          matches: ['https://close-race.example.com/*'],
          matchPatterns: ['https://close-race.example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [],
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

      context.mockDebugger.sendCommand.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 15))
      );

      const initPromise = manager.executeDeclarativeInit(204, 'https://close-race.example.com/page');

      await new Promise((r) => setTimeout(r, 5));

      // Tab closed while commands are running
      await manager.handleTabRemoved(204);

      await initPromise;

      // Session must be completely deleted from manager
      expect(manager.getSession(204)).toBeUndefined();
      expect(manager.getTabStatus(204)).toBe('IDLE');

      manager.destroy();
    });

    it('2.5: multiple concurrent executeDeclarativeInit calls on the same tab execute safely', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();

      const script: ScriptRecord = {
        id: 'concurrent-init-script',
        name: 'Concurrent Init Script',
        code: '',
        metadata: {
          name: 'Concurrent Init',
          matches: ['https://concurrent.example.com/*'],
          matchPatterns: ['https://concurrent.example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [],
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

      // Invoke 5 times concurrently
      await Promise.all([
        manager.executeDeclarativeInit(205, 'https://concurrent.example.com/page'),
        manager.executeDeclarativeInit(205, 'https://concurrent.example.com/page'),
        manager.executeDeclarativeInit(205, 'https://concurrent.example.com/page'),
        manager.executeDeclarativeInit(205, 'https://concurrent.example.com/page'),
        manager.executeDeclarativeInit(205, 'https://concurrent.example.com/page')
      ]);

      const session = manager.getSession(205);
      expect(session?.status).toBe('ATTACHED');
      expect(session?.activeDomains).toContain('Network');
      expect(session?.activeDomains).toContain('Page');

      manager.destroy();
    });

    it('2.6: 10 rapid attach -> declarative init -> detach cycles do not deadlock', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();

      const script: ScriptRecord = {
        id: 'cycle-script',
        name: 'Cycle Script',
        code: '',
        metadata: {
          name: 'Cycle Script',
          matches: ['https://cycle.example.com/*'],
          matchPatterns: ['https://cycle.example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [
            { domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} }
          ],
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
      await saveScript(script);

      for (let i = 0; i < 10; i++) {
        await manager.executeDeclarativeInit(206, 'https://cycle.example.com/');
        expect(manager.getTabStatus(206)).toBe('ATTACHED');
        await manager.detachTab(206);
        expect(manager.getTabStatus(206)).toBe('DETACHED');
      }

      const internalSession = (manager as any).sessions.get(206);
      expect(internalSession.operationLock).toBeNull();
      expect(internalSession.status).toBe('DETACHED');

      manager.destroy();
    });

    it('2.7: partial failure in declarative commands enables valid domains and logs errors without throwing', async () => {
      const manager = new TabDebuggerManager();
      await manager.init();

      const partialScript: ScriptRecord = {
        id: 'partial-fail-script',
        name: 'Partial Fail Script',
        code: '',
        metadata: {
          name: 'Partial Fail Script',
          matches: ['https://partial.example.com/*'],
          matchPatterns: ['https://partial.example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_cdp'],
          cdp: [],
          cdpDeclarations: [
            { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
            { domain: 'BrokenDomain', method: 'enable', command: 'BrokenDomain.enable', params: {} },
            { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} }
          ],
          cdpDomains: ['Network', 'BrokenDomain', 'Page'],
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
      await saveScript(partialScript);

      context.mockDebugger.sendCommand.mockImplementation(async (_target, cmd) => {
        if (cmd === 'BrokenDomain.enable') {
          throw new Error('Unknown domain: BrokenDomain');
        }
        return {};
      });

      // Must NOT throw
      await expect(
        manager.executeDeclarativeInit(207, 'https://partial.example.com/')
      ).resolves.toBeUndefined();

      const session = manager.getSession(207);
      expect(session?.activeDomains).toContain('Network');
      expect(session?.activeDomains).toContain('Page');
      expect(session?.activeDomains).not.toContain('BrokenDomain');

      manager.destroy();
    });
  });
});
