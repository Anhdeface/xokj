/**
 * Category 1: Security Policy Enforcement Rules
 */

import { secNoEval, secNoEvalRule } from './sec-no-eval.js';
import { secNoNewFunction, secNoNewFunctionRule } from './sec-no-new-function.js';
import { secNoStringTimers, secNoStringTimersRule } from './sec-no-string-timers.js';
import { secNoUnsafeDomSink, secNoUnsafeDomSinkRule } from './sec-no-unsafe-dom-sink.js';
import { secNoPrototypePollution, secNoPrototypePollutionRule } from './sec-no-prototype-pollution.js';
import { secNoScriptInjection, secNoScriptInjectionRule } from './sec-no-script-injection.js';
import type { RuleDefinition } from '../../types.js';

export {
  secNoEval,
  secNoEvalRule,
  secNoNewFunction,
  secNoNewFunctionRule,
  secNoStringTimers,
  secNoStringTimersRule,
  secNoUnsafeDomSink,
  secNoUnsafeDomSinkRule,
  secNoPrototypePollution,
  secNoPrototypePollutionRule,
  secNoScriptInjection,
  secNoScriptInjectionRule
};

export const securityRules: readonly RuleDefinition[] = [
  secNoEval,
  secNoNewFunction,
  secNoStringTimers,
  secNoUnsafeDomSink,
  secNoPrototypePollution,
  secNoScriptInjection
] as const;
