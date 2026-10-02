/**
 * Empirical Challenger M3: Injector Deduplication & Storage Handler Challenger Suite
 * Location: test/unit/challenger-m3-injector-storage.spec.ts
 *
 * Rigorous empirical stress test suite verifying:
 * 1. GmStorageMessageHandler under high-volume concurrent GM_STORAGE_SET and GM_STORAGE_DELETE calls.
 * 2. Multi-frame navigation deduplication, stage scheduling, and error rollback in ScriptInjector.
 * 3. Pre-hydrated storage loading and synchronous GM_getValue execution inside pageSandboxRunner.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { GmStorageMessageHandler } from '@/background/gm-handler';
import {
  ScriptInjector,
  PrehydratedStorageLoader,
  pageSandboxRunner
} from '@/background/injector';
import { TabDebuggerManager } from '@/background/debugger-mgr';
import {
  gmStorageRepo,
  setGmValue,
  getGmValue,
  getGmValues,
  clearGmValues,
  saveScript,
  deleteScript,
  resetToDefaultScripts
} from '@/shared/storage';
import type { ScriptRecord, GmStorageResponse } from '@/shared/types';

describe('Empirical Challenger M3: Injector Deduplication & Storage Handler Suite', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let debuggerMgr: TabDebuggerManager;
  let injector: ScriptInjector;
  let handler: GmStorageMessageHandler;
  let executedScripts: any[] = [];

  beforeEach(async () => {
    context = setupChromeMock();
    executedScripts = [];

    context.mockScripting.executeScript.mockImplementation(async (opts: any) => {
      executedScripts.push(opts);
      if (typeof opts.func === 'function') {
        const res = opts.func(...opts.args);
        return [{ result: res }];
      }
      return [{ result: { success: true } }];
    });

    await clearGmValues();
    await resetToDefaultScripts();

    debuggerMgr = new TabDebuggerManager();
    await debuggerMgr.init();

    injector = new ScriptInjector({
      debuggerManager: debuggerMgr,
      autoStart: true
    });

    handler = new GmStorageMessageHandler(gmStorageRepo);
    handler.init();
  });

  afterEach(async () => {
    handler.destroy();
    injector.destroy();
    debuggerMgr.destroy();
    await clearGmValues();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Dimension 1: GmStorageMessageHandler Concurrent Mutations & Race Conditions
  // =========================================================================
  describe('Dimension 1: GmStorageMessageHandler Concurrency & Race Conditions', () => {
    it('1.1: 100 concurrent GM_STORAGE_SET operations across 10 scripts succeed with 100% data integrity', async () => {
      const scriptCount = 10;
      const writesPerScript = 10;
      const promises: Promise<GmStorageResponse>[] = [];

      for (let s = 0; s < scriptCount; s++) {
        const scriptId = `script-burst-${s}`;
        for (let w = 0; w < writesPerScript; w++) {
          const p = new Promise<GmStorageResponse>((resolve) => {
            handler.handleMessage(
              {
                type: 'GM_STORAGE_SET',
                scriptId,
                key: `field_${w}`,
                value: { scriptIndex: s, writeIndex: w, timestamp: Date.now() }
              },
              {} as any,
              resolve
            );
          });
          promises.push(p);
        }
      }

      const results = await Promise.all(promises);

      // Verify every single operation reported success
      expect(results.length).toBe(100);
      for (const res of results) {
        expect(res.success).toBe(true);
        expect(res.error).toBeUndefined();
      }

      // Verify persisted storage in gmStorageRepo for all 10 scripts
      for (let s = 0; s < scriptCount; s++) {
        const scriptId = `script-burst-${s}`;
        const storedValues = await getGmValues(scriptId);
        expect(Object.keys(storedValues).length).toBe(writesPerScript);

        for (let w = 0; w < writesPerScript; w++) {
          const val = storedValues[`field_${w}`] as any;
          expect(val).toBeDefined();
          expect(val.scriptIndex).toBe(s);
          expect(val.writeIndex).toBe(w);
        }
      }
    });

    it('1.2: 50 concurrent interleaved SET and DELETE on the SAME key maintain FIFO determinism without deadlock', async () => {
      const scriptId = 'fifo-race-script';
      const key = 'stateKey';
      const opCount = 50;
      const promises: Promise<GmStorageResponse>[] = [];

      // Even index: SET key to i
      // Odd index: DELETE key
      for (let i = 0; i < opCount; i++) {
        if (i % 2 === 0) {
          promises.push(
            new Promise<GmStorageResponse>((resolve) => {
              handler.handleMessage(
                {
                  type: 'GM_STORAGE_SET',
                  scriptId,
                  key,
                  value: `value_${i}`
                },
                {} as any,
                resolve
              );
            })
          );
        } else {
          promises.push(
            new Promise<GmStorageResponse>((resolve) => {
              handler.handleMessage(
                {
                  type: 'GM_STORAGE_DELETE',
                  scriptId,
                  key
                },
                {} as any,
                resolve
              );
            })
          );
        }
      }

      const results = await Promise.all(promises);

      expect(results.length).toBe(opCount);
      for (const res of results) {
        expect(res.success).toBe(true);
      }

      // Since opCount = 50, last op was index 49 (odd), which is DELETE!
      const finalVal = await getGmValue(scriptId, key);
      expect(finalVal).toBeUndefined();
    });

    it('1.3: Concurrent storm of mixed valid and malformed messages isolates errors cleanly', async () => {
      const validPromises: Promise<GmStorageResponse>[] = [];
      const invalidPromises: Promise<GmStorageResponse>[] = [];

      for (let i = 0; i < 40; i++) {
        // Valid SET
        validPromises.push(
          new Promise<GmStorageResponse>((resolve) => {
            handler.handleMessage(
              {
                type: 'GM_STORAGE_SET',
                scriptId: 'valid-script',
                key: `k_${i}`,
                value: i * 10
              },
              {} as any,
              resolve
            );
          })
        );

        // Invalid: missing key
        invalidPromises.push(
          new Promise<GmStorageResponse>((resolve) => {
            handler.handleMessage(
              {
                type: 'GM_STORAGE_SET',
                scriptId: 'valid-script',
                key: '',
                value: 'invalid'
              },
              {} as any,
              resolve
            );
          })
        );

        // Invalid: missing scriptId
        invalidPromises.push(
          new Promise<GmStorageResponse>((resolve) => {
            handler.handleMessage(
              {
                type: 'GM_STORAGE_DELETE',
                scriptId: '   ',
                key: `k_${i}`
              },
              {} as any,
              resolve
            );
          })
        );
      }

      const [validResults, invalidResults] = await Promise.all([
        Promise.all(validPromises),
        Promise.all(invalidPromises)
      ]);

      expect(validResults.length).toBe(40);
      for (const res of validResults) {
        expect(res.success).toBe(true);
      }

      expect(invalidResults.length).toBe(80);
      for (const res of invalidResults) {
        expect(res.success).toBe(false);
        expect(res.error).toBeDefined();
      }

      // Verify that all 40 valid keys were written successfully
      const stored = await getGmValues('valid-script');
      expect(Object.keys(stored).length).toBe(40);
      for (let i = 0; i < 40; i++) {
        expect(stored[`k_${i}`]).toBe(i * 10);
      }
    });

    it('1.4: chrome.runtime._emitMessage routes concurrent messages properly with async responses', async () => {
      const messageCount = 20;
      const emitPromises = Array.from({ length: messageCount }, (_, i) =>
        context.mockRuntime._emitMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: 'runtime-emit-script',
            key: `emitKey_${i}`,
            value: `emitVal_${i}`
          },
          {}
        )
      );

      const responses: GmStorageResponse[] = await Promise.all(emitPromises);

      expect(responses.length).toBe(messageCount);
      for (const res of responses) {
        expect(res.success).toBe(true);
      }

      const stored = await getGmValues('runtime-emit-script');
      expect(Object.keys(stored).length).toBe(messageCount);
    });
  });

  // =========================================================================
  // Dimension 2: Multi-Frame Navigation Deduplication & Stage Scheduling
  // =========================================================================
  describe('Dimension 2: Multi-Frame Deduplication & Stage Scheduling', () => {
    it('2.1: 20 subframes navigating concurrently across 2 tabs inject scripts independently with zero cross-tab leakage', async () => {
      const tabA = 101;
      const tabB = 102;
      const framesPerTab = 10;

      const multiFrameScript: ScriptRecord = {
        id: 'multi-frame-test-script',
        name: 'Multi-Frame Test Script',
        code: '// multi-frame',
        metadata: {
          name: 'Multi-Frame Test Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
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
      await deleteScript('sample-cdp-logger');
      await saveScript(multiFrameScript);

      const navPromises: Promise<void>[] = [];

      for (let f = 0; f < framesPerTab; f++) {
        navPromises.push(
          injector.handleCommitted({
            tabId: tabA,
            frameId: f,
            url: `https://example.com/tabA/frame-${f}`,
            processId: 1,
            transitionType: f === 0 ? 'link' : 'auto_subframe',
            documentId: `doc-tabA-${f}`,
            timeStamp: Date.now()
          })
        );
        navPromises.push(
          injector.handleCommitted({
            tabId: tabB,
            frameId: f,
            url: `https://example.com/tabB/frame-${f}`,
            processId: 1,
            transitionType: f === 0 ? 'link' : 'auto_subframe',
            documentId: `doc-tabB-${f}`,
            timeStamp: Date.now()
          })
        );
      }

      await Promise.all(navPromises);

      // Exactly 20 executions (10 frames x 2 tabs)
      expect(executedScripts.length).toBe(20);

      // Verify each tab and frame is marked injected
      for (let f = 0; f < framesPerTab; f++) {
        expect(injector.hasInjected(tabA, f, 'multi-frame-test-script', 'document-start')).toBe(true);
        expect(injector.hasInjected(tabB, f, 'multi-frame-test-script', 'document-start')).toBe(true);
      }

      // Closing tabA cleans tabA without touching tabB
      injector.handleTabRemoved(tabA);
      expect((injector as any).injectionHistory.has(tabA)).toBe(false);
      expect((injector as any).injectionHistory.has(tabB)).toBe(true);
      for (let f = 0; f < framesPerTab; f++) {
        expect(injector.hasInjected(tabB, f, 'multi-frame-test-script', 'document-start')).toBe(true);
      }
    });

    it('2.2: Scripts execute strictly at their configured timing stage (start, end, idle)', async () => {
      const tabId = 201;
      const url = 'https://example.com/stages';

      const scriptStart: ScriptRecord = {
        id: 'script-start-only',
        name: 'Script Start Only',
        code: '// start',
        metadata: {
          name: 'Script Start Only',
          matches: ['*://example.com/stages*'],
          matchPatterns: ['*://example.com/stages*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
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

      const scriptEnd: ScriptRecord = {
        id: 'script-end-only',
        name: 'Script End Only',
        code: '// end',
        metadata: {
          name: 'Script End Only',
          matches: ['*://example.com/stages*'],
          matchPatterns: ['*://example.com/stages*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          grants: [],
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

      const scriptIdle: ScriptRecord = {
        id: 'script-idle-only',
        name: 'Script Idle Only',
        code: '// idle',
        metadata: {
          name: 'Script Idle Only',
          matches: ['*://example.com/stages*'],
          matchPatterns: ['*://example.com/stages*'],
          includes: [],
          excludes: [],
          runAt: 'document-idle',
          grants: [],
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

      await deleteScript('sample-cdp-logger');
      await deleteScript('sample-dom-highlighter');
      await deleteScript('sample-cookie-inspector');
      await saveScript(scriptStart);
      await saveScript(scriptEnd);
      await saveScript(scriptIdle);

      // Stage 1: document-start
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-stages',
        timeStamp: Date.now()
      });

      expect(executedScripts.length).toBe(1);
      expect(executedScripts[0].args[2]).toBe('script-start-only');
      expect(injector.hasInjected(tabId, 0, 'script-start-only', 'document-start')).toBe(true);
      expect(injector.hasInjected(tabId, 0, 'script-end-only', 'document-end')).toBe(false);
      expect(injector.hasInjected(tabId, 0, 'script-idle-only', 'document-idle')).toBe(false);

      // Stage 2: document-end
      await injector.handleDOMContentLoaded({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        timeStamp: Date.now()
      });

      expect(executedScripts.length).toBe(2);
      expect(executedScripts[1].args[2]).toBe('script-end-only');
      expect(injector.hasInjected(tabId, 0, 'script-end-only', 'document-end')).toBe(true);

      // Stage 3: document-idle
      await injector.handleCompleted({
        tabId,
        frameId: 0,
        url,
        processId: 1,
        timeStamp: Date.now()
      });

      expect(executedScripts.length).toBe(3);
      expect(executedScripts[2].args[2]).toBe('script-idle-only');
      expect(injector.hasInjected(tabId, 0, 'script-idle-only', 'document-idle')).toBe(true);
    });

    it('2.3: Subframe navigation isolation: reloading subframe 1 re-injects without re-running subframe 2 or main frame', async () => {
      const tabId = 202;
      const urlMain = 'https://example.com/main';
      const urlSub1 = 'https://example.com/sub1';
      const urlSub2 = 'https://example.com/sub2';

      const universalScript: ScriptRecord = {
        id: 'universal-isolation-script',
        name: 'Universal Isolation Script',
        code: '// universal',
        metadata: {
          name: 'Universal Isolation Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: [],
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
      await deleteScript('sample-cdp-logger');
      await saveScript(universalScript);

      // Main frame navigation
      await injector.handleCommitted({
        tabId,
        frameId: 0,
        url: urlMain,
        processId: 1,
        transitionType: 'link',
        documentId: 'doc-main',
        timeStamp: Date.now()
      });
      // Subframe 1 navigation
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: urlSub1,
        processId: 1,
        transitionType: 'auto_subframe',
        documentId: 'doc-sub1',
        timeStamp: Date.now()
      });
      // Subframe 2 navigation
      await injector.handleCommitted({
        tabId,
        frameId: 2,
        url: urlSub2,
        processId: 1,
        transitionType: 'auto_subframe',
        documentId: 'doc-sub2',
        timeStamp: Date.now()
      });

      expect(executedScripts.length).toBe(3);

      // Reload subframe 1 only (with new documentId)
      await injector.handleCommitted({
        tabId,
        frameId: 1,
        url: urlSub1,
        processId: 1,
        transitionType: 'reload',
        documentId: 'doc-sub1-reloaded',
        timeStamp: Date.now()
      });

      // Exactly 1 new execution targeting frame 1
      expect(executedScripts.length).toBe(4);
      expect(executedScripts[3].target.frameIds).toEqual([1]);
      expect(injector.hasInjected(tabId, 1, 'universal-isolation-script', 'document-start')).toBe(true);
    });
  });

  // =========================================================================
  // Dimension 3: Prehydrated Storage Loading & Synchronous GM_getValue
  // =========================================================================
  describe('Dimension 3: Storage Pre-Hydration & Synchronous Sandbox Execution', () => {
    it('3.1: PrehydratedStorageLoader accurately evaluates grants with strict @grant none precedence', () => {
      const loader = new PrehydratedStorageLoader();

      const scriptWithGet: any = { metadata: { grants: ['GM_getValue'] } };
      const scriptWithSet: any = { metadata: { grants: ['GM_setValue'] } };
      const scriptWithWildcard: any = { metadata: { grants: ['*'] } };
      const scriptWithDelete: any = { metadata: { grants: ['GM_deleteValue'] } };
      const scriptWithList: any = { metadata: { grants: ['GM_listValues'] } };
      const scriptWithNone: any = { metadata: { grants: ['none', 'GM_getValue'] } };
      const scriptNoGrants: any = { metadata: { grants: [] } };
      const scriptNonStorageGrant: any = { metadata: { grants: ['GM_log', 'GM_addStyle'] } };

      expect(loader.hasStorageGrants(scriptWithGet)).toBe(true);
      expect(loader.hasStorageGrants(scriptWithSet)).toBe(true);
      expect(loader.hasStorageGrants(scriptWithWildcard)).toBe(true);
      expect(loader.hasStorageGrants(scriptWithDelete)).toBe(true);
      expect(loader.hasStorageGrants(scriptWithList)).toBe(true);
      // @grant none strictly negates storage grants
      expect(loader.hasStorageGrants(scriptWithNone)).toBe(false);
      expect(loader.hasStorageGrants(scriptNoGrants)).toBe(false);
      expect(loader.hasStorageGrants(scriptNonStorageGrant)).toBe(false);
    });

    it('3.2: executeScriptInTab pre-loads storage snapshot from repository and passes to pageSandboxRunner', async () => {
      const scriptId = 'prehydrated-test-script';

      // Pre-seed storage in repository
      await setGmValue(scriptId, 'theme', 'dark');
      await setGmValue(scriptId, 'userConfig', { level: 42, sound: true });
      await setGmValue(scriptId, 'emptyVal', null);

      let capturedInitialValues: Record<string, unknown> | undefined;

      // Mock executeScript to capture args passed to pageSandboxRunner
      context.mockScripting.executeScript.mockImplementationOnce(async (opts: any) => {
        capturedInitialValues = opts.args[5];
        return [{ result: { success: true } }];
      });

      const script: ScriptRecord = {
        id: scriptId,
        name: 'Prehydrated Script',
        code: '// test',
        metadata: {
          name: 'Prehydrated Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_getValue', 'GM_setValue'],
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

      const success = await injector.executeScriptInTab(301, 0, script, 'document-start');
      expect(success).toBe(true);

      // Verify that preloadedStorage was supplied as the 6th argument
      expect(capturedInitialValues).toBeDefined();
      expect(capturedInitialValues?.theme).toBe('dark');
      expect(capturedInitialValues?.userConfig).toEqual({ level: 42, sound: true });
      expect(capturedInitialValues?.emptyVal).toBeNull();
    });

    it('3.3: pageSandboxRunner populates scriptStore from initialValues and provides synchronous GM_getValue', () => {
      let probeResult: any = null;
      (window as any).__probe = (res: any) => {
        probeResult = res;
      };

      const code = `
        const theme = GM_getValue('theme', 'default-light');
        const count = GM_getValue('count', 0);
        const missing = GM_getValue('missingKey', 'fallback-val');
        const keys = GM_listValues();
        
        // Mutate during execution
        GM_setValue('theme', 'solarized');
        GM_setValue('newKey', 12345);
        GM_deleteValue('count');

        const updatedTheme = GM_getValue('theme');
        const deletedCount = GM_getValue('count', -1);
        const updatedKeys = GM_listValues();

        window.__probe({
          theme,
          count,
          missing,
          keys,
          updatedTheme,
          deletedCount,
          updatedKeys
        });
      `;

      const initialValues = {
        theme: 'dark',
        count: 99
      };

      const result = pageSandboxRunner(
        code,
        'Sandbox Pre-Hydration Test',
        'script-sandbox-id',
        { grants: ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues'] },
        'channel-1',
        initialValues
      );

      expect(result.success).toBe(true);
      expect(probeResult).toEqual({
        theme: 'dark',
        count: 99,
        missing: 'fallback-val',
        keys: ['theme', 'count'],
        updatedTheme: 'solarized',
        deletedCount: -1,
        updatedKeys: ['theme', 'newKey']
      });

      delete (window as any).__probe;
    });

    it('3.4: PrehydratedStorageLoader fails gracefully if repository throws and does not abort script execution', async () => {
      const scriptId = 'failing-storage-script';

      const script: ScriptRecord = {
        id: scriptId,
        name: 'Failing Storage Script',
        code: '// will run even if storage fails',
        metadata: {
          name: 'Failing Storage Script',
          matches: ['*://example.com/*'],
          matchPatterns: ['*://example.com/*'],
          includes: [],
          excludes: [],
          runAt: 'document-start',
          grants: ['GM_getValue'],
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

      // Mock getGmValues to throw
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(gmStorageRepo, 'getGmValues').mockRejectedValueOnce(new Error('Corrupt storage disk'));

      let capturedStorage: any = null;
      context.mockScripting.executeScript.mockImplementationOnce(async (opts: any) => {
        capturedStorage = opts.args[5];
        return [{ result: { success: true } }];
      });

      const success = await injector.executeScriptInTab(302, 0, script, 'document-start');

      // Injection still succeeds; preloadedStorage is undefined
      expect(success).toBe(true);
      expect(capturedStorage).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
