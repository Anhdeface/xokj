// ==UserScript==
// @name         Top Level Return Userscript
// @version      1.0.0
// @match        *://*/*
// @grant        none
// ==/UserScript==

// Userscript top-level early termination
if (window.top !== window.self) {
  return;
}

console.log('Running in top frame only');
