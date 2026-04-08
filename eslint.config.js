const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');
const noLoggerErrorRuleModule = require('./tools/eslint-rules/no-logger-error.ts');
const noLoggerErrorRule = noLoggerErrorRuleModule.default || noLoggerErrorRuleModule;

const nodeLanguageOptions = {
  sourceType: 'commonjs',
  ecmaVersion: 2022,
  globals: {
    ...globals.node
  }
};

const nodeTsLanguageOptions = {
  ...nodeLanguageOptions,
  parser: tsParser,
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs'
  }
};

const browserTsLanguageOptions = {
  sourceType: 'module',
  ecmaVersion: 2022,
  parser: tsParser,
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true }
  },
  globals: {
    ...globals.browser
  }
};

const testGlobals = {
  ...globals.node,
  describe: false,
  test: false,
  it: false,
  expect: false,
  beforeAll: false,
  afterAll: false,
  beforeEach: false,
  afterEach: false,
  mock: false,
  spyOn: false,
  jest: false,
  scheduleTestTimeout: false,
  scheduleTestInterval: false,
  waitForDelay: false,
  createTestApp: false
};

const srcJsRules = {
  'chatbot/no-logger-error': 'error',
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-undef': 'error',
  'no-console': 'error',
  'no-unused-private-class-members': 'error',
  'no-unused-vars': ['error', { vars: 'all', args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  'no-restricted-syntax': [
    'error',
    {
      selector: 'CallExpression[callee.property.name="toISOString"][callee.object.type="NewExpression"][callee.object.callee.name="Date"][callee.object.arguments.length=0]',
      message: 'Use getSystemTimestampISO() from src/utils/timestamp.ts instead of new Date().toISOString().'
    }
  ]
};

const srcTsRules = {
  'chatbot/no-logger-error': 'error',
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-console': 'error',
  'no-unused-private-class-members': 'error',
  'no-undef': 'off',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['error', { vars: 'all', args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  'no-restricted-syntax': [
    'error',
    {
      selector: 'CallExpression[callee.property.name="toISOString"][callee.object.type="NewExpression"][callee.object.callee.name="Date"][callee.object.arguments.length=0]',
      message: 'Use getSystemTimestampISO() from src/utils/timestamp.ts instead of new Date().toISOString().'
    }
  ]
};

const scriptJsRules = {
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-undef': 'error',
  'no-unused-private-class-members': 'error',
  'no-unused-vars': ['error', { vars: 'all', args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
};

const scriptTsRules = {
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-unused-private-class-members': 'error',
  'no-undef': 'off',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['error', { vars: 'all', args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
};

const testJsRules = {
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-undef': 'error',
  'no-unused-vars': ['error', { vars: 'all', args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  'no-restricted-properties': [
    'error',
    {
      object: 'Date',
      property: 'now',
      message: 'Use testClock.now() for deterministic test timing.'
    },
    {
      object: 'performance',
      property: 'now',
      message: 'Use testClock.now() for deterministic test timing.'
    },
    {
      object: 'Math',
      property: 'random',
      message: 'Use deterministic test data instead of Math.random().'
    }
  ]
};

const testTsRules = {
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-undef': 'off',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['error', { vars: 'all', args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  'no-restricted-properties': [
    'error',
    {
      object: 'Date',
      property: 'now',
      message: 'Use testClock.now() for deterministic test timing.'
    },
    {
      object: 'performance',
      property: 'now',
      message: 'Use testClock.now() for deterministic test timing.'
    },
    {
      object: 'Math',
      property: 'random',
      message: 'Use deterministic test data instead of Math.random().'
    }
  ]
};

const guiTsRules = {
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-console': 'error',
  'no-unused-private-class-members': 'error',
  'no-undef': 'off',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['error', { vars: 'all', args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
};

module.exports = [
  {
    files: ['src/**/*.js'],
    languageOptions: nodeLanguageOptions,
    plugins: {
      chatbot: {
        rules: {
          'no-logger-error': noLoggerErrorRule
        }
      }
    },
    rules: srcJsRules
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/utils/platform-error-handler.ts'],
    languageOptions: nodeTsLanguageOptions,
    plugins: {
      chatbot: {
        rules: {
          'no-logger-error': noLoggerErrorRule
        }
      },
      '@typescript-eslint': tsPlugin
    },
    rules: srcTsRules
  },
  {
    files: ['src/core/logging.js'],
    languageOptions: nodeLanguageOptions,
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['src/bootstrap.ts', 'src/core/logging.ts'],
    languageOptions: nodeTsLanguageOptions,
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: nodeLanguageOptions,
    rules: scriptJsRules
  },
  {
    files: ['tools/**/*.js'],
    languageOptions: nodeLanguageOptions,
    rules: scriptJsRules
  },
  {
    files: ['scripts/**/*.ts'],
    languageOptions: nodeTsLanguageOptions,
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: scriptTsRules
  },
  {
    files: ['tools/**/*.ts'],
    languageOptions: nodeTsLanguageOptions,
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: scriptTsRules
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ...nodeLanguageOptions,
      globals: testGlobals
    },
    rules: testJsRules
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      ...nodeTsLanguageOptions,
      globals: testGlobals
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: testTsRules
  },
  {
    files: ['gui/**/*.ts', 'gui/**/*.tsx'],
    languageOptions: browserTsLanguageOptions,
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: guiTsRules
  },
  {
    files: ['gui/vite.config.ts'],
    languageOptions: nodeTsLanguageOptions,
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: scriptTsRules
  }
];
