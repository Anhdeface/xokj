// ==UserScript==
// @name         Modern ECMAScript Constructs
// @namespace    https://xokj.dev/userscripts
// @version      1.0.0
// @description  Uses optional chaining, nullish coalescing, top-level return
// @match        https://example.com/*
// @grant        none
// ==/UserScript==

// Top-level early return check
if (typeof window === 'undefined') {
  return;
}

const config = {
  options: {
    timeout: 3000,
    retries: 2
  }
};

const delay = config?.options?.timeout ?? 1000;
const { retries = 1 } = config?.options || {};

console.log('Configuration initialized:', { delay, retries });
