import { describe, it, expect } from 'vitest';
import {
  isSeverity,
  isRuleCategory,
  fromBabelLoc,
  VALID_SEVERITIES,
  VALID_CATEGORIES
} from '../../src/types.js';

describe('Core Types & Helpers (types.ts)', () => {
  describe('isSeverity', () => {
    it('returns true for all valid severities', () => {
      for (const sev of VALID_SEVERITIES) {
        expect(isSeverity(sev)).toBe(true);
      }
    });

    it('returns false for invalid severities or non-string values', () => {
      expect(isSeverity('fatal')).toBe(false);
      expect(isSeverity('critical')).toBe(false);
      expect(isSeverity('')).toBe(false);
      expect(isSeverity(null)).toBe(false);
      expect(isSeverity(undefined)).toBe(false);
      expect(isSeverity(123)).toBe(false);
      expect(isSeverity({})).toBe(false);
    });
  });

  describe('isRuleCategory', () => {
    it('returns true for all valid categories', () => {
      for (const cat of VALID_CATEGORIES) {
        expect(isRuleCategory(cat)).toBe(true);
      }
    });

    it('returns false for unknown categories', () => {
      expect(isRuleCategory('performance')).toBe(false);
      expect(isRuleCategory('style')).toBe(false);
      expect(isRuleCategory(123)).toBe(false);
      expect(isRuleCategory(null)).toBe(false);
    });
  });

  describe('fromBabelLoc', () => {
    it('normalizes Babel 0-indexed column to 1-indexed column', () => {
      const babelLoc = {
        start: { line: 5, column: 0 },
        end: { line: 5, column: 15 }
      };

      const loc = fromBabelLoc(babelLoc);
      expect(loc.line).toBe(5);
      expect(loc.column).toBe(1);
      expect(loc.endLine).toBe(5);
      expect(loc.endColumn).toBe(16);
    });

    it('handles undefined loc or undefined start gracefully with fallback', () => {
      const fallbackLoc1 = fromBabelLoc(undefined);
      expect(fallbackLoc1).toEqual({ line: 1, column: 1 });

      const fallbackLoc2 = fromBabelLoc({});
      expect(fallbackLoc2).toEqual({ line: 1, column: 1 });
    });

    it('handles loc without end coordinate', () => {
      const babelLoc = {
        start: { line: 12, column: 8 }
      };

      const loc = fromBabelLoc(babelLoc);
      expect(loc.line).toBe(12);
      expect(loc.column).toBe(9);
      expect(loc.endLine).toBeUndefined();
      expect(loc.endColumn).toBeUndefined();
    });
  });
});
