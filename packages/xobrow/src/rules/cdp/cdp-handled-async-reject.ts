import type { RuleDefinition, RuleContext, NodeVisitor } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { matchCdpCall } from './cdp-helpers.js';

export const cdpHandledAsyncReject: RuleDefinition = {
  id: 'cdp-handled-async-reject',
  name: 'Check handled CDP rejections',
  category: 'cdp-integrity',
  defaultSeverity: 'warning',
  description: 'Floating unhandled cdp.send promises trigger uncaught rejections when tabs detach or conflicts occur.',
  create: (context: RuleContext): NodeVisitor => {
    function inspectCall(node: any, parent?: any, ancestors: any[] = []) {
      const cdpCall = matchCdpCall(node);
      if (!cdpCall) {
        return;
      }

      // Only check sending methods that return Promises
      if (cdpCall.calleeType !== 'cdp.send' && cdpCall.calleeType !== 'GM_cdp.send' && cdpCall.calleeType !== 'GM_cdp') {
        return;
      }

      // 1. Is the call awaited?
      if (parent?.type === 'AwaitExpression') {
        return;
      }

      // 2. Is .catch() chained? e.g. cdp.send(...).catch(...)
      if (
        (parent?.type === 'MemberExpression' || parent?.type === 'OptionalMemberExpression') &&
        parent.property?.type === 'Identifier'
      ) {
        const prop = parent.property.name;
        if (prop === 'catch') return;
        if (prop === 'then') {
          // Check if 2nd argument (onRejected) is supplied to .then()
          const grandParent = ancestors?.[ancestors.length - 2];
          if (
            (grandParent?.type === 'CallExpression' || grandParent?.type === 'OptionalCallExpression') &&
            grandParent.arguments?.length >= 2
          ) {
            return;
          }
        }
      }

      // 3. Is it returned from a function?
      if (parent?.type === 'ReturnStatement') {
        return;
      }

      // 4. Is it passed into a Promise combinator (Promise.all([cdp.send(...)]) etc.)?
      if (parent?.type === 'ArrayExpression') {
        const grandParent = ancestors?.[ancestors.length - 2];
        if (grandParent?.type === 'CallExpression' || grandParent?.type === 'OptionalCallExpression') {
          return;
        }
      }

      // Floating unhandled promise!
      const loc = fromBabelLoc(node.loc);
      const methodDisplay = cdpCall.methodString || 'cdp.send';

      context.report({
        message: `Unhandled CDP promise: Call to "${methodDisplay}" returns a Promise that is not awaited or caught with .catch().`,
        location: loc,
        suggestion: `Await the call inside try/catch (await cdp.send(...)), or attach an error handler: cdp.send(...).catch(err => console.error(err)).`,
        codeSnippet: methodDisplay
      });
    }

    return {
      CallExpression(node: any, parent?: any, ancestors: any[] = []) {
        inspectCall(node, parent, ancestors);
      },
      OptionalCallExpression(node: any, parent?: any, ancestors: any[] = []) {
        inspectCall(node, parent, ancestors);
      }
    };
  }
};

export const cdpHandledAsyncRejectRule = cdpHandledAsyncReject;
export default cdpHandledAsyncReject;
