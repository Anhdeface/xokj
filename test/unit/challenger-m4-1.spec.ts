/**
 * Empirical Challenger M4-1: Content Script Bridge & Security Isolation Adversarial Test Suite
 * Location: test/unit/challenger-m4-1.spec.ts
 *
 * Adversarial verification suite attacking:
 * 1. ContentScriptBridge Security Boundaries (R1 / Feature 15):
 *    - Mismatched or missing secret channelId requests dropped without background dispatch.
 *    - Foreign or invalid origins (event.origin !== window.location.origin, attacker.evil, null origins) rejected/dropped.
 *    - Spoofed caller sources (data.source !== 'xokj-userscript') dropped.
 *    - Non-window sources (event.source !== window, iframes, worker stubs) dropped.
 *    - Spoofed data.tabId stripped and never forwarded to background service worker.
 *    - Draining on detachment and conflict echoes the valid secret channelId.
 * 2. CdpBridgeServer Permission Enforcement (R2 / Feature 16):
 *    - Scripts declaring @grant none attempting any CDP command rejected with code 403 (GRANT_NONE).
 *    - Scripts declaring specific domains attempting unauthorized domains rejected with code 403 (DOMAIN_NOT_AUTHORIZED).
 *    - Disabled scripts or non-existent script IDs rejected with code 403 (SCRIPT_DISABLED / SCRIPT_NOT_FOUND).
 *    - URL mismatch or excluded URL calls rejected with code 403 (URL_NOT_MATCHED / URL_EXCLUDED).
 *    - Strict mode with missing scriptId rejected with code 403 (MISSING_SCRIPT_ID).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { ContentScriptBridge } from '@/content/bridge';
import { bridge as singletonBridge } from '@/content/index';
import { CdpBridgeServer } from '@/background/cdp-bridge';
import { saveScript, resetToDefaultScripts, deleteScript } from '@/shared/storage';
import type { ScriptRecord } from '@/shared/types';

function createScriptRecord(opts: {
  id: string;
  name?: string;
  enabled?: boolean;
  matches?: string[];
  excludes?: string[];
  grants?: string[];
  cdpDomains?: string[];
  cdp?: Array<{ domain: string; method: string; command: string; params: Record<string, unknown>; raw: string }>;
}): ScriptRecord {
  return {
    id: opts.id,
    name: opts.name || `Script ${opts.id}`,
    code: '// test code',
    enabled: opts.enabled ?? true,
    metadata: {
      name: opts.name || `Script ${opts.id}`,
      matches: opts.matches ?? ['*://*/*'],
      matchPatterns: opts.matches ?? ['*://*/*'],
      includes: [],
      excludes: opts.excludes ?? [],
      runAt: 'document-idle',
      grants: opts.grants ?? [],
      cdp: opts.cdp ?? [],
      cdpDeclarations: opts.cdp ?? [],
      cdpDomains: opts.cdpDomains ?? [],
      requires: [],
      resources: {},
      noframes: false,
      connects: [],
      rawEntries: {}
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

