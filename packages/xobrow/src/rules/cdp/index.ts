/**
 * Category 3: CDP Protocol Integrity & Contract Validation Rules
 */

export * from './cdp-catalog.js';
export * from './cdp-helpers.js';

import { cdpValidDomainMethod, cdpValidDomainMethodRule } from './cdp-valid-domain-method.js';
import { cdpHeaderPermission, cdpHeaderPermissionRule } from './cdp-header-permission.js';
import { cdpHandledAsyncReject, cdpHandledAsyncRejectRule } from './cdp-handled-async-reject.js';
import { cdpNoTightPolling, cdpNoTightPollingRule } from './cdp-no-tight-polling.js';
import { cdpValidPayload, cdpValidPayloadRule } from './cdp-valid-payload.js';
import type { RuleDefinition } from '../../types.js';

export {
  cdpValidDomainMethod,
  cdpValidDomainMethodRule,
  cdpHeaderPermission,
  cdpHeaderPermissionRule,
  cdpHandledAsyncReject,
  cdpHandledAsyncRejectRule,
  cdpNoTightPolling,
  cdpNoTightPollingRule,
  cdpValidPayload,
  cdpValidPayloadRule
};

export const cdpRules: readonly RuleDefinition[] = [
  cdpValidDomainMethod,
  cdpHeaderPermission,
  cdpHandledAsyncReject,
  cdpNoTightPolling,
  cdpValidPayload
] as const;
