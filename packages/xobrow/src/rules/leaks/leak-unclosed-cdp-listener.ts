/**
 * Rule: leak-unclosed-cdp-listener
 * Category: resource-leak
 * Severity: error
 *
 * Detects CDP event subscriptions (cdp.on / GM_cdp.on) that are not properly
 * unsubscribed via unbind() callback or cdp.off().
 */

import type { RuleDefinition, RuleContext, NodeVisitor, CodeLocation } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { unwrapCall, getStaticPropertyName } from '../security/helpers.js';

interface CdpSubscription {
  id: number;
  node: any;
  location: CodeLocation;
  eventName: string;
  handlerStr: string | null;
  isAnonymous: boolean;
  unbindVar: string | null;
  codeSnippet: string;
}

interface CdpOffCall {
  eventName: string;
  handlerStr: string;
}

function serializeTarget(node: any): string {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const obj = serializeTarget(node.object);
    const prop = getStaticPropertyName(node);
    return obj ? `${obj}.${prop ?? ''}` : (prop ?? '');
  }
  if (node.type === 'ThisExpression') return 'this';
  return '';
}

function isCdpObject(node: any): boolean {
  if (!node) return false;
  if (node.type === 'Identifier' && (node.name === 'cdp' || node.name === 'GM_cdp')) {
    return true;
  }
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    return serializeTarget(node) === 'xokj.cdp';
  }
  return false;
}

export const leakUnclosedCdpListener: RuleDefinition = {
  id: 'leak-unclosed-cdp-listener',
  name: 'Detect unclosed CDP listeners',
  category: 'resource-leak',
  defaultSeverity: 'error',
  description:
    'CDP event subscriptions (cdp.on / GM_cdp.on) leak channels if not unsubscribed via unbind() or cdp.off().',

  create(context: RuleContext): NodeVisitor {
    const subscriptions: CdpSubscription[] = [];
    const offCalls: CdpOffCall[] = [];
    const calledFunctions = new Set<string>();
    let subscriptionCount = 0;

    function inspectCall(node: any, parent: any, ancestors?: any[]) {
      if (!node) return;

      // 1. Check if callee is an invocation of an unbind function (e.g. unbind(), unbind.call(null), this.unbind())
      const { callee, args } = unwrapCall(node);
      if (callee) {
        if (callee.type === 'Identifier') {
          calledFunctions.add(callee.name);
        } else if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
          const mem = serializeTarget(callee);
          if (mem) calledFunctions.add(mem);
        }
      }
      if (node.callee) {
        if (node.callee.type === 'Identifier') {
          calledFunctions.add(node.callee.name);
        } else if (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression') {
          const mem = serializeTarget(node.callee);
          if (mem) calledFunctions.add(mem);
        }
      }

      if (!callee) return;

      // 2. Check for cdp.on / GM_cdp.on / cdp["on"]
      if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
        const propName = getStaticPropertyName(callee);
        if (propName === 'on' && isCdpObject(callee.object)) {
          const eventArg = args?.[0];
          const handlerArg = args?.[1];

          let eventName = '';
          if (eventArg?.type === 'StringLiteral') {
            eventName = eventArg.value;
          } else if (eventArg) {
            eventName = context.sourceCode.slice(eventArg.start, eventArg.end);
          }

          let isAnonymous = false;
          let handlerStr: string | null = null;
          if (
            handlerArg?.type === 'ArrowFunctionExpression' ||
            handlerArg?.type === 'FunctionExpression'
          ) {
            isAnonymous = true;
          } else if (handlerArg?.type === 'Identifier') {
            handlerStr = handlerArg.name;
          } else if (handlerArg) {
            handlerStr = serializeTarget(handlerArg);
          }

          let unbindVar: string | null = null;
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
              unbindVar = effectiveParent.id.name;
            } else if (effectiveParent.type === 'AssignmentExpression') {
              if (effectiveParent.left?.type === 'Identifier') {
                unbindVar = effectiveParent.left.name;
              } else if (effectiveParent.left?.type === 'MemberExpression') {
                unbindVar = serializeTarget(effectiveParent.left);
              }
            }
          }

          subscriptions.push({
            id: ++subscriptionCount,
            node,
            location: fromBabelLoc(node.loc),
            eventName,
            handlerStr,
            isAnonymous,
            unbindVar,
            codeSnippet: context.sourceCode.slice(node.start, node.end)
          });
          return;
        }

        // 3. Check for cdp.off / GM_cdp.off / cdp["off"]
        if (propName === 'off' && isCdpObject(callee.object)) {
          const eventArg = args?.[0];
          const handlerArg = args?.[1];

          let eventName = '';
          if (eventArg?.type === 'StringLiteral') {
            eventName = eventArg.value;
          } else if (eventArg) {
            eventName = context.sourceCode.slice(eventArg.start, eventArg.end);
          }

          let handlerStr = '';
          if (handlerArg?.type === 'Identifier') {
            handlerStr = handlerArg.name;
          } else if (handlerArg) {
            handlerStr = serializeTarget(handlerArg);
          }

          if (eventName && handlerStr) {
            offCalls.push({ eventName, handlerStr });
          }
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
        for (const sub of subscriptions) {
          const isUnbindInvoked = sub.unbindVar !== null && calledFunctions.has(sub.unbindVar);
          const isOffInvoked =
            sub.handlerStr !== null &&
            offCalls.some((off) => off.eventName === sub.eventName && off.handlerStr === sub.handlerStr);

          if (isUnbindInvoked || isOffInvoked) {
            continue; // Safely unsubscribed!
          }

          if (sub.isAnonymous && sub.unbindVar === null) {
            context.report({
              location: sub.location,
              message: `CDP event listener for '${sub.eventName}' uses an anonymous function without capturing the unbind callback, preventing unsubscription.`,
              suggestion: `Capture the unbind callback ('const unbind = cdp.on(...)') and invoke 'unbind()', or use a named handler with 'cdp.off(...)'.`,
              codeSnippet: sub.codeSnippet
            });
          } else if (sub.unbindVar !== null && !isUnbindInvoked) {
            context.report({
              location: sub.location,
              message: `CDP event unbind callback '${sub.unbindVar}' for '${sub.eventName}' is never invoked.`,
              suggestion: `Invoke '${sub.unbindVar}()' in a teardown function or on page unload to release the event channel.`,
              codeSnippet: sub.codeSnippet
            });
          } else {
            context.report({
              location: sub.location,
              message: `CDP event listener for '${sub.eventName}' is never unsubscribed via unbind() or cdp.off().`,
              suggestion: `Call 'cdp.off('${sub.eventName}', ${sub.handlerStr})' or capture and call the unbind function returned by 'cdp.on(...)'.`,
              codeSnippet: sub.codeSnippet
            });
          }
        }
      }
    };
  }
};

export const leakUnclosedCdpListenerRule = leakUnclosedCdpListener;
export default leakUnclosedCdpListener;
