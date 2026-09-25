/**
 * XOKJ - Content Script Entry Point
 * Location: src/content/index.ts
 *
 * Initializes the ContentScriptBridge in the content script context,
 * establishing the communication conduit between userscripts and the extension.
 */

import { ContentScriptBridge } from './bridge';

console.log('[XOKJ Content] Content script loaded on:', typeof window !== 'undefined' ? window.location.href : 'unknown');

// 1. Instantiate the singleton message bridge
export const bridge = new ContentScriptBridge({
  autoStart: true
});

// 2. Attach teardown handler on page unload
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pagehide',
    () => {
      bridge.disconnect();
    },
    { once: true }
  );
}

// 3. Export bridge reference
export default bridge;
export { ContentScriptBridge };
