import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { saveScript } from '@/shared/storage';
import { DevToolsConflictError } from '@/shared/types';
import type { ScriptRecord } from '@/shared/types';

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
});
