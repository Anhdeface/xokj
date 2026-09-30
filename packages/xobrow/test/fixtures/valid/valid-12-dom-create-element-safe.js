// ==UserScript==
// @name         Safe DOM Element Creation
// @namespace    https://xokj.dev/userscripts
// @version      1.0.0
// @description  Creates buttons and styling safely using standard DOM methods
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'xobrow-toggle-btn';
  button.textContent = 'Toggle View';
  button.style.position = 'fixed';
  button.style.bottom = '20px';
  button.style.right = '20px';

  button.addEventListener('click', () => {
    console.log('Button clicked');
  }, { once: true });

  document.body.appendChild(button);
})();
