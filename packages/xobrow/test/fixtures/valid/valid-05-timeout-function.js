// ==UserScript==
// @name         Safe Timers Userscript
// @namespace    https://xokj.dev/userscripts
// @version      1.0.0
// @description  Uses function callbacks for timers instead of strings
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  function onDelayedAction() {
    console.log('Delayed action executed');
  }

  const timeoutId = setTimeout(onDelayedAction, 500);

  // Cancellation pattern
  window.addEventListener('beforeunload', () => {
    clearTimeout(timeoutId);
  }, { once: true });
})();
