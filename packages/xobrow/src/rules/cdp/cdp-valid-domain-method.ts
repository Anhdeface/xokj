import type { RuleDefinition, RuleContext, NodeVisitor } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { matchCdpCall } from './cdp-helpers.js';
import { validateCdpCommand } from './cdp-catalog.js';

export const cdpValidDomainMethod: RuleDefinition = {
  id: 'cdp-valid-domain-method',
  name: 'Validate CDP domain & method',
  category: 'cdp-integrity',
  defaultSeverity: 'error',
  description: 'Calling non-existent CDP domains or methods results in immediate runtime JSON-RPC failure.',
  create: (context: RuleContext): NodeVisitor => {
    function inspectCall(node: any) {
      const cdpCall = matchCdpCall(node);
      if (!cdpCall || !cdpCall.methodString) {
        return;
      }

      const isEvent = cdpCall.calleeType === 'cdp.on' || cdpCall.calleeType === 'cdp.off';
      const validation = validateCdpCommand(cdpCall.methodString, isEvent ? 'event' : 'method');

      if (!validation.valid) {
        const loc = fromBabelLoc(cdpCall.methodArgNode?.loc || node.loc);
        let message = `Invalid CDP method: "${cdpCall.methodString}".`;

        if (validation.reason === 'UNKNOWN_DOMAIN') {
          message = `Unknown CDP domain "${validation.domain}". Method "${cdpCall.methodString}" is not a valid Chrome DevTools Protocol command.`;
        } else if (validation.reason === 'UNKNOWN_METHOD') {
          message = isEvent
            ? `Unknown CDP event "${validation.method}" on domain "${validation.domain}".`
            : `Unknown CDP method "${validation.method}" on domain "${validation.domain}".`;
        } else if (validation.reason === 'INVALID_FORMAT') {
          message = `Malformed CDP command "${cdpCall.methodString}". CDP commands must follow "Domain.method" format (e.g. "Page.navigate").`;
        }

        context.report({
          message,
          location: loc,
          suggestion:
            validation.suggestion ||
            'Verify method against official Chrome DevTools Protocol documentation (e.g. "Page.navigate", "Network.enable").',
          codeSnippet: cdpCall.methodString
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

export const cdpValidDomainMethodRule = cdpValidDomainMethod;
export default cdpValidDomainMethod;
