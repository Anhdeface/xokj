/**
 * XOKJ - Background GM Storage Message Handler (Feature 12)
 *
 * Handles runtime messages from ContentScriptBridge:
 * - GM_STORAGE_SET: persists a userscript key-value pair via GmStorageRepository
 * - GM_STORAGE_DELETE: deletes a userscript key via GmStorageRepository
 */

import { gmStorageRepo, IGmStorageRepository } from '@/shared/storage';
import type {
  GmStorageMessage,
  GmStorageSetMessage,
  GmStorageDeleteMessage,
  GmStorageResponse
} from '@/shared/types';

export { GmStorageMessage, GmStorageSetMessage, GmStorageDeleteMessage, GmStorageResponse };

export class GmStorageMessageHandler {
  private repo: IGmStorageRepository;
  private isListening = false;
  private handleMessageBound = this.handleMessage.bind(this);

  constructor(repo: IGmStorageRepository = gmStorageRepo) {
    this.repo = repo;
  }

  public init(): void {
    if (this.isListening) return;
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(this.handleMessageBound);
    }
    this.isListening = true;
  }

  public destroy(): void {
    if (!this.isListening) return;
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(this.handleMessageBound);
    }
    this.isListening = false;
  }

  public handleMessage(
    message: any,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: GmStorageResponse) => void
  ): boolean | void {
    if (!message || (message.type !== 'GM_STORAGE_SET' && message.type !== 'GM_STORAGE_DELETE')) {
      return;
    }

    this.processMessage(message as GmStorageMessage)
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err)
        })
      );

    return true; // Keep channel open for async response
  }

  public async processMessage(message: GmStorageMessage): Promise<GmStorageResponse> {
    const { type, scriptId, key } = message;

    if (!scriptId || typeof scriptId !== 'string' || scriptId.trim() === '') {
      return { success: false, error: 'scriptId must be a non-empty string' };
    }
    if (!key || typeof key !== 'string' || key.trim() === '') {
      return { success: false, error: 'key must be a non-empty string' };
    }

    const trimmedScriptId = scriptId.trim();
    const trimmedKey = key.trim();

    try {
      if (type === 'GM_STORAGE_SET') {
        const value = (message as GmStorageSetMessage).value;
        await this.repo.setGmValue(trimmedScriptId, trimmedKey, value);
        return { success: true };
      } else if (type === 'GM_STORAGE_DELETE') {
        await this.repo.deleteGmValue(trimmedScriptId, trimmedKey);
        return { success: true };
      }
      return { success: false, error: `Unknown GM storage operation: ${type}` };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
}

export const gmStorageHandler = new GmStorageMessageHandler();
