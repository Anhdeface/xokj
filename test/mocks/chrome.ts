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
  private onChanged?: MockEvent<(changes: Record<string, any>, areaName: string) => void>;
  private areaName: string;

  constructor(
    onChanged?: MockEvent<(changes: Record<string, any>, areaName: string) => void>,
    areaName = 'local'
  ) {
    this.onChanged = onChanged;
    this.areaName = areaName;
  }

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
    const changes: Record<string, any> = {};
    for (const [k, v] of Object.entries(items)) {
      changes[k] = {
        oldValue: this.clone(this.store[k]),
        newValue: this.clone(v)
      };
      this.store[k] = this.clone(v);
    }
    if (this.onChanged && Object.keys(changes).length > 0) {
      this.onChanged._emit(changes, this.areaName);
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    const changes: Record<string, any> = {};
    for (const k of list) {
      if (k in this.store) {
        changes[k] = {
          oldValue: this.clone(this.store[k]),
          newValue: undefined
        };
        delete this.store[k];
      }
    }
    if (this.onChanged && Object.keys(changes).length > 0) {
      this.onChanged._emit(changes, this.areaName);
    }
  }

  async clear(): Promise<void> {
    const changes: Record<string, any> = {};
    for (const k of Object.keys(this.store)) {
      changes[k] = {
        oldValue: this.clone(this.store[k]),
        newValue: undefined
      };
    }
    this.store = {};
    if (this.onChanged && Object.keys(changes).length > 0) {
      this.onChanged._emit(changes, this.areaName);
    }
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
  const onDOMContentLoaded = new MockEvent<(details: any) => void>();
  const onCompleted = new MockEvent<(details: any) => void>();

  return {
    onBeforeNavigate,
    onCommitted,
    onDOMContentLoaded,
    onCompleted,
    _emitBeforeNavigate: (details: { tabId: number; url: string; frameId?: number; timeStamp?: number }) => {
      return onBeforeNavigate._emit({
        frameId: 0,
        timeStamp: Date.now(),
        ...details
      });
    },
    _emitCommitted: (details: { tabId: number; url: string; frameId?: number; timeStamp?: number; transitionType?: string; transitionQualifiers?: string[] }) => {
      return onCommitted._emit({
        frameId: 0,
        timeStamp: Date.now(),
        transitionType: 'link',
        transitionQualifiers: [],
        ...details
      });
    },
    _emitDOMContentLoaded: (details: { tabId: number; url: string; frameId?: number; timeStamp?: number }) => {
      return onDOMContentLoaded._emit({
        frameId: 0,
        timeStamp: Date.now(),
        ...details
      });
    },
    _emitCompleted: (details: { tabId: number; url: string; frameId?: number; timeStamp?: number }) => {
      return onCompleted._emit({
        frameId: 0,
        timeStamp: Date.now(),
        ...details
      });
    },
    _reset: () => {
      onBeforeNavigate._clear();
      onCommitted._clear();
      onDOMContentLoaded._clear();
      onCompleted._clear();
    }
  };
}

export function createMockRuntime() {
  const onMessage = new MockRuntimeMessageEvent();
  const sendMessage = vi.fn(async (message: any, callback?: (response: any) => void): Promise<any> => {
    if (typeof callback === 'function') {
      callback(undefined);
    }
    return undefined;
  });
  const openOptionsPage = vi.fn(async () => {});

  return {
    lastError: undefined as { message?: string } | undefined,
    sendMessage,
    onMessage,
    openOptionsPage,
    _emitMessage: onMessage._emitMessage,
    _reset: () => {
      sendMessage.mockClear();
      onMessage._clear();
      openOptionsPage.mockClear();
    }
  };
}

export function createMockTabs() {
  const sendMessage = vi.fn(async (tabId: number, message: any, options?: any) => {});
  const query = vi.fn(async (queryInfo: any) => [{ id: 1, url: 'https://example.com' }]);
  const get = vi.fn(async (tabId: number) => ({ id: tabId, url: 'https://example.com' }));
  const reload = vi.fn(async (tabId?: number) => {});
  const create = vi.fn(async (props: any) => ({ id: 99, ...props }));
  const onRemoved = new MockEvent<(tabId: number, removeInfo: any) => void>();
  const onUpdated = new MockEvent<(tabId: number, changeInfo: any, tab: any) => void>();

  return {
    sendMessage,
    query,
    get,
    reload,
    create,
    onRemoved,
    onUpdated,
    _emitRemoved: (tabId: number) => {
      return onRemoved._emit(tabId, { isWindowClosing: false, windowId: 1 });
    },
    _emitUpdated: (tabId: number, changeInfo: any, tab?: any) => {
      return onUpdated._emit(tabId, changeInfo, tab || { id: tabId, url: changeInfo?.url || 'https://example.com' });
    },
    _reset: () => {
      sendMessage.mockClear();
      query.mockClear();
      get.mockClear();
      reload.mockClear();
      create.mockClear();
      onRemoved._clear();
      onUpdated._clear();
    }
  };
}

export function createMockScripting() {
  const executeScript = vi.fn(async (options: any): Promise<any[]> => {
    return [{ result: undefined }];
  });

  return {
    executeScript,
    _reset: () => {
      executeScript.mockClear();
    }
  };
}

export interface ChromeMockContext {
  localStorage: MockStorageArea;
  sessionStorage: MockStorageArea;
  storageOnChanged: MockEvent<(changes: Record<string, any>, areaName: string) => void>;
  mockDebugger: ReturnType<typeof createMockDebugger>;
  mockWebNavigation: ReturnType<typeof createMockWebNavigation>;
  mockRuntime: ReturnType<typeof createMockRuntime>;
  mockTabs: ReturnType<typeof createMockTabs>;
  mockScripting: ReturnType<typeof createMockScripting>;
  resetAll: () => void;
}

/**
 * Initializes and registers the global chrome mock object.
 * Fully backwards compatible with Milestone 1 & 2 tests.
 */
export function setupChromeMock(): ChromeMockContext {
  const storageOnChanged = new MockEvent<(changes: Record<string, any>, areaName: string) => void>();
  const localStorage = new MockStorageArea(storageOnChanged, 'local');
  const sessionStorage = new MockStorageArea(storageOnChanged, 'session');
  const mockDebugger = createMockDebugger();
  const mockWebNavigation = createMockWebNavigation();
  const mockRuntime = createMockRuntime();
  const mockTabs = createMockTabs();
  const mockScripting = createMockScripting();

  const resetAll = () => {
    localStorage.clear();
    sessionStorage.clear();
    storageOnChanged._clear();
    mockDebugger._reset();
    mockWebNavigation._reset();
    mockRuntime._reset();
    mockTabs._reset();
    mockScripting._reset();
  };

  (globalThis as any).chrome = {
    storage: {
      local: localStorage,
      session: sessionStorage,
      onChanged: storageOnChanged
    },
    debugger: mockDebugger,
    webNavigation: mockWebNavigation,
    runtime: mockRuntime,
    tabs: mockTabs,
    scripting: mockScripting
  };

  return {
    localStorage,
    sessionStorage,
    storageOnChanged,
    mockDebugger,
    mockWebNavigation,
    mockRuntime,
    mockTabs,
    mockScripting,
    resetAll
  };
}
