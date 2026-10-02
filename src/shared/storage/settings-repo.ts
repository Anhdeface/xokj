import type { AppSettings } from '../types';
import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  deepClone,
  getStorageItem,
  setStorageItem
} from './defaults';
import { storageMutex } from './mutex';

/**
 * Internal helper to read settings directly from storage.
 */
export async function getSettingsInternal(): Promise<AppSettings> {
  const settings = await getStorageItem<AppSettings>(STORAGE_KEYS.SETTINGS);
  return settings ? settings : deepClone(DEFAULT_SETTINGS);
}

/**
 * Retrieves global application settings.
 */
export async function getSettings(): Promise<AppSettings> {
  return getSettingsInternal();
}

/**
 * Updates application settings.
 */
export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return storageMutex.runExclusive(async () => {
    const current = await getSettingsInternal();
    const updated = { ...current, ...deepClone(settings) };
    await setStorageItem(STORAGE_KEYS.SETTINGS, updated);
    return deepClone(updated);
  });
}
