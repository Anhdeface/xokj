import type { RuleDefinition, RuleContext, NodeVisitor } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { isGlobalObject, getStaticPropertyName, unwrapCall, unwrapSequence } from './helpers.js';

export const secNoNewFunction: RuleDefinition = {
  id: 'sec-no-new-function',
  name: 'Prohibit Function constructor',
  category: 'security',
  defaultSeverity: 'error',
  description: 'new Function(...) compiles arbitrary strings into executable code.',

  create(context: RuleContext): NodeVisitor {
    function reportViolation(node: any) {
      context.report({
        message: 'Dynamic code evaluation via Function constructor is strictly prohibited.',
        location: fromBabelLoc(node.loc),
        suggestion: 'Declare functions statically using standard function declarations, function expressions, or closures instead of dynamic string evaluation.'
      });
    }

    function checkCallee(node: any, callee: any) {
      if (!callee) return;

      // 1. Direct Identifier: Function(...)
      if (callee.type === 'Identifier' && callee.name === 'Function') {
        reportViolation(node);
        return;
      }

      // 2. MemberExpression: window.Function(...), globalThis['Function'](...)
      if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
        const propName = getStaticPropertyName(callee);
        if (propName === 'Function' && isGlobalObject(callee.object)) {
          reportViolation(node);
          return;
        }
      }
    }

    return {
      NewExpression(node) {
        const callee = unwrapSequence(node.callee);
        checkCallee(node, callee);
      },
      CallExpression(node) {
        const { callee } = unwrapCall(node);
        checkCallee(node, callee);
      },
      OptionalCallExpression(node) {
        const { callee } = unwrapCall(node);
        checkCallee(node, callee);
      }
    };
  }
};

export const secNoNewFunctionRule = secNoNewFunction;
export default secNoNewFunction;
