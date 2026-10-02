/**
 * XOKJ - Persistent Userscript Storage Engine (GmStorageRepository)
 * Location: src/shared/storage/gm-repo.ts
 *
 * Implements persistent Greasemonkey key-value storage backed by chrome.storage.local.
 * Provides atomic read-modify-write transactions serialized by AsyncMutex.
 */

import { AsyncMutex } from './mutex';
import { deepClone } from './defaults';

/** Key prefix for per-script Greasemonkey persistent storage buckets */
export const GM_STORAGE_PREFIX = 'gm_values_';

/** Computes the chrome.storage.local key for a given script identifier */
export function getGmStorageKey(scriptId: string): string {
  if (!scriptId || typeof scriptId !== 'string' || scriptId.trim() === '') {
    throw new TypeError('[GmStorageRepository] scriptId must be a non-empty string');
  }
  return `${GM_STORAGE_PREFIX}${scriptId.trim()}`;
}

export interface IGmStorageRepository {
  /**
   * Retrieves all persisted key-value pairs for a specific userscript.
   * Returns an empty object if no values have been saved yet.
   */
  getGmValues(scriptId: string): Promise<Record<string, unknown>>;

  /**
   * Retrieves a single persisted value for a script by key.
   * If the key does not exist, returns defaultValue (or undefined).
   */
  getGmValue<T = unknown>(scriptId: string, key: string, defaultValue?: T): Promise<T | undefined>;

  /**
   * Persists a single key-value pair for a script.
   * Concurrently safe via AsyncMutex serialization.
   */
  setGmValue(scriptId: string, key: string, value: unknown): Promise<void>;

  /**
   * Persists multiple key-value pairs in a single atomic transaction.
   */
  setGmValues(scriptId: string, values: Record<string, unknown>): Promise<void>;

  /**
   * Deletes a specific key from a script's storage bucket.
   * Concurrently safe via AsyncMutex serialization.
   */
  deleteGmValue(scriptId: string, key: string): Promise<void>;

  /**
   * Lists all existing keys stored for a script.
   */
  listGmValues(scriptId: string): Promise<string[]>;

  /**
   * Completely removes all stored key-value pairs for a script (or all scripts if omitted).
   */
  clearGmValues(scriptId?: string): Promise<void>;

  /**
   * Diagnostic / export helper: dumps all GM storage across all scripts.
   */
  getAllGmStorage(): Promise<Record<string, Record<string, unknown>>>;
}

export interface GmStorageOptions {
  /** Optional custom mutex */
  mutex?: AsyncMutex;
  /** Force in-memory storage mode (useful for testing or fallback) */
  inMemoryOnly?: boolean;
}

export class GmStorageRepository implements IGmStorageRepository {
  private inMemoryFallback = new Map<string, Record<string, unknown>>();
  private scriptMutexes = new Map<string, AsyncMutex>();
  private globalMutex: AsyncMutex;
  private inMemoryOnly: boolean;

  constructor(options: GmStorageOptions = {}) {
    this.globalMutex = options.mutex || new AsyncMutex();
    this.inMemoryOnly = options.inMemoryOnly ?? false;
  }

  /**
   * Retrieves or allocates a dedicated AsyncMutex for a scriptId.
   */
  private getScriptMutex(scriptId: string): AsyncMutex {
    let mutex = this.scriptMutexes.get(scriptId);
    if (!mutex) {
      mutex = new AsyncMutex();
      this.scriptMutexes.set(scriptId, mutex);
    }
    return mutex;
  }

