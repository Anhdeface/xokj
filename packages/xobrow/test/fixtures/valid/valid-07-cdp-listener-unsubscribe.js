// ==UserScript==
// @name         CDP Listener Unsubscribe Userscript
// @namespace    https://xokj.dev/userscripts
// @version      1.0.0
// @description  Subscribes to CDP events and properly unsubscribes
// @match        https://example.com/*
// @grant        GM_cdp
// @cdp          Page
// ==/UserScript==

(function () {
  'use strict';

  function onPageLoad(params) {
    console.log('Page loaded timestamp:', params.timestamp);
  }

  // Subscribe to Page.loadEventFired and store unbinder
  const unbind = cdp.on('Page.loadEventFired', onPageLoad);

  // Clean up when no longer needed
  window.addEventListener('beforeunload', () => {
    unbind();
    cdp.off('Page.loadEventFired', onPageLoad);
  }, { once: true });
})();
