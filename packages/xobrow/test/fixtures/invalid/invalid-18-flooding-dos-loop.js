// ==UserScript==
// @name         Flooding DoS Loop Scenario
// @namespace    https://dos.example.com/flood
// @version      1.0.0
// @description  Unthrottled infinite async loop saturating CDP IPC
// @match        https://target.example.com/*
// @grant        GM_cdp
// @cdp          Page
// ==/UserScript==

(async function () {
  'use strict';

  // Flooding loop without delay, sleep, or exit condition
  while (true) {
    try {
      await cdp.send('Page.captureScreenshot', { format: 'png' });
    } catch (err) {
      console.error('Screenshot failed:', err);
    }
  }
})();
