// ==UserScript==
// @name         Safe Prototype and Map Handling
// @namespace    https://xokj.dev/userscripts
// @version      1.0.0
// @description  Uses Object.create(null) and Map safely without prototype pollution
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Safe dictionary with null prototype
  const safeDict = Object.create(null);
  safeDict['key'] = 'safe value';

  // Native Map avoids prototype injection hazards
  const lookupMap = new Map();
  lookupMap.set('token', 'abc-123');

  // Immutable copy pattern
  const source = { count: 10 };
  const target = Object.assign({}, source, { count: 20 });

  console.log('Safe structures:', safeDict.key, lookupMap.get('token'), target.count);
})();
