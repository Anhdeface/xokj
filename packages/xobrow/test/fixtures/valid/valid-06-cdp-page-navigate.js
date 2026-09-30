// ==UserScript==
// @name         CDP Page Navigate Userscript
// @namespace    https://xokj.dev/userscripts
// @version      1.0.0
// @description  Uses Chrome DevTools Protocol to safely navigate pages
// @match        https://example.com/*
// @grant        GM_cdp
// @cdp          Page
// ==/UserScript==

(async function () {
  'use strict';

  try {
    const response = await cdp.send('Page.navigate', {
      url: 'https://example.com/target'
    });
    console.log('Navigation frameId:', response?.frameId);
  } catch (error) {
    console.error('CDP navigation failed:', error);
  }
})();
