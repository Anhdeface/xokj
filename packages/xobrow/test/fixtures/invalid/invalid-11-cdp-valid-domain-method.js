// ==UserScript==
// @name         Violation: cdp-valid-domain-method
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        GM_cdp
// @cdp          Page
// ==/UserScript==

(async function () {
  'use strict';

  try {
    // Violation: cdp-valid-domain-method
    await cdp.send('InvalidDomain.fakeMethod', {});
  } catch (err) {
    console.error(err);
  }
})();
