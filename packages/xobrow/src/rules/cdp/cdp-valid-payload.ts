import type { RuleDefinition, RuleContext, NodeVisitor } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { matchCdpCall } from './cdp-helpers.js';

export const cdpValidPayload: RuleDefinition = {
  id: 'cdp-valid-payload',
  name: 'Validate CDP parameters payload',
  category: 'cdp-integrity',
  defaultSeverity: 'error',
  description: 'CDP method parameters must be an object dictionary. Passing primitives or arrays triggers schema rejection.',
  create: (context: RuleContext): NodeVisitor => {
    function inspectCall(node: any) {
      const cdpCall = matchCdpCall(node);
      if (!cdpCall || !cdpCall.paramsArgNode) {
        // If no parameters argument was provided, that is valid for zero-arg methods
        return;
      }

      const params = cdpCall.paramsArgNode;
      let invalidType: string | null = null;

      if (params.type === 'StringLiteral') {
        invalidType = 'string';
      } else if (params.type === 'NumericLiteral') {
        invalidType = 'number';
      } else if (params.type === 'BooleanLiteral') {
        invalidType = 'boolean';
      } else if (params.type === 'ArrayExpression') {
        invalidType = 'array';
      } else if (params.type === 'NullLiteral') {
        invalidType = 'null';
      }

      if (invalidType) {
        const loc = fromBabelLoc(params.loc || node.loc);
        const methodDisplay = cdpCall.methodString || 'cdp.send';

        context.report({
          message: `Invalid CDP parameters payload: Method "${methodDisplay}" expected an object dictionary, but received ${invalidType}.`,
          location: loc,
          suggestion: `Pass parameters as an object dictionary: cdp.send("${methodDisplay}", { ... }) or omit the argument if no parameters are required.`,
          codeSnippet: invalidType
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

export const cdpValidPayloadRule = cdpValidPayload;
export default cdpValidPayload;
