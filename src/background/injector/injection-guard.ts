/**
 * XOKJ - Userscript Injection Deduplication & Navigation Guard
 *
 * Tracks navigation lifecycle, document IDs, frame histories, and manages
 * synchronous pre-reservation and error rollbacks to prevent double injection
 * and race conditions across tabs and subframes.
 */

import type { RunAtTiming } from '@/shared/types';

export class InjectionGuard {
  // Nested injection deduplication map: tabId -> frameId -> Set of `${scriptId}:${stage}`
  public readonly injectionHistory = new Map<number, Map<number, Set<string>>>();

  // Navigation tracker: tabId -> current navigation URL
  public readonly tabUrls = new Map<number, string>();

  // Document tracker: tabId -> current documentId (for same-URL & duplicate deduplication)
  public readonly tabDocumentIds = new Map<number, string>();

  // Subframe URL tracker: tabId -> frameId -> current URL
  public readonly frameUrls = new Map<number, Map<number, string>>();

  // Subframe document tracker: tabId -> frameId -> current documentId
  public readonly frameDocumentIds = new Map<number, Map<number, string>>();

  /**
   * Clears injection history for a specific frame.
   */
  public clearFrameHistory(tabId: number, frameId: number): void {
    const frameMap = this.injectionHistory.get(tabId);
    if (frameMap) {
      const scriptSet = frameMap.get(frameId);
      if (scriptSet) {
        scriptSet.clear();
        frameMap.delete(frameId);
      }
      if (frameMap.size === 0) {
        this.injectionHistory.delete(tabId);
      }
    }
    const frameUrlMap = this.frameUrls.get(tabId);
    if (frameUrlMap) {
      frameUrlMap.delete(frameId);
      if (frameUrlMap.size === 0) {
        this.frameUrls.delete(tabId);
      }
    }
    const frameDocMap = this.frameDocumentIds.get(tabId);
    if (frameDocMap) {
      frameDocMap.delete(frameId);
      if (frameDocMap.size === 0) {
        this.frameDocumentIds.delete(tabId);
      }
    }
  }

  /**
   * Resets injection history for all frames in a tab (e.g. top-level navigation / tab close).
   */
  public resetTabHistory(tabId: number): void {
    const frameMap = this.injectionHistory.get(tabId);
    if (frameMap) {
      for (const scriptSet of frameMap.values()) {
        scriptSet.clear();
      }
      frameMap.clear();
      this.injectionHistory.delete(tabId);
    }
    const frameUrlMap = this.frameUrls.get(tabId);
    if (frameUrlMap) {
      frameUrlMap.clear();
      this.frameUrls.delete(tabId);
    }
    const frameDocMap = this.frameDocumentIds.get(tabId);
    if (frameDocMap) {
      frameDocMap.clear();
      this.frameDocumentIds.delete(tabId);
    }
  }

  /**
   * Handles navigation commit event and resets history when appropriate.
   */
  public handleCommitted(
    tabId: number,
    frameId = 0,
    url: string,
    transitionType?: string,
    documentId?: string
  ): void {
    if (frameId === 0) {
      const currentUrl = this.tabUrls.get(tabId);
      const currentDocId = this.tabDocumentIds.get(tabId);

      // Same-URL link navigation reset with duplicate event protection:
      // If documentId is present:
      //   - Different documentId -> new document context -> reset history
      //   - Same documentId -> duplicate event delivery -> preserve history
      // If documentId is absent (legacy tests / mocks):
      //   - URL change or reload -> reset history
      //   - If URL and transitionType are identical without documentId, preserve history
      const hasDocId = typeof documentId === 'string' && documentId.length > 0;
      const isNewDoc = hasDocId
        ? documentId !== currentDocId
        : currentUrl !== url || transitionType === 'reload';

      if (isNewDoc) {
        this.resetTabHistory(tabId);
        this.tabUrls.set(tabId, url);
        if (hasDocId) {
          this.tabDocumentIds.set(tabId, documentId);
        } else {
          this.tabDocumentIds.delete(tabId);
        }
      }
    } else {
      // Subframe committed navigation: track subframe documentId and URL
      if (!this.tabUrls.has(tabId)) {
        this.tabUrls.set(tabId, url);
      }

      const hasDocId = typeof documentId === 'string' && documentId.length > 0;
      let frameUrlMap = this.frameUrls.get(tabId);
      if (!frameUrlMap) {
        frameUrlMap = new Map<number, string>();
        this.frameUrls.set(tabId, frameUrlMap);
      }
      let frameDocMap = this.frameDocumentIds.get(tabId);
      if (!frameDocMap) {
        frameDocMap = new Map<number, string>();
        this.frameDocumentIds.set(tabId, frameDocMap);
      }

      if (hasDocId) {
        const currentFrameDocId = frameDocMap.get(frameId);
        if (documentId !== currentFrameDocId) {
          this.clearFrameHistory(tabId, frameId);
          let fUrls = this.frameUrls.get(tabId);
          if (!fUrls) {
            fUrls = new Map<number, string>();
            this.frameUrls.set(tabId, fUrls);
          }
          fUrls.set(frameId, url);

          let fDocs = this.frameDocumentIds.get(tabId);
          if (!fDocs) {
            fDocs = new Map<number, string>();
            this.frameDocumentIds.set(tabId, fDocs);
          }
          fDocs.set(frameId, documentId);
        }
      } else {
        const currentFrameUrl = frameUrlMap.get(frameId);
        const isSubframeReload = transitionType === 'reload';
        const isNewSubframeDoc = currentFrameUrl !== url || isSubframeReload;

        if (isNewSubframeDoc) {
          this.clearFrameHistory(tabId, frameId);
          let fUrls = this.frameUrls.get(tabId);
          if (!fUrls) {
            fUrls = new Map<number, string>();
            this.frameUrls.set(tabId, fUrls);
          }
          fUrls.set(frameId, url);
        }
      }
    }
  }

