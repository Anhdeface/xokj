// ==UserScript==
// @name         Violation: sec-no-eval
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const payload = 'console.log("dynamically evaluated")';
  // Violation: sec-no-eval
  eval(payload);
})();
