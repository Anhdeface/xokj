// ==UserScript==
// @name         Violation: sec-no-unsafe-dom-sink
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const container = document.getElementById('content');
  const userContent = '<img src=x onerror=alert(1)>';
  // Violation: sec-no-unsafe-dom-sink
  container.innerHTML = userContent;
})();
