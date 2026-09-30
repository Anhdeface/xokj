/**
 * Shared AST matching helper for Chrome DevTools Protocol calls.
 */

import { unwrapCall, getStaticPropertyName } from '../security/helpers.js';

export interface MatchedCdpCall {
  callNode: any;
  calleeType: 'cdp.send' | 'GM_cdp.send' | 'GM_cdp' | 'cdp.on' | 'cdp.off' | 'chrome.debugger.sendCommand';
  methodArgNode?: any;
  methodString?: string;
  domain?: string;
  method?: string;
  paramsArgNode?: any;
}

/**
 * Extracts method string from a string literal or pure template literal.
 */
export function extractStringValue(node: any): string | undefined {
  if (!node) return undefined;
  if (node.type === 'StringLiteral') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral' && node.expressions?.length === 0 && node.quasis?.length === 1) {
    return node.quasis[0].value.raw;
  }
  return undefined;
}

/**
 * Determines whether an AST CallExpression node represents an invocation of a CDP API.
 * Supports SequenceExpressions, computed bracket properties (cdp['send']), and .call/.apply dispatches.
 */
export function matchCdpCall(node: any): MatchedCdpCall | null {
  if (!node || (node.type !== 'CallExpression' && node.type !== 'OptionalCallExpression') || !node.callee) {
    return null;
  }

  const { callee, args } = unwrapCall(node);
  if (!callee) return null;

  // Pattern 1: cdp.send(...), cdp.on(...), cdp.off(...), GM_cdp.send(...)
  if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
    const propName = getStaticPropertyName(callee);
    const obj = callee.object;

    if (obj?.type === 'Identifier') {
      if (obj.name === 'cdp') {
        if (propName === 'send') {
          const methodString = extractStringValue(args?.[0]);
          return {
            callNode: node,
            calleeType: 'cdp.send',
            methodArgNode: args?.[0],
            methodString,
            domain: methodString?.split('.')[0],
            method: methodString?.split('.')[1],
            paramsArgNode: args?.[1]
          };
        }
        if (propName === 'on') {
          const methodString = extractStringValue(args?.[0]);
          return {
            callNode: node,
            calleeType: 'cdp.on',
            methodArgNode: args?.[0],
            methodString,
            domain: methodString?.split('.')[0],
            method: methodString?.split('.')[1],
            paramsArgNode: args?.[1]
          };
        }
        if (propName === 'off') {
          const methodString = extractStringValue(args?.[0]);
          return {
            callNode: node,
            calleeType: 'cdp.off',
            methodArgNode: args?.[0],
            methodString,
            domain: methodString?.split('.')[0],
            method: methodString?.split('.')[1],
            paramsArgNode: args?.[1]
          };
        }
      }

      if (obj.name === 'GM_cdp') {
        if (propName === 'send') {
          const methodString = extractStringValue(args?.[0]);
          return {
            callNode: node,
            calleeType: 'GM_cdp.send',
            methodArgNode: args?.[0],
            methodString,
            domain: methodString?.split('.')[0],
            method: methodString?.split('.')[1],
            paramsArgNode: args?.[1]
          };
        }
      }
    }

    // Pattern 2: chrome.debugger.sendCommand(target, 'Domain.method', params)
    if (
      (obj?.type === 'MemberExpression' || obj?.type === 'OptionalMemberExpression') &&
      obj.object?.type === 'Identifier' &&
      obj.object.name === 'chrome' &&
      getStaticPropertyName(obj) === 'debugger' &&
      propName === 'sendCommand'
    ) {
      const methodString = extractStringValue(args?.[1]);
      return {
        callNode: node,
        calleeType: 'chrome.debugger.sendCommand',
        methodArgNode: args?.[1],
        methodString,
        domain: methodString?.split('.')[0],
        method: methodString?.split('.')[1],
        paramsArgNode: args?.[2]
      };
    }
  }

  // Pattern 3: Direct function call GM_cdp('Domain.method', params)
  if (callee.type === 'Identifier' && callee.name === 'GM_cdp') {
    const methodString = extractStringValue(args?.[0]);
    return {
      callNode: node,
      calleeType: 'GM_cdp',
      methodArgNode: args?.[0],
      methodString,
      domain: methodString?.split('.')[0],
      method: methodString?.split('.')[1],
      paramsArgNode: args?.[1]
    };
  }

  return null;
}
