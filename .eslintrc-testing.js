/**
 * ESLint Configuration for Testing Standards Enforcement
 * 
 * Specifically designed to prevent integration gaps like the Twitch EventSub failure
 * through static analysis and code quality enforcement.
 * 
 * FOCUS AREAS:
 * ✅ Function Reference Truthiness Detection
 * ✅ Implementation Detail Testing Prevention
 * ✅ Integration Point Bypass Detection
 * ✅ Technical Artifact Prevention
 * ✅ Behavior-Focused Testing Patterns
 * ✅ A+ Testing Excellence Standards
 * 
 * USAGE:
 *   # Lint test files with testing standards
 *   npx eslint --config .eslintrc-testing.js tests/**\/*.test.js
 *   
 *   # Lint source files for integration issues
 *   npx eslint --config .eslintrc-testing.js src/**\/*.js
 *   
 *   # Auto-fix where possible
 *   npx eslint --config .eslintrc-testing.js --fix tests/**\/*.test.js
 * 
 * @author Testing Standards Enforcement Team
 * @version 1.0.0
 */

module.exports = {
  root: true,
  env: {
    node: true,
    jest: true,
    es2022: true
  },
  
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  
  extends: [
    'eslint:recommended'
  ],
  
  // ======================================================================
  // CUSTOM RULES FOR TESTING STANDARDS ENFORCEMENT
  // ======================================================================
  rules: {
    // =====================================================================
    // CRITICAL: Function Reference Truthiness Prevention
    // =====================================================================
    'no-fallthrough-truthiness': 'error',
    'no-implicit-globals': 'error',
    'no-undef': 'error',
    'prefer-explicit-checks': 'warn',
    
    // =====================================================================
    // IMPLEMENTATION DETAIL TESTING PREVENTION
    // =====================================================================
    'no-mock-implementation-testing': 'error',
    'prefer-behavior-assertions': 'warn',
    'no-logger-testing': 'error',
    'no-internal-method-testing': 'warn',
    
    // =====================================================================
    // INTEGRATION POINT BYPASS DETECTION
    // =====================================================================
    'no-direct-handler-calls': 'warn',
    'prefer-e2e-patterns': 'warn',
    'no-integration-bypasses': 'error',
    
    // =====================================================================
    // TECHNICAL ARTIFACT PREVENTION
    // =====================================================================
    'no-template-artifacts': 'error',
    'no-undefined-content': 'error',
    'no-object-artifacts': 'error',
    'prefer-content-validation': 'warn',
    
    // =====================================================================
    // BEHAVIOR-FOCUSED TESTING PATTERNS
    // =====================================================================
    'prefer-behavior-factories': 'warn',
    'require-user-outcome-validation': 'warn',
    'prefer-outcome-assertions': 'warn',
    
    // =====================================================================
    // A+ TESTING EXCELLENCE STANDARDS
    // =====================================================================
    'require-test-descriptions': 'warn',
    'prefer-descriptive-test-names': 'warn',
    'no-magic-numbers-in-tests': 'warn',
    'require-cleanup-after-tests': 'warn',
    
    // =====================================================================
    // PERFORMANCE AND QUALITY
    // =====================================================================
    'no-slow-test-patterns': 'warn',
    'prefer-fast-assertions': 'warn',
    'no-memory-leaks': 'warn',
    
    // =====================================================================
    // STANDARD ESLINT RULES (Enhanced for Testing)
    // =====================================================================
    'no-unused-vars': ['error', { 
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }],
    'no-console': 'off', // Allow console in tests
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'always'],
    'curly': ['error', 'all'],
    'brace-style': ['error', '1tbs'],
    'indent': ['error', 2],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'comma-dangle': ['error', 'never'],
    'no-trailing-spaces': 'error',
    'eol-last': 'error'
  },
  
  // ======================================================================
  // ENVIRONMENT-SPECIFIC OVERRIDES
  // ======================================================================
  overrides: [
    {
      // Test files - stricter testing standards
      files: ['tests/**/*.test.js', '**/*.test.js'],
      rules: {
        'no-mock-implementation-testing': 'error',
        'prefer-behavior-assertions': 'error',
        'no-direct-handler-calls': 'error',
        'prefer-e2e-patterns': 'warn',
        'require-user-outcome-validation': 'error',
        'prefer-behavior-factories': 'warn'
      }
    },
    {
      // Source files - integration safety focus
      files: ['src/**/*.js'],
      rules: {
        'no-fallthrough-truthiness': 'error',
        'no-template-artifacts': 'error',
        'no-undefined-content': 'error',
        'prefer-explicit-checks': 'error'
      }
    },
    {
      // Platform files - extra scrutiny for integration points
      files: ['src/platforms/**/*.js'],
      rules: {
        'no-fallthrough-truthiness': 'error',
        'prefer-explicit-checks': 'error',
        'no-integration-bypasses': 'error',
        'prefer-content-validation': 'error'
      }
    },
    {
      // Notification files - user-facing content protection
      files: ['src/notifications/**/*.js', 'src/**/notification*.js'],
      rules: {
        'no-template-artifacts': 'error',
        'no-undefined-content': 'error',
        'no-object-artifacts': 'error',
        'prefer-content-validation': 'error'
      }
    }
  ],
  
  // ======================================================================
  // CUSTOM RULE DEFINITIONS
  // ======================================================================
  plugins: ['testing-standards'],
  
  settings: {
    'testing-standards': {
      // Patterns that indicate function reference truthiness issues
      truthinessPatterns: [
        'this\\.\\w+\\s*\\|\\|\\s*this\\._\\w+',
        '\\w+\\.\\w+\\s*\\|\\|\\s*\\w+\\._\\w+',
        '\\w+\\s*\\|\\|\\s*.*_initialize\\w*'
      ],
      
      // Patterns that indicate implementation detail testing
      implementationPatterns: [
        'expect\\(.*mock.*\\)\\.toHaveBeenCalledWith',
        'expect\\(.*mock.*\\)\\.toHaveBeenCalled',
        'expect\\(.*\\.debug\\)\\.toHaveBeenCalled',
        'expect\\(.*\\.info\\)\\.toHaveBeenCalled'
      ],
      
      // Patterns that indicate integration bypasses
      bypassPatterns: [
        'platform\\.(handle\\w+Message|process\\w+Event)\\(',
        'handler\\.(handle\\w+|process\\w+)\\(',
        'dispatcher\\.(process\\w+|route\\w+)\\('
      ],
      
      // Patterns for technical artifacts
      artifactPatterns: [
        '\\$\\{.*\\}',
        '\\[object Object\\]',
        'undefined',
        'null'
      ],
      
      // Preferred behavior patterns
      behaviorPatterns: [
        'expectValidNotification',
        'expectNoTechnicalArtifacts',
        'expectUserVisible',
        'createMockPlatform',
        'createMockNotificationManager'
      ]
    }
  }
};

