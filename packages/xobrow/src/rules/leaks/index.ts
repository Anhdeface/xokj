/**
 * Category 2: Resource Leak Detection Rules
 */

import { leakUncleanedEventListener, leakUncleanedEventListenerRule } from './leak-uncleaned-event-listener.js';
import { leakLingeringInterval, leakLingeringIntervalRule } from './leak-lingering-interval.js';
import { leakUnclosedCdpListener, leakUnclosedCdpListenerRule } from './leak-unclosed-cdp-listener.js';
import { leakUnboundedAsyncLoop, leakUnboundedAsyncLoopRule } from './leak-unbounded-async-loop.js';
import type { RuleDefinition } from '../../types.js';

export {
  leakUncleanedEventListener,
  leakUncleanedEventListenerRule,
  leakLingeringInterval,
  leakLingeringIntervalRule,
  leakUnclosedCdpListener,
  leakUnclosedCdpListenerRule,
  leakUnboundedAsyncLoop,
  leakUnboundedAsyncLoopRule
};

export const leakRules: readonly RuleDefinition[] = [
  leakUncleanedEventListener,
  leakLingeringInterval,
  leakUnclosedCdpListener,
  leakUnboundedAsyncLoop
] as const;
