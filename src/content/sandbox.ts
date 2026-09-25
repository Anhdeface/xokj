/**
 * XOKJ - Userscript Execution Sandbox & Lifecycle Timing Engine
 * Location: src/content/sandbox.ts
 *
 * Provides isolated execution wrapper, `@grant` scope construction,
 * source map generation (`//# sourceURL`), and `@run-at` timing scheduling.
 */

import type { ScriptRecord, RunAtTiming } from '@/shared/types';
import { CdpClient, createGmApi } from './cdp-sdk';

export const PRIVILEGED_API_KEYS = [
  'cdp',
  'GM_cdp',
  'GM_info',
  'GM_setValue',
  'GM_getValue',
  'GM_deleteValue',
  'GM_listValues',
  'GM_addStyle',
  'GM_log'
] as const;

/**
 * Builds the isolated sandbox variable scope based on declared @grant and @cdp directives.
 */
export function buildSandboxScope(
  script: ScriptRecord,
  cdpClient: CdpClient
): Record<string, unknown> {
  const grants = script.metadata?.grants || [];
  const isGrantNone = grants.includes('none');

  const baseGlobals: Record<string, unknown> = {
    window: typeof window !== 'undefined' ? window : globalThis,
    document: typeof document !== 'undefined' ? document : undefined,
    console: typeof console !== 'undefined' ? console : undefined
  };

  // If @grant none is declared, strictly return baseGlobals with zero privileged APIs exposed.
  if (isGrantNone) {
    return baseGlobals;
  }

  const cdpDeclarations =
    script.metadata?.cdpDeclarations ||
    script.metadata?.cdp ||
    script.metadata?.cdpDomains ||
    [];
  const hasCdpDirectives = Array.isArray(cdpDeclarations) && cdpDeclarations.length > 0;
  const hasCdpDomains = Array.isArray(script.metadata?.cdpDomains) && script.metadata.cdpDomains.length > 0;

  // If no grants are declared and no CDP directives exist:
  // Strictly return baseGlobals with no GM_* or CDP APIs exposed in scope.
  if (grants.length === 0 && !hasCdpDirectives && !hasCdpDomains) {
    return baseGlobals;
  }

  const effectiveGrants = [...grants];
  if (hasCdpDirectives || hasCdpDomains) {
    if (!effectiveGrants.includes('GM_cdp') && !effectiveGrants.includes('*')) {
      effectiveGrants.push('GM_cdp', 'cdp');
    }
  }

  const allApi = createGmApi(script, cdpClient, effectiveGrants);
  const scope: Record<string, unknown> = {
    ...baseGlobals
  };

  // Standard GM_* functions
  const standardGrants = [
    'GM_setValue',
    'GM_getValue',
    'GM_deleteValue',
    'GM_listValues',
    'GM_addStyle',
    'GM_log',
    'GM_info'
  ];

  for (const grant of standardGrants) {
    if (grants.includes(grant) || grants.includes('*')) {
      scope[grant] = allApi[grant];
    }
  }

  // Populate CDP capabilities if explicitly requested or declared via @cdp
  const hasCdpGrant =
    grants.includes('GM_cdp') ||
    grants.includes('cdp') ||
    grants.includes('*') ||
    hasCdpDirectives ||
    hasCdpDomains;

  if (hasCdpGrant) {
    scope['GM_cdp'] = allApi['GM_cdp'];
    scope['cdp'] = cdpClient;
  }

  return scope;
}

/**
 * Wraps script source in strict function execution context with source map URL.
 * Explicitly shadows all 9 standard privileged keys with undefined when ungranted.
 */
export function createSandboxRunner(
  script: ScriptRecord,
  scope: Record<string, unknown>
): () => unknown {
  const scriptName = script.name;
  const effectiveScope: Record<string, unknown> = { ...scope };

  for (const key of PRIVILEGED_API_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(effectiveScope, key)) {
      effectiveScope[key] = undefined;
    }
  }

  const paramNames = Object.keys(effectiveScope);
  const paramValues = Object.values(effectiveScope);

  const cleanName = encodeURIComponent((scriptName || 'userscript').trim().replace(/\s+/g, '_'));
  const sourceUrl = `\n//# sourceURL=xokj://scripts/${cleanName}.user.js\n`;
  const code = `"use strict";\n${script.code}\n${sourceUrl}`;

  const runner = new Function(...paramNames, code);

  return () => {
    try {
      return runner(...paramValues);
    } catch (err) {
      console.error('[XOKJ Runtime] Exception in script "' + scriptName + '":', err);
      throw err;
    }
  };
}

/**
 * Schedules execution of a userscript according to its @run-at timing.
 */
export function scheduleScriptExecution(
  script: ScriptRecord,
  cdpClient: CdpClient
): void {
  if (!script.enabled) return;

  const scriptName = script.name;
  const timing: RunAtTiming = script.metadata?.runAt || 'document-idle';
  const scope = buildSandboxScope(script, cdpClient);
  const run = createSandboxRunner(script, scope);

  const executeSafely = () => {
    try {
      run();
    } catch (err) {
      console.error('[XOKJ Execution Error] Failed executing script "' + scriptName + '":', err);
    }
  };

  switch (timing) {
    case 'document-start':
      // Synchronous immediate execution before HTML parsing proceeds
      executeSafely();
      break;

    case 'document-end':
      if (
        typeof document !== 'undefined' &&
        (document.readyState === 'interactive' || document.readyState === 'complete')
      ) {
        executeSafely();
      } else if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('DOMContentLoaded', executeSafely, { once: true });
      } else {
        executeSafely();
      }
      break;

    case 'document-idle':
    default: {
      const scheduleIdle = (fn: () => void) => {
        if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
          (window as any).requestIdleCallback(() => fn());
        } else {
          setTimeout(fn, 0);
        }
      };

      if (typeof document !== 'undefined' && document.readyState === 'complete') {
        scheduleIdle(executeSafely);
      } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('load', () => scheduleIdle(executeSafely), { once: true });
      } else {
        scheduleIdle(executeSafely);
      }
      break;
    }
  }
}
