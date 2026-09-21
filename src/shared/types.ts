/**
 * XOKJ - Shared Domain Types & Interface Contracts
 * Authoritative reference for Milestone 1 - Milestone 5
 */

// ---------------------------------------------------------------------------
// 1. Userscript Metadata & Directive Types
// ---------------------------------------------------------------------------

/**
 * Execution timings conforming to Tampermonkey/Violentmonkey specifications.
 */
export type RunAtTiming = 'document-start' | 'document-end' | 'document-idle';

/**
 * Declarative CDP domain or method initialization parsed from userscript headers.
 * Supported syntaxes:
 *   // @cdp <Domain>
 *   // @cdp <Domain>.<method>
 *   // @cdp <Domain>.<method> <JSONParams>
 *   // @cdp <Domain> <JSONParams>
 */
export interface CdpDeclaration {
  /** CDP domain (e.g. "Network", "Fetch", "Page") */
  domain: string;
  /** CDP method (defaults to "enable" if omitted) */
  method: string;
  /** Fully-qualified CDP command (e.g. "Network.enable", "Fetch.enable") */
  command: string;
  /** Parsed JSON parameters object, or empty object if none provided */
  params: Record<string, unknown>;
  /** Raw directive string for traceability and debugging */
  raw?: string;
}

/**
 * Parsed metadata structure extracted from `// ==UserScript==` headers.
 */
export interface ParsedMetadata {
  /** Human-readable script title (defaults to "Unnamed Script" if omitted) */
  name: string;
  /** Unique namespace identifier/domain */
  namespace?: string;
  /** Script semver or dot-notation version string */
  version?: string;
  /** Brief description of script functionality */
  description?: string;
  /** Author name or handle */
  author?: string;
  /** Icon URL (16x16, 32x32, or data URI) */
  icon?: string;
  /** Chromium match patterns defining target pages */
  matches: string[];
  /** Alias for matches for API contract compatibility */
  matchPatterns: string[];
  /** Legacy Greasemonkey include patterns or globs */
  includes: string[];
  /** Exclusion patterns (strict precedence over matches/includes) */
  excludes: string[];
  /** Execution timing tier */
  runAt: RunAtTiming;
  /** Declared privilege grants (e.g. "none", "GM_*", "GM_cdp") */
  grants: string[];
  /** Structured @cdp declarative initializations */
  cdp: CdpDeclaration[];
  /** Alias for cdp for API contract compatibility */
  cdpDeclarations: CdpDeclaration[];
  /** Deduplicated list of CDP domain names required (e.g. ["Network", "Fetch"]) */
  cdpDomains: string[];
  /** External JavaScript library URLs to load prior to script execution */
  requires: string[];
  /** Named static resources (CSS, JSON, image) mapping name -> URL */
  resources: Record<string, string>;
  /** Restricts script execution to top-level frame (frameId === 0) */
  noframes: boolean;
  /** Allowed destination domains for GM_xmlhttpRequest */
  connects: string[];
  /** Raw directive entries indexed by lowercased directive key */
  rawEntries: Record<string, string[]>;
}

/**
 * Complete parse result containing extraction status, metadata, source code, and non-fatal warnings.
 */
export interface ParseResult {
  /** Whether a valid // ==UserScript== delimiter block was detected */
  hasMetadata: boolean;
  /** Parsed or default metadata */
  metadata: ParsedMetadata;
  /** Original unparsed source code */
  code: string;
  /** Non-fatal syntax warnings or validation error messages */
  errors: string[];
}

/**
 * Return type of parseMetadata convenience helper, combining ParsedMetadata and ParseResult properties.
 */
export type ParseMetadataResult = ParsedMetadata & {
  hasMetadata: boolean;
  metadata: ParsedMetadata;
  code: string;
  errors: string[];
};

// ---------------------------------------------------------------------------
// 2. Script Persistence & Record Types (Storage)
// ---------------------------------------------------------------------------

/**
 * Stored script item persisted in chrome.storage.local.
 */
