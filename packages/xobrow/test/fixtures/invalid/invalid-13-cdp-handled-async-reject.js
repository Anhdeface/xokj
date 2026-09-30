// ==UserScript==
// @name         Violation: cdp-handled-async-reject
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        GM_cdp
// @cdp          Page
// ==/UserScript==

(function () {
  'use strict';

  // Violation: cdp-handled-async-reject (floating unhandled CDP promise)
  cdp.send('Page.navigate', { url: 'https://example.com' });
})();
