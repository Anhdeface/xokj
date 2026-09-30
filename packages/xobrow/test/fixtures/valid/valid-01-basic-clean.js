// ==UserScript==
// @name         Basic Clean Userscript
// @namespace    https://xokj.dev/userscripts
// @version      1.0.0
// @description  A simple, secure userscript adhering to all safety guidelines
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  function init() {
    const heading = document.querySelector('h1');
    if (heading) {
      heading.textContent = 'Enhanced by XoBrow Clean Script';
      heading.classList.add('xobrow-active');
    }

    const container = document.createElement('div');
    container.className = 'xobrow-container';
    container.setAttribute('data-loaded', 'true');

    const label = document.createElement('span');
    label.textContent = 'Status: Active';
    container.appendChild(label);

    document.body.appendChild(container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
