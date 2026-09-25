/**
 * XOKJ - Content Script Entry Point
 *
 * Initializes the ContentScriptBridge in the content script context,
 * establishing the communication conduit between userscripts and the extension.
 */

import { ContentScriptBridge } from './bridge';

console.log('[XOKJ Content] Content script loaded on:', typeof window !== 'undefined' ? window.location.href : 'unknown');

export const bridge = new ContentScriptBridge({
  autoStart: true
});

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pagehide',
    () => {
      bridge.disconnect();
    },
    { once: true }
  );
}

export default bridge;
export { ContentScriptBridge };
