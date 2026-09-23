/**
 * Empirical Challenger M4-2 Adversarial Test Suite:
 * Userscript Sandbox Closure Isolation & Parameter Shadowing (R3 / Feature 17)
 * and Secure GM Storage Isolation & Tampering Resistance (R4 / Feature 18).
 *
 * Location: test/unit/challenger-m4-2.spec.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildSandboxScope,
  createSandboxRunner,
  PRIVILEGED_API_KEYS
} from '@/content/sandbox';
import {
  CdpClient,
  createGmApi,
  clearIsolatedGmStorage,
  getIsolatedScriptStore
} from '@/content/cdp-sdk';
import { pageSandboxRunner } from '@/background/injector';
import type { ScriptRecord } from '@/shared/types';

describe('Empirical Challenger M4-2: Sandbox Closure Isolation & GM Storage Tamper-Resistance', () => {
  let cdpClient: CdpClient;

  // Track host polluted properties for guaranteed cleanup
  const hostPoisonedKeys = [
    'cdp',
    'GM_cdp',
    'GM_setValue',
    'GM_getValue',
    'GM_deleteValue',
    'GM_listValues',
    'GM_addStyle',
    'GM_log',
    'GM_info',
    '__xokj_cdp',
    '__challengerResults',
    '__testResult'
  ];

  beforeEach(() => {
    cdpClient = new CdpClient({ timeoutMs: 1000 });
    clearIsolatedGmStorage();
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear();
    }
  });

  afterEach(() => {
    cdpClient.destroy();
    clearIsolatedGmStorage();

    // Clean up window pollution
    if (typeof window !== 'undefined') {
      for (const key of hostPoisonedKeys) {
        try {
          delete (window as any)[key];
        } catch {}
      }
      if (window.localStorage) {
        window.localStorage.clear();
      }
    }

    // Clean up prototype pollution
    for (const key of hostPoisonedKeys) {
      try {
        delete (Object.prototype as any)[key];
      } catch {}
      try {
        delete (Function.prototype as any)[key];
      } catch {}
    }

    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION 1: Userscript Sandbox Closure Isolation & Parameter Shadowing (R3)
  // =========================================================================

  describe('Section 1: Host Webpage Global Pollution vs @grant none Userscripts', () => {
    beforeEach(() => {
      // Host webpage aggressively pollutes globals with mock traps
      (window as any).cdp = {
        send: vi.fn(() => Promise.reject(new Error('HOST_CDP_ACCESSED'))),
        isHostMalicious: true,
        secretToken: 'LEAKED_HOST_TOKEN'
      };
      (window as any).GM_cdp = vi.fn(() => Promise.reject(new Error('HOST_GM_CDP_ACCESSED')));
      (window as any).GM_setValue = vi.fn(() => 'HOST_POLLUTED_SET');
      (window as any).GM_getValue = vi.fn(() => 'HOST_POLLUTED_GET');
      (window as any).GM_deleteValue = vi.fn(() => 'HOST_POLLUTED_DELETE');
      (window as any).GM_listValues = vi.fn(() => ['HOST_PWNED_KEY']);
      (window as any).GM_addStyle = vi.fn(() => document.createElement('style'));
      (window as any).GM_log = vi.fn(() => 'HOST_POLLUTED_LOG');
      (window as any).GM_info = { scriptHandler: 'HOST_ATTACKER_HANDLER', version: '999.0.0' };
    });

    it('1.1: createSandboxRunner: @grant none script bare identifiers strictly evaluate to undefined', () => {
      const script: ScriptRecord = {
        id: 'challenger-grant-none-csr',
        name: 'Challenger Grant None CSR',
        code: `
          return {
            cdpType: typeof cdp,
            cdpVal: cdp,
            gmCdpType: typeof GM_cdp,
            gmCdpVal: GM_cdp,
            gmSetValueType: typeof GM_setValue,
            gmSetValueVal: GM_setValue,
            gmGetValueType: typeof GM_getValue,
            gmGetValueVal: GM_getValue,
            gmDeleteValueType: typeof GM_deleteValue,
            gmDeleteValueVal: GM_deleteValue,
            gmListValuesType: typeof GM_listValues,
            gmListValuesVal: GM_listValues,
            gmAddStyleType: typeof GM_addStyle,
            gmAddStyleVal: GM_addStyle,
            gmLogType: typeof GM_log,
            gmLogVal: GM_log,
            gmInfoType: typeof GM_info,
            gmInfoVal: GM_info
          };
        `,
        metadata: {
          name: 'Challenger Grant None CSR',
          grants: ['none'],
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
      const runner = createSandboxRunner(script, scope);
      const result = runner() as Record<string, unknown>;

      const expectedMap: Record<string, { typeKey: string; valKey: string }> = {
        cdp: { typeKey: 'cdpType', valKey: 'cdpVal' },
        GM_cdp: { typeKey: 'gmCdpType', valKey: 'gmCdpVal' },
        GM_info: { typeKey: 'gmInfoType', valKey: 'gmInfoVal' },
        GM_setValue: { typeKey: 'gmSetValueType', valKey: 'gmSetValueVal' },
        GM_getValue: { typeKey: 'gmGetValueType', valKey: 'gmGetValueVal' },
        GM_deleteValue: { typeKey: 'gmDeleteValueType', valKey: 'gmDeleteValueVal' },
        GM_listValues: { typeKey: 'gmListValuesType', valKey: 'gmListValuesVal' },
        GM_addStyle: { typeKey: 'gmAddStyleType', valKey: 'gmAddStyleVal' },
        GM_log: { typeKey: 'gmLogType', valKey: 'gmLogVal' }
      };

      for (const key of PRIVILEGED_API_KEYS) {
        const { typeKey, valKey } = expectedMap[key];
        expect(result[typeKey], `${key} must have typeof 'undefined'`).toBe('undefined');
        expect(result[valKey], `${key} must strictly equal undefined`).toBeUndefined();
      }

      // Verify host polluted globals were never invoked
      expect((window as any).GM_setValue).not.toHaveBeenCalled();
      expect((window as any).GM_getValue).not.toHaveBeenCalled();
      expect((window as any).GM_deleteValue).not.toHaveBeenCalled();
      expect((window as any).GM_listValues).not.toHaveBeenCalled();
      expect((window as any).GM_addStyle).not.toHaveBeenCalled();
      expect((window as any).GM_log).not.toHaveBeenCalled();
      expect((window as any).GM_cdp).not.toHaveBeenCalled();
      expect((window as any).cdp.send).not.toHaveBeenCalled();
    });

    it('1.2: pageSandboxRunner: @grant none script bare identifiers strictly evaluate to undefined', () => {
      const code = `
        window.__challengerResults = {
          cdpType: typeof cdp,
          cdpVal: cdp,
          gmCdpType: typeof GM_cdp,
          gmCdpVal: GM_cdp,
          gmSetValueType: typeof GM_setValue,
          gmSetValueVal: GM_setValue,
          gmGetValueType: typeof GM_getValue,
          gmGetValueVal: GM_getValue,
          gmDeleteValueType: typeof GM_deleteValue,
          gmDeleteValueVal: GM_deleteValue,
          gmListValuesType: typeof GM_listValues,
          gmListValuesVal: GM_listValues,
          gmAddStyleType: typeof GM_addStyle,
          gmAddStyleVal: GM_addStyle,
          gmLogType: typeof GM_log,
          gmLogVal: GM_log,
          gmInfoType: typeof GM_info,
          gmInfoVal: GM_info
        };
      `;

      const result = pageSandboxRunner(
        code,
        'Challenger Grant None PSR',
        'script-grant-none-psr',
        {
          grants: ['none']
        }
      );

      expect(result.success).toBe(true);
      const res = (window as any).__challengerResults;
      expect(res).toBeDefined();

      expect(res.cdpType).toBe('undefined');
      expect(res.cdpVal).toBeUndefined();
      expect(res.gmCdpType).toBe('undefined');
      expect(res.gmCdpVal).toBeUndefined();
      expect(res.gmSetValueType).toBe('undefined');
      expect(res.gmSetValueVal).toBeUndefined();
      expect(res.gmGetValueType).toBe('undefined');
      expect(res.gmGetValueVal).toBeUndefined();
      expect(res.gmDeleteValueType).toBe('undefined');
      expect(res.gmDeleteValueVal).toBeUndefined();
      expect(res.gmListValuesType).toBe('undefined');
      expect(res.gmListValuesVal).toBeUndefined();
      expect(res.gmAddStyleType).toBe('undefined');
      expect(res.gmAddStyleVal).toBeUndefined();
      expect(res.gmLogType).toBe('undefined');
      expect(res.gmLogVal).toBeUndefined();
      expect(res.gmInfoType).toBe('undefined');
      expect(res.gmInfoVal).toBeUndefined();

      // Ensure zero host function invocation
      expect((window as any).GM_setValue).not.toHaveBeenCalled();
      expect((window as any).GM_log).not.toHaveBeenCalled();
      expect((window as any).cdp.send).not.toHaveBeenCalled();
    });

    it('1.3: invoking shadowed identifiers in @grant none userscripts throws TypeError and does not call host', () => {
      const code = `
        const errors = {};
        try { cdp.send('Page.enable'); } catch (e) { errors.cdp = e.name; }
        try { GM_cdp('Page.enable'); } catch (e) { errors.GM_cdp = e.name; }
        try { GM_setValue('k', 'v'); } catch (e) { errors.GM_setValue = e.name; }
        try { GM_log('test'); } catch (e) { errors.GM_log = e.name; }
        try { GM_addStyle('body{}'); } catch (e) { errors.GM_addStyle = e.name; }
        window.__challengerErrors = errors;
      `;

      const result = pageSandboxRunner(
        code,
        'Invoke Shadowed Test',
        'script-invoke-shadowed',
        { grants: ['none'] }
      );

      expect(result.success).toBe(true);
      const errors = (window as any).__challengerErrors;
      expect(errors.cdp).toBe('TypeError');
      expect(errors.GM_cdp).toBe('TypeError');
      expect(errors.GM_setValue).toBe('TypeError');
      expect(errors.GM_log).toBe('TypeError');
      expect(errors.GM_addStyle).toBe('TypeError');

      // Verify none of the polluted host methods were ever reached
      expect((window as any).cdp.send).not.toHaveBeenCalled();
      expect((window as any).GM_cdp).not.toHaveBeenCalled();
      expect((window as any).GM_setValue).not.toHaveBeenCalled();
      expect((window as any).GM_log).not.toHaveBeenCalled();
      expect((window as any).GM_addStyle).not.toHaveBeenCalled();

      delete (window as any).__challengerErrors;
    });

    it('1.4: nested closures inside userscript preserve parameter shadowing to undefined', () => {
      const script: ScriptRecord = {
        id: 'nested-closure-script',
        name: 'Nested Closure Test',
        code: `
          function getClosureScope() {
            const nested = () => ({
              innerCdp: typeof cdp,
              innerGMSet: typeof GM_setValue,
              innerGMLog: typeof GM_log
            });
            return nested();
          }
          return getClosureScope();
        `,
        metadata: { grants: ['none'] } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);
      const closureRes = runner() as any;

      expect(closureRes.innerCdp).toBe('undefined');
      expect(closureRes.innerGMSet).toBe('undefined');
      expect(closureRes.innerGMLog).toBe('undefined');
    });

    it('1.5: empty grants [] without CDP declarations strictly shadows all 9 privileged APIs with undefined', () => {
      const script: ScriptRecord = {
        id: 'empty-grants-script',
        name: 'Empty Grants Test',
        code: `
          return {
            cdp: typeof cdp,
            GM_cdp: typeof GM_cdp,
            GM_setValue: typeof GM_setValue,
            GM_getValue: typeof GM_getValue,
            GM_deleteValue: typeof GM_deleteValue,
            GM_listValues: typeof GM_listValues,
            GM_addStyle: typeof GM_addStyle,
            GM_log: typeof GM_log,
            GM_info: typeof GM_info
          };
        `,
        metadata: { grants: [] } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);
      const res = runner() as Record<string, string>;

      for (const key of PRIVILEGED_API_KEYS) {
        expect(res[key]).toBe('undefined');
      }
    });
  });

  describe('Section 2: Ungranted API Shadowing with Granular Grants', () => {
    beforeEach(() => {
      // Host webpage pollutes window with traps
      (window as any).cdp = { send: vi.fn(), hostPolluted: true };
      (window as any).GM_cdp = vi.fn();
      (window as any).GM_setValue = vi.fn();
      (window as any).GM_log = vi.fn();
      (window as any).GM_addStyle = vi.fn();
    });

    it('2.1: script with only @grant GM_setValue: GM_setValue is functional, but cdp and other APIs are shadowed as undefined', () => {
      // 1. Test createSandboxRunner
      const script: ScriptRecord = {
        id: 'script-granular-setvalue',
        name: 'Granular GM_setValue',
        code: `
          GM_setValue('test_key', 'stored_value');
          return {
            gmSetValueType: typeof GM_setValue,
            cdpType: typeof cdp,
            gmCdpType: typeof GM_cdp,
            gmLogType: typeof GM_log,
            gmAddStyleType: typeof GM_addStyle
          };
        `,
        metadata: { grants: ['GM_setValue'] } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);
      const resCSR = runner() as any;

      expect(resCSR.gmSetValueType).toBe('function');
      expect(resCSR.cdpType).toBe('undefined');
      expect(resCSR.gmCdpType).toBe('undefined');
      expect(resCSR.gmLogType).toBe('undefined');
      expect(resCSR.gmAddStyleType).toBe('undefined');

      // 2. Test pageSandboxRunner
      const codePSR = `
        GM_setValue('test_psr', 777);
        window.__granularPSR = {
          gmSetValueType: typeof GM_setValue,
          cdpType: typeof cdp,
          gmCdpType: typeof GM_cdp,
          gmLogType: typeof GM_log,
          gmAddStyleType: typeof GM_addStyle
        };
      `;

      const psrResult = pageSandboxRunner(
        codePSR,
        'Granular PSR',
        'script-granular-psr',
        { grants: ['GM_setValue'] }
      );

      expect(psrResult.success).toBe(true);
      const resPSR = (window as any).__granularPSR;
      expect(resPSR.gmSetValueType).toBe('function');
      expect(resPSR.cdpType).toBe('undefined');
      expect(resPSR.gmCdpType).toBe('undefined');
      expect(resPSR.gmLogType).toBe('undefined');
      expect(resPSR.gmAddStyleType).toBe('undefined');

      delete (window as any).__granularPSR;
    });

    it('2.2: script with only @grant GM_log: GM_log is functional, while cdp, GM_setValue, GM_addStyle are shadowed as undefined', () => {
      const script: ScriptRecord = {
        id: 'script-granular-log',
        name: 'Granular GM_log',
        code: `
          GM_log('Userscript log entry');
          return {
            gmLogType: typeof GM_log,
            cdpType: typeof cdp,
            gmSetValueType: typeof GM_setValue,
            gmAddStyleType: typeof GM_addStyle
          };
        `,
        metadata: { grants: ['GM_log'] } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);
      const res = runner() as any;

      expect(res.gmLogType).toBe('function');
      expect(res.cdpType).toBe('undefined');
      expect(res.gmSetValueType).toBe('undefined');
      expect(res.gmAddStyleType).toBe('undefined');
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('2.3: script with only @grant GM_cdp: cdp and GM_cdp are active, but storage and styling APIs remain shadowed as undefined', () => {
      const script: ScriptRecord = {
        id: 'script-granular-cdp',
        name: 'Granular GM_cdp',
        code: `
          return {
            cdpType: typeof cdp,
            gmCdpType: typeof GM_cdp,
            gmSetValueType: typeof GM_setValue,
            gmGetValueType: typeof GM_getValue,
            gmAddStyleType: typeof GM_addStyle,
            gmLogType: typeof GM_log
          };
        `,
        metadata: { grants: ['GM_cdp'] } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);
      const res = runner() as any;

      expect(res.cdpType).toBe('object');
      expect(res.gmCdpType).toBe('function');
      expect(res.gmSetValueType).toBe('undefined');
      expect(res.gmGetValueType).toBe('undefined');
      expect(res.gmAddStyleType).toBe('undefined');
      expect(res.gmLogType).toBe('undefined');
    });
  });

  describe('Section 3: Prototype Chain Walk & Pollution Attacks', () => {
    beforeEach(() => {
      // Host webpage aggressively injects traps directly onto Object.prototype and Function.prototype
      (Object.prototype as any).cdp = {
        protoPoison: true,
        send: vi.fn(() => Promise.reject(new Error('PROTO_POISON_CDP_TRIGGERED')))
      };
      (Object.prototype as any).GM_cdp = vi.fn(() => 'PROTO_POISON_GM_CDP');
      (Object.prototype as any).GM_setValue = vi.fn(() => 'PROTO_POISON_SET');
      (Object.prototype as any).GM_getValue = vi.fn(() => 'PROTO_POISON_GET');
      (Object.prototype as any).GM_deleteValue = vi.fn(() => 'PROTO_POISON_DEL');
      (Object.prototype as any).GM_listValues = vi.fn(() => ['PROTO_POISON_KEY']);
      (Object.prototype as any).GM_addStyle = vi.fn(() => 'PROTO_POISON_STYLE');
      (Object.prototype as any).GM_log = vi.fn(() => 'PROTO_POISON_LOG');
      (Object.prototype as any).GM_info = { protoPoison: true, version: '0.0.0-pwned' };

      (Function.prototype as any).cdp = { funcProtoPoison: true };
      (Function.prototype as any).GM_setValue = vi.fn(() => 'FUNC_PROTO_POISON');
    });

    it('3.1a: createSandboxRunner: prototype pollution on Object.prototype does not bypass closure parameter shadowing in @grant none script', () => {
      const script: ScriptRecord = {
        id: 'script-proto-bypass-csr',
        name: 'Prototype Bypass Test CSR',
        code: `
          return {
            cdp: cdp,
            cdpType: typeof cdp,
            gmSetValue: GM_setValue,
            gmSetValueType: typeof GM_setValue,
            gmLog: GM_log,
            gmLogType: typeof GM_log,
            gmAddStyle: GM_addStyle,
            gmAddStyleType: typeof GM_addStyle
          };
        `,
        metadata: { grants: ['none'] } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);
      const resCSR = runner() as any;

      expect(resCSR.cdp).toBeUndefined();
      expect(resCSR.cdpType).toBe('undefined');
      expect(resCSR.gmSetValue).toBeUndefined();
      expect(resCSR.gmSetValueType).toBe('undefined');
      expect(resCSR.gmLog).toBeUndefined();
      expect(resCSR.gmLogType).toBe('undefined');
      expect(resCSR.gmAddStyle).toBeUndefined();
      expect(resCSR.gmAddStyleType).toBe('undefined');
    });

    it('3.1b: pageSandboxRunner: prototype pollution on Object.prototype does not bypass closure parameter shadowing in @grant none script', () => {
      const codePSR = `
        window.__protoPSRResult = {
          cdp: cdp,
          cdpType: typeof cdp,
          gmSetValue: GM_setValue,
          gmSetValueType: typeof GM_setValue
        };
      `;

      const psrResult = pageSandboxRunner(
        codePSR,
        'Proto PSR Test',
        'script-proto-psr',
        { grants: ['none'] }
      );

      expect(psrResult.success).toBe(true);
      const resPSR = (window as any).__protoPSRResult;
      expect(resPSR.cdp).toBeUndefined();
      expect(resPSR.cdpType).toBe('undefined');
      expect(resPSR.gmSetValue).toBeUndefined();
      expect(resPSR.gmSetValueType).toBe('undefined');

      // Ensure Object.prototype poisoned spies were not invoked
      expect((Object.prototype as any).GM_setValue).not.toHaveBeenCalled();
      expect((Object.prototype as any).cdp.send).not.toHaveBeenCalled();

      delete (window as any).__protoPSRResult;
    });

    it('3.1c: createSandboxRunner: granular grant @grant GM_setValue under Object.prototype.cdp pollution', () => {
      const script: ScriptRecord = {
        id: 'script-proto-granular',
        name: 'Proto Granular CSR',
        code: `
          return {
            cdp: cdp,
            cdpType: typeof cdp,
            gmSetValueType: typeof GM_setValue
          };
        `,
        metadata: { grants: ['GM_setValue'] } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);
      const res = runner() as any;

      expect(res.gmSetValueType).toBe('function');
      // cdp is ungranted and should be shadowed with undefined, but fails if prototype pollution bypasses it
      expect(res.cdp).toBeUndefined();
      expect(res.cdpType).toBe('undefined');
    });

    it('3.2: calling shadowed identifier under Object.prototype pollution fails cleanly with TypeError and does not execute poisoned method', () => {
      const code = `
        let caughtErr = null;
        try {
          cdp.send('Page.navigate');
        } catch (e) {
          caughtErr = e.name;
        }
        window.__protoCallResult = caughtErr;
      `;

      const result = pageSandboxRunner(
        code,
        'Proto Call Test',
        'script-proto-call',
        { grants: ['none'] }
      );

      expect(result.success).toBe(true);
      expect((window as any).__protoCallResult).toBe('TypeError');
      expect((Object.prototype as any).cdp.send).not.toHaveBeenCalled();

      delete (window as any).__protoCallResult;
    });

    it('3.3: strict mode execution in createSandboxRunner prevents "this" walk to poisoned global or prototypes', () => {
      const script: ScriptRecord = {
        id: 'script-this-walk',
        name: 'This Walk Attack',
        code: `
          // In "use strict", bare this is undefined
          const thisVal = this;
          let thisCdp = null;
          try {
            thisCdp = this.cdp;
          } catch (e) {
            thisCdp = 'THREW_TYPE_ERROR';
          }
          return { thisVal, thisCdp };
        `,
        metadata: { grants: ['none'] } as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scope = buildSandboxScope(script, cdpClient);
      const runner = createSandboxRunner(script, scope);
      const res = runner() as any;

      expect(res.thisVal).toBeUndefined();
      expect(res.thisCdp).toBe('THREW_TYPE_ERROR');
    });
  });

  // =========================================================================
  // SECTION 2: Secure GM Storage Isolation & Tampering Resistance (R4)
  // =========================================================================

  describe('Section 4: Zero window.localStorage Reads, Writes or Modifications', () => {
    it('4.1: createGmApi: GM_setValue, GM_getValue, GM_deleteValue, GM_listValues produce ZERO calls to localStorage', () => {
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');
      const clearSpy = vi.spyOn(Storage.prototype, 'clear');
      const keySpy = vi.spyOn(Storage.prototype, 'key');

      const script: ScriptRecord = {
        id: 'zero-ls-script',
        name: 'Zero LocalStorage Script',
        code: '',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient) as any;

      // 1. Set values
      api.GM_setValue('key1', 'value1');
      api.GM_setValue('key2', { nested: [1, 2, 3] });
      api.GM_setValue('key3', 42);

      // 2. Read values
      expect(api.GM_getValue('key1')).toBe('value1');
      expect(api.GM_getValue('key2')).toEqual({ nested: [1, 2, 3] });
      expect(api.GM_getValue('key3')).toBe(42);
      expect(api.GM_getValue('missingKey', 'defaultVal')).toBe('defaultVal');

      // 3. List values
      const keys = api.GM_listValues();
      expect(keys).toEqual(['key1', 'key2', 'key3']);

      // 4. Delete value
      api.GM_deleteValue('key2');
      expect(api.GM_getValue('key2')).toBeUndefined();
      expect(api.GM_listValues()).toEqual(['key1', 'key3']);

      // Verify ZERO interactions with window.localStorage
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(getItemSpy).not.toHaveBeenCalled();
      expect(removeItemSpy).not.toHaveBeenCalled();
      expect(clearSpy).not.toHaveBeenCalled();
      expect(keySpy).not.toHaveBeenCalled();

      // Verify physical localStorage state
      expect(window.localStorage.length).toBe(0);
      expect(window.localStorage.getItem('key1')).toBeNull();
      expect(window.localStorage.getItem('key2')).toBeNull();
      expect(window.localStorage.getItem('__xokj_zero-ls-script_key1')).toBeNull();
      expect(window.localStorage.getItem('xokj_zero-ls-script_key1')).toBeNull();
    });

    it('4.2: pageSandboxRunner: userscript storage operations produce ZERO calls to localStorage', () => {
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
      const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');
      const clearSpy = vi.spyOn(Storage.prototype, 'clear');

      const code = `
        GM_setValue('session_token', 'psr_secret_abc123');
        GM_setValue('count', 10);
        const retrievedToken = GM_getValue('session_token');
        const listBefore = GM_listValues();
        GM_deleteValue('count');
        const listAfter = GM_listValues();

        window.__storagePSRResult = {
          retrievedToken,
          listBefore,
          listAfter
        };
      `;

      const result = pageSandboxRunner(
        code,
        'Storage PSR Script',
        'storage-psr-script',
        {
          grants: ['GM_setValue', 'GM_getValue', 'GM_deleteValue', 'GM_listValues']
        }
      );

      expect(result.success).toBe(true);
      const res = (window as any).__storagePSRResult;
      expect(res.retrievedToken).toBe('psr_secret_abc123');
      expect(res.listBefore).toEqual(['session_token', 'count']);
      expect(res.listAfter).toEqual(['session_token']);

      // Absolutely zero calls to window.localStorage
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(getItemSpy).not.toHaveBeenCalled();
      expect(removeItemSpy).not.toHaveBeenCalled();
      expect(clearSpy).not.toHaveBeenCalled();

      expect(window.localStorage.length).toBe(0);
      expect(window.localStorage.getItem('session_token')).toBeNull();

      delete (window as any).__storagePSRResult;
    });
  });

  describe('Section 5: Host Page Tampering & Resistance', () => {
    it('5.1: host page injecting keys into localStorage has ZERO effect on userscript GM_getValue', () => {
      const script: ScriptRecord = {
        id: 'victim-script',
        name: 'Victim Script',
        code: '',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient) as any;

      // Host page attempts to poison storage via different naming patterns
      window.localStorage.setItem('auth_secret', 'HOST_MALICIOUS_SECRET');
      window.localStorage.setItem('__xokj_victim-script_auth_secret', 'HOST_SPOOFED_KEY');
      window.localStorage.setItem('xokj_victim-script_auth_secret', 'LEGACY_SPOOFED_KEY');
      window.localStorage.setItem('__xokj_auth_secret', 'GLOBAL_SPOOFED_KEY');

      // 1. Reading an unset key returns specified default value, NEVER the host-injected key
      expect(api.GM_getValue('auth_secret', 'safe_default')).toBe('safe_default');
      expect(api.GM_getValue('auth_secret')).toBeUndefined();

      // 2. Setting legitimate value in userscript
      api.GM_setValue('auth_secret', 'GENUINE_USERSCRIPT_TOKEN');

      // 3. Reading key returns genuine userscript value
      expect(api.GM_getValue('auth_secret')).toBe('GENUINE_USERSCRIPT_TOKEN');

      // 4. Host localStorage keys remain intact and unmodified
      expect(window.localStorage.getItem('auth_secret')).toBe('HOST_MALICIOUS_SECRET');
      expect(window.localStorage.getItem('__xokj_victim-script_auth_secret')).toBe('HOST_SPOOFED_KEY');
    });

    it('5.2: host page executing localStorage.clear() has ZERO effect on userscript data', () => {
      const script: ScriptRecord = {
        id: 'wipe-resilient-script',
        name: 'Wipe Resilient Script',
        code: '',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient) as any;
      api.GM_setValue('critical_data', { account: 12345, active: true });
      api.GM_setValue('config', 'user_preference_dark_mode');

      // Host webpage clears all local storage
      window.localStorage.clear();
      expect(window.localStorage.length).toBe(0);

      // Userscript data is completely unharmed
      expect(api.GM_getValue('critical_data')).toEqual({ account: 12345, active: true });
      expect(api.GM_getValue('config')).toBe('user_preference_dark_mode');
      expect(api.GM_listValues()).toEqual(['critical_data', 'config']);
    });

    it('5.3: host page mutating localStorage after userscript storage operations has ZERO effect', () => {
      const script: ScriptRecord = {
        id: 'tamper-after-script',
        name: 'Tamper After Script',
        code: '',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const api = createGmApi(script, cdpClient) as any;
      api.GM_setValue('token', 'ORIGINAL_SECURE_TOKEN');

      // Host page overwrites localStorage after the fact
      window.localStorage.setItem('token', 'OVERWRITTEN_BY_HOST');
      window.localStorage.setItem('__xokj_tamper-after-script_token', 'OVERWRITTEN_BY_HOST_PREFIX');

      expect(api.GM_getValue('token')).toBe('ORIGINAL_SECURE_TOKEN');
      expect(api.GM_listValues()).toEqual(['token']);
    });

    it('5.4: pageSandboxRunner userscript is fully immune to host localStorage manipulation and clearing', () => {
      // Pre-seed host localStorage with attacker keys
      window.localStorage.setItem('api_key', 'ATTACKER_API_KEY');
      window.localStorage.setItem('__xokj_psr-victim_api_key', 'ATTACKER_PREFIX_KEY');

      const code = `
        const initialBefore = GM_getValue('api_key', 'initial_default');
        GM_setValue('api_key', 'GENUINE_PSR_KEY');

        // Simulate host page calling localStorage.clear() mid-execution
        window.localStorage.clear();
        window.localStorage.setItem('api_key', 'POST_CLEAR_ATTACKER_KEY');

        const finalValue = GM_getValue('api_key');
        window.__psrTamperResult = {
          initialBefore,
          finalValue,
          lsLen: window.localStorage.length
        };
      `;

      const result = pageSandboxRunner(
        code,
        'PSR Tamper Victim',
        'psr-victim',
        {
          grants: ['GM_setValue', 'GM_getValue']
        }
      );

      expect(result.success).toBe(true);
      const res = (window as any).__psrTamperResult;
      expect(res.initialBefore).toBe('initial_default');
      expect(res.finalValue).toBe('GENUINE_PSR_KEY');
      expect(res.lsLen).toBe(1);

      delete (window as any).__psrTamperResult;
    });
  });

  describe('Section 6: Cross-Script Storage Partition Isolation', () => {
    it('6.1: Script A cannot read, overwrite or list Script B stored values in createGmApi', () => {
      const scriptA: ScriptRecord = {
        id: 'script-alpha',
        name: 'Script Alpha',
        code: '',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const scriptB: ScriptRecord = {
        id: 'script-beta',
        name: 'Script Beta',
        code: '',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };

      const apiA = createGmApi(scriptA, cdpClient) as any;
      const apiB = createGmApi(scriptB, cdpClient) as any;

      // 1. Script Alpha stores sensitive data
      apiA.GM_setValue('shared_key', 'ALPHA_SECRET');
      apiA.GM_setValue('alpha_exclusive', 111);

      // 2. Script Beta stores distinct data with overlapping key name
      apiB.GM_setValue('shared_key', 'BETA_SECRET');
      apiB.GM_setValue('beta_exclusive', 222);

      // 3. Read isolation
      expect(apiA.GM_getValue('shared_key')).toBe('ALPHA_SECRET');
      expect(apiB.GM_getValue('shared_key')).toBe('BETA_SECRET');
      expect(apiA.GM_getValue('beta_exclusive')).toBeUndefined();
      expect(apiB.GM_getValue('alpha_exclusive')).toBeUndefined();

      // 4. List isolation
      expect(apiA.GM_listValues().sort()).toEqual(['alpha_exclusive', 'shared_key'].sort());
      expect(apiB.GM_listValues().sort()).toEqual(['beta_exclusive', 'shared_key'].sort());

      // 5. Delete isolation: Script B deletes shared_key
      apiB.GM_deleteValue('shared_key');
      expect(apiB.GM_getValue('shared_key')).toBeUndefined();
      expect(apiB.GM_listValues()).toEqual(['beta_exclusive']);

      // Script Alpha's shared_key is completely unaffected
      expect(apiA.GM_getValue('shared_key')).toBe('ALPHA_SECRET');
      expect(apiA.GM_listValues().sort()).toEqual(['alpha_exclusive', 'shared_key'].sort());

      // 6. Partition clearing: clear only Script Beta partition
      clearIsolatedGmStorage('script-beta');
      expect(apiB.GM_listValues()).toEqual([]);
      expect(apiB.GM_getValue('beta_exclusive')).toBeUndefined();

      // Script Alpha partition remains fully intact
      expect(apiA.GM_getValue('shared_key')).toBe('ALPHA_SECRET');
      expect(apiA.GM_getValue('alpha_exclusive')).toBe(111);
      expect(apiA.GM_listValues().sort()).toEqual(['alpha_exclusive', 'shared_key'].sort());
    });

    it('6.2: pageSandboxRunner executes multiple scripts in separate isolated closure stores', () => {
      // Execute Script A
      const codeA = `
        GM_setValue('common_key', 'ALPHA_PSR_VAL');
        GM_setValue('a_only', 'SECRET_A');
      `;
      pageSandboxRunner(codeA, 'Script A', 'script-a', {
        grants: ['GM_setValue', 'GM_getValue']
      });

      // Execute Script B
      const codeB = `
        GM_setValue('common_key', 'BETA_PSR_VAL');
        window.__scriptBReadA = GM_getValue('a_only', 'NOT_FOUND');
        window.__scriptBCommon = GM_getValue('common_key');
        window.__scriptBList = GM_listValues();
      `;
      pageSandboxRunner(codeB, 'Script B', 'script-b', {
        grants: ['GM_setValue', 'GM_getValue', 'GM_listValues']
      });

      const resB = (window as any);
      expect(resB.__scriptBReadA).toBe('NOT_FOUND');
      expect(resB.__scriptBCommon).toBe('BETA_PSR_VAL');
      expect(resB.__scriptBList).toEqual(['common_key']);

      delete resB.__scriptBReadA;
      delete resB.__scriptBCommon;
      delete resB.__scriptBList;
    });
  });

  describe('Section 7: Stress Testing with Diverse & Extreme Value Types', () => {
    let api: any;

    beforeEach(() => {
      const script: ScriptRecord = {
        id: 'stress-type-script',
        name: 'Stress Type Script',
        code: '',
        metadata: {} as any,
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      };
      api = createGmApi(script, cdpClient);
    });

    it('7.1: deeply nested complex objects (10 levels of mixed objects and arrays)', () => {
      const deeplyNested = {
        l1: {
          l2: {
            l3: {
              l4: [
                1,
                {
                  l5: {
                    l6: {
                      l7: {
                        l8: {
                          l9: {
                            l10: 'deepest_payload',
                            leafArray: [true, false, null, 123.456, 'leaf']
                          }
                        }
                      }
                    }
                  }
                }
              ]
            }
          }
        }
      };

      api.GM_setValue('nested_key', deeplyNested);
      const retrieved = api.GM_getValue('nested_key');

      expect(retrieved).toEqual(deeplyNested);
      // Verify defensive copy (mutating retrieved does not mutate underlying storage)
      retrieved.l1.l2 = 'mutated';
      expect(api.GM_getValue('nested_key')).toEqual(deeplyNested);
    });

    it('7.2: diverse array structures (empty, primitives, mixed, nested arrays)', () => {
      const emptyArr: unknown[] = [];
      const primitiveArr = [1, 'two', 3.0, true, false, null];
      const arrayOfObjects = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob', tags: ['admin', 'dev'] },
        { id: 3, name: null }
      ];
      const nestedMatrix = [
        [1, 2, 3],
        [4, [5, 6, [7, 8]]],
        []
      ];

      api.GM_setValue('empty_arr', emptyArr);
      api.GM_setValue('primitive_arr', primitiveArr);
      api.GM_setValue('obj_arr', arrayOfObjects);
      api.GM_setValue('matrix', nestedMatrix);

      expect(api.GM_getValue('empty_arr')).toEqual([]);
      expect(api.GM_getValue('primitive_arr')).toEqual(primitiveArr);
      expect(api.GM_getValue('obj_arr')).toEqual(arrayOfObjects);
      expect(api.GM_getValue('matrix')).toEqual(nestedMatrix);
    });

    it('7.3: numeric edge cases (0, -0, negative, floats, safe integers, MIN_VALUE, EPSILON)', () => {
      api.GM_setValue('num_zero', 0);
      api.GM_setValue('num_neg_zero', -0);
      api.GM_setValue('num_neg_int', -42);
      api.GM_setValue('num_pi', 3.141592653589793);
      api.GM_setValue('num_max_safe', Number.MAX_SAFE_INTEGER);
      api.GM_setValue('num_min_safe', Number.MIN_SAFE_INTEGER);
      api.GM_setValue('num_epsilon', Number.EPSILON);
      api.GM_setValue('num_min_val', Number.MIN_VALUE);

      expect(api.GM_getValue('num_zero')).toBe(0);
      expect(api.GM_getValue('num_neg_zero')).toBe(0);
      expect(api.GM_getValue('num_neg_int')).toBe(-42);
      expect(api.GM_getValue('num_pi')).toBe(3.141592653589793);
      expect(api.GM_getValue('num_max_safe')).toBe(Number.MAX_SAFE_INTEGER);
      expect(api.GM_getValue('num_min_safe')).toBe(Number.MIN_SAFE_INTEGER);
      expect(api.GM_getValue('num_epsilon')).toBe(Number.EPSILON);
      expect(api.GM_getValue('num_min_val')).toBe(Number.MIN_VALUE);
    });

    it('7.4: boolean edge cases (true and false preserved without false-coercion)', () => {
      api.GM_setValue('bool_true', true);
      api.GM_setValue('bool_false', false);

      expect(api.GM_getValue('bool_true')).toBe(true);
      expect(typeof api.GM_getValue('bool_true')).toBe('boolean');

      // Crucial: false must NOT be coerced to default fallback
      expect(api.GM_getValue('bool_false', true)).toBe(false);
      expect(typeof api.GM_getValue('bool_false')).toBe('boolean');
    });

    it('7.5: null edge case (null preserved without coercion to default fallback)', () => {
      api.GM_setValue('val_null', null);

      // Crucial: stored null must NOT be replaced by defaultValue
      expect(api.GM_getValue('val_null', 'default_fallback')).toBeNull();
    });

    it('7.6: unicode, emojis, multiline strings, escaped characters, and raw JSON strings', () => {
      const emptyStr = '';
      const emojiStr = '🛡️ XOKJ Userscript Manager 🚀 🔐 💥 🔥';
      const unicodeStr = 'Tiếng Việt: Kiểm thử bảo mật sandbox 100%! 漢字 測試 日本語 テスト 한국어 العربية';
      const escapedStr = 'Line1\nLine2\r\nLine3\tTabbed\b"DoubleQuotes"\'SingleQuotes\'\\Backslash\0NullChar';
      const jsonStr = '{"notAnObject": true, "rawString": "preserved"}';

      api.GM_setValue('str_empty', emptyStr);
      api.GM_setValue('str_emoji', emojiStr);
      api.GM_setValue('str_unicode', unicodeStr);
      api.GM_setValue('str_escaped', escapedStr);
      api.GM_setValue('str_raw_json', jsonStr);

      // Empty string must NOT be coerced to default
      expect(api.GM_getValue('str_empty', 'fallback')).toBe('');
      expect(api.GM_getValue('str_emoji')).toBe(emojiStr);
      expect(api.GM_getValue('str_unicode')).toBe(unicodeStr);
      expect(api.GM_getValue('str_escaped')).toBe(escapedStr);

      // JSON string should be returned as literal string, not double-parsed object
      const retrievedJsonStr = api.GM_getValue('str_raw_json');
      expect(typeof retrievedJsonStr).toBe('string');
      expect(retrievedJsonStr).toBe(jsonStr);
    });

    it('7.7: high-volume rapid churn stress test (100 writes, 100 overwrites, 50 deletes)', () => {
      const totalKeys = 100;

      // 1. Initial burst write
      for (let i = 0; i < totalKeys; i++) {
        api.GM_setValue(`k_${i}`, { index: i, value: `val_${i}` });
      }
      expect(api.GM_listValues().length).toBe(totalKeys);

      // Verify all keys
      for (let i = 0; i < totalKeys; i++) {
        expect(api.GM_getValue(`k_${i}`)).toEqual({ index: i, value: `val_${i}` });
      }

      // 2. Overwrite all keys with updated payload
      for (let i = 0; i < totalKeys; i++) {
        api.GM_setValue(`k_${i}`, { index: i, updated: true, newVal: i * 10 });
      }
      expect(api.GM_listValues().length).toBe(totalKeys);

      for (let i = 0; i < totalKeys; i++) {
        expect(api.GM_getValue(`k_${i}`)).toEqual({ index: i, updated: true, newVal: i * 10 });
      }

      // 3. Delete even keys (50 keys)
      for (let i = 0; i < totalKeys; i += 2) {
        api.GM_deleteValue(`k_${i}`);
      }
      expect(api.GM_listValues().length).toBe(50);

      // 4. Verify odd keys remain, even keys return undefined
      for (let i = 0; i < totalKeys; i++) {
        if (i % 2 === 0) {
          expect(api.GM_getValue(`k_${i}`)).toBeUndefined();
        } else {
          expect(api.GM_getValue(`k_${i}`)).toEqual({ index: i, updated: true, newVal: i * 10 });
        }
      }
    });

    it('7.8: diverse default fallback types for missing keys', () => {
      const objFallback = { fallback: true };
      const arrFallback = [1, 2, 3];
      const boolFallback = false;
      const numFallback = 0;
      const strFallback = '';

      expect(api.GM_getValue('non_existent_1', objFallback)).toBe(objFallback);
      expect(api.GM_getValue('non_existent_2', arrFallback)).toBe(arrFallback);
      expect(api.GM_getValue('non_existent_3', boolFallback)).toBe(false);
      expect(api.GM_getValue('non_existent_4', numFallback)).toBe(0);
      expect(api.GM_getValue('non_existent_5', strFallback)).toBe('');
      expect(api.GM_getValue('non_existent_6')).toBeUndefined();
    });
  });
});
