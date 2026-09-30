/**
 * XoBrow - Chrome DevTools Protocol (CDP) Domain & Method Catalog
 * Authoritative dictionary of standard CDP domains, methods, and events
 * with Levenshtein-based typo suggestion utilities.
 */

export interface CdpDomainSchema {
  domain: string;
  methods: Set<string>;
  events: Set<string>;
  experimental?: boolean;
}

/**
 * Catalog of official Chrome DevTools Protocol domains with canonical methods and events.
 */
export const CDP_DOMAINS: Record<string, CdpDomainSchema> = {
  Page: {
    domain: 'Page',
    methods: new Set([
      'enable', 'disable', 'reload', 'navigate', 'stopLoading',
      'getNavigationHistory', 'navigateToHistoryEntry', 'resetNavigationHistory',
      'captureScreenshot', 'printToPDF', 'startScreencast', 'stopScreencast',
      'getLayoutMetrics', 'setDocumentContent', 'bringToFront', 'close', 'crash',
      'setLifecycleEventsEnabled', 'addScriptToEvaluateOnNewDocument',
      'removeScriptToEvaluateOnNewDocument', 'createIsolatedWorld',
      'handleJavaScriptDialog', 'setGeolocationOverride', 'clearGeolocationOverride',
      'setDeviceMetricsOverride', 'clearDeviceMetricsOverride', 'getCookies',
      'setWebLifecycleState', 'getAppManifest', 'requestAppBanner'
    ]),
    events: new Set([
      'domContentEventFired', 'loadEventFired', 'lifecycleEvent',
      'frameAttached', 'frameNavigated', 'frameDetached', 'frameStartedLoading',
      'frameStoppedLoading', 'javascriptDialogOpening', 'javascriptDialogClosed',
      'screencastFrame', 'screencastVisibilityChanged', 'windowOpen'
    ])
  },
  DOM: {
    domain: 'DOM',
    methods: new Set([
      'enable', 'disable', 'getDocument', 'getFlattenedDocument',
      'collectClassNamesFromSubtree', 'requestChildNodes', 'querySelector',
      'querySelectorAll', 'setNodeName', 'setNodeValue', 'removeNode',
      'setAttributeValue', 'setAttributesAsText', 'removeAttribute',
      'getOuterHTML', 'setOuterHTML', 'performSearch', 'getSearchResults',
      'discardSearchResults', 'requestNode', 'pushNodesByBackendIdsToFrontend',
      'setFileInputFiles', 'getBoxModel', 'getContentQuads', 'highlightRect',
      'highlightNode', 'hideHighlight', 'resolveNode', 'focus', 'describeNode',
      'scrollIntoViewIfNeeded'
    ]),
    events: new Set([
      'documentUpdated', 'inspectNodeRequested', 'setChildNodes',
      'attributeModified', 'attributeRemoved', 'characterDataModified',
      'childNodeCountUpdated', 'childNodeInserted', 'childNodeRemoved'
    ])
  },
  Network: {
    domain: 'Network',
    methods: new Set([
      'enable', 'disable', 'setUserAgentOverride', 'setExtraHTTPHeaders',
      'getResponseBody', 'getRequestPostData', 'setBlockedURLs',
      'emulateNetworkConditions', 'clearBrowserCache', 'clearBrowserCookies',
      'getCookies', 'getAllCookies', 'deleteCookies', 'setCookie', 'setCookies',
      'searchInResponseBody', 'setCacheDisabled', 'loadNetworkResource',
      'canClearBrowserCache', 'canClearBrowserCookies', 'canEmulateNetworkConditions',
      'replayXHR', 'setAttachDebugStack'
    ]),
    events: new Set([
      'requestWillBeSent', 'responseReceived', 'loadingFinished', 'loadingFailed',
      'dataReceived', 'requestServedFromCache', 'webSocketCreated',
      'webSocketWillSendHandshakeRequest', 'webSocketHandshakeResponseReceived',
      'webSocketClosed', 'webSocketFrameReceived', 'webSocketFrameError',
      'webSocketFrameSent', 'requestWillBeSentExtraInfo', 'responseReceivedExtraInfo'
    ])
  },
  Runtime: {
    domain: 'Runtime',
    methods: new Set([
      'enable', 'disable', 'evaluate', 'awaitPromise', 'callFunctionOn',
      'getProperties', 'releaseObject', 'releaseObjectGroup',
      'runIfWaitingForDebugger', 'terminateExecution', 'addBinding',
      'removeBinding', 'getExceptionDetails', 'compileScript', 'runScript',
      'queryObjects', 'globalLexicalScopeNames', 'discardConsoleEntries'
    ]),
    events: new Set([
      'executionContextCreated', 'executionContextDestroyed',
      'executionContextsCleared', 'exceptionThrown', 'bindingCalled',
      'consoleAPICalled', 'inspectRequested'
    ])
  },
  Target: {
    domain: 'Target',
    methods: new Set([
      'setDiscoverTargets', 'setAutoAttach', 'attachToTarget',
      'detachFromTarget', 'sendMessageToTarget', 'getTargetInfo',
      'getTargets', 'createTarget', 'closeTarget', 'activateTarget',
      'exposeDevToolsProtocol', 'createBrowserContext', 'disposeBrowserContext'
    ]),
    events: new Set([
      'targetCreated', 'targetDestroyed', 'targetCrashed',
      'targetInfoChanged', 'attachedToTarget', 'detachedFromTarget',
      'receivedMessageFromTarget'
    ])
  },
  Fetch: {
    domain: 'Fetch',
    methods: new Set([
      'enable', 'disable', 'failRequest', 'fulfillRequest', 'continueRequest',
      'continueWithAuth', 'continueResponse', 'getResponseBody',
      'takeResponseBodyAsStream'
    ]),
    events: new Set(['requestPaused', 'authRequired'])
  },
  Storage: {
    domain: 'Storage',
    methods: new Set([
      'clearDataForOrigin', 'getCookies', 'setCookies', 'clearCookies',
      'getStorageKeyForFrame', 'getUsageAndQuota', 'overrideQuotaForOrigin',
      'trackCacheStorageForOrigin', 'trackIndexedDBForOrigin',
      'untrackCacheStorageForOrigin', 'untrackIndexedDBForOrigin',
      'getInterestGroupDetails', 'setInterestGroupTracking'
    ]),
    events: new Set(['cacheStorageContentUpdated', 'cacheStorageListUpdated', 'indexedDBContentUpdated'])
  },
  Browser: {
    domain: 'Browser',
    methods: new Set([
      'getVersion', 'getBrowserCommandLine', 'setPermission', 'grantPermissions',
      'resetPermissions', 'setDownloadBehavior', 'cancelDownload', 'close',
      'crash', 'crashGpuProcess', 'getWindowForTarget', 'getWindowBounds',
      'setWindowBounds', 'setDockTile'
    ]),
    events: new Set(['downloadWillBegin', 'downloadProgress'])
  },
  Console: {
    domain: 'Console',
    methods: new Set(['enable', 'disable', 'clearMessages']),
    events: new Set(['messageAdded'])
  },
  Emulation: {
    domain: 'Emulation',
    methods: new Set([
      'setDeviceMetricsOverride', 'clearDeviceMetricsOverride',
      'setGeolocationOverride', 'clearGeolocationOverride',
      'setUserAgentOverride', 'setEmulatedMedia', 'setCPUThrottlingRate',
      'setVirtualTimePolicy', 'setTimezoneOverride', 'setScriptExecutionDisabled',
      'setTouchEmulationEnabled', 'setAutoDarkModeOverride', 'setFocusEmulationEnabled'
    ]),
    events: new Set(['virtualTimeBudgetExpired'])
  },
  Input: {
    domain: 'Input',
    methods: new Set([
      'dispatchKeyEvent', 'insertText', 'imeSetComposition',
      'dispatchMouseEvent', 'dispatchTouchEvent', 'emulateTouchFromMouseEvent',
      'synthesizePinchGesture', 'synthesizeScrollGesture', 'synthesizeTapGesture',
      'setIgnoreInputEvents'
    ]),
    events: new Set([])
  },
  Security: {
    domain: 'Security',
    methods: new Set(['enable', 'disable', 'setIgnoreCertificateErrors', 'handleCertificateError']),
    events: new Set(['securityStateChanged', 'visibleSecurityStateChanged'])
  },
  Log: {
    domain: 'Log',
    methods: new Set(['enable', 'disable', 'clear', 'startViolationsReport', 'stopViolationsReport']),
    events: new Set(['entryAdded'])
  },
  Overlay: {
    domain: 'Overlay',
    methods: new Set([
      'enable', 'disable', 'setShowGridOverlays', 'setShowFlexOverlays',
      'setHighlightConfig', 'highlightNode', 'highlightRect', 'hideHighlight'
    ]),
    events: new Set(['nodeHighlightRequested', 'inspectNodeRequested'])
  },
  Performance: {
    domain: 'Performance',
    methods: new Set(['enable', 'disable', 'getMetrics', 'setTimeDomain']),
    events: new Set(['metrics'])
  },
  CSS: {
    domain: 'CSS',
    methods: new Set([
      'enable', 'disable', 'getMatchedStylesForNode', 'getInlineStylesForNode',
      'getComputedStyleForNode', 'setStyleSheetText', 'setRuleSelector',
      'createStyleSheet', 'addRule', 'setStyleTexts'
    ]),
    events: new Set(['fontsUpdated', 'mediaQueryResultChanged', 'styleSheetAdded', 'styleSheetChanged', 'styleSheetRemoved'])
  },
  Debugger: {
    domain: 'Debugger',
    methods: new Set([
      'enable', 'disable', 'pause', 'resume', 'stepOver', 'stepInto', 'stepOut',
      'setBreakpoint', 'setBreakpointByUrl', 'removeBreakpoint', 'evaluateOnCallFrame',
      'setScriptSource', 'restartFrame', 'setVariableValue'
    ]),
    events: new Set(['breakpointResolved', 'paused', 'resumed', 'scriptFailedToParse', 'scriptParsed'])
  },
  Profiler: {
    domain: 'Profiler',
    methods: new Set(['enable', 'disable', 'start', 'stop', 'getBestEffortCoverage', 'startPreciseCoverage', 'stopPreciseCoverage', 'takePreciseCoverage']),
    events: new Set(['consoleProfileFinished', 'consoleProfileStarted'])
  },
  Audits: {
    domain: 'Audits',
    methods: new Set(['enable', 'disable', 'getEncodedResponse', 'checkContrast']),
    events: new Set(['issueAdded'])
  },
  WebAuthn: {
    domain: 'WebAuthn',
    methods: new Set(['enable', 'disable', 'addVirtualAuthenticator', 'removeVirtualAuthenticator', 'setAutomaticPresenceSimulation']),
    events: new Set([])
  },
  ServiceWorker: {
    domain: 'ServiceWorker',
    methods: new Set(['enable', 'disable', 'updateRegistration', 'startWorker', 'skipWaiting', 'stopWorker', 'inspectWorker', 'setForceUpdateOnPageLoad']),
    events: new Set(['workerErrorReported', 'workerRegistrationUpdated', 'workerVersionUpdated'])
  },
  IndexedDB: {
    domain: 'IndexedDB',
    methods: new Set(['enable', 'disable', 'requestDatabaseNames', 'requestDatabase', 'requestData', 'deleteDatabase', 'deleteObjectStore']),
    events: new Set([])
  },
  DOMStorage: {
    domain: 'DOMStorage',
    methods: new Set(['enable', 'disable', 'clear', 'getDOMStorageItems', 'setDOMStorageItem', 'removeDOMStorageItem']),
    events: new Set(['domStorageItemAdded', 'domStorageItemRemoved', 'domStorageItemUpdated', 'domStorageItemsCleared'])
  },
  ApplicationCache: {
    domain: 'ApplicationCache',
    methods: new Set(['enable', 'getFramesWithManifests', 'getManifestForFrame']),
    events: new Set(['applicationCacheStatusUpdated', 'networkStateUpdated'])
  },
  Memory: {
    domain: 'Memory',
    methods: new Set(['getDOMCounters', 'prepareForLeakDetection', 'forciblyPurgeJavaScriptMemory', 'setPressureNotificationsSuppressed', 'simulatePressureNotification']),
    events: new Set([])
  },
  Accessibility: {
    domain: 'Accessibility',
    methods: new Set(['enable', 'disable', 'getPartialAXTree', 'getFullAXTree', 'getRootAXNode', 'getAXNodeAndAncestors']),
    events: new Set([])
  },
  Database: {
    domain: 'Database',
    methods: new Set(['enable', 'disable', 'getDatabaseTableNames', 'executeSQL']),
    events: new Set(['addDatabase'])
  },
  DeviceOrientation: {
    domain: 'DeviceOrientation',
    methods: new Set(['setDeviceOrientationOverride', 'clearDeviceOrientationOverride']),
    events: new Set([])
  },
  HeapProfiler: {
    domain: 'HeapProfiler',
    methods: new Set(['enable', 'disable', 'startTrackingHeapObjects', 'stopTrackingHeapObjects', 'takeHeapSnapshot', 'collectGarbage']),
    events: new Set(['addHeapSnapshotChunk', 'heapStatsUpdate', 'lastSeenObjectId', 'reportHeapSnapshotProgress', 'resetProfiles'])
  },
  IO: {
    domain: 'IO',
    methods: new Set(['read', 'close', 'resolveBlob']),
    events: new Set([])
  },
  SystemInfo: {
    domain: 'SystemInfo',
    methods: new Set(['getInfo', 'getProcessInfo']),
    events: new Set([])
  },
  Cast: {
    domain: 'Cast',
    methods: new Set(['enable', 'disable', 'setSinksFilter', 'startTabMirroring', 'stopCasting']),
    events: new Set(['sinksUpdated', 'issueUpdated'])
  },
  WebAudio: {
    domain: 'WebAudio',
    methods: new Set(['enable', 'disable', 'getRealtimeData']),
    events: new Set(['contextCreated', 'contextWillBeDestroyed', 'contextChanged'])
  },
  Media: {
    domain: 'Media',
    methods: new Set(['enable', 'disable']),
    events: new Set(['playerPropertiesChanged', 'playerEventsAdded', 'playerMessagesLogged', 'playerErrorsRaised', 'playersCreated'])
  },
  HeadlessExperimental: {
    domain: 'HeadlessExperimental',
    methods: new Set(['enable', 'disable', 'beginFrame']),
    events: new Set([])
  },
  Tracing: {
    domain: 'Tracing',
    methods: new Set(['start', 'end', 'getCategories', 'recordClockSyncMarker', 'requestMemoryDump']),
    events: new Set(['dataCollected', 'tracingComplete', 'bufferUsage'])
  },
  Animation: {
    domain: 'Animation',
    methods: new Set(['enable', 'disable', 'getPlaybackRate', 'setPlaybackRate', 'getCurrentTime', 'setTiming', 'seekAnimations', 'releaseAnimations']),
    events: new Set(['animationCreated', 'animationStarted', 'animationCanceled'])
  }
};

