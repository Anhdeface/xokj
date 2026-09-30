/**
 * Rule: leak-uncleaned-event-listener
 * Category: resource-leak
 * Severity: error
 *
 * Detects addEventListener calls without matching removeEventListener,
 * { once: true } option, or AbortSignal binding.
 */

import type { RuleDefinition, RuleContext, NodeVisitor, CodeLocation } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { unwrapCall, getStaticPropertyName, tryEvaluateStaticBoolean } from '../security/helpers.js';

interface RegisteredListener {
  id: number;
  node: any;
  location: CodeLocation;
  targetStr: string;
  eventType: string;
  handlerStr: string | null;
  isAnonymous: boolean;
  codeSnippet: string;
}

interface CleanupCall {
  targetStr: string;
  eventType: string;
  handlerStr: string;
}

function serializeTarget(node: any): string {
  if (!node) return '';
  switch (node.type) {
    case 'Identifier':
      return node.name;
    case 'MemberExpression':
    case 'OptionalMemberExpression': {
      const obj = serializeTarget(node.object);
      const prop = getStaticPropertyName(node);
      return obj ? `${obj}.${prop ?? ''}` : (prop ?? '');
    }
    case 'ThisExpression':
      return 'this';
    default:
      return '';
  }
}

function normalizeTarget(target: string): string {
  if (!target || target === 'window' || target === 'globalThis' || target === 'self') {
    return 'window';
  }
  return target;
}

export const leakUncleanedEventListener: RuleDefinition = {
  id: 'leak-uncleaned-event-listener',
  name: 'Detect uncleaned event listeners',
  category: 'resource-leak',
  defaultSeverity: 'error',
  description:
    'Adding event listeners without { once: true }, AbortSignal, or matching removeEventListener leaks memory across navigations.',

  create(context: RuleContext): NodeVisitor {
    const registeredListeners: RegisteredListener[] = [];
    const cleanupCalls: CleanupCall[] = [];
    let listenerCount = 0;

    function inspectCall(node: any) {
      if (!node) return;
      const { callee, args, thisArg } = unwrapCall(node);
      if (!callee) return;

      let isAddListener = false;
      let isRemoveListener = false;
      let targetStr = 'window';

      if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
        const propName = getStaticPropertyName(callee);
        if (propName === 'addEventListener') {
          isAddListener = true;
          targetStr = (thisArg ? serializeTarget(thisArg) : serializeTarget(callee.object)) || 'window';
        } else if (propName === 'removeEventListener') {
          isRemoveListener = true;
          targetStr = (thisArg ? serializeTarget(thisArg) : serializeTarget(callee.object)) || 'window';
        }
      } else if (callee.type === 'Identifier') {
        if (callee.name === 'addEventListener') {
          isAddListener = true;
          targetStr = (thisArg ? serializeTarget(thisArg) : '') || 'window';
        } else if (callee.name === 'removeEventListener') {
          isRemoveListener = true;
          targetStr = (thisArg ? serializeTarget(thisArg) : '') || 'window';
        }
      }

      // --- Process addEventListener ---
      if (isAddListener && args && args.length >= 2) {
        const eventArg = args[0];
        const handlerArg = args[1];
        const optionsArg = args[2];

        // 1. Check if exempt via options ({ once: true / !0 } or { signal: ... })
        if (optionsArg && optionsArg.type === 'ObjectExpression') {
          for (const prop of optionsArg.properties) {
            if (prop.type === 'ObjectProperty') {
              const keyName = prop.key?.name ?? prop.key?.value;
              if (keyName === 'once') {
                const val = tryEvaluateStaticBoolean(prop.value);
                if (val === true) {
                  return; // Self-cleaning: EXEMPT
                }
              }
              if (keyName === 'signal') {
                return; // Bound to AbortSignal: EXEMPT
              }
            }
          }
        }

        // 2. Extract event type string
        let eventType = '';
        if (eventArg.type === 'StringLiteral') {
          eventType = eventArg.value;
        } else if (eventArg.type === 'Identifier') {
          eventType = eventArg.name;
        } else {
          eventType = context.sourceCode.slice(eventArg.start, eventArg.end);
        }

        // 3. Inspect handler
        let isAnonymous = false;
        let handlerStr: string | null = null;
        if (
          handlerArg.type === 'ArrowFunctionExpression' ||
          handlerArg.type === 'FunctionExpression'
        ) {
          isAnonymous = true;
          handlerStr = null;
        } else if (handlerArg.type === 'Identifier') {
          handlerStr = handlerArg.name;
        } else if (handlerArg.type === 'MemberExpression' || handlerArg.type === 'OptionalMemberExpression') {
          handlerStr = serializeTarget(handlerArg);
        }

        registeredListeners.push({
          id: ++listenerCount,
          node,
          location: fromBabelLoc(node.loc),
          targetStr: normalizeTarget(targetStr),
          eventType,
          handlerStr,
          isAnonymous,
          codeSnippet: context.sourceCode.slice(node.start, node.end)
        });
        return;
      }

      // --- Process removeEventListener ---
      if (isRemoveListener && args && args.length >= 2) {
        const eventArg = args[0];
        const handlerArg = args[1];

        let eventType = '';
        if (eventArg.type === 'StringLiteral') {
          eventType = eventArg.value;
        } else if (eventArg.type === 'Identifier') {
          eventType = eventArg.name;
        } else {
          eventType = context.sourceCode.slice(eventArg.start, eventArg.end);
        }

        let handlerStr = '';
        if (handlerArg.type === 'Identifier') {
          handlerStr = handlerArg.name;
        } else if (handlerArg.type === 'MemberExpression' || handlerArg.type === 'OptionalMemberExpression') {
          handlerStr = serializeTarget(handlerArg);
        }

        if (eventType && handlerStr) {
          cleanupCalls.push({
            targetStr: normalizeTarget(targetStr),
            eventType,
            handlerStr
          });
        }
      }
    }

    return {
      CallExpression(node: any) {
        inspectCall(node);
      },
      OptionalCallExpression(node: any) {
        inspectCall(node);
      },

      postCheck() {
        for (const listener of registeredListeners) {
          if (listener.isAnonymous) {
            context.report({
              location: listener.location,
              message: `Event listener for '${listener.eventType}' uses an anonymous inline function without '{ once: true }' or 'signal', preventing cleanup.`,
              suggestion: `Pass '{ once: true }' in options, bind an 'AbortSignal' via '{ signal }', or use a named handler function with removeEventListener().`,
              codeSnippet: listener.codeSnippet
            });
            continue;
          }

          const isCleaned = cleanupCalls.some((cleanup) => {
            if (cleanup.eventType !== listener.eventType || cleanup.handlerStr !== listener.handlerStr) {
              return false;
            }
            // Require exact target equality to avoid masking element leaks with window cleanup
            return cleanup.targetStr === listener.targetStr;
          });

          if (!isCleaned) {
            const prefix = listener.targetStr && listener.targetStr !== 'window' ? `${listener.targetStr}.` : '';
            context.report({
              location: listener.location,
              message: `Event listener '${listener.eventType}' registered on '${listener.targetStr}' is never cleaned up with removeEventListener().`,
              suggestion: `Invoke '${prefix}removeEventListener('${listener.eventType}', ${listener.handlerStr})' during teardown, or pass '{ once: true }'.`,
              codeSnippet: listener.codeSnippet
            });
          }
        }
      }
    };
  }
};

export const leakUncleanedEventListenerRule = leakUncleanedEventListener;
export default leakUncleanedEventListener;
