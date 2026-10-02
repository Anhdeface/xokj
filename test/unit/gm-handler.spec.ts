/**
 * XOKJ - GmStorageMessageHandler Unit Tests
 * Tests for Feature 12: Background GM Storage Message Handler
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupChromeMock } from '../mocks/chrome';
import { GmStorageMessageHandler, gmStorageHandler } from '@/background/gm-handler';
import { gmStorageRepo } from '@/shared/storage';
import type { GmStorageResponse } from '@/shared/types';

describe('Feature 12: Background GM Storage Message Handler', () => {
  let context: ReturnType<typeof setupChromeMock>;
  let handler: GmStorageMessageHandler;

  beforeEach(async () => {
    context = setupChromeMock();
    await gmStorageRepo.clearGmValues('test-script');
    handler = new GmStorageMessageHandler(gmStorageRepo);
    handler.init();
  });

  afterEach(async () => {
    handler.destroy();
    await gmStorageRepo.clearGmValues('test-script');
  });

  describe('Tier 1: Core Storage Operations (GM_STORAGE_SET & GM_STORAGE_DELETE)', () => {
    it('T1.1: GM_STORAGE_SET successfully writes a value and verifies via gmStorageRepo.getGmValue', async () => {
      const response = await new Promise<GmStorageResponse>((resolve) => {
        handler.handleMessage(
          {
            type: 'GM_STORAGE_SET',
            scriptId: 'test-script',
            key: 'theme',
            value: 'dark'
          },
          {} as any,
          resolve
        );
      });

      expect(response.success).toBe(true);
      expect(response.error).toBeUndefined();

      const stored = await gmStorageRepo.getGmValue('test-script', 'theme');
      expect(stored).toBe('dark');
    });

    it('T1.2: GM_STORAGE_DELETE removes a previously set key', async () => {
      await gmStorageRepo.setGmValue('test-script', 'counter', 42);
      expect(await gmStorageRepo.getGmValue('test-script', 'counter')).toBe(42);

      const response = await new Promise<GmStorageResponse>((resolve) => {
        handler.handleMessage(
          {
            type: 'GM_STORAGE_DELETE',
            scriptId: 'test-script',
            key: 'counter'
          },
          {} as any,
          resolve
        );
      });

      expect(response.success).toBe(true);
      expect(await gmStorageRepo.getGmValue('test-script', 'counter')).toBeUndefined();
    });

    it('T1.3: GM_STORAGE_SET supports complex objects, arrays, and booleans', async () => {
      const complexData = {
        nested: { count: 10, flag: true },
        tags: ['a', 'b', 'c']
      };

      const res = await handler.processMessage({
        type: 'GM_STORAGE_SET',
        scriptId: 'test-script',
        key: 'config',
        value: complexData
      });

      expect(res.success).toBe(true);
      const retrieved = await gmStorageRepo.getGmValue('test-script', 'config');
      expect(retrieved).toEqual(complexData);
    });

    it('T1.4: GM_STORAGE_DELETE on non-existent key succeeds gracefully', async () => {
      const res = await handler.processMessage({
        type: 'GM_STORAGE_DELETE',
        scriptId: 'test-script',
        key: 'non-existent-key'
      });

      expect(res.success).toBe(true);
    });
  });

  describe('Tier 2: Input Validation & Error Handling', () => {
    it('T2.1: rejects GM_STORAGE_SET when scriptId is missing or empty', async () => {
      const res1 = await handler.processMessage({
        type: 'GM_STORAGE_SET',
        scriptId: '',
        key: 'myKey',
        value: 'val'
      });
      expect(res1.success).toBe(false);
      expect(res1.error).toContain('scriptId must be a non-empty string');

      const res2 = await handler.processMessage({
        type: 'GM_STORAGE_SET',
        scriptId: '   ',
        key: 'myKey',
        value: 'val'
      });
      expect(res2.success).toBe(false);
    });

    it('T2.2: rejects GM_STORAGE_SET when key is missing or empty', async () => {
      const res = await handler.processMessage({
        type: 'GM_STORAGE_SET',
        scriptId: 'test-script',
        key: '',
        value: 'val'
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain('key must be a non-empty string');
    });

    it('T2.3: rejects GM_STORAGE_DELETE when scriptId or key is invalid', async () => {
      const res1 = await handler.processMessage({
        type: 'GM_STORAGE_DELETE',
        scriptId: '',
        key: 'myKey'
      });
      expect(res1.success).toBe(false);

      const res2 = await handler.processMessage({
        type: 'GM_STORAGE_DELETE',
        scriptId: 'test-script',
        key: '   '
      });
      expect(res2.success).toBe(false);
    });

    it('T2.4: handleMessage ignores messages that are not GM_STORAGE_*', () => {
      let called = false;
      const result = handler.handleMessage(
        { type: 'UNKNOWN_TYPE_ACTION' },
        {} as any,
        () => {
          called = true;
        }
      );

      expect(result).toBeUndefined();
      expect(called).toBe(false);
    });

    it('T2.5: handleMessage safely handles null or undefined messages', () => {
      expect(handler.handleMessage(null, {} as any, () => {})).toBeUndefined();
      expect(handler.handleMessage(undefined, {} as any, () => {})).toBeUndefined();
    });

    it('T2.6: handles repository write exceptions and returns structured failure', async () => {
      const failingRepo = {
        ...gmStorageRepo,
        setGmValue: vi.fn().mockRejectedValue(new Error('Storage quota exceeded'))
      };

      const customHandler = new GmStorageMessageHandler(failingRepo as any);
      const res = await customHandler.processMessage({
        type: 'GM_STORAGE_SET',
        scriptId: 'test-script',
        key: 'big-data',
        value: 'overflow'
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Storage quota exceeded');
    });
  });

  describe('Tier 3: Runtime Message Listener Lifecycle & Async Channel', () => {
    it('T3.1: handleMessage returns true synchronously to keep port open for async sendResponse', () => {
      const isAsync = handler.handleMessage(
        { type: 'GM_STORAGE_SET', scriptId: 'test-script', key: 'k', value: 'v' },
        {} as any,
        () => {}
      );
      expect(isAsync).toBe(true);
    });

    it('T3.2: chrome.runtime._emitMessage routes to handler when registered', async () => {
      const response: GmStorageResponse = await context.mockRuntime._emitMessage(
        {
          type: 'GM_STORAGE_SET',
          scriptId: 'test-script',
          key: 'from-runtime',
          value: 123
        },
        {}
      );

      expect(response.success).toBe(true);
      expect(await gmStorageRepo.getGmValue('test-script', 'from-runtime')).toBe(123);
    });

    it('T3.3: singleton gmStorageHandler instance exists and can be imported', () => {
      expect(gmStorageHandler).toBeInstanceOf(GmStorageMessageHandler);
    });
  });
});
