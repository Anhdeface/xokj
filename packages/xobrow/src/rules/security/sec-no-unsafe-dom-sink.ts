import type { RuleDefinition, RuleContext, NodeVisitor } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { isDocumentObject, getStaticPropertyName, unwrapCall, extractLValues } from './helpers.js';

const UNSAFE_DOM_PROPERTIES = new Set(['innerHTML', 'outerHTML']);
const DOCUMENT_WRITE_METHODS = new Set(['write', 'writeln']);

export const secNoUnsafeDomSink: RuleDefinition = {
  id: 'sec-no-unsafe-dom-sink',
  name: 'Prohibit unsafe DOM sinks',
  category: 'security',
  defaultSeverity: 'error',
  description: 'Assigning unvalidated HTML strings to DOM sinks (.innerHTML, .outerHTML, document.write) introduces XSS.',

  create(context: RuleContext): NodeVisitor {
    function inspectCall(node: any) {
      if (!node) return;
      const { callee } = unwrapCall(node);
      if (!callee) return;

      if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
        const methodName = getStaticPropertyName(callee);

        // 1. document.write(...) / document.writeln(...)
        if (methodName && DOCUMENT_WRITE_METHODS.has(methodName) && isDocumentObject(callee.object)) {
          context.report({
            message: `Calling document.${methodName}() is prohibited due to unsafe DOM injection.`,
            location: fromBabelLoc(callee.loc ?? node.loc),
            suggestion: 'Use safe DOM manipulation APIs such as element.textContent, element.setAttribute(), or document.createElement().'
          });
          return;
        }

        // 2. element.insertAdjacentHTML(...)
        if (methodName === 'insertAdjacentHTML') {
          context.report({
            message: 'Calling insertAdjacentHTML() is prohibited due to unsafe DOM injection.',
            location: fromBabelLoc(callee.loc ?? node.loc),
            suggestion: 'Use safe DOM manipulation APIs such as element.textContent, element.setAttribute(), or document.createElement().'
          });
        }
      }
    }

    return {
      AssignmentExpression(node) {
        if (!node || !node.left) return;

        // Check if left is MemberExpression or a pattern destructuring to an unsafe DOM sink
        const targets = extractLValues(node.left);
        for (const target of targets) {
          if (target.type === 'MemberExpression' || target.type === 'OptionalMemberExpression') {
            const propName = getStaticPropertyName(target);
            if (propName && UNSAFE_DOM_PROPERTIES.has(propName)) {
              context.report({
                message: `Direct assignment to .${propName} is prohibited due to XSS vulnerabilities.`,
                location: fromBabelLoc(target.loc ?? node.loc),
                suggestion: 'Use safe DOM manipulation APIs such as element.textContent, element.setAttribute(), or document.createElement().'
              });
            }
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

export const secNoUnsafeDomSinkRule = secNoUnsafeDomSink;
export default secNoUnsafeDomSink;