/**
 * Checks whether a given string is a known CDP domain name.
 */
export function isKnownCdpDomain(domain: string): boolean {
  return Object.prototype.hasOwnProperty.call(CDP_DOMAINS, domain);
}

/**
 * Checks whether a method exists on the specified domain.
 */
export function isKnownCdpMethod(domain: string, method: string): boolean {
  const schema = CDP_DOMAINS[domain];
  return Boolean(schema?.methods.has(method));
}

/**
 * Checks whether an event exists on the specified domain.
 */
export function isKnownCdpEvent(domain: string, event: string): boolean {
  const schema = CDP_DOMAINS[domain];
  return Boolean(schema?.events.has(event));
}

/**
 * Computes the Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix: number[][] = [];
  for (let i = 0; i <= an; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= bn; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[an][bn];
}

/**
 * Finds the closest matching domain name for a misspelled domain.
 */
export function findClosestCdpDomain(domain: string): string | undefined {
  const domains = Object.keys(CDP_DOMAINS);
  let closest: string | undefined;
  let minDistance = 3; // Max tolerance threshold

  for (const d of domains) {
    const dist = levenshteinDistance(domain, d);
    if (dist < minDistance) {
      minDistance = dist;
      closest = d;
    }
  }

  return closest;
}

/**
 * Finds the closest matching method name for a domain.
 */
