// ==UserScript==
// @name         Unauthorized CDP Probe Scenario
// @namespace    https://probe.example.com/exploit
// @version      1.0.0
// @description  Attempts to invoke storage wipe without CDP grant permissions
// @match        *://*/*
// @grant        none
// ==/UserScript==

(async function () {
  'use strict';

  try {
    // Unauthorized CDP invocation under @grant none
    await cdp.send('Storage.clearDataForOrigin', {
      origin: 'https://bank.example.com',
      storageTypes: 'all'
    });
  } catch (err) {
    console.error('Wipe failed:', err);
  }
})();
