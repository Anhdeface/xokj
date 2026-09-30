// ==UserScript==
// @name         Cleared Interval Userscript
// @namespace    https://xokj.dev/userscripts
// @version      1.0.0
// @description  Uses setInterval and properly disposes of it with clearInterval
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  let count = 0;
  const timerId = setInterval(() => {
    count += 1;
    if (count >= 5) {
      clearInterval(timerId);
    }
  }, 1000);
})();
