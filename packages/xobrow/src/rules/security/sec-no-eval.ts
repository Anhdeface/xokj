import type { RuleDefinition, RuleContext, NodeVisitor } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { isGlobalObject, getStaticPropertyName, unwrapCall } from './helpers.js';

export const secNoEval: RuleDefinition = {
  id: 'sec-no-eval',
  name: 'Prohibit eval()',
  category: 'security',
  defaultSeverity: 'error',
  description: 'Calling eval(), window.eval, or globalThis.eval executes dynamic untrusted code.',

  create(context: RuleContext): NodeVisitor {
    function checkCall(node: any) {
      if (!node || !node.callee) return;

      const { callee, isDispatch } = unwrapCall(node);
      if (!callee) return;

      // 1. Direct or dispatched call to eval (eval(...), eval.call(...), (0, eval)(...))
      if (callee.type === 'Identifier' && callee.name === 'eval') {
        const isIndirectSequence = !isDispatch && node.callee.type === 'SequenceExpression';
        context.report({
          message: isIndirectSequence
            ? 'Indirect call to eval() is strictly prohibited.'
            : 'Direct call to eval() is strictly prohibited.',
          location: fromBabelLoc(callee.loc ?? node.loc),
          suggestion: 'Refactor dynamic code evaluation using JSON.parse(), static functions, or an object lookup dictionary.'
        });
        return;
      }

      // 2. Member call: window.eval(...), globalThis['eval'](...), window.eval.call(...)
      if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
        const propName = getStaticPropertyName(callee);
        if (propName === 'eval' && isGlobalObject(callee.object)) {
          context.report({
            message: 'Indirect call to eval() is strictly prohibited.',
            location: fromBabelLoc(callee.loc ?? node.loc),
            suggestion: 'Refactor dynamic code evaluation using JSON.parse(), static functions, or an object lookup dictionary.'
          });
          return;
        }
      }
    }

    return {
      CallExpression(node) {
        checkCall(node);
      },
      OptionalCallExpression(node) {
        checkCall(node);
      }
    };
  }
};

export const secNoEvalRule = secNoEval;
export default secNoEval;
