import type { ScriptRecord } from '../types';
import { parseMetadata } from '../metadata-parser';
import { deepClone } from './defaults';

/**
 * Type guard checking if an unknown value satisfies the minimal ScriptRecord interface.
 */
export function isScriptRecord(val: unknown): val is ScriptRecord {
  if (!val || typeof val !== 'object') return false;
  const s = val as Partial<ScriptRecord>;
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.code === 'string' &&
    typeof s.enabled === 'boolean' &&
    typeof s.createdAt === 'number' &&
    typeof s.updatedAt === 'number'
  );
}

/**
 * Validates whether a script object contains required fields for persistence.
 */
export function validateScriptRecord(script: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!script || typeof script !== 'object') {
    return { valid: false, errors: ['Script must be a non-null object'] };
  }
  const s = script as Partial<ScriptRecord>;
  if (!s.code || typeof s.code !== 'string') {
    errors.push('Missing or invalid script code');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Pure in-memory helper that validates, parses metadata, and constructs
 * a complete ScriptRecord without performing storage I/O or acquiring mutexes.
 * Reusable across saveScript and importScripts.
 */
export function prepareScriptRecord(
  script: ScriptRecord | (Partial<ScriptRecord> & { code: string; id?: string }),
  existing?: ScriptRecord,
  now: number = Date.now()
): ScriptRecord {
  if (!script || typeof script.code !== 'string') {
    throw new Error('Cannot save script without valid source code');
  }

  let id = script.id;
  if (!id || id === '__proto__') {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `script_${now}_${Math.random().toString(36).slice(2, 7)}`;
  }

  const existingCodeChanged = Boolean(existing && existing.code !== script.code);

  let metadata = script.metadata;
  let parseErrors: string[] | undefined = existing?.parseErrors;

  const metadataMissing =
    !metadata ||
    ((!metadata.matches || metadata.matches.length === 0) &&
      (!metadata.matchPatterns || metadata.matchPatterns.length === 0));

  if (existingCodeChanged || metadataMissing) {
    const parseRes = parseMetadata(script.code);
    metadata = parseRes.metadata;
    parseErrors = parseRes.errors.length > 0 ? parseRes.errors : undefined;
  }

  if (!metadata) {
    const parseRes = parseMetadata(script.code);
    metadata = parseRes.metadata;
  }

  const name = script.name || metadata.name || existing?.name || 'Unnamed Script';

  const updatedScript: ScriptRecord = {
    id,
    name,
    code: script.code,
    metadata: deepClone(metadata),
    enabled: typeof script.enabled === 'boolean' ? script.enabled : existing?.enabled ?? true,
    createdAt: existing?.createdAt || script.createdAt || now,
    updatedAt: now,
    lastRunAt: existing?.lastRunAt || script.lastRunAt,
    parseErrors
  };

  return updatedScript;
}
