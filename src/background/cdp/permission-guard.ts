/**
 * XOKJ - CDP Script Permission & Match Pattern Guard
 */

import type { CdpRpcRequest, CdpRpcError, ScriptRecord } from '@/shared/types';
import { matchesAny } from '@/shared/match-pattern';
import { getScript, getScripts, onScriptsChanged } from '@/shared/storage';

export class CdpPermissionGuard {
  public enforcePermissions: boolean;
  public readonly scriptResolver: (scriptId: string) => Promise<ScriptRecord | null>;
  public readonly scriptCache = new Map<string, ScriptRecord>();
  private unsubscribeScriptsChanged?: () => void;

  constructor(
    enforcePermissions = false,
    scriptResolver: (scriptId: string) => Promise<ScriptRecord | null> = getScript
  ) {
    this.enforcePermissions = enforcePermissions;
    this.scriptResolver = scriptResolver;
  }

  public init(): void {
    if (!this.unsubscribeScriptsChanged) {
      try {
        this.unsubscribeScriptsChanged = onScriptsChanged(async () => {
          this.scriptCache.clear();
          try {
            const all = await getScripts();
            for (const s of Object.values(all)) {
              if (s?.id) {
                this.scriptCache.set(s.id, s);
              }
            }
          } catch {}
        });
      } catch {}
    }
  }

  public destroy(): void {
    if (this.unsubscribeScriptsChanged) {
      this.unsubscribeScriptsChanged();
      this.unsubscribeScriptsChanged = undefined;
    }
    this.scriptCache.clear();
  }

  public setEnforcePermissions(enforce: boolean): void {
    this.enforcePermissions = enforce;
  }

  /**
   * Validates userscript execution permissions, URL matching, and CDP capabilities.
   */
  public async validateScriptPermissions(
    request: CdpRpcRequest,
    sender: chrome.runtime.MessageSender
  ): Promise<CdpRpcError | null> {
    const scriptId = request.scriptId;

    if (!scriptId || typeof scriptId !== 'string' || scriptId.trim() === '') {
      if (this.enforcePermissions) {
        return {
          code: 403,
          message: 'Unauthorized CDP RPC: Missing userscript identifier (scriptId required)',
          data: { reason: 'MISSING_SCRIPT_ID' }
        };
      }
      return null;
    }

    const trimmedId = scriptId.trim();

    let script: ScriptRecord | null = this.scriptCache.get(trimmedId) || null;
    if (!script) {
      script = await this.scriptResolver(trimmedId);
      if (script) {
        this.scriptCache.set(trimmedId, script);
      }
    }
    if (!script) {
      return {
        code: 403,
        message: `Unauthorized CDP RPC: Script '${trimmedId}' not found in registry`,
        data: { reason: 'SCRIPT_NOT_FOUND', scriptId: trimmedId }
      };
    }

    if (!script.enabled) {
      return {
        code: 403,
        message: `Permission denied: Script '${script.name || trimmedId}' is disabled`,
        data: { reason: 'SCRIPT_DISABLED', scriptId: trimmedId }
      };
    }

    const tabUrl = sender.url || sender.tab?.url;
    if (tabUrl && script.metadata) {
      const excludes = script.metadata.excludes || [];
      if (excludes.length > 0 && matchesAny(excludes, tabUrl)) {
        return {
          code: 403,
          message: `Permission denied: Script '${script.name || trimmedId}' is excluded on '${tabUrl}'`,
          data: { reason: 'URL_EXCLUDED', scriptId: trimmedId, url: tabUrl }
        };
      }

      const patterns =
        script.metadata.matches?.length
          ? script.metadata.matches
          : script.metadata.matchPatterns?.length
          ? script.metadata.matchPatterns
          : script.metadata.includes || [];

      if (patterns.length > 0 && !matchesAny(patterns, tabUrl)) {
        return {
          code: 403,
          message: `Permission denied: Script '${script.name || trimmedId}' is not authorized for URL '${tabUrl}'`,
          data: { reason: 'URL_NOT_MATCHED', scriptId: trimmedId, url: tabUrl }
        };
      }
    }

    const grants: string[] = Array.isArray(script.metadata?.grants) ? script.metadata.grants : [];
    if (grants.includes('none')) {
      return {
        code: 403,
        message: `Permission denied: Script '${script.name || trimmedId}' declared '@grant none' and has no CDP privileges`,
        data: { reason: 'GRANT_NONE', scriptId: trimmedId }
      };
    }

    const hasCdpGrant =
      grants.includes('GM_cdp') ||
      grants.includes('cdp') ||
      grants.includes('*');

    const cdpDecls = script.metadata?.cdpDeclarations || script.metadata?.cdp || [];
    const hasCdpDirectives = Array.isArray(cdpDecls) && cdpDecls.length > 0;
    const rawCdpDomains: string[] = Array.isArray(script.metadata?.cdpDomains) ? script.metadata.cdpDomains : [];

    let cdpDomains = rawCdpDomains;
    if (cdpDomains.length === 0 && Array.isArray(cdpDecls)) {
      cdpDomains = cdpDecls
        .map((d: any) => {
          if (typeof d === 'string') {
            return d.split('.')[0];
          }
          if (d && typeof d === 'object') {
            return d.domain || (typeof d.command === 'string' ? d.command.split('.')[0] : undefined);
          }
          return undefined;
        })
        .filter((domain): domain is string => typeof domain === 'string' && domain.length > 0);
      cdpDomains = Array.from(new Set(cdpDomains));
    }
    const hasCdpDomains = cdpDomains.length > 0;

    if (!hasCdpGrant && !hasCdpDirectives && !hasCdpDomains) {
      return {
        code: 403,
        message: `Permission denied: Script '${script.name || trimmedId}' has not requested @cdp or @grant GM_cdp permissions`,
        data: { reason: 'NO_CDP_PERMISSIONS', scriptId: trimmedId }
      };
    }

    if (hasCdpGrant) {
      return null;
    }

    const requestedDomain = request.method.split('.')[0];
    const isDomainAllowed = cdpDomains.includes(requestedDomain) || cdpDomains.includes('*');

    if (!isDomainAllowed) {
      return {
        code: 403,
        message: `Permission denied: Script '${script.name || trimmedId}' is not authorized for CDP domain '${requestedDomain}'. Allowed domains: [${cdpDomains.join(', ')}]`,
        data: {
          reason: 'DOMAIN_NOT_AUTHORIZED',
          scriptId: trimmedId,
          requestedDomain,
          allowedDomains: cdpDomains
        }
      };
    }

    return null;
  }
}