export function findClosestCdpMethod(domain: string, method: string): string | undefined {
  const schema = CDP_DOMAINS[domain];
  if (!schema) return undefined;

  let closest: string | undefined;
  let minDistance = 3;

  for (const m of schema.methods) {
    const dist = levenshteinDistance(method, m);
    if (dist < minDistance) {
      minDistance = dist;
      closest = m;
    }
  }

  return closest;
}

/**
 * Finds the closest matching event name for a domain.
 */
export function findClosestCdpEvent(domain: string, event: string): string | undefined {
  const schema = CDP_DOMAINS[domain];
  if (!schema) return undefined;

  let closest: string | undefined;
  let minDistance = 3;

  for (const e of schema.events) {
    const dist = levenshteinDistance(event, e);
    if (dist < minDistance) {
      minDistance = dist;
      closest = e;
    }
  }

  return closest;
}

export interface CdpValidationResult {
  valid: boolean;
  reason?: 'INVALID_FORMAT' | 'UNKNOWN_DOMAIN' | 'UNKNOWN_METHOD';
  domain?: string;
  method?: string;
  suggestion?: string;
}

/**
 * Validates a CDP command string (e.g. 'Page.navigate' or 'Page.loadEventFired') against the official catalog.
 */
export function validateCdpCommand(
  command: string,
  kind: 'method' | 'event' | 'any' = 'method'
): CdpValidationResult {
  const parts = command.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return {
      valid: false,
      reason: 'INVALID_FORMAT',
      suggestion: 'CDP command must follow "Domain.method" or "Domain.event" format, e.g. "Page.navigate" or "Page.loadEventFired".'
    };
  }

  const [domain, name] = parts;

  if (!isKnownCdpDomain(domain)) {
    const closestDomain = findClosestCdpDomain(domain);
    const domainSuggestion = closestDomain
      ? `Did you mean domain "${closestDomain}"?`
      : 'Verify domain against official CDP specification ("Page", "DOM", "Network", "Runtime", etc.).';

    return {
      valid: false,
      reason: 'UNKNOWN_DOMAIN',
      domain,
      method: name,
      suggestion: domainSuggestion
    };
  }

  if (kind === 'event') {
    if (!isKnownCdpEvent(domain, name)) {
      const closestEvent = findClosestCdpEvent(domain, name);
      const eventSuggestion = closestEvent
        ? `Did you mean "${domain}.${closestEvent}"?`
        : `Check official events for domain "${domain}" (e.g. ${Array.from(CDP_DOMAINS[domain].events).slice(0, 4).join(', ')}).`;

      return {
        valid: false,
        reason: 'UNKNOWN_METHOD',
        domain,
        method: name,
        suggestion: eventSuggestion
      };
    }
  } else if (kind === 'any') {
    if (!isKnownCdpMethod(domain, name) && !isKnownCdpEvent(domain, name)) {
      const closestMethod = findClosestCdpMethod(domain, name);
      const closestEvent = findClosestCdpEvent(domain, name);
      const closest = closestMethod || closestEvent;
      const suggestion = closest
        ? `Did you mean "${domain}.${closest}"?`
        : `Check official methods for domain "${domain}".`;
      return {
        valid: false,
        reason: 'UNKNOWN_METHOD',
        domain,
        method: name,
        suggestion
      };
    }
  } else {
    // kind === 'method'
    if (!isKnownCdpMethod(domain, name)) {
      const closestMethod = findClosestCdpMethod(domain, name);
      const methodSuggestion = closestMethod
        ? `Did you mean "${domain}.${closestMethod}"?`
        : `Check official methods for domain "${domain}" (e.g. ${Array.from(CDP_DOMAINS[domain].methods).slice(0, 4).join(', ')}).`;

      return {
        valid: false,
        reason: 'UNKNOWN_METHOD',
        domain,
        method: name,
        suggestion: methodSuggestion
      };
    }
  }

  return {
    valid: true,
    domain,
    method: name
  };
}
