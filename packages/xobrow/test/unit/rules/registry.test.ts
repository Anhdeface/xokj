import { describe, it, expect, beforeEach } from 'vitest';
import {
  RuleRegistry,
  CANONICAL_RULES_CATALOG,
  defaultRegistry,
  registerRule,
  registerRules,
  getRule,
  getAllRules,
  getRulesByCategory
} from '../../../src/rules/registry.js';
import type { RuleDefinition } from '../../../src/types.js';

describe('Rule Registry & Catalog (rules/registry.ts)', () => {
  let registry: RuleRegistry;

  const createDummyRule = (id: string, overrides: Partial<RuleDefinition> = {}): RuleDefinition => ({
    id,
    name: `Rule ${id}`,
    category: 'security',
    defaultSeverity: 'error',
    description: `Description for ${id}`,
    create: () => ({}),
    ...overrides
  });

  beforeEach(() => {
    registry = new RuleRegistry();
  });

  describe('RuleRegistry Class', () => {
    it('registers and retrieves a valid rule definition', () => {
      const rule = createDummyRule('test-rule');
      registry.register(rule);

      expect(registry.has('test-rule')).toBe(true);
      expect(registry.get('test-rule')).toBe(rule);
      expect(registry.count()).toBe(1);
    });

    it('returns undefined for non-existent rule', () => {
      expect(registry.has('missing-rule')).toBe(false);
      expect(registry.get('missing-rule')).toBeUndefined();
    });

    it('throws error when registering duplicate rule ID', () => {
      const rule1 = createDummyRule('duplicate-rule');
      const rule2 = createDummyRule('duplicate-rule');

      registry.register(rule1);
      expect(() => registry.register(rule2)).toThrowError(
        'Duplicate rule registration: Rule with ID "duplicate-rule" is already registered.'
      );
    });

    it('rejects rules missing required properties', () => {
      expect(() => registry.register(null as any)).toThrowError('rule definition must be an object');
      expect(() => registry.register({} as any)).toThrowError('missing or empty "id"');
      expect(() => registry.register({ id: 'bad', name: '' } as any)).toThrowError('missing or empty "name"');
      expect(() => registry.register({ id: 'bad', name: 'Name', category: 'invalid' } as any)).toThrowError('invalid category');
      expect(() => registry.register({ id: 'bad', name: 'Name', category: 'security', defaultSeverity: 'fatal' } as any)).toThrowError('invalid defaultSeverity');
      expect(() => registry.register({ id: 'bad', name: 'Name', category: 'security', defaultSeverity: 'error', create: 'not-a-fn' } as any)).toThrowError('"create" property must be a factory function');
    });

    it('registers multiple rules via registerMany', () => {
      const rules = [
        createDummyRule('r1', { category: 'security' }),
        createDummyRule('r2', { category: 'resource-leak' }),
        createDummyRule('r3', { category: 'cdp-integrity' })
      ];
      registry.registerMany(rules);

      expect(registry.count()).toBe(3);
      expect(registry.getAll()).toHaveLength(3);
    });

    it('unregisters rule by ID', () => {
      const rule = createDummyRule('removable');
      registry.register(rule);

      expect(registry.unregister('removable')).toBe(true);
      expect(registry.has('removable')).toBe(false);
      expect(registry.unregister('removable')).toBe(false);
    });

    it('filters rules by category', () => {
      registry.registerMany([
        createDummyRule('sec-1', { category: 'security' }),
        createDummyRule('sec-2', { category: 'security' }),
        createDummyRule('leak-1', { category: 'resource-leak' }),
        createDummyRule('cdp-1', { category: 'cdp-integrity' })
      ]);

      const secRules = registry.getByCategory('security');
      expect(secRules).toHaveLength(2);
      expect(secRules.map((r) => r.id)).toEqual(['sec-1', 'sec-2']);

      const leakRules = registry.getByCategory('resource-leak');
      expect(leakRules).toHaveLength(1);
      expect(leakRules[0].id).toBe('leak-1');
    });

    it('retrieves rules by specific ID list', () => {
      registry.registerMany([
        createDummyRule('r1'),
        createDummyRule('r2'),
        createDummyRule('r3')
      ]);

      const selected = registry.getByIds(['r1', 'r3', 'missing']);
      expect(selected).toHaveLength(2);
      expect(selected.map((r) => r.id)).toEqual(['r1', 'r3']);
    });

    it('filters rules by custom predicate', () => {
      registry.registerMany([
        createDummyRule('warn-1', { defaultSeverity: 'warning' }),
        createDummyRule('err-1', { defaultSeverity: 'error' })
      ]);

      const warnings = registry.filter((r) => r.defaultSeverity === 'warning');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].id).toBe('warn-1');
    });

    it('clears all rules', () => {
      registry.register(createDummyRule('temp'));
      expect(registry.count()).toBe(1);
      registry.clear();
      expect(registry.count()).toBe(0);
      expect(registry.getAll()).toEqual([]);
    });

    it('maintains independent isolation between instances', () => {
      const reg1 = new RuleRegistry();
      const reg2 = new RuleRegistry();

      reg1.register(createDummyRule('reg1-only'));
      expect(reg1.has('reg1-only')).toBe(true);
      expect(reg2.has('reg1-only')).toBe(false);
    });
  });

  describe('CANONICAL_RULES_CATALOG', () => {
    it('contains exactly 15 canonical rules defined across 3 categories', () => {
      expect(CANONICAL_RULES_CATALOG).toHaveLength(15);

      const securityRules = CANONICAL_RULES_CATALOG.filter((r) => r.category === 'security');
      const leakRules = CANONICAL_RULES_CATALOG.filter((r) => r.category === 'resource-leak');
      const cdpRules = CANONICAL_RULES_CATALOG.filter((r) => r.category === 'cdp-integrity');

      expect(securityRules).toHaveLength(6);
      expect(leakRules).toHaveLength(4);
      expect(cdpRules).toHaveLength(5);
    });

    it('contains all required security rules', () => {
      const ids = CANONICAL_RULES_CATALOG.map((r) => r.id);
      expect(ids).toContain('sec-no-eval');
      expect(ids).toContain('sec-no-new-function');
      expect(ids).toContain('sec-no-string-timers');
      expect(ids).toContain('sec-no-unsafe-dom-sink');
      expect(ids).toContain('sec-no-prototype-pollution');
      expect(ids).toContain('sec-no-script-injection');
    });

    it('contains all required leak rules', () => {
      const ids = CANONICAL_RULES_CATALOG.map((r) => r.id);
      expect(ids).toContain('leak-uncleaned-event-listener');
      expect(ids).toContain('leak-lingering-interval');
      expect(ids).toContain('leak-unclosed-cdp-listener');
      expect(ids).toContain('leak-unbounded-async-loop');
    });

    it('contains all required CDP integrity rules', () => {
      const ids = CANONICAL_RULES_CATALOG.map((r) => r.id);
      expect(ids).toContain('cdp-valid-domain-method');
      expect(ids).toContain('cdp-header-permission');
      expect(ids).toContain('cdp-handled-async-reject');
      expect(ids).toContain('cdp-no-tight-polling');
      expect(ids).toContain('cdp-valid-payload');
    });
  });

  describe('Global defaultRegistry & Wrappers', () => {
    it('operates via convenience wrappers', () => {
      const initialCount = defaultRegistry.count();
      const tempRule = createDummyRule('global-test-rule');

      registerRule(tempRule);
      expect(getRule('global-test-rule')).toBe(tempRule);
      expect(getAllRules().some((r) => r.id === 'global-test-rule')).toBe(true);

      defaultRegistry.unregister('global-test-rule');
      expect(defaultRegistry.count()).toBe(initialCount);
    });
  });
});
