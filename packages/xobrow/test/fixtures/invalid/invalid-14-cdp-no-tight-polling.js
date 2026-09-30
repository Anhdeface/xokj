// ==UserScript==
// @name         Violation: cdp-no-tight-polling
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        GM_cdp
// @cdp          Page
// ==/UserScript==

(function () {
  'use strict';

  // Violation: cdp-no-tight-polling (10ms interval is below 100ms threshold)
  const timer = setInterval(async () => {
    try {
      await cdp.send('Page.getLayoutMetrics', {});
    } catch (err) {
      console.error(err);
    }
  }, 10);

  window.addEventListener('unload', () => clearInterval(timer), { once: true });
})();
