import type { RuleDefinition, RuleContext, NodeVisitor } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { isGlobalObject, getStaticPropertyName, unwrapCall } from './helpers.js';

const TIMER_FUNCTION_NAMES = new Set(['setTimeout', 'setInterval', 'setImmediate']);

function isStringLikeExpression(node: any): boolean {
  if (!node) return false;
  if (node.type === 'StringLiteral' || node.type === 'TemplateLiteral' || node.type === 'TaggedTemplateExpression') {
    return true;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return isStringLikeExpression(node.left) || isStringLikeExpression(node.right);
  }
  if (node.type === 'ConditionalExpression') {
    return isStringLikeExpression(node.consequent) || isStringLikeExpression(node.alternate);
  }
  if (node.type === 'SequenceExpression' && node.expressions?.length > 0) {
    return isStringLikeExpression(node.expressions[node.expressions.length - 1]);
  }
  return false;
}

export const secNoStringTimers: RuleDefinition = {
  id: 'sec-no-string-timers',
  name: 'Prohibit string-based timers',
  category: 'security',
  defaultSeverity: 'error',
  description: 'Passing a string as timer callback triggers implicit eval evaluation.',

  create(context: RuleContext): NodeVisitor {
    function inspectTimerCall(node: any) {
      if (!node) return;

      const { callee, args } = unwrapCall(node);
      if (!callee || !args || args.length === 0) return;

      let timerName: string | null = null;

      // Direct: setTimeout("...", 100) or .call/.apply/SequenceExpression
      if (callee.type === 'Identifier' && TIMER_FUNCTION_NAMES.has(callee.name)) {
        timerName = callee.name;
      } else if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
        const propName = getStaticPropertyName(callee);
        if (propName && TIMER_FUNCTION_NAMES.has(propName) && isGlobalObject(callee.object)) {
          timerName = propName;
        }
      }

      if (!timerName) {
        return;
      }

      const firstArg = args[0];
      if (isStringLikeExpression(firstArg)) {
        context.report({
          message: `Passing a string to ${timerName}() triggers implicit eval and is prohibited.`,
          location: fromBabelLoc(firstArg.loc ?? node.loc),
          suggestion: 'Pass a callback function (() => { ... }) instead of a string to avoid dynamic code evaluation.'
        });
      }
    }

    return {
      CallExpression(node) {
        inspectTimerCall(node);
      },
      OptionalCallExpression(node) {
        inspectTimerCall(node);
      }
    };
  }
};

export const secNoStringTimersRule = secNoStringTimers;
export default secNoStringTimers;
