/**
 * XOKJ - Chrome Debugger Session Manager & Declarative Early Init
 * Authoritative implementation for Milestone 2
 */

import {
  DebuggerSessionStatus,
  TabSessionState,
  CdpRpcLifecycleMessage,
  DevToolsConflictError,
  CdpDeclaration,
  ScriptRecord,
  ReconnectCdpResponse
} from '@/shared/types';
import { isRestrictedUrl, matchesAny } from '@/shared/match-pattern';
import { getScriptList, getSettings, storageMutex } from '@/shared/storage';

export interface TabSessionInternal {
  tabId: number;
  status: DebuggerSessionStatus;
  attached: boolean;
  attachedAt?: number;
  activeDomains: Set<string>;
  conflictDetected: boolean;
  conflictReason?: string;
  lastError?: string;
  updatedAt: number;
  operationLock: Promise<void> | null;
  currentOp?: 'attach' | 'detach' | null;
  targetUrl?: string;
}

export interface InflightRequestTracker {
  rejectPendingRequestsForTab?(tabId: number, error: any): number;
  rejectInflightForTab?(tabId: number, error: any): number;
}

export type LifecycleListener = (event: CdpRpcLifecycleMessage) => void;

/**
 * Checks if a URL is attachable by chrome.debugger.
 */
export function isAttachableTarget(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return !isRestrictedUrl(url);
}

/**
 * Deduplicates and orders declarative @cdp directives.
 * Domain .enable commands are sorted first, followed by configuration commands.
 */
export function aggregateCdpDeclarations(scripts: ScriptRecord[]): CdpDeclaration[] {
  const seenCommands = new Set<string>();
  const enableCommands: CdpDeclaration[] = [];
  const otherCommands: CdpDeclaration[] = [];

  for (const script of scripts) {
    if (!script.enabled) continue;
    const declarations = script.metadata?.cdpDeclarations || script.metadata?.cdp || [];
    for (const decl of declarations) {
      const key = `${decl.command}:${JSON.stringify(decl.params || {})}`;
      if (seenCommands.has(key)) continue;
      seenCommands.add(key);

      if (decl.method === 'enable') {
        enableCommands.push(decl);
      } else {
        otherCommands.push(decl);
      }
    }
  }

  return [...enableCommands, ...otherCommands];
}

export class TabDebuggerManager {
  private sessions = new Map<number, TabSessionInternal>();
  private lifecycleListeners = new Set<LifecycleListener>();
  private inflightTracker: InflightRequestTracker | null = null;
  private initialized = false;

  private onBeforeNavigateBound = this.handleNavigation.bind(this);
  private onDetachBound = this.handleDetach.bind(this);
  private onTabRemovedBound = this.handleTabRemoved.bind(this);

  /**
   * Binds an inflight command tracker (CdpBridgeServer) for single-owner detach rejection.
   */
  public setInflightTracker(tracker: InflightRequestTracker): void {
    this.inflightTracker = tracker;
  }

  /**
   * Initializes background listeners and rehydrates tab sessions.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (typeof chrome !== 'undefined') {
      if (chrome.webNavigation?.onBeforeNavigate) {
        chrome.webNavigation.onBeforeNavigate.addListener(this.onBeforeNavigateBound);
      }
      if (chrome.debugger?.onDetach) {
        chrome.debugger.onDetach.addListener(this.onDetachBound);
      }
      if (chrome.tabs?.onRemoved) {
        chrome.tabs.onRemoved.addListener(this.onTabRemovedBound);
      }

      await this.reconcileTargets();
    }

    this.initialized = true;
  }

  /**
   * Cleans up event listeners and resets state.
   */
  destroy(): void {
    if (!this.initialized) return;

    if (typeof chrome !== 'undefined') {
      if (chrome.webNavigation?.onBeforeNavigate) {
        chrome.webNavigation.onBeforeNavigate.removeListener(this.onBeforeNavigateBound);
      }
      if (chrome.debugger?.onDetach) {
        chrome.debugger.onDetach.removeListener(this.onDetachBound);
      }
      if (chrome.tabs?.onRemoved) {
        chrome.tabs.onRemoved.removeListener(this.onTabRemovedBound);
      }
    }

    this.sessions.clear();
    this.lifecycleListeners.clear();
    this.initialized = false;
  }

  private createSession(tabId: number): TabSessionInternal {
    const session: TabSessionInternal = {
      tabId,
      status: 'IDLE',
      attached: false,
      activeDomains: new Set<string>(),
      conflictDetected: false,
      updatedAt: Date.now(),
      operationLock: null,
      currentOp: null
    };
    this.sessions.set(tabId, session);
    return session;
  }

