// ==UserScript==
// @name         Violation: leak-uncleaned-event-listener
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Violation: leak-uncleaned-event-listener
  window.addEventListener('resize', (event) => {
    console.log('Window resized without cleanup');
  });
})();
