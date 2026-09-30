// ==UserScript==
// @name         Production Automation Userscript
// @namespace    https://xokj.dev/automation
// @version      2.1.0
// @description  Full production automation userscript with CDP and safe DOM APIs
// @match        https://app.example.com/*
// @grant        GM_cdp
// @cdp          Page
// @cdp          DOM
// ==/UserScript==

(async function () {
  'use strict';

  const controller = new AbortController();

  function cleanup() {
    controller.abort();
  }

  window.addEventListener('beforeunload', cleanup, { once: true });

  try {
    // Navigate via CDP
    await cdp.send('Page.navigate', {
      url: 'https://app.example.com/dashboard'
    });

    // Wait and observe load event
    const unbind = cdp.on('Page.loadEventFired', (params) => {
      console.log('Load event at:', params.timestamp);
      unbind();
    });

    // Safe DOM inspection
    const target = document.querySelector('.metric-value');
    if (target) {
      const text = target.textContent;
      console.log('Extracted metric:', text);
    }
  } catch (error) {
    console.error('Automation failed:', error);
  }
})();
