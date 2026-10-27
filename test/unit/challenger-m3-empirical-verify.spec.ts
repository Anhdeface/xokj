/**
 * Empirical Verification & Adversarial Stress Suite for Milestone 3
 * Location: test/unit/challenger-m3-empirical-verify.spec.ts
 *
 * Verifies:
 * 1. SW wake-up rehydration & target synchronization without false DevToolsConflictError.
 * 2. Content script bridge anti-spoofing security (channelId & source verification).
 * 3. Page runner window.postMessage origin confinement.
 * 4. ContentScriptBridge double-settlement guard & EXECUTE_USERSCRIPT fallback.
 * 5. Deterministic script ordering in StageScheduler.
 * 6. SPA route change injection in ScriptInjector.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import { ContentScriptBridge } from '@/content/bridge';
import { verifySenderSource, verifyChannelId } from '@/content/bridge/validator';
import { saveTabSession, getTabSessions, saveSettings, getScriptList } from '@/shared/storage';
import { DevToolsConflictError } from '@/shared/types';
import type { ScriptRecord } from '@/shared/types';
import { StageScheduler } from '@/background/injector/stage-scheduler';
import { ScriptInjector } from '@/background/injector';
import { pageSandboxRunner } from '@/background/injector/page-runner';

describe('Challenger M3: Empirical Verification & Adversarial Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;

  beforeEach(async () => {
    context = setupChromeMock();
    await getScriptList();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Objective 1: Service Worker Wake-up Rehydration & Target Synchronization', () => {
    it('1.1: Rehydrates persisted ATTACHED session on SW startup and attaches without false DevToolsConflictError', async () => {
      const tabId = 101;

      // 1. Pre-seed tab session into persistent storage as if prior SW was alive
      await saveTabSession({
        tabId,
        status: 'ATTACHED',
        attached: true,
        targetUrl: 'https://example.com/app',
        activeDomains: ['Page', 'Runtime'],
        attachedAt: Date.now() - 5000,
        updatedAt: Date.now() - 5000
      } as any);

      // Verify it was correctly persisted
      const stored = await getTabSessions();
      expect(stored[tabId]).toBeDefined();
      expect(stored[tabId].status).toBe('ATTACHED');

      // 2. Mock chrome.debugger.getTargets() reporting this tab is already attached in Chrome
      context.mockDebugger.getTargets.mockResolvedValue([
        {
          id: String(tabId),
          tabId,
          type: 'page',
          title: 'Example Page',
          url: 'https://example.com/app',
          attached: true
        } as any
      ]);

      // 3. New Service Worker wakes up: instantiates and initializes TabDebuggerManager
      const freshManager = new TabDebuggerManager();
      await freshManager.init();

      // State check: Session should be rehydrated and synchronized as ATTACHED
      expect(freshManager.getTabStatus(tabId)).toBe('ATTACHED');
      expect(freshManager.isAttached(tabId)).toBe(true);

      // 4. Userscript / caller invokes attachTab(tabId)
      // Must NOT call chrome.debugger.attach and must NOT throw DevToolsConflictError
      context.mockDebugger.attach.mockClear();

      const session = await freshManager.attachTab(tabId, {});

      expect(context.mockDebugger.attach).not.toHaveBeenCalled();
      expect(freshManager.getTabStatus(tabId)).toBe('ATTACHED');
      expect(session).toBeDefined();
      expect(session.attached).toBe(true);

      freshManager.destroy();
    });

    it('1.2: Automatically discovers targets already attached in Chrome even if unpersisted in storage', async () => {
      const tabId = 202;

      // Ensure storage is empty
      const sessions = await getTabSessions();
      expect(sessions[tabId]).toBeUndefined();

      // Chrome has this tab attached externally
      context.mockDebugger.getTargets.mockResolvedValue([
        {
          id: String(tabId),
          tabId,
          type: 'page',
          title: 'Attached Elsewhere',
          url: 'https://dashboard.service.com',
          attached: true
        } as any
      ]);

      const manager = new TabDebuggerManager();
      await manager.init();

      // Reconcile targets should have created the session and marked it ATTACHED
      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');
      expect(manager.isAttached(tabId)).toBe(true);

      // Subsequent attachTab does not throw and does not re-attach
      context.mockDebugger.attach.mockClear();
      const session = await manager.attachTab(tabId, {});
      expect(context.mockDebugger.attach).not.toHaveBeenCalled();
      expect(session.status).toBe('ATTACHED');

      manager.destroy();
    });

    it('1.3: Reconciles target detachment: if Chrome detached the tab while SW slept, tab is not attached and re-attaches cleanly', async () => {
      const tabId = 303;

      // Persisted as ATTACHED
      await saveTabSession({
        tabId,
        status: 'ATTACHED',
        attached: true,
        targetUrl: 'https://unmatched-no-cdp.org',
        activeDomains: [],
        attachedAt: Date.now() - 10000,
        updatedAt: Date.now() - 10000
      } as any);

      // But Chrome targets list shows target is NOT attached (or absent)
      context.mockDebugger.getTargets.mockResolvedValue([
        {
          id: String(tabId),
          tabId,
          type: 'page',
          title: 'Unmatched Page',
          url: 'https://unmatched-no-cdp.org',
          attached: false
        } as any
      ]);

      const manager = new TabDebuggerManager();
      await manager.init();

      // Should reconcile to DETACHED
      expect(manager.getTabStatus(tabId)).toBe('DETACHED');
      expect(manager.isAttached(tabId)).toBe(false);

      // Now explicit attachTab should invoke chrome.debugger.attach
      context.mockDebugger.attach.mockClear();
      await manager.attachTab(tabId);
      expect(context.mockDebugger.attach).toHaveBeenCalledWith({ tabId }, '1.3');
      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');

      manager.destroy();
    });

    it('1.4: Real DevTools conflict still correctly throws DevToolsConflictError', async () => {
      const tabId = 404;

      context.mockDebugger.getTargets.mockResolvedValue([]);
      context.mockDebugger.attach.mockRejectedValue(
        new Error('Another debugger is already attached to the tab with id: 404.')
      );

      const manager = new TabDebuggerManager();
      await manager.init();

      await expect(manager.attachTab(tabId)).rejects.toThrow(DevToolsConflictError);
      expect(manager.getTabStatus(tabId)).toBe('CONFLICT');

      manager.destroy();
    });
  });

  describe('Objective 2: Content Script Bridge Anti-Spoofing & Channel Security', () => {
    it('2.1: validator.verifySenderSource rejects missing or invalid source when allowUnspecified is false', () => {
      // Production mode: allowUnspecified = false
      expect(verifySenderSource(undefined, false)).toBe(false);
      expect(verifySenderSource(null, false)).toBe(false);
      expect(verifySenderSource('', false)).toBe(false);
      expect(verifySenderSource('evil-userscript', false)).toBe(false);
      expect(verifySenderSource('xokj-userscript', false)).toBe(true);

      // Test mode compatibility: allowUnspecified = true
      expect(verifySenderSource(undefined, true)).toBe(true);
      expect(verifySenderSource(null, true)).toBe(true);
      expect(verifySenderSource('xokj-userscript', true)).toBe(true);
      expect(verifySenderSource('evil-userscript', true)).toBe(false);
    });

    it('2.2: validator.verifyChannelId enforces token when requireChannelId is true', () => {
      const expectedToken = 'token-uuid-1234';

      // Required: must match
      expect(verifyChannelId(expectedToken, expectedToken, true)).toBe(true);
      expect(verifyChannelId('wrong-token', expectedToken, true)).toBe(false);
      expect(verifyChannelId(undefined, expectedToken, true)).toBe(false);
      expect(verifyChannelId(null, expectedToken, true)).toBe(false);

      // Not required:
      expect(verifyChannelId(undefined, expectedToken, false)).toBe(true);
      expect(verifyChannelId('wrong-token', expectedToken, false)).toBe(false);
    });

    it('2.3: Rejects forged webpage postMessage lacking channelId or correct source in production mode', async () => {
      const postedToWindow: any[] = [];
      vi.stubGlobal('postMessage', (msg: any) => {
        postedToWindow.push(msg);
      });

      // Emulate production bridge instance (requireChannelId defaults to true, verifySenderSource rejects missing source)
      const secretChannelId = 'secure-auth-token-prod-xyz';
      const bridge = new ContentScriptBridge({
        channelId: secretChannelId,
        requireChannelId: true,
        autoStart: true
      });

      // Attack 1: Page script sends request with NO source and NO channelId
      await bridge.handlePageMessage({
        source: window,
        origin: window.location.origin,
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'attack-1',
          method: 'Page.navigate',
          params: { url: 'https://evil.com' }
        }
      } as any);

      // Attack 2: Page script sends request with forged source but NO channelId
      await bridge.handlePageMessage({
        source: window,
        origin: window.location.origin,
        data: {
          source: 'xokj-userscript',
          type: 'CDP_RPC_REQUEST',
          id: 'attack-2',
          method: 'Page.navigate',
          params: { url: 'https://evil.com' }
        }
      } as any);

      // Attack 3: Page script sends request with WRONG channelId
      await bridge.handlePageMessage({
        source: window,
        origin: window.location.origin,
        data: {
          source: 'xokj-userscript',
          channelId: 'attacker-guessed-token',
          type: 'CDP_RPC_REQUEST',
          id: 'attack-3',
          method: 'Page.navigate',
          params: { url: 'https://evil.com' }
        }
      } as any);

      // Attack 4: Page script sends GM storage mutation with NO channelId
      await bridge.handlePageMessage({
        source: window,
        origin: window.location.origin,
        data: {
          source: 'xokj-userscript',
          type: 'GM_STORAGE_SET',
          scriptId: 'target-script',
          key: 'session_token',
          value: 'stolen'
        }
      } as any);

      // All attacks must be dropped cleanly without reaching runtime.sendMessage
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

      // Legitimate userscript with source AND matching channelId:
      context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
        const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true, result: {} };
        cb?.(res);
        return res;
      });

      await bridge.handlePageMessage({
        source: window,
        origin: window.location.origin,
        data: {
          source: 'xokj-userscript',
          channelId: secretChannelId,
          type: 'CDP_RPC_REQUEST',
          id: 'legit-req-1',
          method: 'Page.enable',
          params: {}
        }
      } as any);

      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CDP_RPC_REQUEST',
          id: 'legit-req-1',
          method: 'Page.enable'
        }),
        expect.any(Function)
      );

      bridge.destroy();
    });
  });

  describe('Objective 3 & 4: Subsystem Robustness & Architecture Requirements', () => {
    it('3.1: ContentScriptBridge forwardToServiceWorker guards against double settlement', async () => {
      const bridge = new ContentScriptBridge({ autoStart: true });

      let callbackRef: any;
      context.mockRuntime.sendMessage.mockImplementation((req: any, cb: any) => {
        callbackRef = cb;
        // Return a promise that resolves
        return Promise.resolve({ type: 'CDP_RPC_RESPONSE', id: req.id, success: true });
      });

      const forwardPromise = (bridge as any).forwardToServiceWorker({
        type: 'CDP_RPC_REQUEST',
        id: 'test-double-settle',
        method: 'DOM.getDocument'
      });

      // Call callback immediately as well
      callbackRef?.({ type: 'CDP_RPC_RESPONSE', id: 'test-double-settle', success: true });

      const result = await forwardPromise;
      expect(result.success).toBe(true);

      bridge.destroy();
    });

    it('3.2: ContentScriptBridge handles EXECUTE_USERSCRIPT runtime message via sandbox runner', async () => {
      const bridge = new ContentScriptBridge({ autoStart: true });

      const mockScript: ScriptRecord = {
        id: 'script-fallback-1',
        name: 'Fallback Script',
        code: 'console.log("fallback loaded");',
        enabled: true,
        metadata: {
          name: 'Fallback Script',
          matches: ['*://*/*'],
          runAt: 'document-end'
        } as any,
        createdAt: 1000,
        updatedAt: 1000
      };

      const sendResponse = vi.fn();
      const handled = (bridge as any).handleRuntimeMessage(
        {
          type: 'EXECUTE_USERSCRIPT',
          script: mockScript,
          runAt: 'document-idle'
        },
        {},
        sendResponse
      );

      expect(handled).toBe(true);
      expect(sendResponse).toHaveBeenCalledWith({ acknowledged: true, success: true });

      bridge.destroy();
    });

    it('3.3: StageScheduler orders matching scripts deterministically by createdAt, name, id', async () => {
      const scheduler = new (StageScheduler as any)();

      const script1: ScriptRecord = {
        id: 'id-c',
        name: 'Beta Script',
        code: '',
        enabled: true,
        metadata: { name: 'Beta Script', matches: ['https://example.com/*'], runAt: 'document-idle' } as any,
        createdAt: 200,
        updatedAt: 200
      };

      const script2: ScriptRecord = {
        id: 'id-a',
        name: 'Alpha Script',
        code: '',
        enabled: true,
        metadata: { name: 'Alpha Script', matches: ['https://example.com/*'], runAt: 'document-idle' } as any,
        createdAt: 100,
        updatedAt: 100
      };

      const script3: ScriptRecord = {
        id: 'id-b',
        name: 'Alpha Script 2',
        code: '',
        enabled: true,
        metadata: { name: 'Alpha Script 2', matches: ['https://example.com/*'], runAt: 'document-idle' } as any,
        createdAt: 200,
        updatedAt: 200
      };

      (scheduler as any).cachedScripts = [script1, script2, script3];

      const matched = await scheduler.getMatchingScripts('https://example.com/test', 'document-idle');

      // Expected order:
      // 1. script2 (createdAt: 100)
      // 2. script3 (createdAt: 200, name: 'Alpha Script 2')
      // 3. script1 (createdAt: 200, name: 'Beta Script')
      expect(matched.map((s: any) => s.id)).toEqual(['id-a', 'id-b', 'id-c']);
    });

    it('3.4: ScriptInjector triggers document-idle injection upon SPA URL update', async () => {
      const debuggerMgr = new TabDebuggerManager();
      const injector = new ScriptInjector({ debuggerManager: debuggerMgr });

      const processStageSpy = vi.spyOn(injector as any, 'processStage').mockResolvedValue(undefined);

      // Initial tab load
      (injector as any).guard.tabUrls.set(42, 'https://spa.com/home');

      // SPA in-page navigation: URL changes without status complete
      await (injector as any).handleTabsUpdated(42, {
        url: 'https://spa.com/dashboard',
        status: 'loading'
      });

      expect(processStageSpy).toHaveBeenCalledWith(42, 0, 'https://spa.com/dashboard', 'document-idle');

      debuggerMgr.destroy();
    });
  });

  describe('Adversarial Stress Suite: Origin Confinement, Burst Spoofing & High-Concurrency Rehydration', () => {
    it('4.1: pageSandboxRunner confines postMessage targetOrigin strictly to window.location.origin', () => {
      const postedCalls: Array<{ payload: any; targetOrigin: string }> = [];
      const origPostMessage = window.postMessage;

      vi.stubGlobal('postMessage', (payload: any, targetOrigin: string) => {
        postedCalls.push({ payload, targetOrigin });
      });

      // Test Case A: Valid web origin (e.g. https://my-bank.com)
      delete (window as any).location;
      (window as any).location = { origin: 'https://my-bank.com', href: 'https://my-bank.com/account' };

      pageSandboxRunner(
        `GM_setValue('secretKey', 'superSecretToken123');`,
        'Bank Security Script',
        'script-bank-1',
        { grants: ['GM_setValue'] },
        'channel-bank-token-999'
      );

      expect(postedCalls.length).toBeGreaterThan(0);
      expect(postedCalls[0].targetOrigin).toBe('https://my-bank.com');
      expect(postedCalls[0].targetOrigin).not.toBe('*');
      expect(postedCalls[0].payload.channelId).toBe('channel-bank-token-999');

      postedCalls.length = 0;

      // Test Case B: Sandboxed or null origin (e.g. data: URI or sandboxed iframe)
      (window as any).location = { origin: 'null', href: 'about:blank' };

      pageSandboxRunner(
        `GM_setValue('counter', 42);`,
        'Sandboxed Script',
        'script-sandbox-1',
        { grants: ['GM_setValue'] },
        'channel-null-token'
      );

      expect(postedCalls.length).toBeGreaterThan(0);
      expect(postedCalls[0].targetOrigin).toBe('*');

      window.postMessage = origPostMessage;
    });

    it('4.2: ContentScriptBridge burst spoofing resilience: 100 malformed/spoofed messages interleaved with 10 authentic messages', async () => {
      const channelId = 'authentic-channel-token-42';
      const bridge = new ContentScriptBridge({
        channelId,
        requireChannelId: true,
        autoStart: true
      });

      const processedIds: string[] = [];
      context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
        processedIds.push(req.id);
        const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true };
        cb?.(res);
        return res;
      });

      const promises: Promise<void>[] = [];

      // Interleave 10 authentic messages with 100 hostile/malformed messages
      for (let i = 0; i < 110; i++) {
        if (i % 11 === 0) {
          // Authentic message
          promises.push(
            bridge.handlePageMessage({
              source: window,
              origin: window.location.origin,
              data: {
                source: 'xokj-userscript',
                channelId,
                type: 'CDP_RPC_REQUEST',
                id: `auth-${i}`,
                method: 'Runtime.evaluate',
                params: { expression: '1 + 1' }
              }
            } as any)
          );
        } else {
          // Adversarial attack variations:
          const attackType = i % 5;
          let maliciousData: any;

          switch (attackType) {
            case 0:
              // Prototype pollution attempt
              maliciousData = {
                __proto__: { isAdmin: true },
                type: 'CDP_RPC_REQUEST',
                id: `evil-proto-${i}`,
                method: 'Page.navigate'
              };
              break;
            case 1:
              // Missing channelId with spoofed source
              maliciousData = {
                source: 'xokj-userscript',
                type: 'CDP_RPC_REQUEST',
                id: `evil-no-token-${i}`,
                method: 'DOM.getDocument'
              };
              break;
            case 2:
              // Forged channelId
              maliciousData = {
                source: 'xokj-userscript',
                channelId: `guessed-token-${i}`,
                type: 'CDP_RPC_REQUEST',
                id: `evil-fake-token-${i}`,
                method: 'Network.enable'
              };
              break;
            case 3:
              // Non-string method or corrupt structure
              maliciousData = {
                source: 'xokj-userscript',
                channelId,
                type: 'CDP_RPC_REQUEST',
                id: `evil-bad-method-${i}`,
                method: 12345 as any
              };
              break;
            case 4:
              // Malicious storage mutation attempt without valid token
              maliciousData = {
                source: 'xokj-userscript',
                channelId: 'attacker-token',
                type: 'GM_STORAGE_SET',
                scriptId: 'victim-script',
                key: 'auth_token',
                value: 'exfiltrated'
              };
              break;
          }

          promises.push(
            bridge.handlePageMessage({
              source: window,
              origin: window.location.origin,
              data: maliciousData
            } as any)
          );
        }
      }

      await Promise.all(promises);

      // Oracle assertion: Exactly 10 authentic messages made it to the background!
      expect(processedIds.length).toBe(10);
      expect(processedIds.every((id) => id.startsWith('auth-'))).toBe(true);

      bridge.destroy();
    });

    it('4.3: Concurrency stress: 20 simultaneous tabs on SW startup without false CONFLICT or deadlocks', async () => {
      // 10 tabs already attached in Chrome (tabIds 1000..1009)
      // 10 tabs not attached in Chrome (tabIds 1010..1019)
      const attachedTabIds = Array.from({ length: 10 }, (_, i) => 1000 + i);
      const detachedTabIds = Array.from({ length: 10 }, (_, i) => 1010 + i);
      const allTabIds = [...attachedTabIds, ...detachedTabIds];

      // Pre-persist all 20 tabs into storage as ATTACHED
      for (const tabId of allTabIds) {
        await saveTabSession({
          tabId,
          status: 'ATTACHED',
          attached: true,
          targetUrl: `https://app-${tabId}.example.com`,
          activeDomains: ['Page'],
          attachedAt: Date.now() - 5000,
          updatedAt: Date.now() - 5000
        } as any);
      }

      // Chrome targets list reports only 1000..1009 as attached
      context.mockDebugger.getTargets.mockResolvedValue(
        attachedTabIds.map((tabId) => ({
          id: String(tabId),
          tabId,
          type: 'page',
          title: `Tab ${tabId}`,
          url: `https://app-${tabId}.example.com`,
          attached: true
        } as any))
      );

      // SW wakes up
      const manager = new TabDebuggerManager();
      await manager.init();

      // Clear mock call count from init
      context.mockDebugger.attach.mockClear();

      // All 10 attached tabs concurrently call attachTab
      const attachPromises = attachedTabIds.map((tabId) => manager.attachTab(tabId));
      await Promise.all(attachPromises);

      // Zero calls to chrome.debugger.attach for already-attached tabs!
      expect(context.mockDebugger.attach).not.toHaveBeenCalled();

      // All 10 attached tabs must remain in ATTACHED state without false CONFLICT
      for (const tabId of attachedTabIds) {
        expect(manager.getTabStatus(tabId)).toBe('ATTACHED');
        expect(manager.isAttached(tabId)).toBe(true);
      }

      manager.destroy();
    });
  });
});
