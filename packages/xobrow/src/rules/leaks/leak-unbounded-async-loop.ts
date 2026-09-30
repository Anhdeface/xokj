/**
 * Rule: leak-unbounded-async-loop
 * Category: resource-leak
 * Severity: error
 *
 * Detects unbounded async loops (while(true), for(;;)) containing CDP calls
 * that lack throttling delay (sleep/delay) or exit condition (break/return).
 */

import type { RuleDefinition, RuleContext, NodeVisitor } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { unwrapCall, getStaticPropertyName, tryEvaluateStaticBoolean } from '../security/helpers.js';

interface LoopInspection {
  hasCdpCall: boolean;
  hasExitCondition: boolean;
  hasThrottling: boolean;
}

function isCdpCall(node: any): boolean {
  if (!node || (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression')) return false;
  const { callee } = unwrapCall(node);
  if (!callee) return false;

  if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
    const propName = getStaticPropertyName(callee);
    const obj = callee.object;
    if (propName === 'send' && obj?.type === 'Identifier' && (obj.name === 'cdp' || obj.name === 'GM_cdp')) {
      return true;
    }
    if (
      propName === 'sendCommand' &&
      obj?.type === 'MemberExpression' &&
      obj.object?.type === 'Identifier' &&
      obj.object.name === 'chrome' &&
      getStaticPropertyName(obj) === 'debugger'
    ) {
      return true;
    }
  }
  if (callee.type === 'Identifier' && callee.name === 'GM_cdp') {
    return true;
  }
  return false;
}

function isThrottlingCall(callNode: any): boolean {
  if (!callNode || (callNode.type !== 'CallExpression' && callNode.type !== 'OptionalCallExpression')) return false;
  const { callee } = unwrapCall(callNode);
  if (!callee) return false;

  if (callee.type === 'Identifier') {
    return /^(sleep|delay|wait|waitFor|backoff)$/i.test(callee.name);
  }
  if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
    const propName = getStaticPropertyName(callee);
    return /^(sleep|delay|wait|waitFor|backoff)$/i.test(propName || '');
  }
  return false;
}

function getLoopLabels(ancestors?: any[]): Set<string> {
  const labels = new Set<string>();
  if (!ancestors || ancestors.length === 0) return labels;

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const anc = ancestors[i];
    if (anc.type === 'LabeledStatement') {
      if (anc.label?.name) {
        labels.add(anc.label.name);
      }
    } else {
      break;
    }
  }
  return labels;
}

function inspectLoopBody(bodyNode: any, loopLabels: Set<string>): LoopInspection {
  const result: LoopInspection = {
    hasCdpCall: false,
    hasExitCondition: false,
    hasThrottling: false
  };

  function walk(node: any, inNestedLoop: boolean, inSwitch: boolean): void {
    if (!node || typeof node !== 'object') return;

    // Check for CDP calls
    if (isCdpCall(node)) {
      result.hasCdpCall = true;
    }

    // Check for exit condition (break/return) belonging to this loop
    if (node.type === 'ReturnStatement') {
      result.hasExitCondition = true;
    } else if (node.type === 'BreakStatement') {
      if (node.label?.name && loopLabels.has(node.label.name)) {
        // Labeled break specifically targeting this loop breaks it, even inside switch/nested loop
        result.hasExitCondition = true;
      } else if (!node.label && !inSwitch && !inNestedLoop) {
        result.hasExitCondition = true;
      }
    }

    // Check for throttling delay (await sleep(...) or await delay(...))
    if (node.type === 'AwaitExpression') {
      if (node.argument && isThrottlingCall(node.argument)) {
        result.hasThrottling = true;
      } else if (node.argument?.type === 'NewExpression' && node.argument.callee?.name === 'Promise') {
        result.hasThrottling = true;
      }
    }

    // Recurse children with scoping flags
    const isNewLoop = ['WhileStatement', 'DoWhileStatement', 'ForStatement', 'ForOfStatement', 'ForInStatement'].includes(node.type);
    const nextInNestedLoop = inNestedLoop || (node !== bodyNode && isNewLoop);
    const nextInSwitch = inSwitch || node.type === 'SwitchStatement';

    // Do not recurse into independent function bodies inside the loop
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      return;
    }

    for (const key of Object.keys(node)) {
      if (['loc', 'start', 'end', 'range', 'comments', 'tokens', 'extra'].includes(key)) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object') walk(item, nextInNestedLoop, nextInSwitch);
        }
      } else if (child && typeof child === 'object') {
        walk(child, nextInNestedLoop, nextInSwitch);
      }
    }
  }

  walk(bodyNode, false, false);
  return result;
}

function isStaticallyUnbounded(testNode: any): boolean {
  if (!testNode) return true; // e.g. for (;;)
  const evaluated = tryEvaluateStaticBoolean(testNode);
  return evaluated === true;
}

export const leakUnboundedAsyncLoop: RuleDefinition = {
  id: 'leak-unbounded-async-loop',
  name: 'Detect unbounded async loops',
  category: 'resource-leak',
  defaultSeverity: 'error',
  description:
    'while(true) loops invoking CDP commands without sleep delays or break conditions flood protocol channels.',

  create(context: RuleContext): NodeVisitor {
    function checkLoop(loopNode: any, testNode: any, bodyNode: any, ancestors?: any[]): void {
      const unbounded = isStaticallyUnbounded(testNode);
      const loopLabels = getLoopLabels(ancestors);
      const inspection = inspectLoopBody(bodyNode, loopLabels);

      // Only evaluate loops that invoke CDP commands
      if (!inspection.hasCdpCall) {
        return;
      }

      const location = fromBabelLoc(loopNode.loc);
      const codeSnippet = context.sourceCode.slice(loopNode.start, bodyNode?.start ?? loopNode.end);

      // Case 1: Statically unbounded (while(true)) lacking both exit and throttling
      if (unbounded && !inspection.hasExitCondition && !inspection.hasThrottling) {
        context.report({
          location,
          message:
            'Unbounded async loop containing CDP calls lacks both an exit condition (break or return) and throttling delay.',
          suggestion:
            "Add a termination condition (e.g. 'if (done) break;') and a throttling delay (e.g. 'await delay(500);') to avoid flooding the CDP IPC channel.",
          codeSnippet
        });
        return;
      }

      // Case 2: Statically unbounded lacking exit condition
      if (unbounded && !inspection.hasExitCondition) {
        context.report({
          location,
          message: 'Infinite loop containing CDP calls lacks an exit condition (break or return).',
          suggestion:
            "Add an exit condition (e.g. 'if (condition) break;') to allow the loop to terminate.",
          codeSnippet
        });
        return;
      }

      // Case 3: Loop containing CDP calls lacking throttling delay
      if (!inspection.hasThrottling) {
        context.report({
          location,
          message: 'Async loop invoking CDP commands lacks a throttling backoff delay.',
          suggestion:
            "Add a delay between iterations (e.g. 'await delay(500);' or 'await sleep(1000);') to prevent saturating browser IPC.",
          codeSnippet
        });
      }
    }

    return {
      WhileStatement(node: any, parent: any, ancestors: any) {
        checkLoop(node, node.test, node.body, ancestors);
      },
      DoWhileStatement(node: any, parent: any, ancestors: any) {
        checkLoop(node, node.test, node.body, ancestors);
      },
      ForStatement(node: any, parent: any, ancestors: any) {
        checkLoop(node, node.test, node.body, ancestors);
      }
    };
  }
};

export const leakUnboundedAsyncLoopRule = leakUnboundedAsyncLoop;
export default leakUnboundedAsyncLoop;
