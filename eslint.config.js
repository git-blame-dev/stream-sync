/**
 * ESLint flat configuration with custom linting rules
 */
const noLoggerErrorRule = require('./tools/eslint-rules/no-logger-error');
const globals = require('globals');

const languageOptions = {
  sourceType: 'commonjs',
  ecmaVersion: 2022,
  globals: {
    ...globals.node
  }
};

module.exports = [
  {
    files: ['src/**/*.js'],
    ignores: ['src/utils/platform-error-handler.js'],
    languageOptions,
    plugins: {
      chatbot: {
        rules: {
          'no-logger-error': noLoggerErrorRule
        }
      }
    },
    rules: {
      'chatbot/no-logger-error': 'error',
      'no-undef': 'error',
      'no-console': 'error'
    }
  },
  {
    files: ['src/bootstrap.js', 'src/core/logging.js'],
    languageOptions,
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['src/utils/**/*.js'],
    languageOptions,
    rules: {
      'no-unused-vars': ['error', { vars: 'all', args: 'none' }]
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ...languageOptions,
      globals: {
        ...globals.node,
        ...globals.jest,
        scheduleTestTimeout: false,
        scheduleTestInterval: false,
        waitForDelay: false,
        createTestApp: false
      }
    },
    rules: {
      'no-undef': 'error'
    }
  }
];
