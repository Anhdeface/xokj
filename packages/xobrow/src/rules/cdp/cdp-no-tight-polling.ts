import type { RuleDefinition, RuleContext, NodeVisitor } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { matchCdpCall } from './cdp-helpers.js';

/**
 * Checks if an AST node contains any CDP calls in its subtree.
 */
function containsCdpCall(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if ((node.type === 'CallExpression' || node.type === 'OptionalCallExpression') && matchCdpCall(node)) return true;

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'comments') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (containsCdpCall(item)) return true;
      }
    } else if (child && typeof child === 'object') {
      if (containsCdpCall(child)) return true;
    }
  }
  return false;
}

/**
 * Inspects a loop body for await delay calls with numeric literals.
 */
function findLoopDelay(node: any): number | null {
  if (!node || typeof node !== 'object') return null;

  if (node.type === 'AwaitExpression') {
    const arg = node.argument;
    if (arg?.type === 'CallExpression' || arg?.type === 'OptionalCallExpression') {
      const callee = arg.callee;
      const fnName = callee?.name || callee?.property?.name;
      if (fnName === 'sleep' || fnName === 'delay') {
        const delayArg = arg.arguments?.[0];
        if (delayArg?.type === 'NumericLiteral') {
          return delayArg.value;
        }
      }
    }
  }

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'comments') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const d = findLoopDelay(item);
        if (d !== null) return d;
      }
    } else if (child && typeof child === 'object') {
      const d = findLoopDelay(child);
      if (d !== null) return d;
    }
  }
  return null;
}

export const cdpNoTightPolling: RuleDefinition = {
  id: 'cdp-no-tight-polling',
  name: 'Detect tight CDP polling loops',
  category: 'cdp-integrity',
  defaultSeverity: 'error',
  description: 'Polling CDP methods in tight loops or short timers (< 100ms) without backoff saturates browser IPC.',
  create: (context: RuleContext): NodeVisitor => {
    function checkLoop(node: any) {
      if (containsCdpCall(node.body)) {
        const delayMs = findLoopDelay(node.body);
        if (delayMs !== null && delayMs < 100) {
          context.report({
            message: `Tight CDP polling loop: Loop delay (${delayMs}ms) is below the 100ms minimum threshold with active CDP calls.`,
            location: fromBabelLoc(node.loc),
            suggestion:
              'Increase backoff delay between iterations to at least 500ms (await delay(500)), or replace polling with cdp.on() event subscriptions.'
          });
        }
      }
    }

    function inspectTimerCall(node: any) {
      // Pattern 1: setInterval(fn, ms) / setTimeout(fn, ms)
      const { callee, arguments: args } = node;
      const fnName = callee?.type === 'Identifier' ? callee.name : callee?.property?.name;

      if (fnName === 'setInterval' || fnName === 'setTimeout') {
        const callback = args?.[0];
        const intervalArg = args?.[1];

        if (callback && containsCdpCall(callback)) {
          let interval = 0;
          if (intervalArg?.type === 'NumericLiteral') {
            interval = intervalArg.value;
          } else if (!intervalArg) {
            interval = 0; // default 0ms
          } else {
            return; // Dynamic or identifier interval
          }

          if (interval < 100) {
            context.report({
              message: `Tight CDP polling detected: ${fnName} interval (${interval}ms) is below the 100ms minimum threshold with active CDP calls.`,
              location: fromBabelLoc(intervalArg?.loc || node.loc),
              suggestion:
                'Increase polling interval to at least 500ms, or subscribe to push events with cdp.on() instead of active polling.'
            });
          }
        }
      }
    }

    return {
      CallExpression(node: any) {
        inspectTimerCall(node);
      },
      OptionalCallExpression(node: any) {
        inspectTimerCall(node);
      },

      WhileStatement(node: any) {
        checkLoop(node);
      },
      DoWhileStatement(node: any) {
        checkLoop(node);
      },
      ForStatement(node: any) {
        checkLoop(node);
      }
    };
  }
};

export const cdpNoTightPollingRule = cdpNoTightPolling;
export default cdpNoTightPolling;
