import type { RuleDefinition, RuleContext, NodeVisitor } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { matchCdpCall } from './cdp-helpers.js';

export const cdpHeaderPermission: RuleDefinition = {
  id: 'cdp-header-permission',
  name: 'Enforce metadata permissions',
  category: 'cdp-integrity',
  defaultSeverity: 'error',
  description: 'Invoking CDP methods without @grant GM_cdp or matching @cdp <Domain> directive causes authorization rejection.',
  create: (context: RuleContext): NodeVisitor => {
    function inspectCall(node: any) {
      const cdpCall = matchCdpCall(node);
      if (!cdpCall) {
        return;
      }

      const domain = cdpCall.domain || 'Unknown';
      const methodDisplay = cdpCall.methodString || 'cdp.send';
      const loc = fromBabelLoc(node.loc);

      // Case 1: Script has no metadata header block at all
      if (!context.hasMetadata) {
        context.report({
          message: `Missing userscript metadata header. Calling CDP method "${methodDisplay}" requires declaring "// @grant GM_cdp" or "// @cdp ${domain}".`,
          location: loc,
          suggestion: `Add a // ==UserScript== metadata block declaring "// @grant GM_cdp" or "// @cdp ${domain}".`,
          codeSnippet: methodDisplay
        });
        return;
      }

      const grants = context.metadata.grants || [];

      // Case 2: Script explicitly declares @grant none
      if (grants.includes('none')) {
        context.report({
          message: `Permission denied: Script declared "@grant none" which explicitly prohibits all privileged CDP access, but invokes "${methodDisplay}".`,
          location: loc,
          suggestion: `Remove "// @grant none" from the metadata header and declare "// @grant GM_cdp" or "// @cdp ${domain}".`,
          codeSnippet: methodDisplay
        });
        return;
      }

      // Case 3: Script has global CDP grant (@grant GM_cdp, @grant cdp, or @grant *)
      const hasGlobalGrant = grants.includes('GM_cdp') || grants.includes('cdp') || grants.includes('*');
      if (hasGlobalGrant) {
        return; // Global access granted
      }

      // Case 4: Check domain-specific @cdp declarations
      const cdpDomains = context.metadata.cdpDomains || [];
      const isDomainAllowed = cdpDomains.includes(domain) || cdpDomains.includes('*');

      if (!isDomainAllowed) {
        const allowedList = cdpDomains.length > 0 ? `Allowed domains: [${cdpDomains.join(', ')}].` : 'No CDP domains are authorized.';
        context.report({
          message: `Unauthorized CDP domain: Script invokes "${methodDisplay}" in domain "${domain}", but domain is not declared in metadata headers. ${allowedList}`,
          location: loc,
          suggestion: `Add "// @cdp ${domain}" or "// @grant GM_cdp" to the userscript metadata block.`,
          codeSnippet: methodDisplay
        });
      }
    }

    return {
      CallExpression(node: any) {
        inspectCall(node);
      },
      OptionalCallExpression(node: any) {
        inspectCall(node);
      }
    };
  }
};

export const cdpHeaderPermissionRule = cdpHeaderPermission;
export default cdpHeaderPermission;
