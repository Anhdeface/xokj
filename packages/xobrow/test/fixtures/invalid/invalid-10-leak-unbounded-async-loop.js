// ==UserScript==
// @name         Violation: leak-unbounded-async-loop
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        GM_cdp
// @cdp          Page
// ==/UserScript==

(async function () {
  'use strict';

  // Violation: leak-unbounded-async-loop
  while (true) {
    await cdp.send('Page.captureScreenshot', {});
  }
})();
