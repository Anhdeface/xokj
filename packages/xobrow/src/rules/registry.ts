/**
 * XoBrow Static Analysis & Security Audit Tool
 * Rule Catalog & Registry Architecture with 15 Canonical Rules
 */

import type { RuleCategory, RuleDefinition } from '../types.js';

// Category 1: Security Policy Enforcement
import {
  secNoEval,
  secNoNewFunction,
  secNoStringTimers,
  secNoUnsafeDomSink,
  secNoPrototypePollution,
  secNoScriptInjection,
  securityRules
} from './security/index.js';

// Category 2: Resource Leak Detection
import {
  leakUncleanedEventListener,
  leakLingeringInterval,
  leakUnclosedCdpListener,
  leakUnboundedAsyncLoop,
  leakRules
} from './leaks/index.js';

// Category 3: CDP Protocol Integrity & Contract Validation
import {
  cdpValidDomainMethod,
  cdpHeaderPermission,
  cdpHandledAsyncReject,
  cdpNoTightPolling,
  cdpValidPayload,
  cdpRules
} from './cdp/index.js';

export {
  secNoEval,
  secNoNewFunction,
  secNoStringTimers,
  secNoUnsafeDomSink,
  secNoPrototypePollution,
  secNoScriptInjection,
  securityRules,
  leakUncleanedEventListener,
  leakLingeringInterval,
  leakUnclosedCdpListener,
  leakUnboundedAsyncLoop,
  leakRules,
  cdpValidDomainMethod,
  cdpHeaderPermission,
  cdpHandledAsyncReject,
  cdpNoTightPolling,
  cdpValidPayload,
  cdpRules
};

export interface RuleCatalogEntry {
  id: string;
  name: string;
  category: RuleCategory;
  defaultSeverity: 'error' | 'warning';
  description: string;
}

/**
 * Complete catalog of all 15 canonical rules across the three core categories.
 * Referenced for validation, discovery, and documentation generation.
 */