  /**
   * Internal storage reader helper with environment fallback.
   */
  private async readBucket(scriptId: string): Promise<Record<string, unknown>> {
    const storageKey = getGmStorageKey(scriptId);

    if (this.inMemoryOnly || typeof chrome === 'undefined' || !chrome.storage?.local) {
      const stored = this.inMemoryFallback.get(storageKey);
      return stored ? deepClone(stored) : {};
    }

    try {
      const result = await chrome.storage.local.get(storageKey);
      const raw = result[storageKey];
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        return deepClone(raw as Record<string, unknown>);
      }
      return {};
    } catch (err) {
      console.warn(`[GmStorageRepository] Failed to read storage for script "${scriptId}":`, err);
      const fallback = this.inMemoryFallback.get(storageKey);
      return fallback ? deepClone(fallback) : {};
    }
  }

  /**
   * Internal storage writer helper with environment fallback.
   */
  private async writeBucket(scriptId: string, data: Record<string, unknown>): Promise<void> {
    const storageKey = getGmStorageKey(scriptId);
    const cloned = deepClone(data);

    this.inMemoryFallback.set(storageKey, cloned);

    if (this.inMemoryOnly || typeof chrome === 'undefined' || !chrome.storage?.local) {
      return;
    }

    try {
      await chrome.storage.local.set({ [storageKey]: cloned });
    } catch (err) {
      console.error(`[GmStorageRepository] Failed to write storage for script "${scriptId}":`, err);
      throw err;
    }
  }

  /**
   * Internal storage removal helper.
   */
  private async removeBucket(scriptId: string): Promise<void> {
    const storageKey = getGmStorageKey(scriptId);
    this.inMemoryFallback.delete(storageKey);

    if (this.inMemoryOnly || typeof chrome === 'undefined' || !chrome.storage?.local) {
      return;
    }

    try {
      await chrome.storage.local.remove(storageKey);
    } catch (err) {
      console.error(`[GmStorageRepository] Failed to remove storage for script "${scriptId}":`, err);
      throw err;
    }
  }

  /**
   * Retrieves all persisted key-value pairs for a userscript.
   */
  public async getGmValues(scriptId: string): Promise<Record<string, unknown>> {
    getGmStorageKey(scriptId); // Validates scriptId
    return this.readBucket(scriptId);
  }

  /**
   * Retrieves a single persisted value for a script.
   */
  public async getGmValue<T = unknown>(
    scriptId: string,
    key: string,
    defaultValue?: T
  ): Promise<T | undefined> {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new TypeError('[GmStorageRepository] key must be a non-empty string');
    }
    const bucket = await this.getGmValues(scriptId);
    if (Object.prototype.hasOwnProperty.call(bucket, key)) {
      return deepClone(bucket[key]) as T;
    }
    return defaultValue;
  }

  /**
   * Persists a single key-value pair for a script.
   * Atomically reads, updates, and writes back using AsyncMutex.
   */
  public async setGmValue(scriptId: string, key: string, value: unknown): Promise<void> {
    getGmStorageKey(scriptId); // Validates scriptId
    if (typeof key !== 'string' || key.trim() === '') {
      throw new TypeError('[GmStorageRepository] key must be a non-empty string');
    }

    const mutex = this.getScriptMutex(scriptId);

    return mutex.runExclusive(async () => {
      const bucket = await this.readBucket(scriptId);
      if (value === undefined) {
        delete bucket[key];
      } else {
        bucket[key] = deepClone(value);
      }
      await this.writeBucket(scriptId, bucket);
    });
  }

  /**
   * Persists multiple key-value pairs for a script in a single atomic transaction.
   */
  public async setGmValues(scriptId: string, values: Record<string, unknown>): Promise<void> {
    getGmStorageKey(scriptId); // Validates scriptId
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new TypeError('[GmStorageRepository] values must be an object');
    }

    const mutex = this.getScriptMutex(scriptId);

    return mutex.runExclusive(async () => {
      const bucket = await this.readBucket(scriptId);
      for (const [k, v] of Object.entries(values)) {
        if (typeof k === 'string' && k.trim() !== '') {
          if (v === undefined) {
            delete bucket[k];
          } else {
            bucket[k] = deepClone(v);
          }
        }
      }
      await this.writeBucket(scriptId, bucket);
    });
  }

  /**
   * Deletes a specific key from a script's storage bucket.
   */
  public async deleteGmValue(scriptId: string, key: string): Promise<void> {
    getGmStorageKey(scriptId); // Validates scriptId
    if (typeof key !== 'string' || key.trim() === '') {
      throw new TypeError('[GmStorageRepository] key must be a non-empty string');
    }

    const mutex = this.getScriptMutex(scriptId);

    return mutex.runExclusive(async () => {
      const bucket = await this.readBucket(scriptId);
      if (Object.prototype.hasOwnProperty.call(bucket, key)) {
        delete bucket[key];
        await this.writeBucket(scriptId, bucket);
      }
    });
  }

  /**
   * Returns a list of all keys currently stored for a script.
   */
  public async listGmValues(scriptId: string): Promise<string[]> {
    const bucket = await this.getGmValues(scriptId);
    return Object.keys(bucket);
  }

  /**
   * Completely removes all stored key-value pairs for a script (or all scripts if omitted).
   */
  public async clearGmValues(scriptId?: string): Promise<void> {
    if (arguments.length > 0) {
      getGmStorageKey(scriptId as string); // Validates scriptId
      const sId = (scriptId as string).trim();
      const mutex = this.getScriptMutex(sId);
      return mutex.runExclusive(async () => {
        await this.removeBucket(sId);
        this.scriptMutexes.delete(sId);
      });
    }

    return this.globalMutex.runExclusive(async () => {
      const allGm = await this.getAllGmStorage();
      for (const sId of Object.keys(allGm)) {
        await this.removeBucket(sId);
      }
      this.scriptMutexes.clear();
      this.inMemoryFallback.clear();
    });
  }

  /**
   * Diagnostic / export helper: dumps all GM storage across all scripts.
   */
  public async getAllGmStorage(): Promise<Record<string, Record<string, unknown>>> {
    if (this.inMemoryOnly || typeof chrome === 'undefined' || !chrome.storage?.local) {
      const result: Record<string, Record<string, unknown>> = {};
      for (const [key, value] of this.inMemoryFallback.entries()) {
        if (key.startsWith(GM_STORAGE_PREFIX)) {
          const scriptId = key.slice(GM_STORAGE_PREFIX.length);
          result[scriptId] = deepClone(value);
        }
      }
      return result;
    }

    try {
      const all = await chrome.storage.local.get(null);
      const result: Record<string, Record<string, unknown>> = {};
      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith(GM_STORAGE_PREFIX) && value && typeof value === 'object' && !Array.isArray(value)) {
          const scriptId = key.slice(GM_STORAGE_PREFIX.length);
          result[scriptId] = deepClone(value as Record<string, unknown>);
        }
      }
      return result;
    } catch {
      return {};
    }
  }
}

/** Global default singleton instance */
export const gmStorageRepo = new GmStorageRepository();

/** Functional facade exports matching project storage conventions */
export const getGmValues = (scriptId: string) => gmStorageRepo.getGmValues(scriptId);
export const getGmValue = <T = unknown>(scriptId: string, key: string, defaultValue?: T) =>
  gmStorageRepo.getGmValue<T>(scriptId, key, defaultValue);
export const setGmValue = (scriptId: string, key: string, value: unknown) =>
  gmStorageRepo.setGmValue(scriptId, key, value);
export const setGmValues = (scriptId: string, values: Record<string, unknown>) =>
  gmStorageRepo.setGmValues(scriptId, values);
export const deleteGmValue = (scriptId: string, key: string) =>
  gmStorageRepo.deleteGmValue(scriptId, key);
export const listGmValues = (scriptId: string) => gmStorageRepo.listGmValues(scriptId);
export const clearGmValues = (...args: [scriptId?: string]) => gmStorageRepo.clearGmValues(...args);
export const getAllGmStorage = () => gmStorageRepo.getAllGmStorage();
