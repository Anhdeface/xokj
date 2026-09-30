// ==UserScript==
// @name         Violation: cdp-header-permission
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(async function () {
  'use strict';

  try {
    // Violation: cdp-header-permission (script declares @grant none but calls cdp.send)
    await cdp.send('Page.navigate', { url: 'https://example.com' });
  } catch (err) {
    console.error(err);
  }
})();
