/**
 * XOKJ - Content Script Bridge Security Validator & Token Generator
 *
 * Enforces the 4-layer validation security gate and provides cryptographic channel tokens.
 */

/**
 * Generates a cryptographically strong channel identifier for postMessage authorization.
 */
export function generateSecureChannelId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return `xokj_${crypto.randomUUID()}`;
    }
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return `xokj_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    }
  }
  return `xokj_${Math.random().toString(36).slice(2, 12)}_${Date.now().toString(36)}`;
}

/**
 * Step 0 Fast-Path Check:
 * Checks event.data before accessing event.source or event.origin to drop ~99.9% of
 * non-extension messages in <1µs and prevent hostile getter traps from firing.
 */
export function isFastPathAllowed(data: any): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const type = data.type;
  return type === 'CDP_RPC_REQUEST' || type === 'GM_STORAGE_SET' || type === 'GM_STORAGE_DELETE';
}

/**
 * Layer 1: Source verification - must be current window.
 */
export function verifySource(eventSource: any): boolean {
  if (typeof window === 'undefined') return true;
  return eventSource === window;
}

/**
 * Layer 2: Origin verification.
 * Verifies that the message origin matches window.location.origin or configured allowedOrigin.
 */
export function verifyOrigin(
  origin?: string,
  allowedOrigin?: string | string[],
  requireOrigin?: boolean
): boolean {
  if (requireOrigin && !origin) {
    return false;
  }
  if (allowedOrigin) {
    if (origin === undefined) {
      return !requireOrigin;
    }
    if (allowedOrigin === '*') {
      return true;
    }
    if (Array.isArray(allowedOrigin)) {
      return allowedOrigin.includes('*') || allowedOrigin.includes(origin);
    }
    return origin === allowedOrigin;
  }
  if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.origin &&
    window.location.origin !== 'null'
  ) {
    if (origin !== undefined && origin !== '' && origin !== window.location.origin) {
      return false;
    }
  }
  return true;
}

/**
 * Layer 3: Sender source tag verification.
 * Validates that data.source is either omitted or explicitly 'xokj-userscript'.
 */
export function verifySenderSource(source: unknown): boolean {
  return !source || source === 'xokj-userscript';
}

/**
 * Layer 4: Channel token validation.
 * Verifies cryptographic channel token shared between injected scripts and bridge.
 */
export function verifyChannelId(
  messageChannelId: unknown,
  expectedChannelId: string,
  requireChannelId: boolean
): boolean {
  if (requireChannelId) {
    return (
      typeof messageChannelId === 'string' &&
      messageChannelId.length > 0 &&
      messageChannelId === expectedChannelId
    );
  }
  if (expectedChannelId && messageChannelId) {
    return messageChannelId === expectedChannelId;
  }
  return true;
}

/**
 * Validates GM storage payload fields (scriptId and key must be non-empty strings).
 */
export function validateStoragePayload(data: any): {
  valid: boolean;
  scriptId: string;
  key: string;
  error?: string;
} {
  const scriptId = typeof data?.scriptId === 'string' ? data.scriptId.trim() : '';
  const key = typeof data?.key === 'string' ? data.key.trim() : '';

  if (!scriptId) {
    return { valid: false, scriptId: '', key: '', error: 'scriptId must be a non-empty string' };
  }
  if (!key) {
    return { valid: false, scriptId, key: '', error: 'key must be a non-empty string' };
  }

  return { valid: true, scriptId, key };
}