export interface ScriptRecord {
  /** Unique UUID v4 or nanoid identifier */
  id: string;
  /** Normalized display name */
  name: string;
  /** Full source code including metadata header block */
  code: string;
  /** Cached pre-parsed metadata */
  metadata: ParsedMetadata;
  /** User toggle state (enabled/disabled) */
  enabled: boolean;
  /** Epoch millisecond creation timestamp */
  createdAt: number;
  /** Epoch millisecond last modification timestamp */
  updatedAt: number;
  /** Epoch millisecond timestamp of last injection run */
  lastRunAt?: number;
  /** Non-fatal parser warnings or validation errors detected on save */
  parseErrors?: string[];
}

/**
 * Filter parameters for querying scripts.
 */
export interface ScriptFilter {
  search?: string;
  enabledOnly?: boolean;
  enabled?: boolean;
  url?: string;
  runAt?: RunAtTiming;
  domain?: string;
}

// ---------------------------------------------------------------------------
// 3. Chrome DevTools Protocol (CDP) RPC Message Protocol
// ---------------------------------------------------------------------------

/**
 * Asynchronous RPC invocation sent from Userscript/Content Script to Background Service Worker.
 */
export interface CdpRpcRequest {
  type: 'CDP_RPC_REQUEST';
  /** Unique correlation ID for matching requests with responses */
  id: string;
  /** Tab ID where the script executes (injected by background via sender.tab.id) */
  tabId?: number;
  /** Calling script identifier for permission verification */
  scriptId?: string;
  /** CDP method to invoke (e.g. "Page.navigate", "Network.getCookies", "Fetch.enable") */
  method: string;
  /** Method parameters object */
  params?: Record<string, unknown>;
}

/**
 * Error structure returned when a CDP RPC invocation fails.
 */
export interface CdpRpcError {
  /** Error code (standard JSON-RPC or custom error code) */
  code?: number;
  /** Error description */
  message: string;
  /** Optional supplementary error data */
  data?: unknown;
}

/**
 * Response returned from Background Service Worker to Userscript/Content Script.
 */
export interface CdpRpcResponse {
  type: 'CDP_RPC_RESPONSE';
  /** Correlates to request id */
  id: string;
  /** True if command succeeded, false otherwise */
  success: boolean;
  /** Result payload returned by chrome.debugger.sendCommand */
  result?: unknown;
  /** Error details if invocation failed */
  error?: CdpRpcError;
}

/**
 * Push event notification broadcast from Background Service Worker to Tab content scripts.
 */
export interface CdpRpcEventMessage {
  type: 'CDP_RPC_EVENT';
  /** Target tab ID */
  tabId: number;
  /** CDP event name (e.g. "Network.requestWillBeSent", "Page.loadEventFired") */
  method: string;
  /** Event payload */
  params: unknown;
}

/**
 * Connection states for tab debugger sessions.
 */
export type CdpLifecycleStatus = 'ATTACHED' | 'DETACHED' | 'CONFLICT';

/**
 * Lifecycle notification pushed to UI and content scripts when debugger state changes.
 */
export interface CdpRpcLifecycleMessage {
  type: 'CDP_LIFECYCLE_EVENT';
  tabId: number;
  status: CdpLifecycleStatus;
  /** Disconnection or conflict reason (e.g. "canceled_by_user", "target_closed") */
  reason?: string;
}

// ---------------------------------------------------------------------------
// 4. Tab & Debugger Session State Machine
// ---------------------------------------------------------------------------

export type DebuggerSessionStatus = 'IDLE' | 'ATTACHING' | 'ATTACHED' | 'CONFLICT' | 'DETACHED';

/**
 * Internal state maintained per tab in the Background Service Worker.
 */
export interface TabSessionState {
  tabId: number;
  status: DebuggerSessionStatus;
  attached: boolean;
  attachedAt?: number;
  activeDomains: string[];
  conflictDetected: boolean;
  conflictReason?: string;
  lastError?: string;
  updatedAt: number;
}

/**
 * Alias for TabSessionState conforming to PROJECT.md architectural contracts.
 */
export type TabSession = TabSessionState;

/**
 * DevTools conflict event description.
 */
