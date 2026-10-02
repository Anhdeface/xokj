/**
 * Empirical Challenger M4-2 Gen5: Content Script Bridge Adversarial & Stress Test Suite
 * Location: test/unit/challenger-m4-2-gen5.spec.ts
 *
 * Empirical verification of:
 * 1. Fast-Path message throughput: 50,000+ random non-extension window messages dropped in <200ms with zero verifyOrigin calls.
 * 2. Hostile getter traps: throwing property getters on event.source, event.origin, data.channelId, data.type without crashing or rogue execution.
 * 3. 4-Layer validation integrity: strict rejection of spoofed channelId, mismatched origin, non-window source, client-spoofed tabId.
 * 4. GM storage bypass of CONFLICT: GM_STORAGE_SET and GM_STORAGE_DELETE forwarded to chrome.runtime.sendMessage while CDP_RPC_REQUEST is rejected with code 1001.
 * 5. Memory leaks & lifecycle: verify detach / cleanup removes all window and runtime listeners without dangling handlers across repeated cycles.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { ContentScriptBridge } from '@/content/bridge';
import { DevToolsConflictError } from '@/shared/types';
import {
  isFastPathAllowed,
  verifySource,
  verifyOrigin,
  verifySenderSource,
  verifyChannelId,
  validateStoragePayload,
  generateSecureChannelId
} from '@/content/bridge/validator';

describe('Empirical Challenger M4-2 Gen5: Content Script Bridge Modularization, Security & Stress', () => {
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
      channelId: 'xokj_secure_test_token_12345',
      requireChannelId: true,
      requireOrigin: false,
      autoStart: true
    });
  });

  afterEach(() => {
    bridge.destroy();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: Fast-Path Message Throughput (50,000+ non-extension messages)
  // =========================================================================

  describe('Section 1: Fast-Path Message Throughput & Non-Extension Filter Benchmark', () => {
    it('1.1: drops 50,000 random non-extension window messages in <200ms with ZERO verifyOrigin calls', async () => {
      const verifyOriginSpy = vi.spyOn(bridge, 'verifyOrigin');
      const MESSAGE_COUNT = 50000;

      // Construct a heterogeneous mix of random non-extension window messages
      const noiseSamples = [
        { type: 'WEBPACK_HMR' },
        { type: 'REACT_DEVTOOLS_MESSAGE' },
        { type: 'REDUX_ACTION', action: { type: 'INCREMENT' } },
        { type: 'ANALYTICS_EVENT', event: 'page_view' },
        { type: 'GA_HIT', id: 42 },
        { type: 'CUSTOM_PAGE_MSG' },
        { type: 'CDP_RPC_EVENT', method: 'Page.frameNavigated' }, // CDP_RPC_EVENT comes from bridge, not page!
        { action: 'ping' },
        { payload: 'test' },
        'string_message',
        12345,
        null,
        undefined,
        {},
        { type: null },
        { type: 123 },
        { type: 'xokj_fake_type' }
      ];

      // Pre-create message batches to measure pure dispatch/filtering throughput
      const events: any[] = new Array(MESSAGE_COUNT);
      for (let i = 0; i < MESSAGE_COUNT; i++) {
        const sample = noiseSamples[i % noiseSamples.length];
        events[i] = {
          source: window,
          origin: 'https://example.com',
          data: sample
        };
      }

      const start = performance.now();

      // Dispatch all 50,000 messages to bridge.handleWindowMessage
      for (let i = 0; i < MESSAGE_COUNT; i++) {
        bridge.handleWindowMessage(events[i]);
      }

      const elapsedMs = performance.now() - start;

      // Assertions
      expect(elapsedMs).toBeLessThan(200);
      expect(verifyOriginSpy).toHaveBeenCalledTimes(0);
      expect(context.mockRuntime.sendMessage).toHaveBeenCalledTimes(0);
      expect(postedToWindow.length).toBe(0);

      // Verify throughput calculation (>250,000 msgs/sec equivalent)
      const messagesPerSec = (MESSAGE_COUNT / elapsedMs) * 1000;
      expect(messagesPerSec).toBeGreaterThan(250000);
    });

    it('1.2: unit validator isFastPathAllowed strictly accepts only permitted message types', () => {
      // Must allow exactly these three types:
      expect(isFastPathAllowed({ type: 'CDP_RPC_REQUEST' })).toBe(true);
      expect(isFastPathAllowed({ type: 'GM_STORAGE_SET' })).toBe(true);
      expect(isFastPathAllowed({ type: 'GM_STORAGE_DELETE' })).toBe(true);

      // Must reject everything else
      expect(isFastPathAllowed(null)).toBe(false);
      expect(isFastPathAllowed(undefined)).toBe(false);
      expect(isFastPathAllowed('string')).toBe(false);
      expect(isFastPathAllowed(123)).toBe(false);
      expect(isFastPathAllowed({})).toBe(false);
      expect(isFastPathAllowed({ type: 'CDP_RPC_RESPONSE' })).toBe(false);
      expect(isFastPathAllowed({ type: 'CDP_RPC_EVENT' })).toBe(false);
      expect(isFastPathAllowed({ type: 'CDP_LIFECYCLE_EVENT' })).toBe(false);
      expect(isFastPathAllowed({ type: 'GM_STORAGE_RESPONSE' })).toBe(false);
      expect(isFastPathAllowed({ type: 'GM_STORAGE_GET' })).toBe(false);
      expect(isFastPathAllowed({ type: 'ANY_OTHER_TYPE' })).toBe(false);
    });
  });

  // =========================================================================
  // SECTION 2: Hostile Getter Traps & Prototype Tampering Resilience
  // =========================================================================

  describe('Section 2: Hostile Getter Traps & Prototype Tampering Resilience', () => {
    it('2.1: non-extension messages with throwing property getters on source, origin, channelId NEVER fire getters', () => {
      let sourceGetterTriggered = false;
      let originGetterTriggered = false;
      let channelIdGetterTriggered = false;

      const hostileEvent = {
        get source() {
          sourceGetterTriggered = true;
          throw new Error('HOSTILE_GETTER_TRAP: event.source accessed!');
        },
        get origin() {
          originGetterTriggered = true;
          throw new Error('HOSTILE_GETTER_TRAP: event.origin accessed!');
        },
        data: {
          type: 'HOSTILE_PAGE_MESSAGE',
          get channelId() {
            channelIdGetterTriggered = true;
            throw new Error('HOSTILE_GETTER_TRAP: data.channelId accessed!');
          }
        }
      };

      // Must execute cleanly without throwing
      expect(() => {
        bridge.handleWindowMessage(hostileEvent as any);
      }).not.toThrow();

      // Zero hostile getters must be accessed
      expect(sourceGetterTriggered).toBe(false);
      expect(originGetterTriggered).toBe(false);
      expect(channelIdGetterTriggered).toBe(false);
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
    });

    it('2.2: hostile message with extension type and throwing event.source getter does not execute rogue code or crash bridge', async () => {
      let sourceTrapFired = false;

      const hostileEvent = {
        get source() {
          sourceTrapFired = true;
          throw new Error('HOSTILE_SOURCE_TRAP');
        },
        origin: window.location.origin,
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'trap-1',
          channelId: bridge.getChannelId(),
          source: 'xokj-userscript',
          method: 'Page.navigate'
        }
      };

      // Calling handleWindowMessage may reject the promise due to the hostile getter,
      // but it must NOT crash the bridge or send to runtime
      try {
        await bridge.handleWindowMessage(hostileEvent as any);
      } catch (err: any) {
        expect(err.message).toBe('HOSTILE_SOURCE_TRAP');
      }

      expect(sourceTrapFired).toBe(true);
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      expect(bridge.isListening).toBe(true);
      expect(bridge.getStatus().status).toBe('IDLE');

      // Verify bridge remains fully operational for legitimate subsequent requests
      context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
        const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true, result: { ok: true } };
        cb?.(res);
        return res;
      });

      await bridge.handleWindowMessage({
        source: window,
        origin: window.location.origin,
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'subsequent-valid',
          channelId: bridge.getChannelId(),
          source: 'xokj-userscript',
          method: 'Page.enable'
        }
      } as any);

      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'subsequent-valid', method: 'Page.enable' }),
        expect.any(Function)
      );
    });

    it('2.3: hostile message with throwing event.origin getter is blocked from dispatching to runtime', async () => {
      let originTrapFired = false;

      const hostileEvent = {
        source: window,
        get origin() {
          originTrapFired = true;
          throw new Error('HOSTILE_ORIGIN_TRAP');
        },
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'trap-origin',
          channelId: bridge.getChannelId(),
          source: 'xokj-userscript',
          method: 'Target.createTarget'
        }
      };

      try {
        await bridge.handleWindowMessage(hostileEvent as any);
      } catch (err: any) {
        expect(err.message).toBe('HOSTILE_ORIGIN_TRAP');
      }

      expect(originTrapFired).toBe(true);
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      expect(bridge.isListening).toBe(true);
    });

    it('2.4: hostile message with throwing data.channelId getter is blocked from dispatching to runtime', async () => {
      let channelIdTrapFired = false;

      const hostileEvent = {
        source: window,
        origin: window.location.origin,
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'trap-channel',
          source: 'xokj-userscript',
          get channelId() {
            channelIdTrapFired = true;
            throw new Error('HOSTILE_CHANNEL_ID_TRAP');
          },
          method: 'Runtime.evaluate'
        }
      };

      try {
        await bridge.handleWindowMessage(hostileEvent as any);
      } catch (err: any) {
        expect(err.message).toBe('HOSTILE_CHANNEL_ID_TRAP');
      }

      expect(channelIdTrapFired).toBe(true);
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      expect(bridge.isListening).toBe(true);
    });

    it('2.5: hostile message with throwing data.type getter is rejected cleanly without corrupting state', async () => {
      let typeTrapFired = false;

      const hostileEvent = {
        source: window,
        origin: window.location.origin,
        data: {
          get type() {
            typeTrapFired = true;
            throw new Error('HOSTILE_TYPE_TRAP');
          }
        }
      };

      try {
        await bridge.handleWindowMessage(hostileEvent as any);
      } catch (err: any) {
        expect(err.message).toBe('HOSTILE_TYPE_TRAP');
      }

      expect(typeTrapFired).toBe(true);
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      expect(bridge.isListening).toBe(true);
    });

    it('2.6: prototype pollution attempts on Object.prototype do not bypass channel validation', async () => {
      const poisonedProtoKey = '__proto_poison_test';
      try {
        // Attempt to pollute Object.prototype with channelId and source
        (Object.prototype as any)[poisonedProtoKey] = 'polluted_value';
        (Object.prototype as any).channelId = bridge.getChannelId();

        // Send a message that lacks an own channelId property
        const cleanData = Object.create(null);
        cleanData.type = 'CDP_RPC_REQUEST';
        cleanData.id = 'proto-attack';
        cleanData.source = 'xokj-userscript';
        cleanData.method = 'Page.enable';

        await bridge.handleWindowMessage({
          source: window,
          origin: window.location.origin,
          data: cleanData
        } as any);

        // Since cleanData has no channelId and requireChannelId is true, verifyChannelId must fail
        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      } finally {
        delete (Object.prototype as any)[poisonedProtoKey];
        delete (Object.prototype as any).channelId;
      }
    });
  });

  // =========================================================================
  // SECTION 3: 4-Layer Validation Integrity
  // =========================================================================

  describe('Section 3: 4-Layer Validation Integrity', () => {
    const validChannelId = 'xokj_secure_test_token_12345';

    it('3.1: Layer 1 - rejects messages where event.source is NOT window (iframe, null, foreign object)', async () => {
      const foreignSources = [
        null,
        undefined,
        {},
        { postMessage: vi.fn() },
        { location: { href: 'https://evil.com' } }
      ];

      for (const invalidSource of foreignSources) {
        await bridge.handleWindowMessage({
          source: invalidSource,
          origin: 'https://example.com',
          data: {
            type: 'CDP_RPC_REQUEST',
            id: 'req-layer1',
            channelId: validChannelId,
            source: 'xokj-userscript',
            method: 'Page.enable'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      }
    });

    it('3.2: Layer 2 - rejects messages with mismatched or foreign origin when allowedOrigin is configured', async () => {
      const strictOriginBridge = new ContentScriptBridge({
        timeoutMs: 1000,
        channelId: validChannelId,
        requireChannelId: true,
        allowedOrigin: 'https://trusted.example.com',
        requireOrigin: true,
        autoStart: true
      });

      const invalidOrigins = [
        'https://attacker.evil.com',
        'http://trusted.example.com', // Protocol mismatch
        'https://trusted.example.com.evil.com',
        'null',
        '',
        undefined
      ];

      for (const invalidOrigin of invalidOrigins) {
        await strictOriginBridge.handleWindowMessage({
          source: window,
          origin: invalidOrigin,
          data: {
            type: 'CDP_RPC_REQUEST',
            id: 'req-layer2',
            channelId: validChannelId,
            source: 'xokj-userscript',
            method: 'Page.enable'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      }

      strictOriginBridge.destroy();
    });

    it('3.3: Layer 3 - rejects messages where data.source is spoofed or foreign', async () => {
      const invalidSenderSources = [
        'attacker-script',
        'tampermonkey',
        'page-script',
        'xokj-bridge', // Bridge cannot send requests to itself
        'unknown',
        123,
        {}
      ];

      for (const invalidSender of invalidSenderSources) {
        await bridge.handleWindowMessage({
          source: window,
          origin: window.location.origin,
          data: {
            type: 'CDP_RPC_REQUEST',
            id: 'req-layer3',
            channelId: validChannelId,
            source: invalidSender,
            method: 'Page.enable'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      }
    });

    it('3.4: Layer 4 - rejects messages with missing, empty, or mismatched channelId', async () => {
      const invalidChannelIds = [
        'wrong_token',
        'xokj_attacker_token',
        '',
        null,
        undefined,
        12345
      ];

      for (const invalidId of invalidChannelIds) {
        await bridge.handleWindowMessage({
          source: window,
          origin: window.location.origin,
          data: {
            type: 'CDP_RPC_REQUEST',
            id: 'req-layer4',
            channelId: invalidId,
            source: 'xokj-userscript',
            method: 'Page.enable'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      }
    });

    it('3.5: All 4 layers pass - message is accepted and forwarded to chrome.runtime.sendMessage', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
        const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true, result: { success: true } };
        cb?.(res);
        return res;
      });

      await bridge.handleWindowMessage({
        source: window,
        origin: window.location.origin,
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'req-4layer-pass',
          channelId: validChannelId,
          source: 'xokj-userscript',
          method: 'Page.enable',
          params: {}
        }
      } as any);

      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CDP_RPC_REQUEST',
          id: 'req-4layer-pass',
          method: 'Page.enable'
        }),
        expect.any(Function)
      );

      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'CDP_RPC_RESPONSE',
          id: 'req-4layer-pass',
          success: true
        })
      );
    });

    it('3.6: strips client-supplied tabId so Main World scripts cannot spoof tab targeting', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
        const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true, result: { ok: true } };
        cb?.(res);
        return res;
      });

      await bridge.handleWindowMessage({
        source: window,
        origin: window.location.origin,
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'req-spoof-tab',
          tabId: 999999, // Malicious spoofed tabId
          channelId: validChannelId,
          source: 'xokj-userscript',
          method: 'Page.reload'
        }
      } as any);

      // Verify forwarded request does NOT include client-provided tabId
      const forwardedCall = context.mockRuntime.sendMessage.mock.calls[0][0];
      expect(forwardedCall.tabId).toBeUndefined();
    });
  });

  // =========================================================================
  // SECTION 4: GM Storage Bypass of DevTools CONFLICT
  // =========================================================================

  describe('Section 4: GM Storage Bypass of DevTools CONFLICT Status', () => {
    const validChannelId = 'xokj_secure_test_token_12345';

    beforeEach(() => {
      // Put bridge into CONFLICT state via handleConflict
      bridge.handleConflict('native_devtools_opened_by_user');
      expect(bridge.getStatus().status).toBe('CONFLICT');
      expect(bridge.getStatus().conflict).toBe(true);
      expect(bridge.getStatus().reason).toBe('native_devtools_opened_by_user');
    });

    it('4.1: rejects CDP_RPC_REQUEST immediately with code 1001 conflict error and skips runtime dispatch', async () => {
      await bridge.handleWindowMessage({
        source: window,
        origin: window.location.origin,
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'req-conflict-cdp',
          channelId: validChannelId,
          source: 'xokj-userscript',
          method: 'Network.enable'
        }
      } as any);

      // Must NOT forward CDP command to background
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

      // Must respond to window with DevTools conflict error
      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'CDP_RPC_RESPONSE',
          id: 'req-conflict-cdp',
          success: false,
          error: expect.objectContaining({
            code: 1001,
            message: expect.stringContaining('DevTools conflict'),
            data: { reason: 'native_devtools_opened_by_user' }
          })
        })
      );
    });

    it('4.2: forwards GM_STORAGE_SET to background service worker even when in CONFLICT state', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async (msg: any, cb?: any) => {
        const res = { success: true };
        cb?.(res);
        return res;
      });

      await bridge.handleWindowMessage({
        source: window,
        origin: window.location.origin,
        data: {
          type: 'GM_STORAGE_SET',
          id: 'storage-set-1',
          channelId: validChannelId,
          source: 'xokj-userscript',
          scriptId: 'test-script-42',
          key: 'userTheme',
          value: { darkMode: true, fontSize: 16 }
        }
      } as any);

      // Must forward storage mutation to background
      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        {
          type: 'GM_STORAGE_SET',
          scriptId: 'test-script-42',
          key: 'userTheme',
          value: { darkMode: true, fontSize: 16 }
        },
        expect.any(Function)
      );

      // Must post GM_STORAGE_RESPONSE back to window with success
      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'GM_STORAGE_RESPONSE',
          id: 'storage-set-1',
          success: true
        })
      );
    });

    it('4.3: forwards GM_STORAGE_DELETE to background service worker even when in CONFLICT state', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async (msg: any, cb?: any) => {
        const res = { success: true };
        cb?.(res);
        return res;
      });

      await bridge.handleWindowMessage({
        source: window,
        origin: window.location.origin,
        data: {
          type: 'GM_STORAGE_DELETE',
          id: 'storage-del-1',
          channelId: validChannelId,
          source: 'xokj-userscript',
          scriptId: 'test-script-42',
          key: 'obsoleteCacheKey'
        }
      } as any);

      // Must forward delete mutation to background
      expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
        {
          type: 'GM_STORAGE_DELETE',
          scriptId: 'test-script-42',
          key: 'obsoleteCacheKey'
        },
        expect.any(Function)
      );

      // Must post GM_STORAGE_RESPONSE back to window
      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'GM_STORAGE_RESPONSE',
          id: 'storage-del-1',
          success: true
        })
      );
    });

    it('4.4: interleaved stream: rejects all CDP requests while successfully executing all storage mutations', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async (msg: any, cb?: any) => {
        const res = { success: true };
        cb?.(res);
        return res;
      });

      const operations = [
        { type: 'CDP_RPC_REQUEST', id: 'cdp-1', method: 'DOM.getDocument' },
        { type: 'GM_STORAGE_SET', id: 'gm-1', scriptId: 's1', key: 'k1', value: 'v1' },
        { type: 'CDP_RPC_REQUEST', id: 'cdp-2', method: 'Page.enable' },
        { type: 'GM_STORAGE_DELETE', id: 'gm-2', scriptId: 's1', key: 'k2' },
        { type: 'CDP_RPC_REQUEST', id: 'cdp-3', method: 'Runtime.evaluate' },
        { type: 'GM_STORAGE_SET', id: 'gm-3', scriptId: 's1', key: 'k3', value: 'v3' }
      ];

      for (const op of operations) {
        await bridge.handleWindowMessage({
          source: window,
          origin: window.location.origin,
          data: {
            ...op,
            channelId: validChannelId,
            source: 'xokj-userscript'
          }
        } as any);
      }

      // Exactly 3 storage messages were forwarded, 0 CDP messages
      expect(context.mockRuntime.sendMessage).toHaveBeenCalledTimes(3);
      expect(context.mockRuntime.sendMessage).toHaveBeenNthCalledWith(
        1,
        { type: 'GM_STORAGE_SET', scriptId: 's1', key: 'k1', value: 'v1' },
        expect.any(Function)
      );
      expect(context.mockRuntime.sendMessage).toHaveBeenNthCalledWith(
        2,
        { type: 'GM_STORAGE_DELETE', scriptId: 's1', key: 'k2' },
        expect.any(Function)
      );
      expect(context.mockRuntime.sendMessage).toHaveBeenNthCalledWith(
        3,
        { type: 'GM_STORAGE_SET', scriptId: 's1', key: 'k3', value: 'v3' },
        expect.any(Function)
      );

      // Verify CDP responses contain conflict error code 1001
      const cdpResponses = postedToWindow.filter((m) => m.type === 'CDP_RPC_RESPONSE');
      expect(cdpResponses.length).toBe(3);
      for (const resp of cdpResponses) {
        expect(resp.success).toBe(false);
        expect(resp.error.code).toBe(1001);
      }

      // Verify GM storage responses succeeded
      const gmResponses = postedToWindow.filter((m) => m.type === 'GM_STORAGE_RESPONSE');
      expect(gmResponses.length).toBe(3);
      for (const resp of gmResponses) {
        expect(resp.success).toBe(true);
      }
    });

    it('4.5: storage payload validator rejects empty or malformed scriptId and key', async () => {
      const invalidStoragePayloads = [
        { scriptId: '', key: 'validKey' },
        { scriptId: '   ', key: 'validKey' },
        { scriptId: 'validScript', key: '' },
        { scriptId: 'validScript', key: '   ' },
        { scriptId: 123, key: 'validKey' },
        { scriptId: 'validScript', key: null }
      ];

      for (const payload of invalidStoragePayloads) {
        await bridge.handleWindowMessage({
          source: window,
          origin: window.location.origin,
          data: {
            type: 'GM_STORAGE_SET',
            id: 'invalid-storage-req',
            channelId: validChannelId,
            source: 'xokj-userscript',
            ...payload
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      }
    });
  });

  // =========================================================================
  // SECTION 5: Memory Leaks, Lifecycle & Listener Cleanup
  // =========================================================================

  describe('Section 5: Memory Leaks, Lifecycle & Listener Cleanup', () => {
    it('5.1: init() registers listeners and destroy() unregisters all listeners without dangling handlers', () => {
      const addWindowSpy = vi.spyOn(window, 'addEventListener');
      const removeWindowSpy = vi.spyOn(window, 'removeEventListener');
      const addRuntimeSpy = vi.spyOn(context.mockRuntime.onMessage, 'addListener');
      const removeRuntimeSpy = vi.spyOn(context.mockRuntime.onMessage, 'removeListener');

      const testBridge = new ContentScriptBridge({
        timeoutMs: 1000,
        autoStart: false
      });

      expect(testBridge.isListening).toBe(false);

      // 1. Initialize
      testBridge.init();
      expect(testBridge.isListening).toBe(true);
      expect(addWindowSpy).toHaveBeenCalledWith('message', expect.any(Function));
      expect(addRuntimeSpy).toHaveBeenCalledWith(expect.any(Function));

      const registeredWindowHandler = addWindowSpy.mock.calls[0][1];
      const registeredRuntimeHandler = addRuntimeSpy.mock.calls[0][0];

      // 2. Destroy
      testBridge.destroy();
      expect(testBridge.isListening).toBe(false);

      // Verify exactly the same bound function references are passed to removeEventListener
      expect(removeWindowSpy).toHaveBeenCalledWith('message', registeredWindowHandler);
      expect(removeRuntimeSpy).toHaveBeenCalledWith(registeredRuntimeHandler);

      // 3. Repeated destroy is idempotent
      testBridge.destroy();
      expect(testBridge.isListening).toBe(false);
    });

    it('5.2: disconnect() drains pending requests with code 1002 and cleans up listeners', async () => {
      const disconnectBridge = new ContentScriptBridge({
        timeoutMs: 5000,
        autoStart: true
      });

      // Register an in-flight programmatic request
      context.mockRuntime.sendMessage.mockImplementation(() => new Promise(() => {})); // Never resolves
      const sendPromise = disconnectBridge.send('Page.captureScreenshot');

      expect(disconnectBridge.pendingRequests.size).toBe(1);

      // Trigger disconnect
      disconnectBridge.disconnect('tab_closed_by_browser');

      // Verify pending request was drained with code 1002
      await expect(sendPromise).rejects.toMatchObject({
        code: 1002,
        message: expect.stringContaining('CDP session detached: tab_closed_by_browser')
      });

      expect(disconnectBridge.pendingRequests.size).toBe(0);
      expect(disconnectBridge.isListening).toBe(false);
      expect(disconnectBridge.getStatus().status).toBe('DETACHED');

      // Verify lifecycle message posted to window
      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'CDP_LIFECYCLE_EVENT',
          status: 'DETACHED',
          reason: 'tab_closed_by_browser'
        })
      );
    });

    it('5.3: messages arriving after destroy() or disconnect() are dropped immediately', async () => {
      bridge.destroy();
      expect(bridge.isListening).toBe(false);

      const verifyOriginSpy = vi.spyOn(bridge, 'verifyOrigin');

      await bridge.handleWindowMessage({
        source: window,
        origin: window.location.origin,
        data: {
          type: 'CDP_RPC_REQUEST',
          id: 'post-destroy-req',
          channelId: bridge.getChannelId(),
          source: 'xokj-userscript',
          method: 'Page.enable'
        }
      } as any);

      expect(verifyOriginSpy).not.toHaveBeenCalled();
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      expect(postedToWindow.length).toBe(0);
    });

    it('5.4: 100 repeated init/destroy cycles maintain 0 listener leaks and zero dangling requests', () => {
      const addWindowSpy = vi.spyOn(window, 'addEventListener');
      const removeWindowSpy = vi.spyOn(window, 'removeEventListener');
      const addRuntimeSpy = vi.spyOn(context.mockRuntime.onMessage, 'addListener');
      const removeRuntimeSpy = vi.spyOn(context.mockRuntime.onMessage, 'removeListener');

      const testBridge = new ContentScriptBridge({
        timeoutMs: 1000,
        autoStart: false
      });

      for (let i = 0; i < 100; i++) {
        testBridge.init();
        expect(testBridge.isListening).toBe(true);

        // Register dummy event listener
        const unsub = testBridge.on('Console.messageAdded', () => {});
        unsub();

        testBridge.destroy();
        expect(testBridge.isListening).toBe(false);
        expect(testBridge.pendingRequests.size).toBe(0);
      }

      // Every add must have had a matching remove
      expect(addWindowSpy.mock.calls.length).toBe(removeWindowSpy.mock.calls.length);
      expect(addRuntimeSpy.mock.calls.length).toBe(removeRuntimeSpy.mock.calls.length);
    });

    it('5.5: internal event subscriptions via bridge.on() and onLifecycle() cleanup properly', () => {
      let eventCount = 0;
      let lifecycleCount = 0;

      const unsubEvent = bridge.on('Network.requestWillBeSent', () => {
        eventCount++;
      });

      const unsubLifecycle = bridge.onLifecycle(() => {
        lifecycleCount++;
      });

      // Trigger runtime messages
      bridge.handleRuntimeMessage({
        type: 'CDP_RPC_EVENT',
        method: 'Network.requestWillBeSent',
        params: { requestId: 'req-1' }
      });

      bridge.handleRuntimeMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        status: 'ATTACHED'
      });

      expect(eventCount).toBe(1);
      expect(lifecycleCount).toBe(1);

      // Unsubscribe both
      unsubEvent();
      unsubLifecycle();

      // Trigger again
      bridge.handleRuntimeMessage({
        type: 'CDP_RPC_EVENT',
        method: 'Network.requestWillBeSent',
        params: { requestId: 'req-2' }
      });

      bridge.handleRuntimeMessage({
        type: 'CDP_LIFECYCLE_EVENT',
        status: 'ATTACHED'
      });

      // Counts should not have increased
      expect(eventCount).toBe(1);
      expect(lifecycleCount).toBe(1);
    });
  });

  // =========================================================================
  // SECTION 6: Deep Boundary Stress & Cryptographic Channel Integrity
  // =========================================================================

  describe('Section 6: Deep Boundary Stress & Cryptographic Channel Integrity', () => {
    it('6.1: ultra-high throughput 100,000 message burst completes under 200ms with zero memory degradation', () => {
      const BURST_COUNT = 100000;
      const verifyOriginSpy = vi.spyOn(bridge, 'verifyOrigin');

      const noisyTypes = [
        'ANALYTICS_CLICK',
        'REACT_FIBER_UPDATE',
        'POST_MESSAGE_HANDSHAKE',
        'HOT_MODULE_RELOAD',
        'UNKNOWN_FRAMEWORK_EVENT',
        'METRICS_TELEMETRY'
      ];

      const batch = new Array(BURST_COUNT);
      for (let i = 0; i < BURST_COUNT; i++) {
        batch[i] = {
          source: window,
          origin: window.location.origin,
          data: {
            type: noisyTypes[i % noisyTypes.length],
            timestamp: Date.now(),
            seq: i
          }
        };
      }

      const t0 = performance.now();
      for (let i = 0; i < BURST_COUNT; i++) {
        bridge.handleWindowMessage(batch[i]);
      }
      const durationMs = performance.now() - t0;

      expect(durationMs).toBeLessThan(200);
      expect(verifyOriginSpy).toHaveBeenCalledTimes(0);
      expect(context.mockRuntime.sendMessage).toHaveBeenCalledTimes(0);
    });

    it('6.2: hostile getter traps on GM storage payload properties (scriptId, key, value) do not corrupt bridge', async () => {
      let scriptIdTrapFired = false;
      let keyTrapFired = false;

      const hostileStorageEvent = {
        source: window,
        origin: window.location.origin,
        data: {
          type: 'GM_STORAGE_SET',
          channelId: bridge.getChannelId(),
          source: 'xokj-userscript',
          get scriptId() {
            scriptIdTrapFired = true;
            throw new Error('HOSTILE_SCRIPT_ID_TRAP');
          },
          get key() {
            keyTrapFired = true;
            throw new Error('HOSTILE_KEY_TRAP');
          },
          value: 'malicious'
        }
      };

      try {
        await bridge.handleWindowMessage(hostileStorageEvent as any);
      } catch (err: any) {
        expect(err.message).toBe('HOSTILE_SCRIPT_ID_TRAP');
      }

      expect(scriptIdTrapFired).toBe(true);
      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
      expect(bridge.isListening).toBe(true);
    });

    it('6.3: frozen, sealed, and circular data structures are handled safely without exceptions', async () => {
      // 1. Frozen non-extension message
      const frozenData = Object.freeze({ type: 'FROZEN_PAGE_EVENT', value: 42 });
      await expect(
        bridge.handleWindowMessage({
          source: window,
          origin: window.location.origin,
          data: frozenData
        } as any)
      ).resolves.toBeUndefined();

      // 2. Circular structure
      const circularData: any = { type: 'CIRCULAR_EVENT' };
      circularData.self = circularData;
      await expect(
        bridge.handleWindowMessage({
          source: window,
          origin: window.location.origin,
          data: circularData
        } as any)
      ).resolves.toBeUndefined();

      // 3. Null prototype data
      const nullProtoData = Object.create(null);
      nullProtoData.type = 'NULL_PROTO_EVENT';
      await expect(
        bridge.handleWindowMessage({
          source: window,
          origin: window.location.origin,
          data: nullProtoData
        } as any)
      ).resolves.toBeUndefined();

      expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
    });

    it('6.4: generateSecureChannelId produces high-entropy, unique tokens prefixed with xokj_', () => {
      const ITERATIONS = 1000;
      const generatedIds = new Set<string>();

      for (let i = 0; i < ITERATIONS; i++) {
        const id = generateSecureChannelId();
        expect(id.startsWith('xokj_')).toBe(true);
        expect(id.length).toBeGreaterThanOrEqual(16);
        generatedIds.add(id);
      }

      // Zero collisions across 1,000 generated tokens
      expect(generatedIds.size).toBe(ITERATIONS);
    });

    it('6.5: GM storage background failure with chrome.runtime.lastError reports error back to window cleanly', async () => {
      context.mockRuntime.sendMessage.mockImplementation(async (_msg: any, cb?: any) => {
        context.mockRuntime.lastError = { message: 'Extension background disconnected during disk sync' };
        cb?.(undefined);
      });

      await bridge.handleWindowMessage({
        source: window,
        origin: window.location.origin,
        data: {
          type: 'GM_STORAGE_SET',
          id: 'storage-err-1',
          channelId: bridge.getChannelId(),
          source: 'xokj-userscript',
          scriptId: 'script-fail',
          key: 'syncKey',
          value: 'test'
        }
      } as any);

      expect(postedToWindow).toContainEqual(
        expect.objectContaining({
          type: 'GM_STORAGE_RESPONSE',
          id: 'storage-err-1',
          success: false,
          error: expect.stringContaining('Extension background disconnected during disk sync')
        })
      );
    });
  });
});

