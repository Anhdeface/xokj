// ==UserScript==
// @name         Event Listener Cleanup Userscript
// @namespace    https://xokj.dev/userscripts
// @version      1.0.0
// @description  Demonstrates proper registration and cleanup of event listeners
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  function onResize() {
    console.log('Window resized:', window.innerWidth, window.innerHeight);
  }

  function setup() {
    window.addEventListener('resize', onResize);
  }

  function teardown() {
    window.removeEventListener('resize', onResize);
  }

  setup();

  // Clean up when page unloads
  window.addEventListener('unload', () => {
    teardown();
  }, { once: true });
})();
