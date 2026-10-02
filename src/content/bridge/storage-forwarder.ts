/**
 * XOKJ - Content Script Bridge Storage Forwarder
 *
 * Forwards validated userscript GM storage mutations (GM_STORAGE_SET, GM_STORAGE_DELETE)
 * from the Main World to the Background Service Worker's GmStorageMessageHandler.
 */

import { validateStoragePayload } from './validator';
import type { GmStorageMessage, GmStorageResponse } from './types';

export class StorageForwarder {
  /**
   * Forwards a storage mutation message to the Background Service Worker.
   */
  public async forwardToBackground(message: GmStorageMessage): Promise<GmStorageResponse> {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime.sendMessage is unavailable');
    }

    return new Promise<GmStorageResponse>((resolve, reject) => {
      let settled = false;

      try {
        const maybePromise: any = chrome.runtime.sendMessage(message, (response: GmStorageResponse) => {
          if (settled) return;
          settled = true;
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message || 'Failed to send storage message to extension background'));
            return;
          }
          resolve(response || { success: true });
        });

        // In environments where sendMessage returns a Promise directly
        if (maybePromise && typeof (maybePromise as any).then === 'function') {
          (maybePromise as Promise<any>).then(
            (res) => {
              if (settled) return;
              settled = true;
              resolve(res || { success: true });
            },
            (err) => {
              if (settled) return;
              settled = true;
              reject(err);
            }
          );
        }
      } catch (ex) {
        if (!settled) {
          settled = true;
          reject(ex);
        }
      }
    });
  }

  /**
   * Processes a validated GM storage message from the window.
   */
  public async processStorageMutation(
    data: any,
    channelId: string,
    postToWindow: (msg: any) => void
  ): Promise<void> {
    const validation = validateStoragePayload(data);
    if (!validation.valid) {
      if (data?.id) {
        postToWindow({
          source: 'xokj-bridge',
          channelId,
          type: 'GM_STORAGE_RESPONSE',
          id: data.id,
          success: false,
          error: validation.error || 'Invalid storage payload'
        });
      }
      return;
    }

    // Construct sanitized payload: strip client-provided tabId or foreign properties
    const message: GmStorageMessage = {
      type: data.type,
      scriptId: validation.scriptId,
      key: validation.key,
      ...(data.type === 'GM_STORAGE_SET' ? { value: data.value } : {})
    };

    try {
      const response = await this.forwardToBackground(message);

      if (data?.id) {
        postToWindow({
          source: 'xokj-bridge',
          channelId,
          type: 'GM_STORAGE_RESPONSE',
          id: data.id,
          success: response?.success ?? true,
          error: response?.error
        });
      }
    } catch (err: any) {
      if (data?.id) {
        postToWindow({
          source: 'xokj-bridge',
          channelId,
          type: 'GM_STORAGE_RESPONSE',
          id: data.id,
          success: false,
          error: err?.message || 'Storage operation failed'
        });
      }
    }
  }
}
