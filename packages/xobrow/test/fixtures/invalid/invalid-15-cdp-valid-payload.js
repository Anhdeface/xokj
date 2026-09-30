// ==UserScript==
// @name         Violation: cdp-valid-payload
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        GM_cdp
// @cdp          Page
// ==/UserScript==

(async function () {
  'use strict';

  try {
    // Violation: cdp-valid-payload (passing string instead of parameter dictionary object)
    await cdp.send('Page.navigate', 'https://example.com');
  } catch (err) {
    console.error(err);
  }
})();