  /**
   * Attaches debugger to tab with re-entrancy protection. Returns boolean.
   */
  async attach(tabId: number, protocolVersion = '1.3', force = false): Promise<boolean> {
    try {
      await this.attachTab(tabId, undefined, force, protocolVersion);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Attaches debugger to tab with re-entrancy protection, throwing on error.
   * If session is in CONFLICT status and force !== true, immediately rejects with
   * DevToolsConflictError (code 1001) to prevent auto-attach loops while DevTools is open.
   *
   * Flexible argument signatures:
   *   - attachTab(tabId)
   *   - attachTab(tabId, protocolVersion) [e.g. attachTab(42, '1.3')]
   *   - attachTab(tabId, url, force, protocolVersion)
   *   - attachTab(tabId, force) [e.g. attachTab(42, true)]
   *   - attachTab(tabId, undefined, force) [e.g. attachTab(42, undefined, true)]
   */
  async attachTab(
    tabId: number,
    urlOrVersionOrForce?: string | boolean,
    forceOrProtocol?: boolean | string,
    protocolVersion = '1.3'
  ): Promise<void> {
    let url: string | undefined;
    let actualForce = false;
    let actualVersion = protocolVersion;

    // Disambiguate arguments
    if (typeof urlOrVersionOrForce === 'boolean') {
      actualForce = urlOrVersionOrForce;
      if (typeof forceOrProtocol === 'string') {
        actualVersion = forceOrProtocol;
      }
    } else if (typeof urlOrVersionOrForce === 'string') {
      if (/^\d+(\.\d+)*$/.test(urlOrVersionOrForce)) {
        actualVersion = urlOrVersionOrForce;
        if (typeof forceOrProtocol === 'boolean') {
          actualForce = forceOrProtocol;
        }
      } else {
        url = urlOrVersionOrForce;
        if (typeof forceOrProtocol === 'boolean') {
          actualForce = forceOrProtocol;
        } else if (typeof forceOrProtocol === 'string') {
          actualVersion = forceOrProtocol;
        }
      }
    } else {
      if (typeof forceOrProtocol === 'boolean') {
        actualForce = forceOrProtocol;
      } else if (typeof forceOrProtocol === 'string') {
        actualVersion = forceOrProtocol;
      }
    }

    let session = this.sessions.get(tabId);
    if (!session) {
      session = this.createSession(tabId);
    }

    // 1. Fast check if already attached and no operation in flight
    if (session.status === 'ATTACHED' && !session.operationLock) {
      return;
    }

    // 2. CONFLICT Guard: If in CONFLICT and not explicit force/reconnect, fast-reject with 1001
    if (session.status === 'CONFLICT' && !session.operationLock && !actualForce) {
      throw new DevToolsConflictError(
        tabId,
        session.conflictReason || 'canceled_by_user',
        `Cannot attach to tab ${tabId}: native DevTools conflict active (session status CONFLICT)`
      );
    }

    // 3. Coalesce with ongoing attachTab call ONLY IF already ATTACHING, attach is current op, and not a forced attach
    if (
      session.status === 'ATTACHING' &&
      session.currentOp === 'attach' &&
      session.operationLock &&
      !actualForce
    ) {
      await session.operationLock;
      if ((session.status as DebuggerSessionStatus) === 'ATTACHED') {
        return;
      }
    }

    // 4. Chain onto operationLock in FIFO order to prevent race conditions & execution order inversion
    const prevLock = session.operationLock;
    let releaseLock!: () => void;
    const attachLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    session.operationLock = attachLock;
    session.currentOp = 'attach';

    try {
      if (prevLock) {
        try {
          await prevLock;
        } catch {
          // Rejection in prior operation should not prevent next operation
        }
      }

      // Re-check state after prior lock settles
      if ((session.status as DebuggerSessionStatus) === 'ATTACHED') {
        return;
      }
      if ((session.status as DebuggerSessionStatus) === 'CONFLICT' && !actualForce) {
        throw new DevToolsConflictError(
          tabId,
          session.conflictReason || 'canceled_by_user',
          `Cannot attach to tab ${tabId}: native DevTools conflict active (session status CONFLICT)`
        );
      }

      session.status = 'ATTACHING';

      const attachAction = async () => {
        let targetUrl = url || session.targetUrl;
        if (!targetUrl && typeof chrome !== 'undefined' && chrome.tabs?.get) {
          try {
            const tab = await chrome.tabs.get(tabId);
            if (tab?.url) {
              targetUrl = tab.url;
              session.targetUrl = targetUrl;
            }
          } catch {
            // Ignore
          }
        }

        if (targetUrl && !isAttachableTarget(targetUrl)) {
          session.status = 'DETACHED';
          session.attached = false;
          session.lastError = `Cannot attach to restricted target URL: ${targetUrl}`;
          await this.persistSession(session);
          throw new Error(`Cannot attach to restricted target URL: ${targetUrl}`);
        }

        try {
          if (typeof chrome === 'undefined' || !chrome.debugger) {
            throw new Error('chrome.debugger API is unavailable');
          }

          await chrome.debugger.attach({ tabId }, actualVersion);

          // Closed tab guard: verify tab was not removed or detached while attach was suspended
          if (!this.sessions.has(tabId) || session.status === 'DETACHED') {
            try {
              if (typeof chrome !== 'undefined' && chrome.debugger) {
                await chrome.debugger.detach({ tabId });
              }
            } catch {
              // Benign
            }
            return;
          }

          session.status = 'ATTACHED';
          session.attached = true;
          session.attachedAt = Date.now();
          session.conflictDetected = false;
          session.conflictReason = undefined;
          session.lastError = undefined;
          session.updatedAt = Date.now();

          await this.persistSession(session);
          this.broadcastLifecycle(tabId, 'ATTACHED');
        } catch (err: any) {
          const errorMsg = err?.message || String(err);
          if (
            errorMsg.includes('Another debugger is already attached') ||
            errorMsg.includes('DevTools') ||
            errorMsg.includes('attached to the tab')
          ) {
            session.status = 'CONFLICT';
            session.attached = false;
            session.conflictDetected = true;
            session.conflictReason = errorMsg;
            session.updatedAt = Date.now();
            await this.persistSession(session);
            this.broadcastLifecycle(tabId, 'CONFLICT', errorMsg);
            throw new DevToolsConflictError(tabId, 'canceled_by_user', errorMsg);
          } else {
            session.status = 'DETACHED';
            session.attached = false;
            session.lastError = errorMsg;
            session.updatedAt = Date.now();
            await this.persistSession(session);
            throw err;
          }
        }
      };

      await attachAction();
    } finally {
      releaseLock();
      if (session.operationLock === attachLock) {
        session.operationLock = null;
        session.currentOp = null;
      }
    }
  }

  /**
   * Detaches debugger from target tab.
   */
  async detach(tabId: number): Promise<void> {
    await this.detachTab(tabId);
  }

  /**
   * Detaches debugger from target tab and updates status.
   */
  async detachTab(tabId: number): Promise<void> {
    const session = this.sessions.get(tabId);
    if (!session) return;

    // Fast check: already detached and no operation in flight
    if (session.status === 'DETACHED' && !session.operationLock) {
      return;
    }

    // If another detach is already in progress, coalesce onto it
    if (session.operationLock && session.currentOp === 'detach') {
      try {
        await session.operationLock;
      } catch {
        // Non-fatal
      }
      return;
    }

    // Chain onto operationLock in FIFO order
    const prevLock = session.operationLock;
    let releaseLock!: () => void;
    const detachLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    session.operationLock = detachLock;
    session.currentOp = 'detach';

    try {
      if (prevLock) {
        try {
          await prevLock;
        } catch {
          // Non-fatal: even if attach failed, detach cleanup must proceed
        }
      }

      // Re-check: if already detached after prior lock settles, return without duplicate detach call
      if (session.status === 'DETACHED') {
        return;
      }

      const detachAction = async () => {
        try {
          if (typeof chrome !== 'undefined' && chrome.debugger) {
            await chrome.debugger.detach({ tabId });
          }
        } catch {
          // Benign if tab already detached or closed
        } finally {
          session.status = 'DETACHED';
          session.attached = false;
          session.activeDomains.clear();
          session.updatedAt = Date.now();

          // Programmatic detach rejection: cleanly reject pending inflight requests immediately
          if (this.inflightTracker) {
            const error = {
              code: 1002,
              message: `Debugger detached from tab: detached`,
              data: { reason: 'detached' }
            };
            if (typeof this.inflightTracker.rejectPendingRequestsForTab === 'function') {
              this.inflightTracker.rejectPendingRequestsForTab(tabId, error);
            } else if (typeof this.inflightTracker.rejectInflightForTab === 'function') {
              this.inflightTracker.rejectInflightForTab(tabId, error as any);
            }
          }

          await this.persistSession(session);
          this.broadcastLifecycle(tabId, 'DETACHED');
        }
      };

      await detachAction();
    } finally {
      releaseLock();
      if (session.operationLock === detachLock) {
        session.operationLock = null;
        session.currentOp = null;
      }
    }
  }

  /**
   * Sends a CDP command to an attached tab.
   */
  async sendCommand<T = unknown>(
    tabId: number,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const session = this.sessions.get(tabId);

    if (session?.status === 'CONFLICT') {
      throw new DevToolsConflictError(tabId, session.conflictReason || 'canceled_by_user');
    }

    if (!session || session.status !== 'ATTACHED') {
      const attached = await this.attach(tabId);
      if (!attached) {
        const current = this.sessions.get(tabId);
        if (current?.status === 'CONFLICT') {
          throw new DevToolsConflictError(tabId, current.conflictReason || 'canceled_by_user');
        }
        throw new Error(`Failed to attach debugger to tab ${tabId}`);
      }
    }

    if (typeof chrome === 'undefined' || !chrome.debugger) {
      throw new Error('chrome.debugger API is unavailable');
    }

    const result = await chrome.debugger.sendCommand({ tabId }, method, params);

    if (method.endsWith('.enable')) {
      const domain = method.split('.')[0];
      this.sessions.get(tabId)?.activeDomains.add(domain);
    }

    return result as T;
  }

  /**
   * Re-initializes declared CDP domains for a tab (e.g. after reconnection or navigation).
   * Harmonizes with DevToolsConflictHandler.reconnectTab and TabDebuggerSessionController.
   */
  async initializeDeclaredDomains(tabId: number, targetUrl?: string): Promise<void> {
    let session = this.sessions.get(tabId);
    if (!session) {
      session = this.createSession(tabId);
    }

    let url = targetUrl || session.targetUrl;

    if (!url && typeof chrome !== 'undefined' && chrome.tabs?.get) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.url) {
          url = tab.url;
          session.targetUrl = url;
        }
      } catch {
        // Tab query failure is non-fatal
      }
    }

