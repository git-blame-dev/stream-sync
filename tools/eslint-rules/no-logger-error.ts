/**
 * ESLint rule to block direct logger.error calls.
 * Ensures all modules route through the shared platform error handler helpers.
 */
'use strict';

type AstRecord = Record<string, unknown> & { type: string };

function isAstRecord(node: unknown): node is AstRecord {
  return !!node && typeof node === 'object' && typeof (node as Record<string, unknown>).type === 'string';
}

function isLoggerReference(node: unknown): boolean {
  if (!isAstRecord(node)) {
    return false;
  }

  if (node.type === 'Identifier') {
    return node.name === 'logger';
  }

  if (node.type === 'MemberExpression') {
    const property = node.property;
    if (
      !node.computed &&
      isAstRecord(property) &&
      property.name === 'logger'
    ) {
      return true;
    }

    return isLoggerReference(node.object);
  }

  return false;
}

const noLoggerErrorRule: import('eslint').Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow direct logger.error usage outside the shared error handler',
      category: 'Best Practices'
    },
    schema: [],
    messages: {
      noLoggerError: 'Route errors through createPlatformErrorHandler instead of calling logger.error directly.'
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'error' &&
          isLoggerReference(callee.object)
        ) {
          context.report({
            node,
            messageId: 'noLoggerError'
          });
        }
      }
    };
  }
};

export default noLoggerErrorRule;
