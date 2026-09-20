/**
 * Headless chrome.* API Mock Suite for Vitest test suites.
 * Location: test/mocks/chrome.ts
 */

import { vi } from 'vitest';

/**
 * Generic mock for chrome.events.Event
 */
export class MockEvent<T extends (...args: any[]) => any> {
  public listeners = new Set<T>();

  public addListener = vi.fn((fn: T) => {
    this.listeners.add(fn);
  });

  public removeListener = vi.fn((fn: T) => {
    this.listeners.delete(fn);
  });

  public hasListener = vi.fn((fn: T) => {
    return this.listeners.has(fn);
  });

  public hasListeners = vi.fn(() => {
    return this.listeners.size > 0;
  });

  public _emit = (...args: Parameters<T>): Promise<void> => {
    const promises: any[] = [];
    for (const fn of Array.from(this.listeners)) {
      try {
        const ret = fn(...args);
        if (ret instanceof Promise) {
          promises.push(ret);
        }
      } catch (err) {
        console.error('[MockEvent._emit] Error in listener:', err);
      }
    }
    return Promise.all(promises).then(() => {});
  };

  public _clear = (): void => {
    this.listeners.clear();
    this.addListener.mockClear();
    this.removeListener.mockClear();
    this.hasListener.mockClear();
    this.hasListeners.mockClear();
  };
}

/**
 * Special mock for chrome.runtime.onMessage with async reply handling
 */
export class MockRuntimeMessageEvent {
  public listeners = new Set<
    (message: any, sender: any, sendResponse: (response?: any) => void) => boolean | void | Promise<any>
  >();

  public addListener = vi.fn((fn: any) => {
    this.listeners.add(fn);
  });

  public removeListener = vi.fn((fn: any) => {
    this.listeners.delete(fn);
  });

  public hasListener = vi.fn((fn: any) => {
    return this.listeners.has(fn);
  });

  public hasListeners = vi.fn(() => {
    return this.listeners.size > 0;
  });

  /**
   * Dispatches message to all registered listeners.
   * Handles synchronous responses, boolean async signals with sendResponse, and Promises.
   */
  public _emitMessage = async (message: any, sender: any = {}): Promise<any> => {
    const promises: Promise<any>[] = [];

    for (const listener of Array.from(this.listeners)) {
      const p = new Promise<any>((resolve) => {
        let responded = false;
        const sendResponse = (res?: any) => {
          if (!responded) {
            responded = true;
            resolve(res);
          }
        };

        try {
          const returnValue = listener(message, sender, sendResponse);
          if (returnValue === true) {
            // Asynchronous listener will call sendResponse later
          } else if (returnValue instanceof Promise) {
            returnValue.then((res) => {
              if (!responded) {
                responded = true;
                resolve(res);
              }
            });
          } else {
            if (!responded) {
              responded = true;
              resolve(returnValue === false ? undefined : returnValue);
            }
          }
        } catch (err) {
          resolve({ error: err instanceof Error ? err.message : String(err) });
        }
      });
      promises.push(p);
    }

    if (promises.length === 0) return undefined;
    const results = await Promise.all(promises);
    return results.find((r) => r !== undefined);
  };

  public _clear = (): void => {
    this.listeners.clear();
    this.addListener.mockClear();
    this.removeListener.mockClear();
  };
}

/**
 * Memory storage area conforming to chrome.storage.StorageArea
 */
export class MockStorageArea {
  private store: Record<string, any> = {};

  private clone<T>(val: T): T {
    if (val === null || typeof val !== 'object') return val;
    if (typeof structuredClone === 'function') return structuredClone(val);
    return JSON.parse(JSON.stringify(val));
  }

  async get(keys?: string | string[] | Record<string, any> | null): Promise<Record<string, any>> {
    if (keys === null || keys === undefined) {
      return this.clone(this.store);
    }
    if (typeof keys === 'string') {
      return { [keys]: this.clone(this.store[keys]) };
    }
    if (Array.isArray(keys)) {
      const res: Record<string, any> = {};
      for (const k of keys) {
        if (k in this.store) res[k] = this.clone(this.store[k]);
      }
      return res;
    }
    if (typeof keys === 'object') {
      const res: Record<string, any> = { ...keys };
      for (const k in keys) {
        if (k in this.store) res[k] = this.clone(this.store[k]);
      }
      return res;
    }
    return {};
  }

  async set(items: Record<string, any>): Promise<void> {
    for (const [k, v] of Object.entries(items)) {
      this.store[k] = this.clone(v);
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) {
      delete this.store[k];
    }
  }

  async clear(): Promise<void> {
    this.store = {};
  }

  // Debug helper
  _dump(): Record<string, any> {
    return this.clone(this.store);
  }
}

/**
 * Factory creating an isolated chrome.debugger mock environment
 */