export interface ConflictEvent {
  tabId: number;
  reason: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// 5. Extension Storage Schema & Application Settings
// ---------------------------------------------------------------------------

export interface AppSettings {
  globalEnabled: boolean;
  autoAttachDebugger: boolean;
  debuggerProtocolVersion?: string; // Default: '1.3'
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface ExtensionStorageSchema {
  schemaVersion: number;
  scripts: Record<string, ScriptRecord>;
  settings: AppSettings;
  tab_sessions?: Record<number, TabSessionState>;
}

// ---------------------------------------------------------------------------
// 6. Extension Internal Messaging (Background ↔ Popup / Dashboard)
// ---------------------------------------------------------------------------

export interface GetActiveScriptsMessage {
  type: 'GET_ACTIVE_SCRIPTS_FOR_TAB';
  tabId: number;
  url: string;
}

export interface GetActiveScriptsResponse {
  scripts: ScriptRecord[];
  cdpStatus: DebuggerSessionStatus;
  conflictReason?: string;
}

export interface ToggleScriptMessage {
  type: 'TOGGLE_SCRIPT';
  scriptId: string;
  enabled: boolean;
}

export interface ToggleScriptResponse {
  success: boolean;
  enabled?: boolean;
  error?: string;
}

export interface ToggleGlobalMessage {
  type: 'TOGGLE_GLOBAL';
  enabled: boolean;
}

export interface ToggleGlobalResponse {
  success: boolean;
  enabled?: boolean;
  error?: string;
}

export interface GetCdpStatusMessage {
  type: 'GET_CDP_STATUS';
  tabId: number;
}

export interface GetCdpStatusResponse {
  status: DebuggerSessionStatus;
  reason?: string;
}

export interface ReconnectCdpMessage {
  type: 'RECONNECT_CDP';
  tabId: number;
}

export interface ReconnectCdpResponse {
  success: boolean;
  error?: string;
}

export interface GetTabSessionMessage {
  type: 'GET_TAB_SESSION';
  tabId: number;
}

export interface GetTabSessionResponse {
  session?: TabSessionState;
}

/**
 * Union type representing all messages routed through chrome.runtime.
 */
export type ExtensionMessage =
  | GetActiveScriptsMessage
  | ToggleScriptMessage
  | ToggleGlobalMessage
  | GetCdpStatusMessage
  | ReconnectCdpMessage
  | GetTabSessionMessage
  | CdpRpcRequest
  | CdpRpcResponse
  | CdpRpcEventMessage
  | CdpRpcLifecycleMessage;

// ---------------------------------------------------------------------------
// 7. Userscript Runtime SDK Interface
// ---------------------------------------------------------------------------

export type CdpClientStatus = 'ATTACHED' | 'CONFLICT' | 'DETACHED' | 'IDLE';

export interface CdpClient {
  /**
   * Invokes a CDP method and awaits the result asynchronously.
   */
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;

  /**
   * Subscribes to a CDP event. Returns an unsubscribe teardown function.
   */
  on(event: string, handler: (params: any) => void): () => void;

  /**
   * Unsubscribes a previously registered event listener.
   */
  off(event: string, handler: (params: any) => void): void;

  /**
   * Checks whether the current tab's debugger session is actively attached.
   */
  isAttached(): Promise<boolean>;

  /**
   * Queries the current CDP debugger session status for the current tab.
   */
  getStatus(): Promise<CdpClientStatus>;
}

// ---------------------------------------------------------------------------
// 8. Custom Error Classes
// ---------------------------------------------------------------------------

/**
 * Thrown or rejected when a CDP operation fails due to native DevTools conflict.
 */
export class DevToolsConflictError extends Error {
  public readonly code: number = 1001;
  public readonly tabId: number;
  public readonly reason: string;

  constructor(
    tabId: number,
    reason: string = 'canceled_by_user',
    message: string = 'DevTools conflict: native developer tools opened on tab'
  ) {
    super(message);
    this.name = 'DevToolsConflictError';
    this.tabId = tabId;
    this.reason = reason;
    this.code = 1001;
    Object.setPrototypeOf(this, DevToolsConflictError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      tabId: this.tabId,
      reason: this.reason,
      message: this.message
    };
  }
}
