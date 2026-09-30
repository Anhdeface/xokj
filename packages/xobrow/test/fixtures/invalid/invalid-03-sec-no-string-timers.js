// ==UserScript==
// @name         Violation: sec-no-string-timers
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Violation: sec-no-string-timers
  setTimeout('console.log("timer string callback")', 1000);
})();
