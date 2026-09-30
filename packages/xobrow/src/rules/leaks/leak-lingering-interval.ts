/**
 * Rule: leak-lingering-interval
 * Category: resource-leak
 * Severity: error
 *
 * Detects setInterval timers that are never cleared via clearInterval.
 */

import type { RuleDefinition, RuleContext, NodeVisitor, CodeLocation } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { unwrapCall, getStaticPropertyName, isGlobalObject } from '../security/helpers.js';

interface RegisteredInterval {
  id: number;
  node: any;
  location: CodeLocation;
  handleVar: string | null;
  codeSnippet: string;
}

function serializeMember(node: any): string {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const obj = serializeMember(node.object);
    const prop = getStaticPropertyName(node);
    return obj ? `${obj}.${prop ?? ''}` : (prop ?? '');
  }
  if (node.type === 'ThisExpression') return 'this';
  return '';
}

export const leakLingeringInterval: RuleDefinition = {
  id: 'leak-lingering-interval',
  name: 'Detect unclosed intervals',
  category: 'resource-leak',
  defaultSeverity: 'error',
  description:
    'setInterval timers continue indefinitely if their handle is not passed to clearInterval.',

  create(context: RuleContext): NodeVisitor {
    const registeredIntervals: RegisteredInterval[] = [];
    const clearedHandles = new Set<string>();
    let intervalCount = 0;

    function inspectCall(node: any, parent: any, ancestors?: any[]) {
      if (!node) return;
      const { callee, args } = unwrapCall(node);
      if (!callee) return;

      let isSetInterval = false;
      let isClearInterval = false;

      if (callee.type === 'Identifier') {
        if (callee.name === 'setInterval') isSetInterval = true;
        if (callee.name === 'clearInterval') isClearInterval = true;
      } else if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
        const propName = getStaticPropertyName(callee);
        if (propName === 'setInterval' && isGlobalObject(callee.object)) {
          isSetInterval = true;
        }
        if (propName === 'clearInterval' && isGlobalObject(callee.object)) {
          isClearInterval = true;
        }
      }

      // --- Process setInterval ---
      if (isSetInterval) {
        let handleVar: string | null = null;
        let effectiveParent = parent;
        if (effectiveParent?.type === 'SequenceExpression' && ancestors && ancestors.length >= 2) {
          for (let i = ancestors.length - 2; i >= 0; i--) {
            if (ancestors[i].type !== 'SequenceExpression') {
              effectiveParent = ancestors[i];
              break;
            }
          }
        }

        if (effectiveParent) {
          if (effectiveParent.type === 'VariableDeclarator' && effectiveParent.id?.type === 'Identifier') {
            handleVar = effectiveParent.id.name;
          } else if (effectiveParent.type === 'AssignmentExpression') {
            if (effectiveParent.left?.type === 'Identifier') {
              handleVar = effectiveParent.left.name;
            } else if (effectiveParent.left?.type === 'MemberExpression') {
              handleVar = serializeMember(effectiveParent.left);
            }
          }
        }

        registeredIntervals.push({
          id: ++intervalCount,
          node,
          location: fromBabelLoc(node.loc),
          handleVar,
          codeSnippet: context.sourceCode.slice(node.start, node.end)
        });
        return;
      }

      // --- Process clearInterval ---
      if (isClearInterval && args && args.length >= 1) {
        const arg = args[0];
        if (arg.type === 'Identifier') {
          clearedHandles.add(arg.name);
        } else if (arg.type === 'MemberExpression' || arg.type === 'OptionalMemberExpression') {
          const memberStr = serializeMember(arg);
          if (memberStr) clearedHandles.add(memberStr);
        }
      }
    }

    return {
      CallExpression(node: any, parent: any, ancestors: any) {
        inspectCall(node, parent, ancestors);
      },
      OptionalCallExpression(node: any, parent: any, ancestors: any) {
        inspectCall(node, parent, ancestors);
      },

      postCheck() {
        for (const interval of registeredIntervals) {
          if (interval.handleVar === null) {
            context.report({
              location: interval.location,
              message:
                'setInterval() return handle is discarded, making it impossible to invoke clearInterval().',
              suggestion:
                "Store the timer handle ('const timerId = setInterval(...)') and invoke 'clearInterval(timerId)' when finished.",
              codeSnippet: interval.codeSnippet
            });
            continue;
          }

          if (!clearedHandles.has(interval.handleVar)) {
            context.report({
              location: interval.location,
              message: `setInterval() timer handle '${interval.handleVar}' is never cleared with clearInterval().`,
              suggestion: `Invoke 'clearInterval(${interval.handleVar})' when the timer is no longer needed or in a cleanup handler.`,
              codeSnippet: interval.codeSnippet
            });
          }
        }
      }
    };
  }
};

export const leakLingeringIntervalRule = leakLingeringInterval;
export default leakLingeringInterval;