export const CANONICAL_RULES_CATALOG: readonly RuleCatalogEntry[] = [
  // --- Security Policy Enforcement (6 rules) ---
  {
    id: 'sec-no-eval',
    name: 'Prohibit eval()',
    category: 'security',
    defaultSeverity: 'error',
    description: 'Calling eval(), window.eval, or globalThis.eval executes dynamic untrusted code.'
  },
  {
    id: 'sec-no-new-function',
    name: 'Prohibit Function constructor',
    category: 'security',
    defaultSeverity: 'error',
    description: 'new Function(...) compiles arbitrary strings into executable code.'
  },
  {
    id: 'sec-no-string-timers',
    name: 'Prohibit string-based timers',
    category: 'security',
    defaultSeverity: 'error',
    description: 'Passing a string as timer callback triggers implicit eval evaluation.'
  },
  {
    id: 'sec-no-unsafe-dom-sink',
    name: 'Prohibit unsafe DOM sinks',
    category: 'security',
    defaultSeverity: 'error',
    description: 'Assigning unvalidated HTML strings to DOM sinks (.innerHTML, .outerHTML, document.write) introduces XSS.'
  },
  {
    id: 'sec-no-prototype-pollution',
    name: 'Prohibit prototype pollution',
    category: 'security',
    defaultSeverity: 'error',
    description: 'Mutating __proto__, Object.prototype, or Object.setPrototypeOf compromises prototype chains.'
  },
  {
    id: 'sec-no-script-injection',
    name: 'Prohibit dynamic script elements',
    category: 'security',
    defaultSeverity: 'error',
    description: 'Dynamic creation and injection of <script> DOM elements bypasses sandbox isolation.'
  },

  // --- Resource Leak Detection (4 rules) ---
  {
    id: 'leak-uncleaned-event-listener',
    name: 'Detect uncleaned event listeners',
    category: 'resource-leak',
    defaultSeverity: 'error',
    description: 'Adding event listeners without { once: true }, AbortSignal, or matching removeEventListener leaks memory.'
  },
  {
    id: 'leak-lingering-interval',
    name: 'Detect unclosed intervals',
    category: 'resource-leak',
    defaultSeverity: 'error',
    description: 'setInterval timers continue indefinitely if their handle is not passed to clearInterval.'
  },
  {
    id: 'leak-unclosed-cdp-listener',
    name: 'Detect unclosed CDP listeners',
    category: 'resource-leak',
    defaultSeverity: 'error',
    description: 'CDP event subscriptions (cdp.on / GM_cdp.on) leak channels if not unsubscribed via unbind() or cdp.off().'
  },
  {
    id: 'leak-unbounded-async-loop',
    name: 'Detect unbounded async loops',
    category: 'resource-leak',
    defaultSeverity: 'error',
    description: 'while(true) loops invoking CDP commands without sleep delays or break conditions flood protocol channels.'
  },

  // --- CDP API Integrity & Contract Validation (5 rules) ---
  {
    id: 'cdp-valid-domain-method',
    name: 'Validate CDP domain & method',
    category: 'cdp-integrity',
    defaultSeverity: 'error',
    description: 'Calling non-existent CDP domains or methods results in immediate runtime JSON-RPC failure.'
  },
  {
    id: 'cdp-header-permission',
    name: 'Enforce metadata permissions',
    category: 'cdp-integrity',
    defaultSeverity: 'error',
    description: 'Invoking CDP methods without @grant GM_cdp or matching @cdp <Domain> directive causes authorization rejection.'
  },
  {
    id: 'cdp-handled-async-reject',
    name: 'Check handled CDP rejections',
    category: 'cdp-integrity',
    defaultSeverity: 'warning',
    description: 'Floating unhandled cdp.send promises trigger uncaught rejections when tabs detach or conflicts occur.'
  },
  {
    id: 'cdp-no-tight-polling',
    name: 'Detect tight CDP polling loops',
    category: 'cdp-integrity',
    defaultSeverity: 'error',
    description: 'Polling CDP methods in tight loops or short timers (< 100ms) without backoff saturates browser IPC.'
  },
  {
    id: 'cdp-valid-payload',
    name: 'Validate CDP parameters payload',
    category: 'cdp-integrity',
    defaultSeverity: 'error',
    description: 'CDP method parameters must be an object dictionary. Passing primitives or arrays triggers schema rejection.'
  }
] as const;

/**
 * Array of all 15 canonical RuleDefinitions ready for registration.
 */
export const ALL_RULES: readonly RuleDefinition[] = [
  secNoEval,
  secNoNewFunction,
  secNoStringTimers,
  secNoUnsafeDomSink,
  secNoPrototypePollution,
  secNoScriptInjection,
  leakUncleanedEventListener,
  leakLingeringInterval,
  leakUnclosedCdpListener,
  leakUnboundedAsyncLoop,
  cdpValidDomainMethod,
  cdpHeaderPermission,
  cdpHandledAsyncReject,
  cdpNoTightPolling,
  cdpValidPayload
];

/**
 * Class representing an isolated rule registry.
 * Allows independent instantiation in unit test suites to avoid test cross-pollution.
 */
export class RuleRegistry {
  private readonly rules = new Map<string, RuleDefinition>();

  /**
   * Registers a single rule definition.
   * Throws an error if rule is invalid or already registered.
   */
  public register(rule: RuleDefinition): void {
    this.validateRule(rule);
    if (this.rules.has(rule.id)) {
      throw new Error(`Duplicate rule registration: Rule with ID "${rule.id}" is already registered.`);
    }
    this.rules.set(rule.id, rule);
  }

  /**
   * Registers multiple rule definitions sequentially.
   */
  public registerMany(rules: RuleDefinition[]): void {
    for (const rule of rules) {
      this.register(rule);
    }
  }