    if (url && isAttachableTarget(url)) {
      await this.executeDeclarativeInit(tabId, url);
    }
  }

  /**
   * Reconnects after a DevTools conflict.
   */
  async reconnect(tabId: number): Promise<ReconnectCdpResponse> {
    let session = this.sessions.get(tabId);
    if (!session) {
      session = this.createSession(tabId);
    }

    session.status = 'IDLE';
    session.conflictDetected = false;
    session.conflictReason = undefined;

    const settings = await getSettings();
    const success = await this.attach(tabId, settings.debuggerProtocolVersion || '1.3', true);

    if (!success) {
      return {
        success: false,
        error: session.conflictReason || session.lastError || 'Failed to reconnect debugger'
      };
    }

    await this.initializeDeclaredDomains(tabId, session.targetUrl);

    return { success: true };
  }

  /**
   * Handles webNavigation.onBeforeNavigate for top-level early initialization.
   */
  async handleNavigation(
    details: chrome.webNavigation.WebNavigationParentedCallbackDetails
  ): Promise<void> {
    if (details.frameId !== 0) return;
    if (!isAttachableTarget(details.url)) return;

    let session = this.sessions.get(details.tabId);
    if (!session) {
      session = this.createSession(details.tabId);
    }
    session.targetUrl = details.url;

    if (session.status === 'CONFLICT') {
      return;
    }

    await this.executeDeclarativeInit(details.tabId, details.url);
  }

  /**
   * Matches enabled scripts and executes declared @cdp directives before DOM is ready.
   */
  async executeDeclarativeInit(tabId: number, targetUrl: string): Promise<void> {
    const settings = await getSettings();
    if (!settings.globalEnabled || !settings.autoAttachDebugger) return;

    const allScripts = await getScriptList();
    const matchedScripts = allScripts.filter((script) => {
      if (!script.enabled) return false;
      if (matchesAny(script.metadata?.excludes || [], targetUrl)) return false;
      const patterns = script.metadata?.matches?.length
        ? script.metadata.matches
        : script.metadata?.matchPatterns?.length
        ? script.metadata.matchPatterns
        : script.metadata?.includes;
      return matchesAny(patterns || [], targetUrl);
    });

    const declarations = aggregateCdpDeclarations(matchedScripts);
    if (declarations.length === 0) {
      return;
    }

    const attached = await this.attach(tabId, settings.debuggerProtocolVersion || '1.3');
    if (!attached) return;

    const session = this.sessions.get(tabId);
    if (!session || !this.sessions.has(tabId) || session.status !== 'ATTACHED') return;

    for (const decl of declarations) {
      if (!this.sessions.has(tabId) || session.status !== 'ATTACHED') {
        break;
      }

      try {
        await chrome.debugger.sendCommand({ tabId }, decl.command, decl.params || {});
        session.activeDomains.add(decl.domain);
      } catch (err) {
        console.warn(`[TabDebuggerManager] Declarative command ${decl.command} failed on tab ${tabId}:`, err);
        if (!this.sessions.has(tabId) || session.status !== 'ATTACHED') {
          break;
        }
      }

      if (!this.sessions.has(tabId) || session.status !== 'ATTACHED') {
        break;
      }
    }
  }

  /**
   * Handles chrome.debugger.onDetach events.
   */
  handleDetach(source: chrome.debugger.Debuggee, reason: string): void {
    const tabId = source.tabId;
    if (typeof tabId !== 'number') return;

    const session = this.sessions.get(tabId);
    if (!session) return;

    const isConflict = reason === 'canceled_by_user' || reason === 'replaced_with_devtools';

    // 1. Instantly reject inflight CDP commands for this tab
    if (this.inflightTracker) {
      const error = isConflict
        ? {
            code: 1001,
            message: 'DevTools conflict: native developer tools opened on tab',
            data: { reason }
          }
        : {
            code: 1002,
            message: `Debugger detached from tab: ${reason}`,
            data: { reason }
          };

      if (typeof this.inflightTracker.rejectPendingRequestsForTab === 'function') {
        this.inflightTracker.rejectPendingRequestsForTab(tabId, error);
      } else if (typeof this.inflightTracker.rejectInflightForTab === 'function') {
        this.inflightTracker.rejectInflightForTab(tabId, error as any);
      }
    }

    if (isConflict) {
      session.status = 'CONFLICT';
      session.attached = false;
      session.conflictDetected = true;
      session.conflictReason = reason;
      session.updatedAt = Date.now();
      this.persistSession(session).catch(() => {});
      this.broadcastLifecycle(tabId, 'CONFLICT', reason);
    } else {
      session.status = 'DETACHED';
      session.attached = false;
      session.activeDomains.clear();
      session.updatedAt = Date.now();
      this.persistSession(session).catch(() => {});
      this.broadcastLifecycle(tabId, 'DETACHED', reason);
    }
  }

  /**
   * Handles chrome.tabs.onRemoved events, cleaning up tab sessions.
   */
  async handleTabRemoved(tabId: number): Promise<void> {
    const session = this.sessions.get(tabId);
    if (session) {
      session.status = 'DETACHED';
      session.attached = false;
      session.activeDomains.clear();
      session.updatedAt = Date.now();
    }
    this.sessions.delete(tabId);

    if (typeof chrome !== 'undefined') {
      chrome.storage?.session?.remove?.([`tab_session_${tabId}`]).catch?.(() => {});

      if (chrome.storage?.local?.get && chrome.storage?.local?.set) {
        try {
          await storageMutex.runExclusive(async () => {
            const stored = await chrome.storage.local.get('tab_sessions');
            if (stored?.tab_sessions && stored.tab_sessions[tabId] !== undefined) {
              const updated = { ...stored.tab_sessions };
              delete updated[tabId];
              await chrome.storage.local.set({ tab_sessions: updated });
            }
          });
        } catch {
          // Non-fatal
        }
      }
    }
  }

  /**
   * Reconciles in-memory sessions with browser ground truth if available.
   */
  private async reconcileTargets(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.debugger?.getTargets) return;
    try {
      const targets = await chrome.debugger.getTargets();
      const attachedTabIds = new Set(
        targets.filter((t) => t.attached && typeof t.tabId === 'number').map((t) => t.tabId!)
      );

      for (const [tabId, session] of this.sessions.entries()) {
        if (session.status === 'ATTACHED' && !attachedTabIds.has(tabId)) {
          session.status = 'DETACHED';
          session.attached = false;
          session.updatedAt = Date.now();
        }
      }
    } catch {
      // Ignored
    }
  }

  /**
   * Persists session snapshot to chrome.storage.session and chrome.storage.local.
   */
  private async persistSession(session: TabSessionInternal): Promise<void> {
    if (!this.sessions.has(session.tabId)) {
      return;
    }

    const snapshot: TabSessionState = {
      tabId: session.tabId,
      status: session.status,
      attached: session.attached,
      attachedAt: session.attachedAt,
      activeDomains: Array.from(session.activeDomains),
      conflictDetected: session.conflictDetected,
      conflictReason: session.conflictReason,
      lastError: session.lastError,
      updatedAt: session.updatedAt
    };

    if (typeof chrome !== 'undefined') {
      if (chrome.storage?.session?.set) {
        try {
          await chrome.storage.session.set({
            [`tab_session_${session.tabId}`]: snapshot
          });
        } catch {
          // Fallback
        }
      }

      if (chrome.storage?.local?.get && chrome.storage?.local?.set) {
        try {
          await storageMutex.runExclusive(async () => {
            if (!this.sessions.has(session.tabId)) return;
            const stored = await chrome.storage.local.get('tab_sessions');
            const sessions = stored.tab_sessions || {};
            sessions[session.tabId] = snapshot;
            await chrome.storage.local.set({ tab_sessions: sessions });
          });
        } catch {
          // Non-fatal
        }
      }
    }
  }

  /**
   * Broadcasts lifecycle status to internal listeners, tab content scripts, and extension runtime.
   */
  private broadcastLifecycle(
    tabId: number,
    status: DebuggerSessionStatus,
    reason?: string
  ): void {
    const lifecycleStatus =
      status === 'CONFLICT' ? 'CONFLICT' : status === 'ATTACHED' ? 'ATTACHED' : 'DETACHED';

    const message: CdpRpcLifecycleMessage = {
      type: 'CDP_LIFECYCLE_EVENT',
      tabId,
      status: lifecycleStatus,
      reason
    };

    for (const listener of this.lifecycleListeners) {
      try {
        listener(message);
      } catch (err) {
        console.error('[TabDebuggerManager] Error in lifecycle listener:', err);
      }
    }

    if (typeof chrome !== 'undefined' && chrome.tabs?.sendMessage) {
      chrome.tabs.sendMessage(tabId, message).catch(() => {});
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(message).catch(() => {});
    }
  }

  // Session query methods
  public getSession(tabId: number): TabSessionState | undefined {
    const session = this.sessions.get(tabId);
    if (!session) return undefined;
    return {
      tabId: session.tabId,
      status: session.status,
      attached: session.attached,
      attachedAt: session.attachedAt,
      activeDomains: Array.from(session.activeDomains),
      conflictDetected: session.conflictDetected,
      conflictReason: session.conflictReason,
      lastError: session.lastError,
      updatedAt: session.updatedAt
    };
  }

  public getAllSessions(): TabSessionState[] {
    return Array.from(this.sessions.values()).map((s) => ({
      tabId: s.tabId,
      status: s.status,
      attached: s.attached,
      attachedAt: s.attachedAt,
      activeDomains: Array.from(s.activeDomains),
      conflictDetected: s.conflictDetected,
      conflictReason: s.conflictReason,
      lastError: s.lastError,
      updatedAt: s.updatedAt
    }));
  }

  public getStatus(tabId: number): DebuggerSessionStatus {
    return this.getTabStatus(tabId);
  }

  public getTabStatus(tabId: number): DebuggerSessionStatus {
    return this.sessions.get(tabId)?.status ?? 'IDLE';
  }

  public setTabStatus(tabId: number, status: DebuggerSessionStatus, reason?: string): void {
    let session = this.sessions.get(tabId);
    if (!session) {
      if (status === 'DETACHED') {
        // Tab was removed or not tracked; do NOT resurrect closed tabs into memory/storage
        return;
      }
      session = this.createSession(tabId);
    }
    session.status = status;
    session.attached = status === 'ATTACHED';
    session.conflictDetected = status === 'CONFLICT';
    if (reason) {
      if (status === 'CONFLICT') {
        session.conflictReason = reason;
      } else {
        session.lastError = reason;
      }
    }
    session.updatedAt = Date.now();
    this.persistSession(session);
  }

  public isAttached(tabId: number): boolean {
    return this.getTabStatus(tabId) === 'ATTACHED';
  }

  public getActiveDomains(tabId: number): string[] {
    const session = this.sessions.get(tabId);
    return session ? Array.from(session.activeDomains) : [];
  }

  public onLifecycle(listener: LifecycleListener): () => void {
    this.lifecycleListeners.add(listener);
    return () => {
      this.lifecycleListeners.delete(listener);
    };
  }
}
