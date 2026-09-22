/**
 * Unit Test Suite: Content Script Message Bridge
 * Location: test/unit/content-bridge.spec.ts
 *
 * Tests request correlation, timeout handling, event relay, conflict invalidation, and anti-spoofing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { ContentScriptBridge, ContentBridge } from '@/content/bridge';
import { DevToolsConflictError } from '@/shared/types';

describe('Feature 14: Content Script Message Bridge (bridge.ts)', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let bridge: ContentScriptBridge;
  let postedToWindow: any[] = [];

  beforeEach(() => {
    context = setupChromeMock();
    postedToWindow = [];

    vi.stubGlobal('postMessage', (msg: any) => {
      postedToWindow.push(msg);
    });

    bridge = new ContentScriptBridge({
      timeoutMs: 1000,
      autoStart: true
    });
  });

  afterEach(() => {
    bridge.destroy();
    vi.restoreAllMocks();
  });

  describe('Tier 1: Request Relaying & Correlation', () => {
    it('T1.1: relays valid CDP_RPC_REQUEST from window.postMessage to chrome.runtime.sendMessage', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: (res: any) => void) => {
        const res = {
          type: 'CDP_RPC_RESPONSE',
          id: req.id,
          success: true,
          result: { enabled: true }
        };
        cb?.(res);
        return res;
      });

      await bridge.handlePageMessage({
        source: window,
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'req-page-1',
          method: 'Page.enable',
          params: {}
        }
      } as any);

      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CDP_RPC_REQUEST',
          id: 'req-page-1',
          method: 'Page.enable'
        }),
        expect.any(Function)
      );

      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'CDP_RPC_RESPONSE',
          id: 'req-page-1',
          success: true,
          result: { enabled: true }
        })
      );
    });

    it('T1.2: catches background error and returns structured failure response to page', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async (_req: any, _cb?: any) => {
        throw new Error('Extension context invalidated');
      });

      await bridge.handlePageMessage({
        source: window,
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'req-fail',
          method: 'Network.enable'
        }
      } as any);

      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'CDP_RPC_RESPONSE',
          id: 'req-fail',
          success: false,
          error: expect.objectContaining({
            message: expect.stringContaining('Extension context invalidated')
          })
        })
      );
    });

    it('T1.3: strips client-provided tabId to enforce background tab identity security', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
        const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true };
        cb?.(res);
        return res;
      });

      await bridge.handlePageMessage({
        source: window,
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'req-spoofed',
          tabId: 9999, // Attempted spoof
          method: 'DOM.getDocument'
        }
      } as any);

      const callArgs = context.mockRuntime.sendMessage.mock.calls[0][0];
      expect(callArgs.tabId).toBeUndefined();
    });

    it('T1.4: handles multiple concurrent requests independently by correlation ID', async () => {
      const callbacks = new Map<string, (res: any) => void>();

      context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
        callbacks.set(req.id, cb);
      });

      const p1 = bridge.handlePageMessage({
        source: window,
        data: { type: 'CDP_RPC_REQUEST', id: 'id-alpha', method: 'DOM.enable' }
      } as any);

      const p2 = bridge.handlePageMessage({
        source: window,
        data: { type: 'CDP_RPC_REQUEST', id: 'id-beta', method: 'CSS.enable' }
      } as any);

      // Reply in reverse order
      callbacks.get('id-beta')?.({
        type: 'CDP_RPC_RESPONSE',
        id: 'id-beta',
        success: true,
        result: { css: true }
      });

      callbacks.get('id-alpha')?.({
        type: 'CDP_RPC_RESPONSE',
        id: 'id-alpha',
        success: true,
        result: { dom: true }
      });

      await Promise.all([p1, p2]);

      expect(postedToWindow).toContainEqual(
        expect.objectContaining({ id: 'id-beta', result: { css: true } })
      );
      expect(postedToWindow).toContainEqual(
        expect.objectContaining({ id: 'id-alpha', result: { dom: true } })
      );
    });

    it('T1.5: handles timeout and responds with error code -32000', async () => {
      vi.useFakeTimers();

      // Background never replies
      context.mockRuntime.sendMessage.mockImplementation(async () => {});

      bridge.handlePageMessage({
        source: window,
        data: { type: 'CDP_RPC_REQUEST', id: 'timeout-req', method: 'Slow.method' }
      } as any);

      vi.advanceTimersByTime(1100);

      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'CDP_RPC_RESPONSE',
          id: 'timeout-req',
          success: false,
          error: expect.objectContaining({
            code: -32000,
            message: expect.stringContaining('timed out')
          })
        })
      );

      vi.useRealTimers();
    });

    it('T1.6: bridge.send() resolves immediately when chrome.runtime.sendMessage returns response directly via callback', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: (res: any) => void) => {
        const res = {
          type: 'CDP_RPC_RESPONSE',
          id: req.id,
          success: true,
          result: { cookies: [{ name: 'session_id', value: 'secret_abc' }] }
        };
        cb?.(res);
        return res;
      });

      const responsePromise = bridge.send<{ cookies: Array<{ name: string; value: string }> }>(
        'Network.getCookies',
        { urls: ['https://example.com'] }
      );

      const result = await responsePromise;

      expect(result).toEqual({ cookies: [{ name: 'session_id', value: 'secret_abc' }] });
      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CDP_RPC_REQUEST',
          method: 'Network.getCookies',
          params: { urls: ['https://example.com'] }
        }),
        expect.any(Function)
      );

      // Verify pending request was cleanly removed from memory
      expect((bridge as any).pendingRequests.size).toBe(0);
    });

    it('T1.7: bridge.send() resolves when chrome.runtime.sendMessage returns response promise directly without callback', async () => {
      context.mockRuntime.sendMessage.mockImplementation((req: any) => {
        return Promise.resolve({
          type: 'CDP_RPC_RESPONSE',
          id: req.id,
          success: true,
          result: { targetId: 'target-tab-42' }
        });
      });

      const result = await bridge.send('Target.getTargetInfo');

      expect(result).toEqual({ targetId: 'target-tab-42' });
      expect((bridge as any).pendingRequests.size).toBe(0);
    });

    it('T1.8: bridge.send() rejects cleanly when chrome.runtime.sendMessage returns structured failure', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
        const res = {
          type: 'CDP_RPC_RESPONSE',
          id: req.id,
          success: false,
          error: { code: -32601, message: 'Method Page.invalidMethod not found' }
        };
        cb?.(res);
        return res;
      });

      await expect(bridge.send('Page.invalidMethod')).rejects.toThrow(
        'Method Page.invalidMethod not found'
      );
      expect((bridge as any).pendingRequests.size).toBe(0);
    });
  });

  describe('Tier 2: Event & Lifecycle Forwarding', () => {
    it('T2.1: forwards CDP_RPC_EVENT from chrome.runtime.onMessage to window.postMessage', () => {
      bridge.handleRuntimeMessage({
        type: 'CDP_RPC_EVENT',
        tabId: 42,
        method: 'Network.responseReceived',
        params: { response: { status: 200 } }
      });

      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'CDP_RPC_EVENT',
          tabId: 42,
          method: 'Network.responseReceived',
          params: { response: { status: 200 } }
        })
      );
    });

    it('T2.2: dispatches CDP_RPC_EVENT to programmatic listeners registered with bridge.on()', () => {
      const listener = vi.fn();
      const unsub = bridge.on('Network.requestWillBeSent', listener);

      bridge.handleRuntimeMessage({
        type: 'CDP_RPC_EVENT',
        tabId: 42,
        method: 'Network.requestWillBeSent',
        params: { url: 'https://test.com' }
      });

      expect(listener).toHaveBeenCalledWith({ url: 'https://test.com' });

      unsub();
      listener.mockClear();

      bridge.handleRuntimeMessage({
        type: 'CDP_RPC_EVENT',
        tabId: 42,
        method: 'Network.requestWillBeSent',
        params: { url: 'https://test2.com' }
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('T2.3: forwards CDP_LIFECYCLE_EVENT to window.postMessage and notifies lifecycle listeners', () => {
      const lifecycleSpy = vi.fn();
      bridge.onLifecycle(lifecycleSpy);

      bridge.handleRuntimeMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 42,
        status: 'ATTACHED'
      });

      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'CDP_LIFECYCLE_EVENT',
          tabId: 42,
          status: 'ATTACHED'
        })
      );

      expect(lifecycleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CDP_LIFECYCLE_EVENT',
          tabId: 42,
          status: 'ATTACHED'
        })
      );
    });
  });

  describe('Tier 3: DevTools Conflict Invalidation', () => {
    it('T3.1: drains active pending requests when CDP_LIFECYCLE_EVENT CONFLICT arrives', async () => {
      // Setup pending request that has not resolved
      context.mockRuntime.sendMessage.mockImplementation(async () => {});

      bridge.handlePageMessage({
        source: window,
        data: { type: 'CDP_RPC_REQUEST', id: 'pending-conflict', method: 'Page.navigate' }
      } as any);

      // Conflict arrives
      bridge.handleRuntimeMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 42,
        status: 'CONFLICT',
        reason: 'canceled_by_user'
      });

      expect(bridge.getStatus().conflict).toBe(true);

      // Pending request should have been rejected with code 1001
      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'CDP_RPC_RESPONSE',
          id: 'pending-conflict',
          success: false,
          error: expect.objectContaining({
            code: 1001,
            message: expect.stringContaining('DevTools conflict')
          })
        })
      );
    });

    it('T3.2: fast-rejects subsequent requests while tab is in CONFLICT state', async () => {
      bridge.handleConflict('canceled_by_user');
      expect(bridge.getStatus().conflict).toBe(true);

      await bridge.handlePageMessage({
        source: window,
        data: { type: 'CDP_RPC_REQUEST', id: 'req-while-conflict', method: 'DOM.getDocument' }
      } as any);

      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'CDP_RPC_RESPONSE',
          id: 'req-while-conflict',
          success: false,
          error: expect.objectContaining({
            code: 1001
          })
        })
      );
    });

    it('T3.3: programmatically calling bridge.send() throws DevToolsConflictError when in conflict', async () => {
      bridge.handleConflict('replaced_with_devtools');

      await expect(bridge.send('Page.reload')).rejects.toThrow(DevToolsConflictError);
    });

    it('T3.4: handleConflict emits exactly ONE window response per pending request during burst conflict', async () => {
      // Background holds all requests pending (simulating in-flight operations)
      context.mockRuntime.sendMessage.mockImplementation(async () => {
        return new Promise(() => {});
      });

      const requestIds = ['conflict-req-1', 'conflict-req-2', 'conflict-req-3'];
      for (const id of requestIds) {
        bridge.handlePageMessage({
          source: window,
          data: {
            source: 'xokj-userscript',
            type: 'CDP_RPC_REQUEST',
            id,
            method: 'Runtime.evaluate',
            params: { expression: '1 + 1' }
          }
        } as any);
      }

      expect((bridge as any).pendingRequests.size).toBe(3);

      // Trigger conflict directly
      bridge.handleConflict('canceled_by_user');

      // 1. All pending requests must be completely drained from internal memory
      expect((bridge as any).pendingRequests.size).toBe(0);

      // 2. Filter window messages for CDP_RPC_RESPONSE
      const rpcResponses = postedToWindow.filter(
        (m) => m.type === 'CDP_RPC_RESPONSE' && m.error?.code === 1001
      );

      // CRITICAL ASSERTION: Exactly ONE response per request ID (3 total, NOT 6)
      expect(rpcResponses.length).toBe(requestIds.length);

      for (const id of requestIds) {
        const matching = rpcResponses.filter((m) => m.id === id);
        expect(matching.length).toBe(1);
        expect(matching[0]).toEqual(
          expect.objectContaining({
            source: 'xokj-bridge',
            type: 'CDP_RPC_RESPONSE',
            id,
            success: false,
            error: expect.objectContaining({
              code: 1001,
              message: expect.stringContaining('DevTools conflict'),
              data: { reason: 'canceled_by_user' }
            })
          })
        );
      }

      // 3. Exactly one CDP_LIFECYCLE_EVENT broadcast must be present
      const lifecycleEvents = postedToWindow.filter(
        (m) => m.type === 'CDP_LIFECYCLE_EVENT' && m.status === 'CONFLICT'
      );
      expect(lifecycleEvents.length).toBe(1);
    });
  });

  describe('Tier 4: Security Boundaries & Anti-Spoofing', () => {
    it('T4.1: ignores messages from non-window sources (e.g. iframes or other windows)', async () => {
      await bridge.handlePageMessage({
        source: {} as Window, // foreign iframe
        data: { type: 'CDP_RPC_REQUEST', id: 'foreign', method: 'Page.navigate' }
      } as any);

      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
    });

    it('T4.2: ignores non-CDP messages cleanly without errors', async () => {
      await bridge.handlePageMessage({
        source: window,
        data: { type: 'OTHER_APP_MESSAGE', payload: 123 }
      } as any);

      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
    });

    it('T4.3: validates channelId when requireChannelId is enabled', async () => {
      const secureBridge = new ContentScriptBridge({
        channelId: 'secret-token-123',
        requireChannelId: true
      });
      secureBridge.init();

      // Message with wrong channelId
      await secureBridge.handlePageMessage({
        source: window,
        data: {
          type: 'CDP_RPC_REQUEST',
          channelId: 'wrong-token',
          id: 'spoof',
          method: 'Page.navigate'
        }
      } as any);

      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

      // Message with correct channelId
      context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
        const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true };
        cb?.(res);
        return res;
      });

      await secureBridge.handlePageMessage({
        source: window,
        data: {
          type: 'CDP_RPC_REQUEST',
          channelId: 'secret-token-123',
          id: 'valid-secure',
          method: 'Page.navigate'
        }
      } as any);

      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'valid-secure' }),
        expect.any(Function)
      );

      secureBridge.destroy();
    });
  });

  describe('Tier 5: Normal & Unexpected Detachment Invalidation (M2)', () => {
    it('T5.1: drains active pending window requests with code 1002 when CDP_LIFECYCLE_EVENT DETACHED arrives', async () => {
      // Background holds request in flight
      context.mockRuntime.sendMessage.mockImplementation(async () => {
        return new Promise(() => {});
      });

      bridge.handlePageMessage({
        source: window,
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'pending-detach-1',
          method: 'Page.navigate',
          params: { url: 'https://example.com' }
        }
      } as any);

      expect((bridge as any).pendingRequests.has('pending-detach-1')).toBe(true);

      // Emit DETACHED lifecycle event from background
      bridge.handleRuntimeMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 42,
        status: 'DETACHED',
        reason: 'target_closed'
      });

      expect(bridge.getStatus().status).toBe('DETACHED');
      expect((bridge as any).pendingRequests.size).toBe(0);

      // Assert Main World received immediate CDP_RPC_RESPONSE with code 1002
      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'CDP_RPC_RESPONSE',
          id: 'pending-detach-1',
          success: false,
          error: expect.objectContaining({
            code: 1002,
            message: expect.stringContaining('CDP session detached')
          })
        })
      );
    });

    it('T5.2: immediately rejects programmatic bridge.send() with code 1002 on DETACHED lifecycle event', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async () => {
        return new Promise(() => {});
      });

      const sendPromise = bridge.send('Runtime.evaluate', { expression: '1 + 1' });
      expect((bridge as any).pendingRequests.size).toBe(1);

      // Emit DETACHED lifecycle event
      bridge.handleRuntimeMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 42,
        status: 'DETACHED',
        reason: 'detached'
      });

      // Promise rejects immediately with code 1002
      await expect(sendPromise).rejects.toThrow(/CDP session detached/);
      try {
        await sendPromise;
      } catch (err: any) {
        expect(err.code).toBe(1002);
      }

      expect((bridge as any).pendingRequests.size).toBe(0);
    });

    it('T5.3: handles burst pending requests during unexpected detachment, emitting exactly one 1002 response per request', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async () => {
        return new Promise(() => {});
      });

      const reqIds = ['burst-det-1', 'burst-det-2', 'burst-det-3', 'burst-det-4'];
      for (const id of reqIds) {
        bridge.handlePageMessage({
          source: window,
          data: {
            source: 'xokj-userscript',
            type: 'CDP_RPC_REQUEST',
            id,
            method: 'DOM.getDocument'
          }
        } as any);
      }

      expect((bridge as any).pendingRequests.size).toBe(4);

      // Emit DETACHED lifecycle event
      bridge.handleRuntimeMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        tabId: 42,
        status: 'DETACHED',
        reason: 'target_closed'
      });

      expect((bridge as any).pendingRequests.size).toBe(0);

      // Assert exactly 4 responses with code 1002
      const rpcResponses = postedToWindow.filter(
        (m) => m.type === 'CDP_RPC_RESPONSE' && m.error?.code === 1002
      );
      expect(rpcResponses.length).toBe(4);

      for (const id of reqIds) {
        const matches = rpcResponses.filter((m) => m.id === id);
        expect(matches.length).toBe(1);
        expect(matches[0]).toEqual(
          expect.objectContaining({
            source: 'xokj-bridge',
            type: 'CDP_RPC_RESPONSE',
            id,
            success: false,
            error: expect.objectContaining({
              code: 1002,
              message: expect.stringContaining('CDP session detached')
            })
          })
        );
      }

      // Assert exactly one CDP_LIFECYCLE_EVENT with status: 'DETACHED'
      const lifecycleEvents = postedToWindow.filter(
        (m) => m.type === 'CDP_LIFECYCLE_EVENT' && m.status === 'DETACHED'
      );
      expect(lifecycleEvents.length).toBe(1);
    });

    it('T5.4: direct handleDetached call notifies lifecycle listeners and clears conflict state', () => {
      const lifecycleSpy = vi.fn();
      bridge.onLifecycle(lifecycleSpy);

      // Put bridge into conflict first
      bridge.handleConflict('canceled_by_user');
      expect(bridge.getStatus().conflict).toBe(true);

      // Call handleDetached
      bridge.handleDetached('target_closed');

      const status = bridge.getStatus();
      expect(status.status).toBe('DETACHED');
      expect(status.conflict).toBe(false);
      expect(status.reason).toBeUndefined();

      expect(lifecycleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CDP_LIFECYCLE_EVENT',
          status: 'DETACHED',
          reason: 'target_closed'
        })
      );
    });
  });
});
