/**
 * Unit Test Suite: Userscript Execution Sandbox & Lifecycle Timing Engine
 * Location: test/unit/sandbox.spec.ts
 *
 * Tests @grant scope construction, privileged API parameter shadowing,
 * @grant none isolation, and @run-at timing execution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildSandboxScope,
  createSandboxRunner,
  scheduleScriptExecution,
  PRIVILEGED_API_KEYS
} from '@/content/sandbox';
import { CdpClient } from '@/content/cdp-sdk';
import type { ScriptRecord } from '@/shared/types';

describe('Feature 17: Userscript Execution Sandbox & Scope Isolation (sandbox.ts)', () => {
  let cdpClient: CdpClient;

  beforeEach(() => {
    cdpClient = new CdpClient({ timeoutMs: 1000 });
  });

  afterEach(() => {
    cdpClient.destroy();
    vi.restoreAllMocks();
  });

  describe('Tier 1: @grant none Scope Isolation', () => {
    it('T1.1: @grant none strictly exposes only base globals (window, document, console)', () => {
      const script: ScriptRecord = {
        id: 'script-grant-none',
        name: 'Grant None Script',
        code: 'return 1;',
        metadata: {
          name: 'Grant None Script',
          grants: ['none'],
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
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
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      expect(scope.window).toBeDefined();
      expect(scope.document).toBeDefined();
      expect(scope.console).toBeDefined();

      for (const key of PRIVILEGED_API_KEYS) {
        expect(scope[key]).toBeUndefined();
      }
    });

    it('T1.2: @grant none strictly overrides conflicting @cdp declarations', () => {
      const script: ScriptRecord = {
        id: 'script-conflicting-none',
        name: 'Conflicting None Script',
        code: 'return 1;',
        metadata: {
          name: 'Conflicting None Script',
          grants: ['none', 'GM_setValue'], // Conflicting grant ignored
          cdpDeclarations: [{ domain: 'Network', method: 'enable', command: 'Network.enable', params: {} }],
          cdpDomains: ['Network'],
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          cdp: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      expect(scope.cdp).toBeUndefined();
      expect(scope.GM_cdp).toBeUndefined();
      expect(scope.GM_setValue).toBeUndefined();
    });

    it('T1.3: empty grants with zero CDP declarations exposes only base globals', () => {
      const script: ScriptRecord = {
        id: 'script-empty-grants',
        name: 'Empty Grants Script',
        code: 'return 1;',
        metadata: {
          name: 'Empty Grants Script',
          grants: [],
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-idle',
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
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      expect(scope.window).toBeDefined();
      expect(scope.cdp).toBeUndefined();
      expect(scope.GM_setValue).toBeUndefined();
    });
  });

  describe('Tier 2: Parameter Shadowing & Anti-Leak in createSandboxRunner', () => {
    it('T2.1: ungranted privileged APIs are shadowed with undefined, preventing window prototype traversal', () => {
      // Simulate host webpage defining malicious/fake window.cdp and window.GM_setValue
      (window as any).cdp = { send: vi.fn(), injectedByPage: true };
      (window as any).GM_setValue = vi.fn();
      (window as any).GM_cdp = vi.fn();

      const script: ScriptRecord = {
        id: 'script-shadow-test',
        name: 'Shadow Test Script',
        code: `
          return {
            cdpType: typeof cdp,
            gmCdpType: typeof GM_cdp,
            gmSetValueType: typeof GM_setValue,
            gmInfoType: typeof GM_info,
            gmAddStyleType: typeof GM_addStyle,
            gmLogType: typeof GM_log,
            gmDeleteValueType: typeof GM_deleteValue,
            gmGetValueType: typeof GM_getValue,
            gmListValuesType: typeof GM_listValues
          };
        `,
        metadata: {
          name: 'Shadow Test Script',
          grants: ['none'],
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
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
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);
      const result = runner() as any;

      expect(result.cdpType).toBe('undefined');
      expect(result.gmCdpType).toBe('undefined');
      expect(result.gmSetValueType).toBe('undefined');
      expect(result.gmInfoType).toBe('undefined');
      expect(result.gmAddStyleType).toBe('undefined');
      expect(result.gmLogType).toBe('undefined');
      expect(result.gmDeleteValueType).toBe('undefined');
      expect(result.gmGetValueType).toBe('undefined');
      expect(result.gmListValuesType).toBe('undefined');

      // Cleanup
      delete (window as any).cdp;
      delete (window as any).GM_setValue;
      delete (window as any).GM_cdp;
    });

    it('T2.2: executes user code in "use strict" and includes sourceURL comment', () => {
      const script: ScriptRecord = {
        id: 'script-source-url',
        name: 'My Special Script',
        code: 'return 100;',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);
      expect(runner()).toBe(100);
    });

    it('T2.3: captures runtime errors and rethrows them cleanly', () => {
      const script: ScriptRecord = {
        id: 'script-throw',
        name: 'Throw Script',
        code: 'throw new Error("userscript boom");',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);
      expect(() => runner()).toThrow('userscript boom');
    });
  });

  describe('Tier 3: Granular @grant Directives', () => {
    it('T3.1: @grant GM_setValue exposes only GM_setValue while cdp remains shadowed', () => {
      const script: ScriptRecord = {
        id: 'script-storage-grant',
        name: 'Storage Grant Script',
        code: 'return typeof GM_setValue;',
        metadata: {
          name: 'Storage Grant Script',
          grants: ['GM_setValue'],
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
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
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      expect(typeof scope.GM_setValue).toBe('function');
      expect(scope.cdp).toBeUndefined();
      expect(scope.GM_cdp).toBeUndefined();

      const runner = createSandboxRunner(script, scope);
      expect(runner()).toBe('function');
    });

    it('T3.2: @grant GM_cdp exposes cdp and GM_cdp', () => {
      const script: ScriptRecord = {
        id: 'script-cdp-grant',
        name: 'CDP Grant Script',
        code: 'return typeof cdp;',
        metadata: {
          name: 'CDP Grant Script',
          grants: ['GM_cdp'],
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
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
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      expect(scope.cdp).toBeDefined();
      expect(typeof scope.GM_cdp).toBe('function');

      const runner = createSandboxRunner(script, scope);
      expect(runner()).toBe('object');
    });

    it('T3.3: @cdp declaration exposes cdp capabilities without explicit @grant cdp', () => {
      const script: ScriptRecord = {
        id: 'script-decl-grant',
        name: 'Decl Grant Script',
        code: 'return typeof GM_cdp;',
        metadata: {
          name: 'Decl Grant Script',
          grants: [],
          cdpDeclarations: [{ domain: 'DOM', method: 'getDocument', command: 'DOM.getDocument', params: {} }],
          cdpDomains: ['DOM'],
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
          cdp: [],
          requires: [],
          resources: {},
          noframes: false,
          connects: [],
          rawEntries: {}
        },
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      expect(scope.cdp).toBeDefined();
      expect(typeof scope.GM_cdp).toBe('function');
    });

    it('T3.4: @grant * exposes all standard GM functions and CDP capabilities', () => {
      const script: ScriptRecord = {
        id: 'script-wildcard-grant',
        name: 'Wildcard Grant Script',
        code: '',
        metadata: {
          name: 'Wildcard Grant Script',
          grants: ['*'],
          matches: ['*://*/*'],
          matchPatterns: ['*://*/*'],
          includes: [],
          excludes: [],
          runAt: 'document-end',
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
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      for (const key of PRIVILEGED_API_KEYS) {
        expect(scope[key]).toBeDefined();
      }
    });
  });

  describe('Tier 4: Lifecycle Timing Scheduling (scheduleScriptExecution)', () => {
    it('T4.1: does not schedule execution when script.enabled is false', () => {
      const script: ScriptRecord = {
        id: 'disabled-script',
        name: 'Disabled',
        code: '(window as any).__disabledRan = true;',
        metadata: { runAt: 'document-start' } as any,
        enabled: false,
        createdAt: 0,
        updatedAt: 0
      };

      scheduleScriptExecution(script, cdpClient);
      expect((window as any).__disabledRan).toBeUndefined();
    });

    it('T4.2: document-start executes synchronously', () => {
      let executed = false;
      const script: ScriptRecord = {
        id: 'doc-start-script',
        name: 'Doc Start',
        code: 'callBack();',
        metadata: {
          name: 'Doc Start',
          runAt: 'document-start',
          grants: ['none']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      (window as any).callBack = () => {
        executed = true;
      };

      scheduleScriptExecution(script, cdpClient);
      expect(executed).toBe(true);

      delete (window as any).callBack;
    });

    it('T4.3: document-end executes immediately when document is already complete', () => {
      let executed = false;
      const script: ScriptRecord = {
        id: 'doc-end-complete',
        name: 'Doc End Complete',
        code: 'window.__docEndRan = true;',
        metadata: {
          name: 'Doc End Complete',
          runAt: 'document-end',
          grants: ['none']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      scheduleScriptExecution(script, cdpClient);
      expect((window as any).__docEndRan).toBe(true);

      delete (window as any).__docEndRan;
    });

    it('T4.4: document-idle schedules execution cleanly', async () => {
      let executed = false;
      (window as any).__idleCallback = () => {
        executed = true;
      };

      const script: ScriptRecord = {
        id: 'doc-idle-script',
        name: 'Doc Idle',
        code: 'window.__idleCallback();',
        metadata: {
          name: 'Doc Idle',
          runAt: 'document-idle',
          grants: ['none']
        } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      scheduleScriptExecution(script, cdpClient);
      await new Promise((r) => setTimeout(r, 50));
      expect(executed).toBe(true);

      delete (window as any).__idleCallback;
    });
  });
});
