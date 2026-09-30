// ==UserScript==
// @name         Violation: sec-no-prototype-pollution
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const userConfig = {};
  // Violation: sec-no-prototype-pollution
  userConfig.__proto__.isAdmin = true;
})();
