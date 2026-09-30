// ==UserScript==
// @name         Violation: leak-unclosed-cdp-listener
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        GM_cdp
// @cdp          Page
// ==/UserScript==

(function () {
  'use strict';

  // Violation: leak-unclosed-cdp-listener
  cdp.on('Page.loadEventFired', (params) => {
    console.log('Page loaded:', params);
  });
})();
