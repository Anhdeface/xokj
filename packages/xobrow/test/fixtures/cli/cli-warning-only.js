// ==UserScript==
// @name         Warning Only Script
// @version      1.0.0
// @grant        GM_cdp
// @cdp          Page
// ==/UserScript==

(function () {
  'use strict';

  // Produces cdp-handled-async-reject warning (floating promise)
  cdp.send('Page.navigate', { url: 'https://example.com' });
})();
