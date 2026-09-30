// ==UserScript==
// @name         Modern Event Listener Lifecycles
// @namespace    https://xokj.dev/userscripts
// @version      1.0.0
// @description  Uses modern once option and AbortController signal
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const controller = new AbortController();

  // Self-cleaning via once: true
  document.addEventListener('click', (event) => {
    console.log('Single click handled:', event.clientX);
  }, { once: true });

  // Bound to AbortController signal
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      controller.abort();
    }
  }, { signal: controller.signal });
})();
