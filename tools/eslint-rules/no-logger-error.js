/**
 * ESLint rule to block direct logger.error calls.
 * Ensures all modules route through the shared platform error handler helpers.
 */
'use strict';

function isLoggerReference(node) {
  if (!node) {
    return false;
  }

  if (node.type === 'Identifier') {
    return node.name === 'logger';
  }

  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const property = node.property;
    if (
      !node.computed &&
      property &&
      property.type === 'Identifier' &&
      property.name === 'logger'
    ) {
      return true;
    }

    return isLoggerReference(node.object);
  }

  return false;
}

module.exports = {
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
          (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') &&
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
