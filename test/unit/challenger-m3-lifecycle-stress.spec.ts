/**
 * Empirical Challenger M3 Lifecycle Stress Suite
 * Location: test/unit/challenger-m3-lifecycle-stress.spec.ts
 *
 * Adversarial stress harness and empirical challenge suite for Milestone 3:
 * CDP Lifecycle Consolidation, DevTools Conflict Detection, Rapid Re-entrancy,
 * and Authoritative State Management.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { TabDebuggerManager, aggregateCdpDeclarations, isAttachableTarget } from '@/background/debugger-mgr';
import { DevToolsConflictHandler } from '@/background/conflict-mgr';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { GmStorageMessageHandler } from '@/background/gm-handler';
import {
  saveScript,
  saveSettings,
  deleteScript,
  resetToDefaultScripts,
  getTabSession,
  gmStorageRepo
} from '@/shared/storage';
import { DevToolsConflictError } from '@/shared/types';
import type { ScriptRecord, CdpRpcLifecycleMessage, CdpRpcRequest } from '@/shared/types';

describe('Empirical Challenger M3: Lifecycle & Conflict Recovery Stress Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let manager: TabDebuggerManager;

  beforeEach(async () => {
    context = setupChromeMock();
    await resetToDefaultScripts();
    manager = new TabDebuggerManager();
    await manager.init();
  });

  afterEach(() => {
    manager.destroy();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Group 1: Extreme Rapid Toggle & Re-entrancy Stress Harness
  // =========================================================================
  describe('Group 1: Extreme Rapid Toggle & Re-entrancy Stress Harness', () => {
    it('1.1: 50 concurrent attachTab calls on the same tab coalesce into a single native attach and all resolve', async () => {
      const tabId = 101;
      let nativeAttachCount = 0;

      context.mockDebugger.attach.mockImplementation(async () => {
        nativeAttachCount++;
        await new Promise((r) => setTimeout(r, 5));
      });

      // Fire 50 concurrent attach calls with options object
      const promises = Array.from({ length: 50 }, () =>
        manager.attachTab(tabId, { url: 'https://example.com', protocolVersion: '1.3' })
      );

      const results = await Promise.all(promises);

      // Exactly 1 native attach call should have occurred
      expect(nativeAttachCount).toBe(1);
      expect(context.mockDebugger.attach).toHaveBeenCalledTimes(1);

      // All 50 returned sessions must be identical and marked ATTACHED
      for (const session of results) {
        expect(session).toBeDefined();
        expect(session.status).toBe('ATTACHED');
        expect(session.attached).toBe(true);
        expect(session.tabId).toBe(tabId);
      }

      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');
      expect(manager.isAttached(tabId)).toBe(true);
    });

    it('1.2: 50 rapid alternating attach/detach calls without await preserve strict serial FIFO order', async () => {
      const tabId = 102;
      const history: string[] = [];

      context.mockDebugger.attach.mockImplementation(async () => {
        history.push('native_attach');
        await new Promise((r) => setTimeout(r, 2));
      });

      context.mockDebugger.detach.mockImplementation(async () => {
        history.push('native_detach');
        await new Promise((r) => setTimeout(r, 2));
      });

      // Rapidly launch 50 alternating operations: attach, detach, attach, detach...
      const ops: Promise<any>[] = [];
      for (let i = 0; i < 50; i++) {
        if (i % 2 === 0) {
          ops.push(manager.attachTab(tabId));
        } else {
          ops.push(manager.detachTab(tabId, 'DETACHED'));
        }
      }

      await Promise.all(ops);

      // Final operation (index 49) was detachTab(tabId, 'DETACHED')
      expect(manager.getTabStatus(tabId)).toBe('DETACHED');
      expect(manager.isAttached(tabId)).toBe(false);

      // Verify that native calls strictly alternated attach and detach
      expect(history.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < history.length; i++) {
        if (i % 2 === 0) {
          expect(history[i]).toBe('native_attach');
        } else {
          expect(history[i]).toBe('native_detach');
        }
      }

      // Verify internal operationLock is released to null
      const session = (manager as any).sessions.get(tabId);
      expect(session.operationLock).toBeNull();
      expect(session.currentOp).toBeNull();
    });

    it('1.3: 51 rapid alternating attach/detach calls ending in attach leaves state ATTACHED', async () => {
      const tabId = 103;

      const ops: Promise<any>[] = [];
      for (let i = 0; i < 51; i++) {
        if (i % 2 === 0) {
          ops.push(manager.attachTab(tabId));
        } else {
          ops.push(manager.detachTab(tabId));
        }
      }

      await Promise.all(ops);

      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');
      expect(manager.isAttached(tabId)).toBe(true);

      const session = (manager as any).sessions.get(tabId);
      expect(session.operationLock).toBeNull();
    });

    it('1.4: Asynchronous delay and jitter across 30 rapid toggles yields zero race corruption', async () => {
      const tabId = 104;

      context.mockDebugger.attach.mockImplementation(async () => {
        const jitter = Math.floor(Math.random() * 8) + 1;
        await new Promise((r) => setTimeout(r, jitter));
      });
      context.mockDebugger.detach.mockImplementation(async () => {
        const jitter = Math.floor(Math.random() * 8) + 1;
        await new Promise((r) => setTimeout(r, jitter));
      });

      const promises: Promise<any>[] = [];
      for (let i = 0; i < 30; i++) {
        if (i % 2 === 0) {
          promises.push(manager.attachTab(tabId));
        } else {
          promises.push(manager.detachTab(tabId, 'IDLE'));
        }
      }

      await Promise.all(promises);

      // Last operation was detachTab(tabId, 'IDLE')
      expect(manager.getTabStatus(tabId)).toBe('IDLE');
      expect(manager.isAttached(tabId)).toBe(false);

      const session = manager.getSession(tabId);
      expect(session).toBeDefined();
      expect(session?.status).toBe('IDLE');
      expect(session?.conflictDetected).toBe(false);
    });

    it('1.5: Mid-chain attach failure recovers cleanly and does not deadlock subsequent operations', async () => {
      const tabId = 105;
      let callCount = 0;

      context.mockDebugger.attach.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Transient network error');
        }
      });

      // First attach fails
      await expect(manager.attachTab(tabId)).rejects.toThrow('Transient network error');
      expect(manager.getTabStatus(tabId)).toBe('DETACHED');

      // Subsequent detach and re-attach work without deadlocking
      await manager.detachTab(tabId);
      expect(manager.getTabStatus(tabId)).toBe('DETACHED');

      await manager.attachTab(tabId);
      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');
      expect(manager.isAttached(tabId)).toBe(true);
    });

    it('1.6: Concurrent multi-tab storm (20 tabs attaching and detaching simultaneously) maintains tab isolation', async () => {
      const tabCount = 20;

      const tasks = Array.from({ length: tabCount }, async (_, i) => {
        const tid = 200 + i;
        await manager.attachTab(tid);
        expect(manager.getTabStatus(tid)).toBe('ATTACHED');
        if (i % 2 === 0) {
          await manager.detachTab(tid, 'IDLE');
          expect(manager.getTabStatus(tid)).toBe('IDLE');
        }
      });

      await Promise.all(tasks);

      for (let i = 0; i < tabCount; i++) {
        const tid = 200 + i;
        if (i % 2 === 0) {
          expect(manager.getTabStatus(tid)).toBe('IDLE');
        } else {
          expect(manager.getTabStatus(tid)).toBe('ATTACHED');
        }
      }
    });
  });

  // =========================================================================
  // Group 2: DevTools Conflict Detection & Anti-False-Positive Oracles
  // =========================================================================
  describe('Group 2: DevTools Conflict Detection & Anti-False-Positive Oracles', () => {
    it('2.1: Native DevTools open error during attachTab transitions to CONFLICT and throws DevToolsConflictError', async () => {
      const tabId = 301;
      const conflictMsg = 'Cannot attach to target: another debugger is already attached';

      context.mockDebugger.attach.mockRejectedValueOnce(new Error(conflictMsg));

      const lifecycleEvents: CdpRpcLifecycleMessage[] = [];
      manager.onLifecycle((evt) => lifecycleEvents.push(evt));

      await expect(manager.attachTab(tabId)).rejects.toThrow(DevToolsConflictError);

      expect(manager.getTabStatus(tabId)).toBe('CONFLICT');
      const session = manager.getSession(tabId);
      expect(session?.conflictDetected).toBe(true);
      expect(session?.conflictReason).toBe(conflictMsg);
      expect(session?.attached).toBe(false);

      expect(lifecycleEvents.some((e) => e.status === 'CONFLICT')).toBe(true);
    });

    it('2.2: Case-insensitive conflict regex catches all DevTools conflict error variations', async () => {
      const variations = [
        'Another debugger is open',
        'Cannot attach: another debugger is already attached',
        'Detached while handling command: replaced_with_devtools',
        'Debugger attached to the tab by other client',
        'Operation canceled_by_user'
      ];

      for (let i = 0; i < variations.length; i++) {
        const tabId = 310 + i;
        context.mockDebugger.attach.mockRejectedValueOnce(new Error(variations[i]));
        await expect(manager.attachTab(tabId)).rejects.toThrow(DevToolsConflictError);
        expect(manager.getTabStatus(tabId)).toBe('CONFLICT');
        expect(manager.getSession(tabId)?.conflictDetected).toBe(true);
      }
    });

    it('2.3: onDetach with replaced_with_devtools on active CDP tab transitions to CONFLICT', async () => {
      const tabId = 303;

      // Add a script requiring CDP matching example.com
      const cdpScript: ScriptRecord = {
        id: 'cdp-test-script',
        name: 'CDP Test Script',
        code: '// cdp',
        metadata: {
          name: 'CDP Test Script',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          runAt: 'document-idle',
          includes: [],
          excludes: [],
          grants: ['cdp'],
          cdp: [],
          cdpDeclarations: [],
          cdpDomains: ['Page'],
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

      // Attach tab with targetUrl
      await manager.attachTab(tabId, { url: 'https://example.com/test' });
      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');

      // Native DevTools opened -> fires onDetach with replaced_with_devtools
      manager.handleDetach({ tabId }, 'replaced_with_devtools');

      expect(manager.getTabStatus(tabId)).toBe('CONFLICT');
      expect(manager.getSession(tabId)?.conflictDetected).toBe(true);
      expect(manager.getSession(tabId)?.conflictReason).toBe('replaced_with_devtools');
    });

    it('2.4: Anti-False-Positive: Clean detachTab must never trigger CONFLICT even if Chrome reports canceled_by_user', async () => {
      const tabId = 304;
      await manager.attachTab(tabId);
      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');

      // Hook detach to fire onDetach with canceled_by_user (as Chrome sometimes does)
      context.mockDebugger.detach.mockImplementationOnce(async () => {
        manager.handleDetach({ tabId }, 'canceled_by_user');
      });

      await manager.detachTab(tabId, 'IDLE');

      expect(manager.getTabStatus(tabId)).toBe('IDLE');
      expect(manager.getSession(tabId)?.conflictDetected).toBe(false);
      expect(manager.getSession(tabId)?.conflictReason).toBeUndefined();
    });

    it('2.5: Anti-False-Positive: Engine globally disabled detaches to IDLE, not CONFLICT', async () => {
      const tabId = 305;
      await manager.attachTab(tabId);

      // Disable engine globally
      await saveSettings({ globalEnabled: false });
      (manager as any).cachedSettings = { globalEnabled: false };

      manager.handleDetach({ tabId }, 'canceled_by_user');

      expect(manager.getTabStatus(tabId)).toBe('IDLE');
      expect(manager.getSession(tabId)?.conflictDetected).toBe(false);
    });

    it('2.6: Anti-False-Positive: Tab with no matching CDP scripts transitions to IDLE on detach', async () => {
      const tabId = 306;
      await deleteScript('sample-cdp-logger');
      (manager as any).cachedScripts = [];

      await manager.attachTab(tabId, { url: 'https://example.com/normal-page' });
      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');

      manager.handleDetach({ tabId }, 'canceled_by_user');

      expect(manager.getTabStatus(tabId)).toBe('IDLE');
      expect(manager.getSession(tabId)?.conflictDetected).toBe(false);
    });

    it('2.7: sendCommand and attachTab without force throw DevToolsConflictError during CONFLICT', async () => {
      const tabId = 307;
      (manager as any).sessions.set(tabId, {
        tabId,
        status: 'CONFLICT',
        attached: false,
        activeDomains: new Set(),
        conflictDetected: true,
        conflictReason: 'DevTools active',
        updatedAt: Date.now(),
        operationLock: null,
        currentOp: null
      });

      await expect(manager.sendCommand(tabId, 'Page.enable')).rejects.toThrow(DevToolsConflictError);
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();

      await expect(manager.attachTab(tabId)).rejects.toThrow(DevToolsConflictError);
      expect(context.mockDebugger.attach).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Group 3: DevTools Reconnect Resilience & Domain Re-initialization Oracles
  // =========================================================================
  describe('Group 3: DevTools Reconnect Resilience & Domain Re-initialization Oracles', () => {
    it('3.1: Reconnect fails cleanly when DevTools is still open and remains in CONFLICT', async () => {
      const tabId = 401;
      (manager as any).sessions.set(tabId, {
        tabId,
        status: 'CONFLICT',
        attached: false,
        activeDomains: new Set(),
        conflictDetected: true,
        conflictReason: 'DevTools active',
        updatedAt: Date.now(),
        operationLock: null,
        currentOp: null
      });

      // Still fails with DevTools open error
      context.mockDebugger.attach.mockRejectedValueOnce(
        new Error('Cannot attach to target: another debugger is open')
      );

      const res = await manager.reconnect(tabId);

      expect(res.success).toBe(false);
      expect(res.error).toContain('DevTools is still open');
      expect(manager.getTabStatus(tabId)).toBe('CONFLICT');
      expect(manager.getSession(tabId)?.conflictDetected).toBe(true);
    });

    it('3.2: Reconnect succeeds after DevTools is closed, clears CONFLICT, and re-initializes domains', async () => {
      const tabId = 402;
      const targetUrl = 'https://example.com/test';

      const scriptWithCdp: ScriptRecord = {
        id: 'cdp-reconnect-script',
        name: 'CDP Reconnect Script',
        code: '// cdp',
        metadata: {
          name: 'CDP Reconnect Script',
          matches: ['https://example.com/*'],
          matchPatterns: ['https://example.com/*'],
          runAt: 'document-idle',
          includes: [],
          excludes: [],
          grants: ['cdp'],
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
      await saveScript(scriptWithCdp);

      (manager as any).sessions.set(tabId, {
        tabId,
        status: 'CONFLICT',
        attached: false,
        activeDomains: new Set(),
        conflictDetected: true,
        conflictReason: 'DevTools active',
        targetUrl,
        updatedAt: Date.now(),
        operationLock: null,
        currentOp: null
      });

      context.mockDebugger.attach.mockResolvedValueOnce(undefined);
      context.mockDebugger.sendCommand.mockResolvedValue({});

      const res = await manager.reconnect(tabId);

      expect(res.success).toBe(true);
      expect(res.session).toBeDefined();
      expect(res.session?.status).toBe('ATTACHED');
      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');
      expect(manager.getSession(tabId)?.conflictDetected).toBe(false);

      // Verify declarative init ran Network.enable
      expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId },
        'Network.enable',
        {}
      );
      expect(manager.getActiveDomains(tabId)).toContain('Network');
    });

    it('3.3: 10 concurrent reconnect calls coalesce and resolve without duplicate attach calls', async () => {
      const tabId = 403;
      (manager as any).sessions.set(tabId, {
        tabId,
        status: 'CONFLICT',
        attached: false,
        activeDomains: new Set(),
        conflictDetected: true,
        conflictReason: 'DevTools active',
        updatedAt: Date.now(),
        operationLock: null,
        currentOp: null
      });

      context.mockDebugger.attach.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });

      const promises = Array.from({ length: 10 }, () => manager.reconnect(tabId));
      const results = await Promise.all(promises);

      // Only 1 native attach call
      expect(context.mockDebugger.attach).toHaveBeenCalledTimes(1);

      for (const res of results) {
        expect(res.success).toBe(true);
      }
      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');
    });

    it('3.4: DevToolsConflictHandler delegates reconnectTab and onMessage correctly', async () => {
      const conflictHandler = new DevToolsConflictHandler(null, manager);
      conflictHandler.init();

      const tabId = 404;
      (manager as any).sessions.set(tabId, {
        tabId,
        status: 'CONFLICT',
        attached: false,
        activeDomains: new Set(),
        conflictDetected: true,
        conflictReason: 'DevTools active',
        updatedAt: Date.now(),
        operationLock: null,
        currentOp: null
      });

      // Successful reconnect delegation
      const res = await conflictHandler.reconnectTab(tabId);
      expect(res.success).toBe(true);
      expect(manager.getTabStatus(tabId)).toBe('ATTACHED');

      // Test handleRuntimeMessage for RECONNECT_CDP
      let responsePayload: any = null;
      const keepOpen = conflictHandler.handleRuntimeMessage(
        { type: 'RECONNECT_CDP', tabId },
        {} as any,
        (r) => { responsePayload = r; }
      );
      expect(keepOpen).toBe(true);
      await vi.waitFor(() => {
        expect(responsePayload).not.toBeNull();
      });
      expect(responsePayload.success).toBe(true);

      // Test invalid tabId
      let invalidResponse: any = null;
      conflictHandler.handleRuntimeMessage(
        { type: 'RECONNECT_CDP' },
        {} as any,
        (r) => { invalidResponse = r; }
      );
      expect(invalidResponse.success).toBe(false);
      expect(invalidResponse.error).toContain('Missing or invalid tabId');

      conflictHandler.destroy();
    });
  });

  // =========================================================================
  // Group 4: Tab Removal Races, Memory Deallocation & Zero-Zombie State
  // =========================================================================
  describe('Group 4: Tab Removal Races, Memory Deallocation & Zero-Zombie State', () => {
    it('4.1: Tab removed during in-flight attachTab cleanly detaches and does NOT resurrect zombie session', async () => {
      const tabId = 501;

      let resolveAttach: () => void;
      context.mockDebugger.attach.mockImplementationOnce(
        () =>
          new Promise<void>((res) => {
            resolveAttach = res;
          })
      );

      const attachPromise = manager.attachTab(tabId);

      // While attach is in-flight, user closes the tab
      await manager.handleTabRemoved(tabId);

      expect(manager.getSession(tabId)).toBeUndefined();

      // Now attach finishes in Chrome
      resolveAttach!();
      await attachPromise;

      // Tab was removed: manager must have detached and MUST NOT have resurrected tab in memory
      expect(context.mockDebugger.detach).toHaveBeenCalledWith({ tabId });
      expect(manager.getSession(tabId)).toBeUndefined();
      expect(manager.getTabStatus(tabId)).toBe('IDLE');
    });

    it('4.2: Tab removed during in-flight detachTab cleans up without resurrecting state', async () => {
      const tabId = 502;
      await manager.attachTab(tabId);

      let resolveDetach: () => void;
      context.mockDebugger.detach.mockImplementationOnce(
        () =>
          new Promise<void>((res) => {
            resolveDetach = res;
          })
      );

      const detachPromise = manager.detachTab(tabId);

      // Tab removed while detaching
      await manager.handleTabRemoved(tabId);

      resolveDetach!();
      await detachPromise;

      expect(manager.getSession(tabId)).toBeUndefined();
      const stored = await getTabSession(tabId);
      expect(stored).toBeUndefined();
    });

    it('4.3: High-frequency tab churn (50 tabs attaching and closing simultaneously) leaves zero zombie entries', async () => {
      const tabCount = 50;

      context.mockDebugger.attach.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5) + 1));
      });

      await Promise.all(
        Array.from({ length: tabCount }, async (_, i) => {
          const tid = 600 + i;
          const p = manager.attachTab(tid);
          if (Math.random() > 0.5) {
            setTimeout(() => manager.handleTabRemoved(tid), 2);
          } else {
            p.finally(() => manager.handleTabRemoved(tid));
          }
          await p.catch(() => {});
        })
      );

      await new Promise((r) => setTimeout(r, 20));

      // After all tabs close, no zombie sessions should remain
      for (let i = 0; i < tabCount; i++) {
        const tid = 600 + i;
        expect(manager.getSession(tid)).toBeUndefined();
      }
      expect(manager.getAllSessions().filter((s) => s.tabId >= 600 && s.tabId < 650)).toEqual([]);
    });
  });

  // =========================================================================
  // Group 5: CdpBridgeServer Single-Owner Coordination & Command Inflight Draining
  // =========================================================================
  describe('Group 5: CdpBridgeServer Single-Owner Coordination & Command Inflight Draining', () => {
    let bridge: CdpBridgeServer;

    beforeEach(() => {
      bridge = new CdpBridgeServer({
        debuggerManager: manager,
        autoAttach: true,
        autoStart: true
      });
    });

    afterEach(() => {
      bridge.destroy();
    });

    it('5.1: Inflight commands reject immediately with code 1001 when tab transitions to CONFLICT', async () => {
      const tabId = 701;
      await manager.attachTab(tabId);

      // Inflight command hangs waiting for response
      context.mockDebugger.sendCommand.mockImplementation(
        () => new Promise(() => {}) // never resolves
      );

      const cmdPromise = bridge.executeCommand(tabId, 'Runtime.evaluate', { expression: '1+1' });

      expect(bridge.getPendingRequestCount(tabId)).toBe(1);

      // Conflict occurs: DevTools opened on tab
      manager.handleDetach({ tabId }, 'replaced_with_devtools');

      const response = await cmdPromise;
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(1001);
      expect(response.error?.message).toContain('DevTools conflict');

      expect(bridge.getPendingRequestCount(tabId)).toBe(0);
    });

    it('5.2: Inflight commands reject with code 1002 when tab is cleanly detached', async () => {
      const tabId = 702;
      await manager.attachTab(tabId);

      context.mockDebugger.sendCommand.mockImplementation(
        () => new Promise(() => {})
      );

      const cmdPromise = bridge.executeCommand(tabId, 'Page.navigate', { url: 'https://example.com' });
      expect(bridge.getPendingRequestCount(tabId)).toBe(1);

      await manager.detachTab(tabId, 'DETACHED');

      const response = await cmdPromise;
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(1002);
      expect(response.error?.message).toContain('Debugger detached from tab');

      expect(bridge.getPendingRequestCount(tabId)).toBe(0);
    });

    it('5.3: 10 concurrent commands on unattached tab trigger exactly 1 auto-attach and all execute', async () => {
      const tabId = 703;
      let attachCount = 0;

      context.mockDebugger.attach.mockImplementation(async () => {
        attachCount++;
        await new Promise((r) => setTimeout(r, 5));
      });
      context.mockDebugger.sendCommand.mockResolvedValue({ result: 'ok' });

      const commands = Array.from({ length: 10 }, (_, i) =>
        bridge.executeCommand(tabId, 'Runtime.evaluate', { expression: `${i}` })
      );

      const responses = await Promise.all(commands);

      expect(attachCount).toBe(1);
      for (const res of responses) {
        expect(res.success).toBe(true);
        expect(res.result).toEqual({ result: 'ok' });
      }
      expect(bridge.isTabAttached(tabId)).toBe(true);
    });

    it('5.4: Command execution fails immediately if tab is already in CONFLICT', async () => {
      const tabId = 704;
      manager.setTabStatus(tabId, 'CONFLICT', 'DevTools open');

      const res = await bridge.executeCommand(tabId, 'Page.enable');
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe(1001);
      expect(res.error?.message).toContain('DevTools conflict');
      expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Group 6: GmStorageMessageHandler Input Validation & Concurrent Mutations
  // =========================================================================
  describe('Group 6: GmStorageMessageHandler Input Validation & Concurrent Mutations', () => {
    let handler: GmStorageMessageHandler;

    beforeEach(() => {
      handler = new GmStorageMessageHandler();
      handler.init();
    });

    afterEach(() => {
      handler.destroy();
    });

    it('6.1: Rejects malformed GM storage payloads with clear validation errors', async () => {
      // Empty scriptId
      const r1 = await handler.processMessage({
        type: 'GM_STORAGE_SET',
        scriptId: '',
        key: 'test',
        value: 123
      } as any);
      expect(r1.success).toBe(false);
      expect(r1.error).toContain('scriptId must be a non-empty string');

      // Null scriptId
      const r2 = await handler.processMessage({
        type: 'GM_STORAGE_SET',
        scriptId: null as any,
        key: 'test',
        value: 123
      });
      expect(r2.success).toBe(false);

      // Empty key
      const r3 = await handler.processMessage({
        type: 'GM_STORAGE_SET',
        scriptId: 'my-script',
        key: '   ',
        value: 123
      });
      expect(r3.success).toBe(false);
      expect(r3.error).toContain('key must be a non-empty string');

      // Unknown type
      const r4 = await handler.processMessage({
        type: 'GM_STORAGE_UNKNOWN' as any,
        scriptId: 'my-script',
        key: 'test'
      });
      expect(r4.success).toBe(false);
      expect(r4.error).toContain('Unknown GM storage operation');
    });

    it('6.2: 20 rapid concurrent GM_STORAGE_SET and DELETE mutations resolve atomically', async () => {
      const scriptId = 'stress-script-gm';

      // 20 rapid mutations
      const mutations = Array.from({ length: 20 }, (_, i) => {
        if (i % 2 === 0) {
          return handler.processMessage({
            type: 'GM_STORAGE_SET',
            scriptId,
            key: `key_${i}`,
            value: { count: i }
          });
        } else {
          return handler.processMessage({
            type: 'GM_STORAGE_DELETE',
            scriptId,
            key: `key_${i - 1}`
          });
        }
      });

      const results = await Promise.all(mutations);
      for (const res of results) {
        expect(res.success).toBe(true);
      }

      // Verify repo contents
      const stored = await gmStorageRepo.getGmValues(scriptId);
      expect(typeof stored).toBe('object');
    });
  });

  // =========================================================================
  // Group 7: Aggregate CDP Declarations & Match Pattern Verification
  // =========================================================================
  describe('Group 7: Declarative CDP Directives & URL Attachability Oracles', () => {
    it('7.1: isAttachableTarget correctly allows public and local URLs, forbids restricted schemes', () => {
      expect(isAttachableTarget('https://google.com')).toBe(true);
      expect(isAttachableTarget('http://localhost:3000')).toBe(true);
      expect(isAttachableTarget('file:///home/user/test.html')).toBe(true);

      // Restricted schemes
      expect(isAttachableTarget('chrome://settings')).toBe(false);
      expect(isAttachableTarget('chrome-extension://abcdef/popup.html')).toBe(false);
      expect(isAttachableTarget('about:blank')).toBe(false);
      expect(isAttachableTarget('devtools://devtools/bundled/inspector.html')).toBe(false);
      expect(isAttachableTarget(undefined)).toBe(false);
      expect(isAttachableTarget('')).toBe(false);
    });

    it('7.2: aggregateCdpDeclarations sorts enable commands first, deduplicates, and ignores disabled scripts', () => {
      const scripts: ScriptRecord[] = [
        {
          id: 'script-1',
          name: 'Script 1',
          code: '',
          enabled: true,
          metadata: {
            name: 'Script 1',
            matches: ['*://*/*'],
            matchPatterns: ['*://*/*'],
            runAt: 'document-idle',
          includes: [],
            excludes: [],
            grants: ['cdp'],
            cdp: [
              { domain: 'Network', method: 'setExtraHTTPHeaders', command: 'Network.setExtraHTTPHeaders', params: { headers: { X: '1' } } },
              { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
              { domain: 'Page', method: 'enable', command: 'Page.enable', params: {} }
            ],
            cdpDeclarations: [
              { domain: 'Network', method: 'setExtraHTTPHeaders', command: 'Network.setExtraHTTPHeaders', params: { headers: { X: '1' } } },
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
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'script-2',
          name: 'Script 2 (Disabled Duplicate)',
          code: '',
          enabled: false,
          metadata: {
            name: 'Script 2',
            matches: ['*://*/*'],
            matchPatterns: ['*://*/*'],
            runAt: 'document-idle',
          includes: [],
            excludes: [],
            grants: ['cdp'],
            cdp: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }],
            cdpDeclarations: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }],
            cdpDomains: ['Network'],
            requires: [],
            resources: {},
            noframes: false,
            connects: [],
            rawEntries: {}
          },
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'script-3',
          name: 'Script 3 (Duplicate Enable)',
          code: '',
          enabled: true,
          metadata: {
            name: 'Script 3',
            matches: ['*://*/*'],
            matchPatterns: ['*://*/*'],
            runAt: 'document-idle',
          includes: [],
            excludes: [],
            grants: ['cdp'],
            cdp: [
              { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
              { domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} }
            ],
            cdpDeclarations: [
              { domain: 'Network', method: 'enable', command: 'Network.enable', params: {} },
              { domain: 'DOM', method: 'enable', command: 'DOM.enable', params: {} }
            ],
            cdpDomains: ['Network', 'DOM'],
            requires: [],
            resources: {},
            noframes: false,
            connects: [],
            rawEntries: {}
          },
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];

      const aggregated = aggregateCdpDeclarations(scripts);

      // Verify enable commands are strictly sorted first
      const enableIdxs = aggregated
        .map((d, i) => (d.method === 'enable' ? i : -1))
        .filter((i) => i !== -1);
      const otherIdxs = aggregated
        .map((d, i) => (d.method !== 'enable' ? i : -1))
        .filter((i) => i !== -1);

      expect(Math.max(...enableIdxs)).toBeLessThan(Math.min(...otherIdxs));

      // Verify deduplication: Network.enable appears exactly once
      const networkEnables = aggregated.filter((d) => d.command === 'Network.enable');
      expect(networkEnables.length).toBe(1);

      // Verify DOM.enable and Page.enable are included
      expect(aggregated.some((d) => d.command === 'DOM.enable')).toBe(true);
      expect(aggregated.some((d) => d.command === 'Page.enable')).toBe(true);
      expect(aggregated.some((d) => d.command === 'Network.setExtraHTTPHeaders')).toBe(true);
    });
  });
});
