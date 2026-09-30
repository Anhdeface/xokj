// ==UserScript==
// @name         Throttled CDP Polling Userscript
// @namespace    https://xokj.dev/userscripts
// @version      1.0.0
// @description  Uses an async loop with backoff throttling and termination condition
// @match        https://example.com/*
// @grant        GM_cdp
// @cdp          Runtime
// ==/UserScript==

(async function () {
  'use strict';

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    try {
      const result = await cdp.send('Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true
      });
      console.log('Document title:', result);
      break;
    } catch (err) {
      console.warn('Evaluation attempt failed, retrying...', err);
    }

    attempts += 1;
    await delay(500); // 500ms backoff
  }
})();
