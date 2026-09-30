import type { RuleDefinition, RuleContext, NodeVisitor } from '../../types.js';
import { fromBabelLoc } from '../../types.js';
import { isDocumentObject, getStaticPropertyName, unwrapCall, tryEvaluateStaticString } from './helpers.js';

function isScriptTagArgument(argNode: any): boolean {
  if (!argNode) return false;
  const evaluated = tryEvaluateStaticString(argNode);
  if (evaluated !== null) {
    return evaluated.trim().toLowerCase() === 'script';
  }
  return false;
}

export const secNoScriptInjection: RuleDefinition = {
  id: 'sec-no-script-injection',
  name: 'Prohibit dynamic script elements',
  category: 'security',
  defaultSeverity: 'error',
  description: 'Dynamic creation and injection of <script> DOM elements bypasses sandbox isolation.',

  create(context: RuleContext): NodeVisitor {
    function inspectElementCreation(node: any) {
      if (!node) return;
      const { callee, args } = unwrapCall(node);
      if (!callee || !args) return;

      if (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') {
        const methodName = getStaticPropertyName(callee);

        // 1. document.createElement('script')
        if (methodName === 'createElement' && isDocumentObject(callee.object)) {
          if (args.length > 0 && isScriptTagArgument(args[0])) {
            context.report({
              message: 'Dynamic creation and injection of <script> DOM elements is strictly prohibited.',
              location: fromBabelLoc(node.loc),
              suggestion: 'Declare external libraries via // @require <url> in the userscript metadata block instead of injecting dynamic <script> elements.'
            });
            return;
          }
        }

        // 2. document.createElementNS(namespace, 'script')
        if (methodName === 'createElementNS' && isDocumentObject(callee.object)) {
          if (args.length > 1 && isScriptTagArgument(args[1])) {
            context.report({
              message: 'Dynamic creation and injection of <script> DOM elements is strictly prohibited.',
              location: fromBabelLoc(node.loc),
              suggestion: 'Declare external libraries via // @require <url> in the userscript metadata block instead of injecting dynamic <script> elements.'
            });
          }
        }
      }
    }

    return {
      CallExpression(node) {
        inspectElementCreation(node);
      },
      OptionalCallExpression(node) {
        inspectElementCreation(node);
      }
    };
  }
};

export const secNoScriptInjectionRule = secNoScriptInjection;
export default secNoScriptInjection;
