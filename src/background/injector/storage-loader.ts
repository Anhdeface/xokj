/**
 * XOKJ - Pre-hydrated Userscript Storage Loader
 *
 * Checks userscript metadata for storage grants and pre-loads
 * stored key-value pairs from GmStorageRepository prior to MAIN world script execution.
 */

import type { ScriptRecord } from '@/shared/types';
import { getGmValues } from '@/shared/storage';

export class PrehydratedStorageLoader {
  /**
   * Evaluates if a script has declared permissions to access GM storage.
   */
  public hasStorageGrants(script: ScriptRecord): boolean {
    const grants: string[] = Array.isArray(script.metadata?.grants) ? script.metadata.grants : [];
    if (grants.includes('none')) return false;

    return (
      grants.includes('*') ||
      grants.includes('GM_getValue') ||
      grants.includes('GM_setValue') ||
      grants.includes('GM_deleteValue') ||
      grants.includes('GM_listValues')
    );
  }

  /**
   * Pre-loads the stored key-value pairs for the script from storage repository.
   * Returns undefined if the script does not have storage grants or if loading fails.
   */
  public async loadStorageSnapshot(
    script: ScriptRecord
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.hasStorageGrants(script)) {
      return undefined;
    }

    try {
      return await getGmValues(script.id);
    } catch (err) {
      console.warn(`[PrehydratedStorageLoader] Failed to pre-load storage for script ${script.id}:`, err);
      return undefined;
    }
  }
}