  /**
   * Handles SPA URL change or in-page navigation.
   */
  public handleUrlUpdate(tabId: number, url: string): void {
    if (url && url !== this.tabUrls.get(tabId)) {
      this.resetTabHistory(tabId);
      this.tabUrls.set(tabId, url);
      this.tabDocumentIds.delete(tabId);
    }
  }

  /**
   * Cleans up tracking when a tab is closed.
   */
  public handleTabRemoved(tabId: number): void {
    this.resetTabHistory(tabId);
    this.tabUrls.delete(tabId);
    this.tabDocumentIds.delete(tabId);
    this.frameUrls.delete(tabId);
    this.frameDocumentIds.delete(tabId);
    this.injectionHistory.delete(tabId);
  }

  /**
   * Synchronously pre-reserves an injection key for a script at a given stage.
   * Returns true if reservation was acquired, false if already executed or pending.
   */
  public reserveInjection(
    tabId: number,
    frameId: number,
    scriptId: string,
    stage: RunAtTiming
  ): boolean {
    let tabMap = this.injectionHistory.get(tabId);
    if (!tabMap) {
      tabMap = new Map<number, Set<string>>();
      this.injectionHistory.set(tabId, tabMap);
    }

    let frameHistory = tabMap.get(frameId);
    if (!frameHistory) {
      frameHistory = new Set<string>();
      tabMap.set(frameId, frameHistory);
    }

    const dedupeKey = `${scriptId}:${stage}`;
    if (frameHistory.has(dedupeKey)) {
      return false;
    }

    frameHistory.add(dedupeKey);
    return true;
  }

  /**
   * Rolls back an injection reservation upon execution failure.
   */
  public rollbackReservation(
    tabId: number,
    frameId: number,
    scriptId: string,
    stage: RunAtTiming
  ): void {
    const frameHistory = this.injectionHistory.get(tabId)?.get(frameId);
    if (frameHistory) {
      frameHistory.delete(`${scriptId}:${stage}`);
    }
  }

  /**
   * Diagnostic query: checks if a script was injected in tab/frame for stage.
   */
  public hasInjected(
    tabId: number,
    frameId: number,
    scriptId: string,
    runAt: RunAtTiming
  ): boolean {
    const key = `${scriptId}:${runAt}`;
    return this.injectionHistory.get(tabId)?.get(frameId)?.has(key) ?? false;
  }

  /**
   * Completely deallocates all maps and sets.
   */
  public destroy(): void {
    for (const frameMap of this.injectionHistory.values()) {
      for (const scriptSet of frameMap.values()) {
        scriptSet.clear();
      }
      frameMap.clear();
    }
    this.injectionHistory.clear();
    for (const frameUrlMap of this.frameUrls.values()) {
      frameUrlMap.clear();
    }
    this.frameUrls.clear();
    for (const frameDocMap of this.frameDocumentIds.values()) {
      frameDocMap.clear();
    }
    this.frameDocumentIds.clear();
    this.tabUrls.clear();
    this.tabDocumentIds.clear();
  }
}
