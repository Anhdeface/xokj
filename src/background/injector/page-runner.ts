/**
 * XOKJ - MAIN World Userscript Sandbox Runner
 *
 * NOTE: This function is serialized via Function.prototype.toString()
 * and injected into the target webpage's MAIN world via chrome.scripting.executeScript.
 * It MUST remain 100% self-contained with ZERO external/module imports!
 */

export function pageSandboxRunner(
  code: string,
  scriptName: string,
  scriptId: string,
  metadata: Record<string, any>,
  channelId?: string,
  initialValues?: Record<string, unknown>
): { success: boolean; error?: string } {
  try {
    const grants: string[] = Array.isArray(metadata?.grants) ? metadata.grants : [];
    const cdpDecls = metadata?.cdpDeclarations || metadata?.cdp || [];
    const hasCdpDirectives = Array.isArray(cdpDecls) && cdpDecls.length > 0;
    const hasCdpDomains = Array.isArray(metadata?.cdpDomains) && metadata.cdpDomains.length > 0;
    const isNoneGrant = grants.includes('none');

    const allowAll = !isNoneGrant && grants.includes('*');

    // CDP capabilities allowed only if not @grant none and explicitly granted or declared
    const allowCdp =
      !isNoneGrant &&
      (allowAll ||
        grants.includes('GM_cdp') ||
        grants.includes('cdp') ||
        hasCdpDirectives ||
        hasCdpDomains);

    // GM_info allowed only if not @grant none and explicitly granted or declared.
    const allowGmInfo =
      !isNoneGrant &&
      (allowAll ||
        grants.includes('GM_info') ||
        (grants.length > 0 && allowCdp) ||
        (allowCdp && hasCdpDirectives));

    const allowGmSetValue = !isNoneGrant && (allowAll || grants.includes('GM_setValue'));
    const allowGmGetValue = !isNoneGrant && (allowAll || grants.includes('GM_getValue'));
    const allowGmDeleteValue = !isNoneGrant && (allowAll || grants.includes('GM_deleteValue'));
    const allowGmListValues = !isNoneGrant && (allowAll || grants.includes('GM_listValues'));
    const allowGmAddStyle = !isNoneGrant && (allowAll || grants.includes('GM_addStyle'));
    const allowGmLog = !isNoneGrant && (allowAll || grants.includes('GM_log'));

    // In-memory isolated storage per script execution (never touches window.localStorage)
    const scriptStore = new Map<string, string>();
    if (initialValues && typeof initialValues === 'object') {
      for (const key of Object.keys(initialValues)) {
        try {
          const val = initialValues[key];
          if (val !== undefined) {
            scriptStore.set(key, JSON.stringify(val));
          }
        } catch {
          // Ignore non-serializable keys safely
        }
      }
    }

    const effectiveChannelId = channelId || (metadata && metadata.channelId);

    // Write-through helper to ContentScriptBridge
    const postStorageMessage = (type: string, key: string, value?: unknown) => {
      try {
        if (typeof window !== 'undefined' && typeof window.postMessage === 'function') {
          const payload: Record<string, any> = {
            source: 'xokj-userscript',
            type,
            scriptId,
            key
          };
          if (effectiveChannelId) {
            payload.channelId = effectiveChannelId;
          }
          if (type === 'GM_STORAGE_SET') {
            payload.value = value;
          }
          window.postMessage(payload, '*');
        }
      } catch {
        // Safe ignore in restricted environments
      }
    };

    const GM_setValue = allowGmSetValue
      ? (key: string, value: unknown): void => {
          if (value === undefined) {
            scriptStore.delete(key);
            postStorageMessage('GM_STORAGE_DELETE', key);
          } else {
            let serialized: string;
            try {
              serialized = JSON.stringify(value);
            } catch {
              serialized = JSON.stringify(String(value));
            }
            scriptStore.set(key, serialized);
            postStorageMessage('GM_STORAGE_SET', key, value);
          }
        }
      : undefined;

    const GM_getValue = allowGmGetValue
      ? (key: string, defaultValue?: unknown): unknown => {
          const raw = scriptStore.get(key);
          if (raw === null || raw === undefined) return defaultValue;
          try {
            return JSON.parse(raw);
          } catch {
            return defaultValue;
          }
        }
      : undefined;

    const GM_deleteValue = allowGmDeleteValue
      ? (key: string): void => {
          scriptStore.delete(key);
          postStorageMessage('GM_STORAGE_DELETE', key);
        }
      : undefined;

    const GM_listValues = allowGmListValues
      ? (): string[] => {
          return Array.from(scriptStore.keys());
        }
      : undefined;

    const GM_addStyle = allowGmAddStyle
      ? (css: string): HTMLStyleElement | null => {
          if (typeof document === 'undefined') return null;
          const style = document.createElement('style');
          style.setAttribute('type', 'text/css');
          style.setAttribute('data-xokj-script', scriptId || 'script');
          style.textContent = css;
          const target = document.head || document.documentElement || document.body;
          if (target) {
            target.appendChild(style);
          }
          return style;
        }
      : undefined;

    const GM_log = allowGmLog
      ? (...args: any[]): void => {
          console.log(`[${scriptName || 'XOKJ'}]`, ...args);
        }
      : undefined;

    let cdp: any = undefined;
    if (allowCdp) {
      // Event subscription registry: eventName -> Set of listener functions
      const eventListeners = new Map<string, Set<Function>>();
      const pendingRequests = new Map<string, {
        resolve: (val: any) => void;
        reject: (err: any) => void;
        timer: any;
        method: string;
      }>();
      const cdpStatus = {
        status: 'ATTACHED' as 'ATTACHED' | 'CONFLICT' | 'DETACHED' | 'IDLE',
        conflict: false,
        reason: undefined as string | undefined
      };

      // Safe event dispatcher with exact match, domain wildcard, and global wildcard support
      const dispatchCdpEvent = (method: string, params: unknown) => {
        if (!method || typeof method !== 'string') return;

        const matchedHandlers: { handler: Function; isWildcard: boolean }[] = [];

        // 1. Exact event name match (e.g. 'Network.requestWillBeSent')
        const exact = eventListeners.get(method);
        if (exact && exact.size > 0) {
          for (const h of exact) {
            matchedHandlers.push({ handler: h, isWildcard: false });
          }
        }

        // 2. Domain wildcard match (e.g. 'Network.*')
        const dotIndex = method.indexOf('.');
        if (dotIndex !== -1) {
          const domainWildcard = method.slice(0, dotIndex) + '.*';
          const domainHandlers = eventListeners.get(domainWildcard);
          if (domainHandlers && domainHandlers.size > 0) {
            for (const h of domainHandlers) {
              matchedHandlers.push({ handler: h, isWildcard: true });
            }
          }
        }

        // 3. Global wildcard match ('*')
        const allHandlers = eventListeners.get('*');
        if (allHandlers && allHandlers.size > 0) {
          for (const h of allHandlers) {
            matchedHandlers.push({ handler: h, isWildcard: true });
          }
        }

        if (matchedHandlers.length === 0) return;

        // 4. Isolated invocation: snapshot array ensures Set mutations do not disrupt iteration
        for (const { handler, isWildcard } of matchedHandlers) {
          try {
            if (isWildcard) {
              handler(params, method);
            } else {
              handler(params);
            }
          } catch (listenerErr) {
            console.error(`[XOKJ Userscript] Error in event listener for '${method}':`, listenerErr);
          }
        }
      };

      // Unified window message listener for RPC responses, live events, and lifecycle updates
      const handleWindowMessage = (event: MessageEvent) => {
        if (event.source !== window || !event.data || typeof event.data !== 'object') return;
        const data = event.data;

        // Security Layer: Verify message source and channel authorization
        if (data.source && data.source !== 'xokj-bridge') return;
        if (effectiveChannelId && data.channelId && data.channelId !== effectiveChannelId) return;

        // 1. Process CDP_RPC_RESPONSE (Settles inflight cdp.send)
        if (data.type === 'CDP_RPC_RESPONSE') {
          const entry = pendingRequests.get(data.id);
          if (entry) {
            clearTimeout(entry.timer);
            pendingRequests.delete(data.id);
            if (data.success) {
              cdpStatus.status = 'ATTACHED';
              cdpStatus.conflict = false;
              entry.resolve(data.result);
            } else {
              const err = data.error;
              if (err?.code === 1001 || /conflict|canceled_by_user|DevTools/i.test(err?.message || '')) {
                cdpStatus.status = 'CONFLICT';
                cdpStatus.conflict = true;
                cdpStatus.reason = (err?.data as any)?.reason || 'canceled_by_user';
              }
              const errorObj = new Error(err?.message || 'CDP command failed');
              (errorObj as any).code = err?.code ?? -32603;
              (errorObj as any).data = err?.data;
              entry.reject(errorObj);
            }
          }
          return;
        }

        // 2. Process CDP_RPC_EVENT (Dispatches live push event)
        if (data.type === 'CDP_RPC_EVENT') {
          const method = data.method;
          const params = data.params !== undefined && data.params !== null ? data.params : {};
          if (typeof method === 'string' && method.length > 0) {
            dispatchCdpEvent(method, params);
          }
          return;
        }

        // 3. Process CDP_LIFECYCLE_EVENT (Updates status and drains pending requests)
        if (data.type === 'CDP_LIFECYCLE_EVENT') {
          if (data.status === 'CONFLICT') {
            cdpStatus.status = 'CONFLICT';
            cdpStatus.conflict = true;
            cdpStatus.reason = data.reason || 'canceled_by_user';
            const conflictErr = new Error('DevTools conflict: native developer tools opened on tab');
            (conflictErr as any).code = 1001;
            for (const [id, req] of pendingRequests.entries()) {
              clearTimeout(req.timer);
              req.reject(conflictErr);
            }
            pendingRequests.clear();
          } else if (data.status === 'DETACHED') {
            cdpStatus.status = 'DETACHED';
            cdpStatus.conflict = false;
            cdpStatus.reason = data.reason;
            const detachErr = new Error(`CDP session detached: ${data.reason || 'detached'}`);
            (detachErr as any).code = 1002;
            for (const [id, req] of pendingRequests.entries()) {
              clearTimeout(req.timer);
              req.reject(detachErr);
            }
            pendingRequests.clear();
          } else if (data.status === 'ATTACHED') {
            cdpStatus.status = 'ATTACHED';
            cdpStatus.conflict = false;
            cdpStatus.reason = undefined;
          }
          return;
        }
      };

      // Teardown / cleanup hook on page navigation
      const handlePageHide = () => {
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('message', handleWindowMessage);
          window.removeEventListener('pagehide', handlePageHide);
        }
        for (const [id, req] of pendingRequests.entries()) {
          clearTimeout(req.timer);
          req.reject(new Error('Userscript execution terminated: page unloaded'));
        }
        pendingRequests.clear();
        eventListeners.clear();
      };

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('message', handleWindowMessage);
        window.addEventListener('pagehide', handlePageHide, { once: true });
      }

      cdp = {
        send: (method: string, params?: Record<string, unknown>): Promise<any> => {
          if (!method || typeof method !== 'string' || method.trim() === '') {
            return Promise.reject(new Error('Invalid CDP command: method must be a non-empty string'));
          }
          if (cdpStatus.status === 'CONFLICT') {
            const err = new Error('DevTools conflict: debugger cannot execute commands while tab is in CONFLICT state');
            (err as any).code = 1001;
            return Promise.reject(err);
          }

          const reqId = `xokj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const p = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              if (pendingRequests.has(reqId)) {
                pendingRequests.delete(reqId);
                reject(new Error(`CDP request timed out after 30000ms: ${method} (${reqId})`));
              }
            }, 30000);

            pendingRequests.set(reqId, {
              resolve,
              reject,
              timer,
              method: method.trim()
            });

            const rpcPayload: Record<string, any> = {
              source: 'xokj-userscript',
              type: 'CDP_RPC_REQUEST',
              id: reqId,
              scriptId,
              method: method.trim(),
              params: params || {}
            };
            if (effectiveChannelId) {
              rpcPayload.channelId = effectiveChannelId;
            }

            window.postMessage(rpcPayload, '*');
          });

          // Prevent unhandled rejection crashes if execution environment tears down before completion
          p.catch(() => {});

          return p;
        },
        on: (event: string, handler: Function): (() => void) => {
          if (!event || typeof event !== 'string' || typeof handler !== 'function') {
            return () => {};
          }
          const trimmed = event.trim();
          if (!trimmed) return () => {};

          let set = eventListeners.get(trimmed);
          if (!set) {
            set = new Set();
            eventListeners.set(trimmed, set);
          }
          set.add(handler);

          return () => {
            cdp.off(trimmed, handler);
          };
        },
        off: (event: string, handler: Function): void => {
          if (!event || typeof event !== 'string') return;
          const trimmed = event.trim();
          const set = eventListeners.get(trimmed);
          if (set) {
            set.delete(handler);
            if (set.size === 0) {
              eventListeners.delete(trimmed);
            }
          }
        },
        getStatus: () => ({ status: cdpStatus.status, conflict: cdpStatus.conflict }),
        isAttached: () => cdpStatus.status === 'ATTACHED'
      };
    }

    const GM_cdp = allowCdp && cdp && typeof cdp.send === 'function'
      ? Object.assign(
          function(method: string, params?: Record<string, unknown>) {
            return cdp.send(method, params);
          },
          {
            send: cdp.send.bind(cdp),
            on: cdp.on.bind(cdp),
            off: cdp.off.bind(cdp),
            getStatus: cdp.getStatus.bind(cdp),
            isAttached: cdp.isAttached.bind(cdp)
          }
        )
      : undefined;

    const GM_info = allowGmInfo
      ? {
          script: {
            name: scriptName,
            version: metadata?.version || '1.0.0',
            description: metadata?.description || '',
            matches: metadata?.matches || []
          },
          scriptHandler: 'XOKJ',
          version: '0.1.0'
        }
      : undefined;

    const wrapped = `(function(cdp, GM_cdp, GM_info, GM_setValue, GM_getValue, GM_deleteValue, GM_listValues, GM_addStyle, GM_log) {\n${code}\n})(__cdp, __GM_cdp, __GM_info, __GM_setValue, __GM_getValue, __GM_deleteValue, __GM_listValues, __GM_addStyle, __GM_log);\n//# sourceURL=xokj://${encodeURIComponent(
      scriptName
    )}.user.js`;

    const runFn = new Function(
      '__cdp',
      '__GM_cdp',
      '__GM_info',
      '__GM_setValue',
      '__GM_getValue',
      '__GM_deleteValue',
      '__GM_listValues',
      '__GM_addStyle',
      '__GM_log',
      wrapped
    );
    runFn(
      cdp,
      GM_cdp,
      GM_info,
      GM_setValue,
      GM_getValue,
      GM_deleteValue,
      GM_listValues,
      GM_addStyle,
      GM_log
    );
    return { success: true };
  } catch (err: any) {
    console.error(`[XOKJ Injector] Error running userscript "${scriptName}" (${scriptId}):`, err);
    return { success: false, error: err?.message || String(err) };
  }
}