  /**
   * Unregisters a rule by ID. Returns true if removed, false if not found.
   */
  public unregister(id: string): boolean {
    return this.rules.delete(id);
  }

  /**
   * Retrieves a rule definition by its ID.
   */
  public get(id: string): RuleDefinition | undefined {
    return this.rules.get(id);
  }

  /**
   * Checks if a rule with the given ID is registered.
   */
  public has(id: string): boolean {
    return this.rules.has(id);
  }

  /**
   * Retrieves all registered rules as an array.
   */
  public getAll(): RuleDefinition[] {
    return Array.from(this.rules.values());
  }

  /**
   * Retrieves all rules belonging to a specific category.
   */
  public getByCategory(category: RuleCategory): RuleDefinition[] {
    return this.getAll().filter((rule) => rule.category === category);
  }

  /**
   * Retrieves rules matching a specified list of IDs.
   */
  public getByIds(ids: string[]): RuleDefinition[] {
    const idSet = new Set(ids);
    return this.getAll().filter((rule) => idSet.has(rule.id));
  }

  /**
   * Filters rules by an arbitrary predicate.
   */
  public filter(predicate: (rule: RuleDefinition) => boolean): RuleDefinition[] {
    return this.getAll().filter(predicate);
  }

  /**
   * Returns total count of registered rules.
   */
  public count(): number {
    return this.rules.size;
  }

  /**
   * Clears all registered rules (useful in test cleanup).
   */
  public clear(): void {
    this.rules.clear();
  }

  /**
   * Validates integrity and mandatory fields of a RuleDefinition.
   */
  private validateRule(rule: RuleDefinition): void {
    if (!rule || typeof rule !== 'object') {
      throw new Error('Invalid rule: rule definition must be an object.');
    }
    if (!rule.id || typeof rule.id !== 'string' || !rule.id.trim()) {
      throw new Error('Invalid rule: missing or empty "id" property.');
    }
    if (!rule.name || typeof rule.name !== 'string' || !rule.name.trim()) {
      throw new Error(`Invalid rule "${rule.id}": missing or empty "name" property.`);
    }
    if (!rule.category || !['security', 'resource-leak', 'cdp-integrity'].includes(rule.category)) {
      throw new Error(
        `Invalid rule "${rule.id}": invalid category "${rule.category}". Must be one of: 'security', 'resource-leak', 'cdp-integrity'.`
      );
    }
    if (!rule.defaultSeverity || !['error', 'warning', 'info'].includes(rule.defaultSeverity)) {
      throw new Error(
        `Invalid rule "${rule.id}": invalid defaultSeverity "${rule.defaultSeverity}". Must be 'error', 'warning', or 'info'.`
      );
    }
    if (typeof rule.create !== 'function') {
      throw new Error(`Invalid rule "${rule.id}": "create" property must be a factory function.`);
    }
  }
}

/**
 * Creates a new RuleRegistry pre-populated with all 15 canonical rules.
 */
export function createDefaultRegistry(): RuleRegistry {
  const registry = new RuleRegistry();
  registry.registerMany(Array.from(ALL_RULES));
  return registry;
}

/**
 * Global default registry instance used across the CLI and scanner engine.
 * Pre-populated with all 15 canonical rules.
 */
export const defaultRegistry = createDefaultRegistry();

/**
 * Convenience wrapper functions operating on the global default registry.
 */
export function registerRule(rule: RuleDefinition): void {
  defaultRegistry.register(rule);
}

export function registerRules(rules: RuleDefinition[]): void {
  defaultRegistry.registerMany(rules);
}

export function getRule(id: string): RuleDefinition | undefined {
  return defaultRegistry.get(id);
}

export function getAllRules(): RuleDefinition[] {
  return defaultRegistry.getAll();
}

export function getRulesByCategory(category: RuleCategory): RuleDefinition[] {
  return defaultRegistry.getByCategory(category);
}
