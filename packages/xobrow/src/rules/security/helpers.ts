/**
 * Shared AST helpers for security and leak rules
 */

export const GLOBAL_OBJECT_NAMES = new Set([
  'window',
  'globalThis',
  'self',
  'top',
  'parent',
  'global'
]);

/**
 * Extracts a static property name from a MemberExpression (both dot-notation and string literal indexing).
 */
export function getStaticPropertyName(node: any): string | null {
  if (!node || (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression')) {
    return null;
  }
  if (!node.computed && node.property?.type === 'Identifier') {
    return node.property.name;
  }
  if (node.computed && node.property) {
    if (node.property.type === 'StringLiteral') {
      return node.property.value;
    }
    if (node.property.type === 'TemplateLiteral' && node.property.quasis && node.property.quasis.length === 1) {
      return node.property.quasis[0].value.cooked ?? node.property.quasis[0].value.raw;
    }
  }
  return null;
}

/**
 * Checks if a node represents a global object reference (window, globalThis, self, etc.)
 * Supports chained globals such as window.window or window.top.
 */
export function isGlobalObject(node: any): boolean {
  if (!node) return false;
  if (node.type === 'Identifier' && GLOBAL_OBJECT_NAMES.has(node.name)) {
    return true;
  }
  if (node.type === 'ThisExpression') {
    return true;
  }
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const prop = getStaticPropertyName(node);
    if (prop && GLOBAL_OBJECT_NAMES.has(prop) && isGlobalObject(node.object)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a node represents a reference to `document` or `window.document` / `globalThis.document`.
 */
export function isDocumentObject(node: any): boolean {
  if (!node) return false;
  if (node.type === 'Identifier' && node.name === 'document') {
    return true;
  }
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const prop = getStaticPropertyName(node);
    if (prop === 'document' && isGlobalObject(node.object)) {
      return true;
    }
  }
  return false;
}

/**
 * Unwraps nested SequenceExpression nodes, returning the final expression.
 */
export function unwrapSequence(node: any): any {
  let curr = node;
  while (curr && curr.type === 'SequenceExpression' && curr.expressions?.length > 0) {
    curr = curr.expressions[curr.expressions.length - 1];
  }
  return curr;
}

export interface UnwrappedCall {
  /** The effective target callee (e.g. `eval`, `window.eval`, `document.write`, `cdp.send`) */
  callee: any;
  /** The effective arguments passed to the function (accounting for .call/.apply shift) */
  args: any[];
  /** Whether the call was dispatched via .call or .apply */
  isDispatch: boolean;
  /** 'call' | 'apply' | null */
  dispatchType: 'call' | 'apply' | null;
  /** The thisArg node if dispatched via .call/.apply */
  thisArg?: any;
}

/**
 * Normalizes a CallExpression by unwrapping SequenceExpressions and .call/.apply member dispatches.
 */
export function unwrapCall(node: any): UnwrappedCall {
  let callee = unwrapSequence(node?.callee);
  let args = node?.arguments ? [...node.arguments] : [];
  let isDispatch = false;
  let dispatchType: 'call' | 'apply' | null = null;
  let thisArg: any = undefined;

  while (callee && (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression')) {
    const propName = getStaticPropertyName(callee);
    if (propName === 'call' || propName === 'apply') {
      isDispatch = true;
      dispatchType = propName;
      thisArg = args[0];
      if (propName === 'call') {
        args = args.slice(1);
      } else if (propName === 'apply') {
        if (args[1]?.type === 'ArrayExpression') {
          args = args[1].elements.filter(Boolean);
        } else {
          args = args.slice(1);
        }
      }
      callee = unwrapSequence(callee.object);
    } else {
      break;
    }
  }

  return {
    callee,
    args,
    isDispatch,
    dispatchType,
    thisArg
  };
}

/**
 * Attempts to statically evaluate a string from literals and binary additions (+).
 */
export function tryEvaluateStaticString(node: any): string | null {
  if (!node) return null;
  if (node.type === 'StringLiteral') {
    return node.value;
  }
  if (node.type === 'TemplateLiteral' && node.expressions?.length === 0 && node.quasis?.length === 1) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = tryEvaluateStaticString(node.left);
    const right = tryEvaluateStaticString(node.right);
    if (left !== null && right !== null) {
      return left + right;
    }
  }
  return null;
}

/**
 * Attempts to statically evaluate a boolean from literals, unaries, and simple binary expressions.
 */
export function tryEvaluateStaticBoolean(node: any): boolean | null {
  if (!node) return null;
  if (node.type === 'BooleanLiteral') return node.value;
  if (node.type === 'NumericLiteral') return node.value !== 0;
  if (node.type === 'StringLiteral') return node.value !== '';
  if (node.type === 'NullLiteral') return false;
  if (node.type === 'Identifier') {
    if (node.name === 'undefined' || node.name === 'NaN') return false;
    if (node.name === 'Infinity') return true;
  }
  if (node.type === 'UnaryExpression') {
    if (node.operator === '!') {
      const val = tryEvaluateStaticBoolean(node.argument);
      return val !== null ? !val : null;
    }
    if (node.operator === '+') {
      if (node.argument?.type === 'NumericLiteral') return node.argument.value !== 0;
    }
    if (node.operator === '-') {
      if (node.argument?.type === 'NumericLiteral') return -node.argument.value !== 0;
    }
  }
  if (node.type === 'BinaryExpression') {
    if (node.left?.type === 'NumericLiteral' && node.right?.type === 'NumericLiteral') {
      if (node.operator === '===' || node.operator === '==') return node.left.value === node.right.value;
      if (node.operator === '!==' || node.operator === '!=') return node.left.value !== node.right.value;
    }
    if (node.left?.type === 'StringLiteral' && node.right?.type === 'StringLiteral') {
      if (node.operator === '===' || node.operator === '==') return node.left.value === node.right.value;
      if (node.operator === '!==' || node.operator === '!=') return node.left.value !== node.right.value;
    }
    if (node.left?.type === 'BooleanLiteral' && node.right?.type === 'BooleanLiteral') {
      if (node.operator === '===' || node.operator === '==') return node.left.value === node.right.value;
      if (node.operator === '!==' || node.operator === '!=') return node.left.value !== node.right.value;
    }
  }
  return null;
}

/**
 * Recursively extracts assignment target lvalues (MemberExpressions, Identifiers) from patterns.
 */
export function extractLValues(pattern: any): any[] {
  if (!pattern) return [];
  if (
    pattern.type === 'MemberExpression' ||
    pattern.type === 'OptionalMemberExpression' ||
    pattern.type === 'Identifier'
  ) {
    return [pattern];
  }
  if (pattern.type === 'ArrayPattern') {
    const list: any[] = [];
    for (const elem of pattern.elements) {
      if (elem) list.push(...extractLValues(elem));
    }
    return list;
  }
  if (pattern.type === 'ObjectPattern') {
    const list: any[] = [];
    for (const prop of pattern.properties) {
      if (prop.type === 'ObjectProperty') {
        list.push(...extractLValues(prop.value));
      } else if (prop.type === 'RestElement') {
        list.push(...extractLValues(prop.argument));
      }
    }
    return list;
  }
  if (pattern.type === 'AssignmentPattern') {
    return extractLValues(pattern.left);
  }
  if (pattern.type === 'RestElement') {
    return extractLValues(pattern.argument);
  }
  return [];
}
