// ==UserScript==
// @name         Violation: sec-no-new-function
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Violation: sec-no-new-function
  const dynamicAdder = new Function('a', 'b', 'return a + b');
  console.log(dynamicAdder(1, 2));
})();
