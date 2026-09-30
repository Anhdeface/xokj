import type { RuleDefinition, RuleContext, NodeVisitor } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { isGlobalObject, getStaticPropertyName, unwrapCall, extractLValues } from './helpers.js';

function isObjectConstructor(node: any): boolean {
  if (!node) return false;
  if (node.type === 'Identifier' && node.name === 'Object') {
    return true;
  }
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const prop = getStaticPropertyName(node);
    if (prop === 'Object' && isGlobalObject(node.object)) {
      return true;
    }
  }
  return false;
}

function isReflectConstructor(node: any): boolean {
  if (!node) return false;
  if (node.type === 'Identifier' && node.name === 'Reflect') {
    return true;
  }
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const prop = getStaticPropertyName(node);
    if (prop === 'Reflect' && isGlobalObject(node.object)) {
      return true;
    }
  }
  return false;
}

function isObjectPrototype(node: any): boolean {
  if (!node || (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression')) {
    return false;
  }
  const prop = getStaticPropertyName(node);
  return prop === 'prototype' && isObjectConstructor(node.object);
}

function hasProtoInMemberChain(expr: any): boolean {
  let curr = expr;
  while (curr && (curr.type === 'MemberExpression' || curr.type === 'OptionalMemberExpression')) {
    const prop = getStaticPropertyName(curr);
    if (prop === '__proto__') {
      return true;
    }
    curr = curr.object;
  }
  return false;
}

function targetsObjectPrototypeInChain(expr: any): boolean {
  let curr = expr;
  while (curr && (curr.type === 'MemberExpression' || curr.type === 'OptionalMemberExpression')) {
    if (isObjectPrototype(curr)) {
      return true;
    }
    curr = curr.object;
  }
  return false;
}

function isVulnerablePrototypeTarget(node: any): boolean {
  if (!node) return false;
  return isObjectPrototype(node) || hasProtoInMemberChain(node) || targetsObjectPrototypeInChain(node);
}

export const secNoPrototypePollution: RuleDefinition = {
  id: 'sec-no-prototype-pollution',
  name: 'Prohibit prototype pollution',
  category: 'security',
  defaultSeverity: 'error',
  description: 'Mutating __proto__, Object.prototype, or Object.setPrototypeOf compromises prototype chains.',

  create(context: RuleContext): NodeVisitor {
    function inspectCall(node: any) {
      if (!node) return;
      const { callee, args } = unwrapCall(node);
      if (!callee) return;

      if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
        const methodName = getStaticPropertyName(callee);
        const isObj = isObjectConstructor(callee.object);
        const isReflect = isReflectConstructor(callee.object);

        // 1. Object.setPrototypeOf / Reflect.setPrototypeOf
        if (
          methodName === 'setPrototypeOf' &&
          (isObj || isReflect)
        ) {
          context.report({
            message: `Invoking ${isReflect ? 'Reflect' : 'Object'}.setPrototypeOf() is prohibited due to prototype pollution risks.`,
            location: fromBabelLoc(callee.loc ?? node.loc),
            suggestion: 'Use Object.create(null), Map, or immutable object spread ({ ...obj }) instead of mutating prototype chains.'
          });
          return;
        }

        // 2. Object.defineProperty / Reflect.defineProperty / Object.defineProperties
        if (
          (methodName === 'defineProperty' || methodName === 'defineProperties') &&
          (isObj || isReflect) &&
          args &&
          args.length > 0 &&
          isVulnerablePrototypeTarget(args[0])
        ) {
          context.report({
            message: 'Defining properties on Object.prototype is prohibited due to prototype pollution vulnerabilities.',
            location: fromBabelLoc(callee.loc ?? node.loc),
            suggestion: 'Use Object.create(null), Map, or immutable object spread ({ ...obj }) instead of mutating prototype chains.'
          });
          return;
        }

        // 3. Object.assign(Object.prototype / obj.__proto__, ...)
        if (
          methodName === 'assign' &&
          isObj &&
          args &&
          args.length > 0 &&
          isVulnerablePrototypeTarget(args[0])
        ) {
          context.report({
            message: 'Modifying Object.prototype directly is prohibited due to prototype pollution vulnerabilities.',
            location: fromBabelLoc(callee.loc ?? node.loc),
            suggestion: 'Use Object.create(null), Map, or immutable object spread ({ ...obj }) instead of mutating prototype chains.'
          });
          return;
        }

        // 4. Reflect.set(Object.prototype / obj.__proto__, ...)
        if (
          methodName === 'set' &&
          isReflect &&
          args &&
          args.length > 0 &&
          isVulnerablePrototypeTarget(args[0])
        ) {
          context.report({
            message: 'Modifying Object.prototype directly is prohibited due to prototype pollution vulnerabilities.',
            location: fromBabelLoc(callee.loc ?? node.loc),
            suggestion: 'Use Object.create(null), Map, or immutable object spread ({ ...obj }) instead of mutating prototype chains.'
          });
        }
      }
    }

    return {
      AssignmentExpression(node) {
        if (!node || !node.left) return;

        const targets = extractLValues(node.left);
        for (const target of targets) {
          // 1. Check for __proto__ in the member assignment chain
          if (hasProtoInMemberChain(target)) {
            context.report({
              message: 'Direct mutation of __proto__ is prohibited due to prototype pollution vulnerabilities.',
              location: fromBabelLoc(target.loc ?? node.loc),
              suggestion: 'Use Object.create(null), Map, or immutable object spread ({ ...obj }) instead of mutating prototype chains.'
            });
            continue;
          }

          // 2. Check for assignment targeting Object.prototype (e.g. Object.prototype.isAdmin = true)
          if (targetsObjectPrototypeInChain(target)) {
            context.report({
              message: 'Modifying Object.prototype directly is prohibited due to prototype pollution vulnerabilities.',
              location: fromBabelLoc(target.loc ?? node.loc),
              suggestion: 'Use Object.create(null), Map, or immutable object spread ({ ...obj }) instead of mutating prototype chains.'
            });
          }
        }
      },

      CallExpression(node) {
        inspectCall(node);
      },

      OptionalCallExpression(node) {
        inspectCall(node);
      }
    };
  }
};

export const secNoPrototypePollutionRule = secNoPrototypePollution;
export default secNoPrototypePollution;