// ======================================================================
// TESTING STANDARDS ESLINT PLUGIN IMPLEMENTATION
// ======================================================================
const testingStandardsPlugin = {
  rules: {
    // ===================================================================
    // CRITICAL: Function Reference Truthiness Detection
    // ===================================================================
    'no-fallthrough-truthiness': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Prevent function reference truthiness patterns that cause silent failures',
          category: 'Critical Integration Issues',
          recommended: true
        },
        fixable: 'code',
        schema: []
      },
      create(context) {
        return {
          LogicalExpression(node) {
            if (node.operator === '||') {
              const source = context.getSourceCode().getText(node);
              
              // Check for the exact pattern that caused Twitch EventSub bug
              const criticalPatterns = [
                /this\.(\w+)\s*\|\|\s*this\._\w+/,
                /(\w+)\.(\w+)\s*\|\|\s*\1\._\w+/
              ];
              
              for (const pattern of criticalPatterns) {
                if (pattern.test(source)) {
                  context.report({
                    node,
                    message: 'CRITICAL: Function reference truthiness pattern detected - this can cause silent test failures like Twitch EventSub bug',
                    fix(fixer) {
                      const match = source.match(pattern);
                      if (match) {
                        const replacement = `${match[1]} && ${match[1]}.isReady`;
                        return fixer.replaceText(node, replacement);
                      }
                    }
                  });
                }
              }
            }
          }
        };
      }
    },
    
    // ===================================================================
    // IMPLEMENTATION DETAIL TESTING PREVENTION
    // ===================================================================
    'no-mock-implementation-testing': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Prevent testing of mock implementation details instead of behavior',
          category: 'Testing Standards',
          recommended: true
        },
        schema: []
      },
      create(context) {
        return {
          CallExpression(node) {
            if (node.callee.name === 'expect') {
              const source = context.getSourceCode().getText(node);
              
              const implementationPatterns = [
                /expect\(.*mock.*\)\.toHaveBeenCalledWith/,
                /expect\(.*mock.*\)\.toHaveBeenCalled/,
                /expect\(.*\.debug\)\.toHaveBeenCalled/,
                /expect\(.*\.info\)\.toHaveBeenCalled/
              ];
              
              for (const pattern of implementationPatterns) {
                if (pattern.test(source)) {
                  context.report({
                    node,
                    message: 'Testing implementation details instead of user behavior - use expectValidNotification() or expectUserVisible() instead'
                  });
                }
              }
            }
          }
        };
      }
    },
    
    // ===================================================================
    // INTEGRATION POINT BYPASS DETECTION
    // ===================================================================
    'no-direct-handler-calls': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Prevent direct handler calls that bypass integration points',
          category: 'Integration Testing',
          recommended: true
        },
        schema: []
      },
      create(context) {
        return {
          CallExpression(node) {
            const source = context.getSourceCode().getText(node);
            
            const bypassPatterns = [
              /platform\.(handle\w+Message|process\w+Event)\(/,
              /handler\.(handle\w+|process\w+)\(/,
              /dispatcher\.(process\w+|route\w+)\(/
            ];
            
            for (const pattern of bypassPatterns) {
              if (pattern.test(source)) {
                context.report({
                  node,
                  message: 'Direct handler call bypasses integration points - use WebSocket message injection or E2E flow methods instead'
                });
              }
            }
          }
        };
      }
    },
    
    // ===================================================================
    // TECHNICAL ARTIFACT PREVENTION
    // ===================================================================
    'no-template-artifacts': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Prevent unresolved template artifacts in user-facing content',
          category: 'Content Quality',
          recommended: true
        },
        fixable: 'code',
        schema: []
      },
      create(context) {
        return {
          Literal(node) {
            if (typeof node.value === 'string') {
              const artifactPatterns = [
                /\$\{.*\}/g,
                /\[object Object\]/gi,
                /undefined/g
              ];
              
              for (const pattern of artifactPatterns) {
                if (pattern.test(node.value)) {
                  context.report({
                    node,
                    message: 'Technical artifact in user-facing content - implement proper content validation',
                    fix(fixer) {
                      if (pattern.source.includes('undefined')) {
                        return fixer.replaceText(node, "''");
                      }
                    }
                  });
                }
              }
            }
          }
        };
      }
    },
    
    // ===================================================================
    // BEHAVIOR-FOCUSED TESTING PATTERNS
    // ===================================================================
    'prefer-behavior-factories': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Encourage use of behavior-focused factories over inline mocks',
          category: 'Testing Excellence',
          recommended: true
        },
        schema: []
      },
      create(context) {
        return {
          VariableDeclarator(node) {
            if (node.id.name && node.id.name.includes('mock') && node.init) {
              const source = context.getSourceCode().getText(node.init);
              
              if (source.includes('{') && !source.includes('createMock')) {
                context.report({
                  node,
                  message: 'Consider using behavior-focused factories (createMockPlatform, createMockNotificationManager) instead of inline mocks'
                });
              }
            }
          }
        };
      }
    },
    
    // ===================================================================
    // USER OUTCOME VALIDATION
    // ===================================================================
    'require-user-outcome-validation': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Require validation of user-visible outcomes in tests',
          category: 'Testing Excellence',
          recommended: true
        },
        schema: []
      },
      create(context) {
        const testFiles = /\.test\.js$/;
        const filename = context.getFilename();
        
        if (!testFiles.test(filename)) {
          return {};
        }
        
        return {
          CallExpression(node) {
            if (node.callee.name === 'it' || node.callee.name === 'test') {
              const testBody = context.getSourceCode().getText(node);
              
              const behaviorPatterns = [
                /expectValidNotification/,
                /expectNoTechnicalArtifacts/,
                /expectUserVisible/,
                /expect.*\.userSees/,
                /expect.*\.displayContent/
              ];
              
              const hasBehaviorValidation = behaviorPatterns.some(pattern => pattern.test(testBody));
              const hasImplementationTesting = /expect\(.*mock.*\)\.toHaveBeenCalled/.test(testBody);
              
              if (hasImplementationTesting && !hasBehaviorValidation) {
                context.report({
                  node,
                  message: 'Test focuses on implementation details - add user outcome validation with expectValidNotification() or expectUserVisible()'
                });
              }
            }
          }
        };
      }
    },
    
    // ===================================================================
    // PERFORMANCE AND QUALITY
    // ===================================================================
    'no-slow-test-patterns': {
      meta: {
        type: 'suggestion',
        docs: {
          description: 'Detect patterns that typically cause slow tests',
          category: 'Performance',
          recommended: true
        },
        schema: []
      },
      create(context) {
        return {
          CallExpression(node) {
            const source = context.getSourceCode().getText(node);
            
            const slowPatterns = [
              /setTimeout.*\d{4,}/,  // Long timeouts
              /setInterval/,          // Intervals in tests
              /fs\..*Sync/,          // Synchronous file operations
              /execSync/             // Synchronous process execution
            ];
            
            for (const pattern of slowPatterns) {
              if (pattern.test(source)) {
                context.report({
                  node,
                  message: 'Pattern may cause slow tests - consider async alternatives or mocking'
                });
              }
            }
          }
        };
      }
    }
  }
};

// Register the custom plugin
if (typeof module !== 'undefined' && module.exports) {
  module.exports.plugins = {
    'testing-standards': testingStandardsPlugin
  };
}
