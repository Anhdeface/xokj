/**
 * XOKJ - Background GM Storage Message Handler (Feature 12)
 *
 * Handles runtime messages from ContentScriptBridge:
 * - GM_STORAGE_SET: persists a userscript key-value pair via GmStorageRepository
 * - GM_STORAGE_DELETE: deletes a userscript key via GmStorageRepository
 */

import { gmStorageRepo, IGmStorageRepository, getScript } from '@/shared/storage';
import { matchesAny } from '@/shared/match-pattern';
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
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: GmStorageResponse) => void
  ): boolean | void {
    if (!message || (message.type !== 'GM_STORAGE_SET' && message.type !== 'GM_STORAGE_DELETE')) {
      return;
    }

    this.processMessage(message as GmStorageMessage, sender)
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err)
        })
      );

    return true; // Keep channel open for async response
  }

  public async processMessage(
    message: GmStorageMessage,
    sender?: chrome.runtime.MessageSender
  ): Promise<GmStorageResponse> {
    const { type, scriptId, key } = message;

    if (!scriptId || typeof scriptId !== 'string' || scriptId.trim() === '') {
      return { success: false, error: 'scriptId must be a non-empty string' };
    }
    if (!key || typeof key !== 'string' || key.trim() === '') {
      return { success: false, error: 'key must be a non-empty string' };
    }

    const trimmedScriptId = scriptId.trim();
    const trimmedKey = key.trim();

    // Sender boundary verification and grant enforcement
    if (sender) {
      const isInternalExtension =
        !sender.tab &&
        (!sender.url || (typeof chrome !== 'undefined' && chrome.runtime?.id && sender.id === chrome.runtime.id));

      const isEmptySender = !sender.tab && !sender.url && !sender.id;

      if (!isInternalExtension && !isEmptySender) {
        const senderTabId = sender.tab?.id;
        const senderUrl = sender.url || sender.tab?.url;
        if (!senderTabId || !senderUrl) {
          return { success: false, error: 'Unauthorized: Sender has no associated tab context' };
        }

        const script = await getScript(trimmedScriptId);
        if (!script) {
          return { success: false, error: `Script "${trimmedScriptId}" not found` };
        }
        if (!script.enabled) {
          return { success: false, error: `Script "${trimmedScriptId}" is disabled` };
        }

        const grants = script.metadata?.grants || [];
        if (grants.includes('none')) {
          return { success: false, error: 'Script declared @grant none' };
        }
        const hasStorageGrant =
          grants.includes('*') ||
          (type === 'GM_STORAGE_SET' && grants.includes('GM_setValue')) ||
          (type === 'GM_STORAGE_DELETE' && grants.includes('GM_deleteValue'));

        if (!hasStorageGrant) {
          return { success: false, error: `Script lacks grant for ${type}` };
        }

        if (script.metadata?.excludes?.length && matchesAny(script.metadata.excludes, senderUrl)) {
          return { success: false, error: `Unauthorized: Sender URL "${senderUrl}" is excluded` };
        }

        const patterns =
          script.metadata?.matches?.length
            ? script.metadata.matches
            : script.metadata?.matchPatterns?.length
            ? script.metadata.matchPatterns
            : script.metadata?.includes || [];
        if (!matchesAny(patterns, senderUrl)) {
          return { success: false, error: `Unauthorized: Sender URL "${senderUrl}" not matched` };
        }
      }
    }

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