describe('Empirical Challenger M4-1: Content Script Bridge & Security Isolation', () => {
  // =========================================================================
  // Section 1: ContentScriptBridge Security Boundaries (R1 / Feature 15)
  // =========================================================================
  describe('1. ContentScriptBridge Security Boundaries (Feature 15)', () => {
    let context: ReturnType<typeof setupChromeMock>;
    let postedToWindow: any[];

    beforeEach(() => {
      context = setupChromeMock();
      postedToWindow = [];

      vi.stubGlobal('postMessage', (msg: any) => {
        postedToWindow.push(msg);
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('1.1 Secret Channel Token (channelId) Verification & Tamper Resistance', () => {
      it('CSB-1.1.1: drops message completely when requireChannelId is true and channelId is missing', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'secret-token-alpha',
          requireChannelId: true
        });
        bridge.init();

        await bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            id: 'unauth-no-token',
            method: 'DOM.getDocument'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        expect(postedToWindow).toEqual([]);
        bridge.destroy();
      });

      it('CSB-1.1.2: drops message when channelId is an empty string', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'secret-token-beta',
          requireChannelId: true
        });
        bridge.init();

        await bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: '',
            id: 'unauth-empty-token',
            method: 'Page.navigate'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        expect(postedToWindow).toEqual([]);
        bridge.destroy();
      });

      it('CSB-1.1.3: drops message when channelId is incorrect / guessed token', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'secret-token-gamma-9999',
          requireChannelId: true
        });
        bridge.init();

        await bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'attacker-guessed-token',
            id: 'unauth-wrong-token',
            method: 'Network.getCookies'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        expect(postedToWindow).toEqual([]);
        bridge.destroy();
      });

      it('CSB-1.1.4: drops message when channelId is a non-string type (numbers, boolean, object, null)', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'secret-token-delta',
          requireChannelId: true
        });
        bridge.init();

        const malformedTypes = [
          12345,
          true,
          false,
          {},
          ['secret-token-delta'],
          null
        ];

        for (const badType of malformedTypes) {
          context.mockRuntime.sendMessage.mockClear();
          postedToWindow = [];

          await bridge.handlePageMessage({
            source: window,
            data: {
              type: 'CDP_RPC_REQUEST',
              channelId: badType,
              id: `bad-type-${String(badType)}`,
              method: 'Runtime.evaluate'
            }
          } as any);

          expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
          expect(postedToWindow).toEqual([]);
        }

        bridge.destroy();
      });

      it('CSB-1.1.5: drops message with token truncation or token padding attack', async () => {
        const trueToken = 'secure-secret-token-xyz';
        const bridge = new ContentScriptBridge({
          channelId: trueToken,
          requireChannelId: true
        });
        bridge.init();

        const tamperedTokens = [
          trueToken.slice(0, -1), // truncated
          `${trueToken}1`,        // padded suffix
          `pre-${trueToken}`,     // padded prefix
          trueToken.toUpperCase() // altered case
        ];

        for (const token of tamperedTokens) {
          context.mockRuntime.sendMessage.mockClear();
          postedToWindow = [];

          await bridge.handlePageMessage({
            source: window,
            data: {
              type: 'CDP_RPC_REQUEST',
              channelId: token,
              id: `tamper-${token}`,
              method: 'Page.reload'
            }
          } as any);

          expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
          expect(postedToWindow).toEqual([]);
        }

        bridge.destroy();
      });

      it('CSB-1.1.6: drops mismatched channelId even when requireChannelId is false', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'known-token-123',
          requireChannelId: false
        });
        bridge.init();

        // If caller provides a token, but it does NOT match, it must be dropped
        await bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'conflicting-token-456',
            id: 'mismatch-unforced',
            method: 'Page.navigate'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        expect(postedToWindow).toEqual([]);
        bridge.destroy();
      });

      it('CSB-1.1.7: drops burst of 30 invalid unauthenticated requests without leaking memory', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'secure-token-burst',
          requireChannelId: true
        });
        bridge.init();

        for (let i = 0; i < 30; i++) {
          await bridge.handlePageMessage({
            source: window,
            data: {
              type: 'CDP_RPC_REQUEST',
              channelId: i % 2 === 0 ? undefined : `wrong-${i}`,
              id: `burst-unauth-${i}`,
              method: 'Network.enable'
            }
          } as any);
        }

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        expect((bridge as any).pendingRequests.size).toBe(0);
        expect(postedToWindow).toEqual([]);
        bridge.destroy();
      });

      it('CSB-1.1.8: accepts request when channelId exactly matches secret token', async () => {
        const expectedToken = 'valid-secure-token-ok';
        const bridge = new ContentScriptBridge({
          channelId: expectedToken,
          requireChannelId: true
        });
        bridge.init();

        context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
          const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true, result: { status: 'ok' } };
          cb?.(res);
          return res;
        });

        await bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: expectedToken,
            id: 'auth-valid',
            method: 'DOM.getDocument'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'auth-valid', method: 'DOM.getDocument' }),
          expect.any(Function)
        );

        expect(postedToWindow).toContainEqual(
          expect.objectContaining({
            type: 'CDP_RPC_RESPONSE',
            id: 'auth-valid',
            channelId: expectedToken,
            success: true
          })
        );

        bridge.destroy();
      });
    });

    describe('1.2 Origin Verification & Foreign Origin Rejection', () => {
      it('CSB-1.2.1: drops message from foreign origin (https://attacker.evil)', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-origin-test',
          requireChannelId: true
        });
        bridge.init();

        await bridge.handlePageMessage({
          source: window,
          origin: 'https://attacker.evil',
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'token-origin-test',
            id: 'evil-origin-msg',
            method: 'Page.navigate'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        expect(postedToWindow).toEqual([]);
        bridge.destroy();
      });

      it('CSB-1.2.2: drops message with domain suffix spoofing (https://target.com.attacker.evil)', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-origin-suffix',
          allowedOrigin: 'https://target.com'
        });
        bridge.init();

        await bridge.handlePageMessage({
          source: window,
          origin: 'https://target.com.attacker.evil',
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'token-origin-suffix',
            id: 'suffix-spoof',
            method: 'Network.getCookies'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        expect(postedToWindow).toEqual([]);
        bridge.destroy();
      });

      it('CSB-1.2.3: drops message with subdomain spoofing (https://evil.target.com) against exact origin', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-subdomain',
          allowedOrigin: 'https://target.com'
        });
        bridge.init();

        await bridge.handlePageMessage({
          source: window,
          origin: 'https://evil.target.com',
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'token-subdomain',
            id: 'subdomain-spoof',
            method: 'Page.navigate'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        expect(postedToWindow).toEqual([]);
        bridge.destroy();
      });

      it('CSB-1.2.4: drops message with "null" string origin (sandboxed iframe origin)', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-null-origin',
          allowedOrigin: 'https://trusted.app',
          requireOrigin: true
        });
        bridge.init();

        await bridge.handlePageMessage({
          source: window,
          origin: 'null',
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'token-null-origin',
            id: 'null-origin-msg',
            method: 'Runtime.evaluate'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        expect(postedToWindow).toEqual([]);
        bridge.destroy();
      });

      it('CSB-1.2.5: drops message when requireOrigin is true and origin is undefined or empty', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-require-orig',
          requireOrigin: true
        });
        bridge.init();

        // 1. undefined origin
        await bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'token-require-orig',
            id: 'no-orig-1',
            method: 'Page.reload'
          }
        } as any);
        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

        // 2. empty string origin
        await bridge.handlePageMessage({
          source: window,
          origin: '',
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'token-require-orig',
            id: 'empty-orig-2',
            method: 'Page.reload'
          }
        } as any);
        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

        bridge.destroy();
      });
    });

    describe('1.3 Caller Source (data.source) Spoofing Prevention', () => {
      it('CSB-1.3.1: drops message when data.source is untrusted caller', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-source-1',
          requireChannelId: true
        });
        bridge.init();

        await bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            source: 'attacker-web-script',
            channelId: 'token-source-1',
            id: 'untrusted-source-msg',
            method: 'Network.enable'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        expect(postedToWindow).toEqual([]);
        bridge.destroy();
      });

      it('CSB-1.3.2: drops message when data.source attempts reflection spoofing (xokj-bridge)', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-source-reflect',
          requireChannelId: true
        });
        bridge.init();

        await bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            source: 'xokj-bridge',
            channelId: 'token-source-reflect',
            id: 'reflect-spoof',
            method: 'Network.enable'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        expect(postedToWindow).toEqual([]);
        bridge.destroy();
      });

      it('CSB-1.3.3: drops message with competitor userscript manager sources (violentmonkey, tampermonkey)', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-competitor',
          requireChannelId: true
        });
        bridge.init();

        for (const spoofSource of ['violentmonkey', 'tampermonkey', 'greasemonkey']) {
          context.mockRuntime.sendMessage.mockClear();

          await bridge.handlePageMessage({
            source: window,
            data: {
              type: 'CDP_RPC_REQUEST',
              source: spoofSource,
              channelId: 'token-competitor',
              id: `spoof-${spoofSource}`,
              method: 'Network.enable'
            }
          } as any);

          expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        }

        bridge.destroy();
      });

      it('CSB-1.3.4: forwards message when data.source is legitimately "xokj-userscript"', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-valid-src',
          requireChannelId: true
        });
        bridge.init();

        context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
          const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true };
          cb?.(res);
          return res;
        });

        await bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            source: 'xokj-userscript',
            channelId: 'token-valid-src',
            id: 'valid-src-msg',
            method: 'Page.enable'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'valid-src-msg' }),
          expect.any(Function)
        );

        bridge.destroy();
      });
    });

    describe('1.4 Non-Window Source Isolation (event.source)', () => {
      it('CSB-1.4.1: drops message originating from an iframe window reference', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-iframe-test',
          requireChannelId: true
        });
        bridge.init();

        const mockIframeWindow = {
          postMessage: vi.fn(),
          location: { origin: 'https://example.com' }
        } as any;

        await bridge.handlePageMessage({
          source: mockIframeWindow,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'token-iframe-test',
            id: 'iframe-msg-attack',
            method: 'Page.navigate'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        expect(postedToWindow).toEqual([]);
        bridge.destroy();
      });

      it('CSB-1.4.2: drops message with null or undefined event.source', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-null-source',
          requireChannelId: true
        });
        bridge.init();

        await bridge.handlePageMessage({
          source: null,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'token-null-source',
            id: 'null-source-msg',
            method: 'Page.navigate'
          }
        } as any);
        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

        await bridge.handlePageMessage({
          source: undefined,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'token-null-source',
            id: 'undefined-source-msg',
            method: 'Page.navigate'
          }
        } as any);
        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

        bridge.destroy();
      });

      it('CSB-1.4.3: drops message with worker/object stub event.source', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-worker-test',
          requireChannelId: true
        });
        bridge.init();

        const workerStub = {
          terminate: vi.fn(),
          onmessage: null
        } as any;

        await bridge.handlePageMessage({
          source: workerStub,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'token-worker-test',
            id: 'worker-stub-msg',
            method: 'Page.navigate'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();
        bridge.destroy();
      });
    });

    describe('1.5 Anti-Spoofing: Client-Supplied data.tabId Stripping', () => {
      it('CSB-1.5.1: strictly strips client-provided tabId and never forwards it to background', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-tab-strip',
          requireChannelId: true
        });
        bridge.init();

        context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
          const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true };
          cb?.(res);
          return res;
        });

        await bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'token-tab-strip',
            id: 'spoof-tab-claim-999',
            tabId: 999999, // Attempted foreign tab targeting
            method: 'DOM.getDocument',
            params: { depth: 1 },
            scriptId: 'script-test'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).toHaveBeenCalled();
        const forwardedMessage = context.mockRuntime.sendMessage.mock.calls[0][0];

        // Must NOT contain tabId
        expect(forwardedMessage.tabId).toBeUndefined();
        expect(forwardedMessage).toEqual({
          type: 'CDP_RPC_REQUEST',
          id: 'spoof-tab-claim-999',
          method: 'DOM.getDocument',
          params: { depth: 1 },
          scriptId: 'script-test'
        });

        bridge.destroy();
      });

      it('CSB-1.5.2: strips negative and zero tabId values', async () => {
        const bridge = new ContentScriptBridge({
          channelId: 'token-negative-tab',
          requireChannelId: true
        });
        bridge.init();

        context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
          const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true };
          cb?.(res);
          return res;
        });

        for (const badTabId of [-1, 0, -9999]) {
          context.mockRuntime.sendMessage.mockClear();

          await bridge.handlePageMessage({
            source: window,
            data: {
              type: 'CDP_RPC_REQUEST',
              channelId: 'token-negative-tab',
              id: `spoof-tab-${badTabId}`,
              tabId: badTabId,
              method: 'Page.enable'
            }
          } as any);

          const forwarded = context.mockRuntime.sendMessage.mock.calls[0][0];
          expect(forwarded.tabId).toBeUndefined();
        }

        bridge.destroy();
      });

      it('CSB-1.5.3: server rejects requests claiming mismatched foreign tabId with code 403', async () => {
        const server = new CdpBridgeServer({ autoAttach: false });
        server.init();

        const response = await (server as any).processRpcRequest(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'cross-tab-attack',
            tabId: 9999, // Claimed tab
            method: 'Network.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } } // Sender tab is 42
        );

        expect(response.success).toBe(false);
        expect(response.error?.code).toBe(403);
        expect(response.error?.message).toMatch(/Security violation: Cross-tab CDP access denied/);

        server.destroy();
      });
    });

    describe('1.6 Draining on Detachment and Conflict Channel Echoing', () => {
      it('CSB-1.6.1: echoes valid channelId on detachment draining responses', async () => {
        const secretToken = 'secret-detach-echo-token';
        const bridge = new ContentScriptBridge({
          channelId: secretToken,
          requireChannelId: true
        });
        bridge.init();

        context.mockRuntime.sendMessage.mockImplementation(async () => new Promise(() => {}));

        // Enqueue 2 pending window requests
        bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: secretToken,
            id: 'detach-pending-1',
            method: 'Page.navigate'
          }
        } as any);

        bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: secretToken,
            id: 'detach-pending-2',
            method: 'DOM.getDocument'
          }
        } as any);

        expect((bridge as any).pendingRequests.size).toBe(2);
        postedToWindow = [];

        // Trigger detachment drain
        bridge.handleDetached('target_closed');

        expect((bridge as any).pendingRequests.size).toBe(0);

        // Verify window responses echo secretToken
        const responses = postedToWindow.filter((m) => m.type === 'CDP_RPC_RESPONSE');
        expect(responses.length).toBe(2);

        for (const resp of responses) {
          expect(resp).toEqual(
            expect.objectContaining({
              source: 'xokj-bridge',
              channelId: secretToken,
              success: false,
              error: expect.objectContaining({ code: 1002 })
            })
          );
        }

        // Verify lifecycle broadcast also echoes secretToken
        const lifecycleEvents = postedToWindow.filter((m) => m.type === 'CDP_LIFECYCLE_EVENT');
        expect(lifecycleEvents.length).toBe(1);
        expect(lifecycleEvents[0]).toEqual(
          expect.objectContaining({
            source: 'xokj-bridge',
            channelId: secretToken,
            status: 'DETACHED',
            reason: 'target_closed'
          })
        );

        bridge.destroy();
      });

      it('CSB-1.6.2: echoes valid channelId on DevTools conflict draining responses', async () => {
        const secretToken = 'secret-conflict-echo-token';
        const bridge = new ContentScriptBridge({
          channelId: secretToken,
          requireChannelId: true
        });
        bridge.init();

        context.mockRuntime.sendMessage.mockImplementation(async () => new Promise(() => {}));

        // Enqueue pending window request
        bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: secretToken,
            id: 'conflict-pending-1',
            method: 'Page.navigate'
          }
        } as any);

        expect((bridge as any).pendingRequests.size).toBe(1);
        postedToWindow = [];

        // Trigger conflict drain
        bridge.handleConflict('canceled_by_user');

        expect((bridge as any).pendingRequests.size).toBe(0);

        const responses = postedToWindow.filter((m) => m.type === 'CDP_RPC_RESPONSE');
        expect(responses.length).toBe(1);
        expect(responses[0]).toEqual(
          expect.objectContaining({
            source: 'xokj-bridge',
            channelId: secretToken,
            id: 'conflict-pending-1',
            success: false,
            error: expect.objectContaining({ code: 1001 })
          })
        );

        const lifecycleEvents = postedToWindow.filter((m) => m.type === 'CDP_LIFECYCLE_EVENT');
        expect(lifecycleEvents.length).toBe(1);
        expect(lifecycleEvents[0]).toEqual(
          expect.objectContaining({
            source: 'xokj-bridge',
            channelId: secretToken,
            status: 'CONFLICT',
            reason: 'canceled_by_user'
          })
        );

        bridge.destroy();
      });

      it('CSB-1.6.3: cleanly isolates programmatic send vs window requests during detachment', async () => {
        const secretToken = 'secret-mixed-queue-token';
        const bridge = new ContentScriptBridge({
          channelId: secretToken,
          requireChannelId: true
        });
        bridge.init();

        context.mockRuntime.sendMessage.mockImplementation(async () => new Promise(() => {}));

        // 1 window request
        bridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: secretToken,
            id: 'window-req-mixed',
            method: 'DOM.getDocument'
          }
        } as any);

        // 1 programmatic request
        const progPromise = bridge.send('Page.navigate', { url: 'https://example.com' });

        expect((bridge as any).pendingRequests.size).toBe(2);
        postedToWindow = [];

        // Detach
        bridge.handleDetached('target_closed');

        // Programmatic promise must reject with code 1002
        await expect(progPromise).rejects.toThrow(/CDP session detached/);
        try {
          await progPromise;
        } catch (err: any) {
          expect(err.code).toBe(1002);
        }

        // Window requests posted to window with channelId
        const windowResponses = postedToWindow.filter((m) => m.type === 'CDP_RPC_RESPONSE');
        expect(windowResponses.length).toBe(1);
        expect(windowResponses[0].id).toBe('window-req-mixed');
        expect(windowResponses[0].channelId).toBe(secretToken);

        bridge.destroy();
      });
    });

    describe('1.7 Wildcard & Array Origin Verification & Content Script Singleton Tokenless Execution', () => {
      it('CSB-1.7.1: verifyOrigin with wildcard "*" accepts any origin and forwards requests', async () => {
        const wildcardBridge = new ContentScriptBridge({
          allowedOrigin: '*'
        });
        wildcardBridge.init();

        expect(wildcardBridge.verifyOrigin('https://example.com')).toBe(true);
        expect(wildcardBridge.verifyOrigin('https://sub.domain.org:8443')).toBe(true);
        expect(wildcardBridge.verifyOrigin('http://localhost:3000')).toBe(true);
        expect(wildcardBridge.verifyOrigin('chrome-extension://abcdef')).toBe(true);

        context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
          const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true };
          cb?.(res);
          return res;
        });

        await wildcardBridge.handlePageMessage({
          source: window,
          origin: 'https://any-arbitrary-domain.com',
          data: {
            type: 'CDP_RPC_REQUEST',
            id: 'wildcard-origin-req',
            method: 'Page.enable'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'wildcard-origin-req' }),
          expect.any(Function)
        );

        wildcardBridge.destroy();
      });

      it('CSB-1.7.2: verifyOrigin with wildcard "*" and requireOrigin: true rejects missing/empty origins', () => {
        const strictWildcardBridge = new ContentScriptBridge({
          allowedOrigin: '*',
          requireOrigin: true
        });

        expect(strictWildcardBridge.verifyOrigin('https://valid.site')).toBe(true);
        expect(strictWildcardBridge.verifyOrigin(undefined)).toBe(false);
        expect(strictWildcardBridge.verifyOrigin('')).toBe(false);

        strictWildcardBridge.destroy();
      });

      it('CSB-1.7.3: verifyOrigin with origin array accepts members and drops foreign origins', async () => {
        const arrayBridge = new ContentScriptBridge({
          allowedOrigin: ['https://alpha.com', 'https://beta.com']
        });
        arrayBridge.init();

        // Valid member origins
        expect(arrayBridge.verifyOrigin('https://alpha.com')).toBe(true);
        expect(arrayBridge.verifyOrigin('https://beta.com')).toBe(true);

        // Foreign origins
        expect(arrayBridge.verifyOrigin('https://gamma.com')).toBe(false);
        expect(arrayBridge.verifyOrigin('https://alpha.com.evil.com')).toBe(false);
        expect(arrayBridge.verifyOrigin('https://alpha.com:8443')).toBe(false);
        expect(arrayBridge.verifyOrigin('http://alpha.com')).toBe(false);

        // Foreign origin message gets dropped
        await arrayBridge.handlePageMessage({
          source: window,
          origin: 'https://gamma.com',
          data: {
            type: 'CDP_RPC_REQUEST',
            id: 'foreign-array-req',
            method: 'DOM.getDocument'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

        // Allowed origin message gets forwarded
        context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
          const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true };
          cb?.(res);
          return res;
        });

        await arrayBridge.handlePageMessage({
          source: window,
          origin: 'https://alpha.com',
          data: {
            type: 'CDP_RPC_REQUEST',
            id: 'valid-member-req',
            method: 'DOM.getDocument'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'valid-member-req' }),
          expect.any(Function)
        );

        arrayBridge.destroy();
      });

      it('CSB-1.7.4: verifyOrigin with array containing wildcard ["https://alpha.com", "*"] accepts any origin', () => {
        const arrayWildcardBridge = new ContentScriptBridge({
          allowedOrigin: ['https://alpha.com', '*']
        });

        expect(arrayWildcardBridge.verifyOrigin('https://alpha.com')).toBe(true);
        expect(arrayWildcardBridge.verifyOrigin('https://unlisted-site.net')).toBe(true);

        arrayWildcardBridge.destroy();
      });

      it('CSB-1.7.5: singleton bridge from src/content/index.ts allows userscript without token to execute cleanly', async () => {
        singletonBridge.init();

        context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
          const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true, result: { done: true } };
          cb?.(res);
          return res;
        });

        postedToWindow = [];

        await singletonBridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            id: 'singleton-tokenless-req',
            method: 'DOM.getDocument'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'singleton-tokenless-req', method: 'DOM.getDocument' }),
          expect.any(Function)
        );

        expect(postedToWindow).toContainEqual(
          expect.objectContaining({
            type: 'CDP_RPC_RESPONSE',
            id: 'singleton-tokenless-req',
            success: true
          })
        );
      });

      it('CSB-1.7.6: bridges configured with explicit channelId strictly enforce token matching and drop tokenless requests', async () => {
        const customChannelBridge = new ContentScriptBridge({
          channelId: 'secure-token-999'
        });
        customChannelBridge.init();

        // Tokenless request -> dropped
        await customChannelBridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            id: 'tokenless-on-configured-bridge',
            method: 'DOM.getDocument'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

        // Mismatched token -> dropped
        await customChannelBridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'attacker-wrong-token',
            id: 'mismatched-on-configured-bridge',
            method: 'DOM.getDocument'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).not.toHaveBeenCalled();

        // Valid token -> accepted
        context.mockRuntime.sendMessage.mockImplementation(async (req: any, cb?: any) => {
          const res = { type: 'CDP_RPC_RESPONSE', id: req.id, success: true };
          cb?.(res);
          return res;
        });

        await customChannelBridge.handlePageMessage({
          source: window,
          data: {
            type: 'CDP_RPC_REQUEST',
            channelId: 'secure-token-999',
            id: 'valid-on-configured-bridge',
            method: 'DOM.getDocument'
          }
        } as any);

        expect(context.mockRuntime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'valid-on-configured-bridge' }),
          expect.any(Function)
        );

        customChannelBridge.destroy();
      });
    });
  });

  // =========================================================================
  // Section 2: CdpBridgeServer Permission Enforcement (R2 / Feature 16)
  // =========================================================================
  describe('2. CdpBridgeServer Permission Enforcement (Feature 16)', () => {
    let context: ReturnType<typeof setupChromeMock>;
    let server: CdpBridgeServer;

    beforeEach(async () => {
      context = setupChromeMock();
      await resetToDefaultScripts();

      server = new CdpBridgeServer({
        autoAttach: false,
        autoStart: true,
        timeoutMs: 1000
      });
    });

    afterEach(() => {
      server.destroy();
      vi.restoreAllMocks();
    });

    describe('2.1 Scripts Declaring @grant none CDP Rejection', () => {
      it('CDP-2.1.1: rejects command with code 403 (GRANT_NONE) when script declared @grant none', async () => {
        const script = createScriptRecord({
          id: 'script-grant-none-adv',
          name: 'Grant None Script',
          grants: ['none']
        });
        await saveScript(script);

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'grant-none-cmd-1',
            scriptId: 'script-grant-none-adv',
            method: 'Page.navigate',
            params: { url: 'https://evil.com' }
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(403);
        expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'GRANT_NONE', scriptId: 'script-grant-none-adv' }));
        expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
      });

      it('CDP-2.1.2: rejects all standard CDP domains for @grant none script', async () => {
        const script = createScriptRecord({
          id: 'script-grant-none-multi',
          grants: ['none']
        });
        await saveScript(script);

        const testMethods = [
          'Page.navigate',
          'Network.enable',
          'DOM.getDocument',
          'Runtime.evaluate',
          'Target.createTarget'
        ];

        for (const method of testMethods) {
          context.mockDebugger.sendCommand.mockClear();

          const res = await context.mockRuntime._emitMessage(
            {
              type: 'CDP_RPC_REQUEST',
              id: `req-${method}`,
              scriptId: 'script-grant-none-multi',
              method
            },
            { tab: { id: 42, url: 'https://example.com' } }
          );

          expect(res.success).toBe(false);
          expect(res.error?.code).toBe(403);
          expect(res.error?.data?.reason).toBe('GRANT_NONE');
          expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
        }
      });

      it('CDP-2.1.3: rejects even when script attempts bypass by declaring @cdp alongside @grant none', async () => {
        const script = createScriptRecord({
          id: 'script-grant-none-bypass-attempt',
          grants: ['none'],
          cdpDomains: ['Network', 'Page'] // Conflicting attempt to gain permissions
        });
        await saveScript(script);

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'bypass-test',
            scriptId: 'script-grant-none-bypass-attempt',
            method: 'Network.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(403);
        expect(res.error?.data?.reason).toBe('GRANT_NONE');
        expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
      });

      it('CDP-2.1.4: rejects even when script attempts bypass by declaring @grant GM_cdp alongside @grant none', async () => {
        const script = createScriptRecord({
          id: 'script-grant-none-gm-cdp',
          grants: ['none', 'GM_cdp'] // Both present; none must take strict precedence
        });
        await saveScript(script);

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'bypass-gm-cdp',
            scriptId: 'script-grant-none-gm-cdp',
            method: 'Page.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(403);
        expect(res.error?.data?.reason).toBe('GRANT_NONE');
        expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
      });
    });

    describe('2.2 Granular Domain Authorization Enforcement', () => {
      it('CDP-2.2.1: rejects unauthorized domain Page.navigate when script only declared Network domain', async () => {
        const script = createScriptRecord({
          id: 'script-network-only',
          cdpDomains: ['Network']
        });
        await saveScript(script);

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'unauth-domain-1',
            scriptId: 'script-network-only',
            method: 'Page.navigate',
            params: { url: 'https://malicious.org' }
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(403);
        expect(res.error?.data).toEqual(
          expect.objectContaining({
            reason: 'DOMAIN_NOT_AUTHORIZED',
            scriptId: 'script-network-only',
            requestedDomain: 'Page',
            allowedDomains: ['Network']
          })
        );
        expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
      });

      it('CDP-2.2.2: rejects high-risk domains (Runtime, Target, Browser) when script only declared Network', async () => {
        const script = createScriptRecord({
          id: 'script-network-only-high-risk',
          cdpDomains: ['Network']
        });
        await saveScript(script);

        const highRiskMethods = [
          'Runtime.evaluate',
          'Target.createTarget',
          'Browser.close',
          'DOM.getDocument'
        ];

        for (const method of highRiskMethods) {
          context.mockDebugger.sendCommand.mockClear();

          const res = await context.mockRuntime._emitMessage(
            {
              type: 'CDP_RPC_REQUEST',
              id: `high-risk-${method}`,
              scriptId: 'script-network-only-high-risk',
              method
            },
            { tab: { id: 42, url: 'https://example.com' } }
          );

          expect(res.success).toBe(false);
          expect(res.error?.code).toBe(403);
          expect(res.error?.data?.reason).toBe('DOMAIN_NOT_AUTHORIZED');
          expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
        }
      });

      it('CDP-2.2.3: allows authorized domain method Network.getCookies for Network-granted script', async () => {
        const script = createScriptRecord({
          id: 'script-network-auth',
          cdpDomains: ['Network']
        });
        await saveScript(script);

        context.mockDebugger.sendCommand.mockResolvedValueOnce({ cookies: [] });

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'auth-net-cmd',
            scriptId: 'script-network-auth',
            method: 'Network.getCookies'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );

        expect(res.success).toBe(true);
        expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
          { tabId: 42 },
          'Network.getCookies',
          {}
        );
      });

      it('CDP-2.2.4: verifies multi-domain script allows both declared domains but rejects undeclared domains', async () => {
        const script = createScriptRecord({
          id: 'script-dual-domain',
          cdpDomains: ['Network', 'DOM']
        });
        await saveScript(script);

        context.mockDebugger.sendCommand.mockResolvedValue({ ok: true });

        // 1. Network allowed
        const r1 = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'dual-1',
            scriptId: 'script-dual-domain',
            method: 'Network.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(r1.success).toBe(true);

        // 2. DOM allowed
        const r2 = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'dual-2',
            scriptId: 'script-dual-domain',
            method: 'DOM.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(r2.success).toBe(true);

        // 3. Page rejected
        const r3 = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'dual-3',
            scriptId: 'script-dual-domain',
            method: 'Page.navigate',
            params: { url: 'https://test.com' }
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(r3.success).toBe(false);
        expect(r3.error?.code).toBe(403);
        expect(r3.error?.data?.reason).toBe('DOMAIN_NOT_AUTHORIZED');
      });

      it('CDP-2.2.5: rejects script with only standard GM grants attempting CDP commands (NO_CDP_PERMISSIONS)', async () => {
        const script = createScriptRecord({
          id: 'script-gm-only',
          grants: ['GM_setValue', 'GM_getValue', 'GM_xmlhttpRequest']
        });
        await saveScript(script);

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'no-cdp-test',
            scriptId: 'script-gm-only',
            method: 'Network.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(403);
        expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'NO_CDP_PERMISSIONS', scriptId: 'script-gm-only' }));
        expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
      });

      it('CDP-2.2.6: allows all domains when script has @grant GM_cdp or wildcard grant', async () => {
        const script = createScriptRecord({
          id: 'script-full-cdp-grant',
          grants: ['GM_cdp']
        });
        await saveScript(script);

        context.mockDebugger.sendCommand.mockResolvedValue({ ok: true });

        for (const method of ['Page.enable', 'Network.enable', 'Runtime.enable']) {
          const res = await context.mockRuntime._emitMessage(
            {
              type: 'CDP_RPC_REQUEST',
              id: `wildcard-${method}`,
              scriptId: 'script-full-cdp-grant',
              method
            },
            { tab: { id: 42, url: 'https://example.com' } }
          );

          expect(res.success).toBe(true);
        }
      });
    });

    describe('2.3 Script State & Registry Existence Enforcement', () => {
      it('CDP-2.3.1: rejects non-existent script ID with code 403 (SCRIPT_NOT_FOUND)', async () => {
        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'ghost-script-test',
            scriptId: 'phantom-script-uuid-404',
            method: 'Network.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(403);
        expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'SCRIPT_NOT_FOUND', scriptId: 'phantom-script-uuid-404' }));
        expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
      });

      it('CDP-2.3.2: rejects disabled script with code 403 (SCRIPT_DISABLED)', async () => {
        const script = createScriptRecord({
          id: 'script-disabled-check',
          enabled: false,
          grants: ['GM_cdp']
        });
        await saveScript(script);

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'disabled-script-test',
            scriptId: 'script-disabled-check',
            method: 'Page.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(403);
        expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'SCRIPT_DISABLED', scriptId: 'script-disabled-check' }));
        expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
      });

      it('CDP-2.3.3: dynamically enables script execution when toggled back to enabled in storage', async () => {
        const script = createScriptRecord({
          id: 'script-toggle-test',
          enabled: false,
          grants: ['GM_cdp']
        });
        await saveScript(script);

        // 1. Initial call rejected
        const r1 = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'toggle-1',
            scriptId: 'script-toggle-test',
            method: 'Page.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(r1.success).toBe(false);
        expect(r1.error?.data?.reason).toBe('SCRIPT_DISABLED');

        // 2. Enable script
        script.enabled = true;
        await saveScript(script);
        context.mockDebugger.sendCommand.mockResolvedValueOnce({ ok: true });

        // 3. Subsequent call succeeds
        const r2 = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'toggle-2',
            scriptId: 'script-toggle-test',
            method: 'Page.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(r2.success).toBe(true);
      });
    });

    describe('2.4 Tab URL Matching & Exclusion Enforcement', () => {
      it('CDP-2.4.1: rejects command with code 403 (URL_NOT_MATCHED) when tab URL fails match pattern', async () => {
        const script = createScriptRecord({
          id: 'script-bank-protected',
          matches: ['https://online.mybank.com/*'],
          grants: ['GM_cdp']
        });
        await saveScript(script);

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'unmatched-url-test',
            scriptId: 'script-bank-protected',
            method: 'Network.getCookies'
          },
          { tab: { id: 42, url: 'https://attacker.evil.com/fake-bank' } }
        );

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(403);
        expect(res.error?.data).toEqual(
          expect.objectContaining({
            reason: 'URL_NOT_MATCHED',
            scriptId: 'script-bank-protected',
            url: 'https://attacker.evil.com/fake-bank'
          })
        );
        expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
      });

      it('CDP-2.4.2: rejects command with code 403 (URL_EXCLUDED) when tab URL matches exclude pattern', async () => {
        const script = createScriptRecord({
          id: 'script-with-exclusion',
          matches: ['*://*.corp.internal/*'],
          excludes: ['*://*.corp.internal/admin/*'],
          grants: ['GM_cdp']
        });
        await saveScript(script);

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'excluded-url-test',
            scriptId: 'script-with-exclusion',
            method: 'DOM.getDocument'
          },
          { tab: { id: 42, url: 'https://vault.corp.internal/admin/secrets' } }
        );

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(403);
        expect(res.error?.data).toEqual(
          expect.objectContaining({
            reason: 'URL_EXCLUDED',
            scriptId: 'script-with-exclusion',
            url: 'https://vault.corp.internal/admin/secrets'
          })
        );
        expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
      });

      it('CDP-2.4.3: URL exclusion cannot be bypassed via query parameters or hash fragments', async () => {
        const script = createScriptRecord({
          id: 'script-exclusion-params',
          matches: ['https://example.com/*'],
          excludes: ['https://example.com/checkout/*'],
          grants: ['GM_cdp']
        });
        await saveScript(script);

        const bypassUrls = [
          'https://example.com/checkout/step1?token=123',
          'https://example.com/checkout/step1#order-summary',
          'https://example.com/checkout/step1?ref=test#done'
        ];

        for (const testUrl of bypassUrls) {
          context.mockDebugger.sendCommand.mockClear();

          const res = await context.mockRuntime._emitMessage(
            {
              type: 'CDP_RPC_REQUEST',
              id: `excl-param-${testUrl}`,
              scriptId: 'script-exclusion-params',
              method: 'Network.getCookies'
            },
            { tab: { id: 42, url: testUrl } }
          );

          expect(res.success).toBe(false);
          expect(res.error?.code).toBe(403);
          expect(res.error?.data?.reason).toBe('URL_EXCLUDED');
          expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
        }
      });

      it('CDP-2.4.4: allows command when tab URL matches included path and is outside exclusion', async () => {
        const script = createScriptRecord({
          id: 'script-allowed-path',
          matches: ['https://example.com/*'],
          excludes: ['https://example.com/admin/*'],
          grants: ['GM_cdp']
        });
        await saveScript(script);

        context.mockDebugger.sendCommand.mockResolvedValueOnce({ ok: true });

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'allowed-url-test',
            scriptId: 'script-allowed-path',
            method: 'DOM.getDocument'
          },
          { tab: { id: 42, url: 'https://example.com/user/profile' } }
        );

        expect(res.success).toBe(true);
      });
    });

    describe('2.5 Strict Permission Mode (enforcePermissions: true)', () => {
      it('CDP-2.5.1: rejects untagged request in strict mode with code 403 (MISSING_SCRIPT_ID)', async () => {
        server.setEnforcePermissions(true);

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'strict-untagged-1',
            method: 'Network.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(403);
        expect(res.error?.data).toEqual(expect.objectContaining({ reason: 'MISSING_SCRIPT_ID' }));
        expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();

        server.setEnforcePermissions(false);
      });

      it('CDP-2.5.2: rejects empty or whitespace-only scriptId in strict mode with code 403', async () => {
        server.setEnforcePermissions(true);

        for (const badScriptId of ['', '   ', '\t\n']) {
          context.mockDebugger.sendCommand.mockClear();

          const res = await context.mockRuntime._emitMessage(
            {
              type: 'CDP_RPC_REQUEST',
              id: 'strict-bad-id',
              scriptId: badScriptId,
              method: 'Network.enable'
            },
            { tab: { id: 42, url: 'https://example.com' } }
          );

          expect(res.success).toBe(false);
          expect(res.error?.code).toBe(403);
          expect(res.error?.data?.reason).toBe('MISSING_SCRIPT_ID');
          expect(context.mockDebugger.sendCommand).not.toHaveBeenCalled();
        }

        server.setEnforcePermissions(false);
      });

      it('CDP-2.5.3: untagged request in default mode (enforcePermissions: false) bypasses check for internal callers', async () => {
        context.mockDebugger.sendCommand.mockResolvedValueOnce({ ok: true });

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'legacy-untagged-ok',
            method: 'DOM.getDocument'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );

        expect(res.success).toBe(true);
        expect(context.mockDebugger.sendCommand).toHaveBeenCalled();
      });

      it('CDP-2.5.4: toggling enforcePermissions dynamically gates untagged requests', async () => {
        context.mockDebugger.sendCommand.mockResolvedValue({ ok: true });

        // Default: false -> passes
        const r1 = await context.mockRuntime._emitMessage(
          { type: 'CDP_RPC_REQUEST', id: 'dyn-1', method: 'DOM.getDocument' },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(r1.success).toBe(true);

        // Turn ON: true -> blocked with 403
        server.setEnforcePermissions(true);
        const r2 = await context.mockRuntime._emitMessage(
          { type: 'CDP_RPC_REQUEST', id: 'dyn-2', method: 'DOM.getDocument' },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(r2.success).toBe(false);
        expect(r2.error?.data?.reason).toBe('MISSING_SCRIPT_ID');

        // Turn OFF: false -> passes again
        server.setEnforcePermissions(false);
        const r3 = await context.mockRuntime._emitMessage(
          { type: 'CDP_RPC_REQUEST', id: 'dyn-3', method: 'DOM.getDocument' },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(r3.success).toBe(true);
      });
    });

    describe('2.6 Fallback Domain Derivation from cdpDeclarations & Untagged Compatibility', () => {
      it('CDP-2.6.1: derives domains from cdpDeclarations string commands when cdpDomains is empty []', async () => {
        const script = createScriptRecord({
          id: 'script-decl-strings',
          cdpDomains: []
        });
        script.metadata.cdpDeclarations = [
          'Network.enable' as any,
          'Page.navigate' as any
        ];
        await saveScript(script);

        context.mockDebugger.sendCommand.mockResolvedValue({ ok: true });

        // Allowed: Network
        const r1 = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'decl-net-1',
            scriptId: 'script-decl-strings',
            method: 'Network.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(r1.success).toBe(true);
        expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith({ tabId: 42 }, 'Network.enable', {});

        // Allowed: Page
        const r2 = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'decl-page-1',
            scriptId: 'script-decl-strings',
            method: 'Page.navigate'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(r2.success).toBe(true);

        // Rejected: DOM (not in cdpDeclarations)
        const r3 = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'decl-dom-unauth',
            scriptId: 'script-decl-strings',
            method: 'DOM.getDocument'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(r3.success).toBe(false);
        expect(r3.error?.code).toBe(403);
        expect(r3.error?.data?.reason).toBe('DOMAIN_NOT_AUTHORIZED');
        expect(r3.error?.data?.requestedDomain).toBe('DOM');
        expect(r3.error?.data?.allowedDomains).toEqual(['Network', 'Page']);
      });

      it('CDP-2.6.2: derives domains from cdpDeclarations objects with domain or command property', async () => {
        const script = createScriptRecord({
          id: 'script-decl-objects',
          cdpDomains: []
        });
        script.metadata.cdpDeclarations = [
          { domain: 'DOM', method: 'getDocument', command: 'DOM.getDocument', params: {} },
          { domain: '', method: '', command: 'Target.setDiscoverTargets', params: {} } as any
        ];
        await saveScript(script);

        context.mockDebugger.sendCommand.mockResolvedValue({ ok: true });

        // DOM allowed via d.domain
        const rDom = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'decl-dom-ok',
            scriptId: 'script-decl-objects',
            method: 'DOM.getDocument'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(rDom.success).toBe(true);

        // Target allowed via d.command.split('.')[0]
        const rTarget = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'decl-target-ok',
            scriptId: 'script-decl-objects',
            method: 'Target.setDiscoverTargets'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(rTarget.success).toBe(true);

        // Runtime rejected
        const rRuntime = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'decl-runtime-rej',
            scriptId: 'script-decl-objects',
            method: 'Runtime.evaluate'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(rRuntime.success).toBe(false);
        expect(rRuntime.error?.data?.reason).toBe('DOMAIN_NOT_AUTHORIZED');
      });

      it('CDP-2.6.3: deduplicates domains when multiple cdpDeclarations share the same domain', async () => {
        const script = createScriptRecord({
          id: 'script-decl-dedupe',
          cdpDomains: []
        });
        script.metadata.cdpDeclarations = [
          'DOM.getDocument' as any,
          'DOM.querySelector' as any,
          'DOM.querySelectorAll' as any
        ];
        await saveScript(script);

        const sender: chrome.runtime.MessageSender = { tab: { id: 42, url: 'https://example.com' } as any };
        const req: any = { type: 'CDP_RPC_REQUEST', id: '1', scriptId: 'script-decl-dedupe', method: 'Console.enable' };

        const error = await server.validateScriptPermissions(req, sender);
        expect(error).not.toBeNull();
        expect(error?.data?.allowedDomains).toEqual(['DOM']);
      });

      it('CDP-2.6.4: derives domains from script.metadata.cdp when cdpDeclarations is missing', async () => {
        const script = createScriptRecord({
          id: 'script-decl-legacy-cdp',
          cdpDomains: []
        });
        (script.metadata as any).cdpDeclarations = undefined;
        script.metadata.cdp = [
          { domain: 'Fetch', method: 'enable', command: 'Fetch.enable', params: {} }
        ];
        await saveScript(script);

        context.mockDebugger.sendCommand.mockResolvedValue({ ok: true });

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'fetch-ok',
            scriptId: 'script-decl-legacy-cdp',
            method: 'Fetch.enable'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );
        expect(res.success).toBe(true);
      });

      it('CDP-2.6.5: rejects script with empty cdpDomains and empty cdpDeclarations with NO_CDP_PERMISSIONS', async () => {
        const script = createScriptRecord({
          id: 'script-zero-cdp',
          cdpDomains: [],
          grants: ['GM_setValue']
        });
        script.metadata.cdpDeclarations = [];
        script.metadata.cdp = [];
        await saveScript(script);

        const res = await context.mockRuntime._emitMessage(
          {
            type: 'CDP_RPC_REQUEST',
            id: 'zero-cdp-req',
            scriptId: 'script-zero-cdp',
            method: 'Page.reload'
          },
          { tab: { id: 42, url: 'https://example.com' } }
        );

        expect(res.success).toBe(false);
        expect(res.error?.code).toBe(403);
        expect(res.error?.data?.reason).toBe('NO_CDP_PERMISSIONS');
      });

      it('CDP-2.6.6: backward compatibility for untagged calls remains 100% passing across multiple commands', async () => {
        context.mockDebugger.sendCommand.mockResolvedValue({ commandExecuted: true });

        // Untagged calls across different domains in default mode
        const untaggedMethods = ['Page.reload', 'DOM.getDocument', 'Network.getCookies', 'Target.getTargets'];

        for (const method of untaggedMethods) {
          context.mockDebugger.sendCommand.mockClear();

          const res = await context.mockRuntime._emitMessage(
            {
              type: 'CDP_RPC_REQUEST',
              id: `untagged-${method}`,
              method
            },
            { tab: { id: 42, url: 'https://example.com' } }
          );

          expect(res.success).toBe(true);
          expect(res.result).toEqual({ commandExecuted: true });
          expect(context.mockDebugger.sendCommand).toHaveBeenCalledWith(
            expect.objectContaining({ tabId: 42 }),
            method,
            {}
          );
        }
      });
    });
  });
});
