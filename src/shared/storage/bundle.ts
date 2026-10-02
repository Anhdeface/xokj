import type { ScriptRecord } from '../types';
import { STORAGE_KEYS, deepClone, setStorageItem } from './defaults';
import { storageMutex } from './mutex';
import { prepareScriptRecord } from './script-record';
import { getScriptList, getScriptsInternal } from './scripts-repo';

/**
 * Export bundle format.
 */
export interface ExportBundle {
  version: number;
  exportedAt: number;
  generator: string;
  scripts: ScriptRecord[];
}

/**
 * Exports userscripts as a formatted JSON string.
 */
export async function exportScripts(scriptIds?: string[]): Promise<string> {
  const all = await getScriptList();
  const toExport =
    scriptIds && scriptIds.length > 0
      ? all.filter((s) => scriptIds.includes(s.id))
      : all;

  const bundle: ExportBundle = {
    version: 1,
    exportedAt: Date.now(),
    generator: 'XOKJ Userscript Manager',
    scripts: toExport
  };

  return JSON.stringify(bundle, null, 2);
}

/**
 * Import result statistics.
 */
export interface ImportResult {
  total: number;
  imported: number;
  updated: number;
  failed: number;
  skipped?: number;
  errors?: string[];
  scripts?: ScriptRecord[];
}

/**
 * Imports scripts from a JSON string or an array of script objects.
 */
export async function importScripts(
  jsonOrArray: string | ScriptRecord[] | any,
  options: { overwrite?: boolean; autoEnable?: boolean } = {}
): Promise<ImportResult> {
  const result: ImportResult = {
    total: 0,
    imported: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    scripts: []
  };

  let rawList: any[] = [];
  try {
    if (typeof jsonOrArray === 'string') {
      const trimmed = jsonOrArray.trim();
      if (!trimmed) {
        throw new Error('Import string is empty');
      }
      if (trimmed.startsWith('// ==UserScript==')) {
        rawList = [{ code: trimmed }];
      } else {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          rawList = parsed;
        } else if (parsed && Array.isArray(parsed.scripts)) {
          rawList = parsed.scripts;
        } else if (parsed && typeof parsed.code === 'string') {
          rawList = [parsed];
        } else {
          throw new Error('Unrecognized JSON format: expected array or bundle with "scripts"');
        }
      }
    } else if (Array.isArray(jsonOrArray)) {
      rawList = jsonOrArray;
    } else if (jsonOrArray && typeof jsonOrArray === 'object' && typeof jsonOrArray.code === 'string') {
      rawList = [jsonOrArray];
    } else {
      throw new Error('Import data must be a JSON string, a script object, or an array of scripts');
    }
  } catch (err: any) {
    result.errors!.push(`Parse error: ${err.message || String(err)}`);
    return result;
  }

  result.total = rawList.length;

  return storageMutex.runExclusive(async () => {
    const scripts = await getScriptsInternal();
    const now = Date.now();
    let hasMutations = false;

    for (let i = 0; i < rawList.length; i++) {
      const raw = rawList[i];
      try {
        if (!raw || typeof raw.code !== 'string') {
          result.failed++;
          if (result.skipped !== undefined) result.skipped++;
          result.errors!.push(`Item #${i + 1} skipped: missing "code" property`);
          continue;
        }

        const hasId = Boolean(raw.id && typeof raw.id === 'string' && raw.id !== '__proto__');
        const exists = Boolean(hasId && Object.prototype.hasOwnProperty.call(scripts, raw.id));

        const itemToSave = { ...raw };
        if (raw.id === '__proto__' || (exists && !options.overwrite)) {
          itemToSave.id = undefined;
        }

        if (options.autoEnable !== undefined) {
          itemToSave.enabled = options.autoEnable;
        }

        const existingRecord =
          itemToSave.id && Object.prototype.hasOwnProperty.call(scripts, itemToSave.id)
            ? scripts[itemToSave.id]
            : undefined;
        const saved = prepareScriptRecord(itemToSave, existingRecord, now);

        // Ensure newly generated ID does not collide with existing or intra-batch scripts
        if (!itemToSave.id) {
          while (
            Object.prototype.hasOwnProperty.call(scripts, saved.id) ||
            saved.id === '__proto__'
          ) {
            saved.id =
              typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `script_${now}_${Math.random().toString(36).slice(2, 7)}`;
          }
        }

        scripts[saved.id] = saved;
        hasMutations = true;
        result.scripts!.push(deepClone(saved));

        if (exists && options.overwrite) {
          result.updated++;
        } else {
          result.imported++;
        }
      } catch (err: any) {
        result.failed++;
        result.errors!.push(`Item #${i + 1} error: ${err.message || String(err)}`);
      }
    }

    if (hasMutations) {
      await setStorageItem(STORAGE_KEYS.SCRIPTS, scripts);
    }

    return result;
  });
}