export function createMockDebugger() {
  const attachedTabs = new Set<number>();

  const onEvent = new MockEvent<(source: { tabId?: number }, method: string, params?: any) => void>();
  const onDetach = new MockEvent<(source: { tabId?: number }, reason: string) => void>();

  const attach = vi.fn(async (target: { tabId?: number }, version: string = '1.3') => {
    if (typeof target.tabId === 'number') {
      attachedTabs.add(target.tabId);
    }
  });

  const detach = vi.fn(async (target: { tabId?: number }) => {
    if (typeof target.tabId === 'number') {
      attachedTabs.delete(target.tabId);
    }
  });

  const sendCommand = vi.fn(async (target: { tabId?: number }, method: string, commandParams?: any) => {
    return {};
  });

  const getTargets = vi.fn(async () => {
    return Array.from(attachedTabs).map((id) => ({
      id: String(id),
      tabId: id,
      type: 'page',
      title: 'Mock Page',
      url: 'https://example.com'
    }));
  });

  return {
    attach,
    detach,
    sendCommand,
    getTargets,
    onEvent,
    onDetach,
    _attachedTabs: attachedTabs,
    _emitEvent: (source: { tabId?: number }, method: string, params?: any) => {
      return onEvent._emit(source, method, params);
    },
    _emitDetach: (source: { tabId?: number }, reason: string) => {
      if (typeof source.tabId === 'number') {
        attachedTabs.delete(source.tabId);
      }
      return onDetach._emit(source, reason);
    },
    _reset: () => {
      attachedTabs.clear();
      attach.mockClear();
      detach.mockClear();
      sendCommand.mockClear();
      getTargets.mockClear();
      onEvent._clear();
      onDetach._clear();
    }
  };
}

export function createMockWebNavigation() {
  const onBeforeNavigate = new MockEvent<(details: any) => void>();
  const onCommitted = new MockEvent<(details: any) => void>();
  const onCompleted = new MockEvent<(details: any) => void>();

  return {
    onBeforeNavigate,
    onCommitted,
    onCompleted,
    _emitBeforeNavigate: (details: { tabId: number; url: string; frameId?: number; timeStamp?: number }) => {
      onBeforeNavigate._emit({
        frameId: 0,
        timeStamp: Date.now(),
        ...details
      });
    },
    _reset: () => {
      onBeforeNavigate._clear();
      onCommitted._clear();
      onCompleted._clear();
    }
  };
}

export function createMockRuntime() {
  const onMessage = new MockRuntimeMessageEvent();
  const sendMessage = vi.fn(async (message: any) => {});

  return {
    lastError: undefined as { message?: string } | undefined,
    sendMessage,
    onMessage,
    _emitMessage: onMessage._emitMessage,
    _reset: () => {
      sendMessage.mockClear();
      onMessage._clear();
    }
  };
}

export function createMockTabs() {
  const sendMessage = vi.fn(async (tabId: number, message: any) => {});
  const query = vi.fn(async (queryInfo: any) => [{ id: 1, url: 'https://example.com' }]);
  const get = vi.fn(async (tabId: number) => ({ id: tabId, url: 'https://example.com' }));
  const onRemoved = new MockEvent<(tabId: number, removeInfo: any) => void>();

  return {
    sendMessage,
    query,
    get,
    onRemoved,
    _emitRemoved: (tabId: number) => {
      onRemoved._emit(tabId, { isWindowClosing: false, windowId: 1 });
    },
    _reset: () => {
      sendMessage.mockClear();
      query.mockClear();
      get.mockClear();
      onRemoved._clear();
    }
  };
}

export interface ChromeMockContext {
  localStorage: MockStorageArea;
  sessionStorage: MockStorageArea;
  mockDebugger: ReturnType<typeof createMockDebugger>;
  mockWebNavigation: ReturnType<typeof createMockWebNavigation>;
  mockRuntime: ReturnType<typeof createMockRuntime>;
  mockTabs: ReturnType<typeof createMockTabs>;
  resetAll: () => void;
}

/**
 * Initializes and registers the global chrome mock object.
 * Fully backwards compatible with Milestone 1 tests.
 */
export function setupChromeMock(): ChromeMockContext {
  const localStorage = new MockStorageArea();
  const sessionStorage = new MockStorageArea();
  const mockDebugger = createMockDebugger();
  const mockWebNavigation = createMockWebNavigation();
  const mockRuntime = createMockRuntime();
  const mockTabs = createMockTabs();

  const resetAll = () => {
    localStorage.clear();
    sessionStorage.clear();
    mockDebugger._reset();
    mockWebNavigation._reset();
    mockRuntime._reset();
    mockTabs._reset();
  };

  (globalThis as any).chrome = {
    storage: {
      local: localStorage,
      session: sessionStorage
    },
    debugger: mockDebugger,
    webNavigation: mockWebNavigation,
    runtime: mockRuntime,
    tabs: mockTabs
  };

  return {
    localStorage,
    sessionStorage,
    mockDebugger,
    mockWebNavigation,
    mockRuntime,
    mockTabs,
    resetAll
  };
}
