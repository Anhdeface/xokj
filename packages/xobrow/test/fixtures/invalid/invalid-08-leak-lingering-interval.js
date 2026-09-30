// ==UserScript==
// @name         Violation: leak-lingering-interval
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Violation: leak-lingering-interval
  setInterval(() => {
    console.log('Uncleaned interval ticking indefinitely');
  }, 1000);
})();
