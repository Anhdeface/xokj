/**
 * XoBrow - Lightweight Two-Pass Recursive AST Visitor Engine
 * Single-pass O(N) AST traversal across all active rule visitors (Pass 1)
 * followed by resource reconciliation postCheck() hooks (Pass 2).
 */

import type { NodeVisitor } from '../types.js';

/**
 * AST properties to skip during child recursion to prevent infinite loops,
 * circular references, or redundant non-AST visits.
 */
const IGNORED_AST_KEYS = new Set([
  'loc',
  'start',
  'end',
  'range',
  'comments',
  'tokens',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'extra',
  'parent'
]);

/**
 * Traverses a node and its children depth-first, maintaining parent and ancestor stack.
 */
function walkNode(
  node: any,
  parent: any,
  ancestors: any[],
  visitors: NodeVisitor[]
): void {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
    return;
  }

  // 1. Preorder hooks: onEnter and node-type hook
  for (let i = 0; i < visitors.length; i++) {
    const v = visitors[i];
    try {
      if (typeof v.onEnter === 'function') {
        v.onEnter.call(v, node, parent, ancestors);
      }
      const typeHook = v[node.type];
      if (typeof typeHook === 'function') {
        typeHook.call(v, node, parent, ancestors);
      }
    } catch (err) {
      // Isolate visitor hook failures so a single rule doesn't crash traversal
      console.error(`Error in visitor hook for node ${node.type}:`, err);
    }
  }

  // 2. Push current node onto ancestor stack
  ancestors.push(node);

  // 3. Recurse over child properties
  const keys = Object.keys(node);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (IGNORED_AST_KEYS.has(key)) {
      continue;
    }

    const child = node[key];
    if (Array.isArray(child)) {
      for (let j = 0; j < child.length; j++) {
        const item = child[j];
        if (item && typeof item === 'object' && typeof item.type === 'string') {
          walkNode(item, node, ancestors, visitors);
        }
      }
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      walkNode(child, node, ancestors, visitors);
    }
  }

  // 4. Pop from ancestor stack
  ancestors.pop();

  // 5. Postorder hook: onLeave
  for (let i = 0; i < visitors.length; i++) {
    const v = visitors[i];
    try {
      if (typeof v.onLeave === 'function') {
        v.onLeave.call(v, node, parent, ancestors);
      }
    } catch (err) {
      console.error(`Error in onLeave hook for node ${node.type}:`, err);
    }
  }
}

/**
 * Executes the Two-Pass AST Visitor Engine:
 * - Pass 1: Recursive depth-first AST walk invoking onEnter, node type hooks, and onLeave.
 * - Pass 2: Lifecycle reconciliation invoking postCheck() on all registered visitors.
 *
 * @param ast The root AST object returned from parseScriptAst.
 * @param visitors A single visitor or an array of active rule visitors.
 */
export function traverseAst(
  ast: any,
  visitors: NodeVisitor | NodeVisitor[]
): void {
  if (!ast) return;

  const visitorList = Array.isArray(visitors) ? visitors : [visitors];
  if (visitorList.length === 0) return;

  // Pass 1: Depth-first AST traversal
  const ancestors: any[] = [];
  walkNode(ast, null, ancestors, visitorList);

  // Pass 2: postCheck() resource lifecycle reconciliation
  for (let i = 0; i < visitorList.length; i++) {
    const v = visitorList[i];
    try {
      if (typeof v.postCheck === 'function') {
        v.postCheck.call(v);
      }
    } catch (err) {
      console.error('Error in visitor postCheck():', err);
    }
  }
}
