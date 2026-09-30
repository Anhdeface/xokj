// ==UserScript==
// @name         Leaky Scraping Bot Scenario
// @namespace    https://leaky.example.com/bot
// @version      1.0.0
// @description  A leaky scraper bot that neglects resource disposal
// @match        https://news.example.com/*
// @grant        GM_cdp
// @cdp          Page
// ==/UserScript==

(function () {
  'use strict';

  // 1. Lingering interval without clearInterval
  setInterval(() => {
    console.log('Scraper polling news feed...');
  }, 2000);

  // 2. Uncleaned global event listener
  window.addEventListener('message', (event) => {
    console.log('Received message from frame:', event.data);
  });

  // 3. Unclosed CDP event listener
  cdp.on('Page.loadEventFired', (params) => {
    console.log('Page loaded for scraper:', params);
  });
})();
