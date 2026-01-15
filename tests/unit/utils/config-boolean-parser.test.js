
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const { initializeTestLogging } = require('../../helpers/test-setup');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Config Boolean Parser Utility', () => {
    afterEach(() => {
        restoreAllModuleMocks();
    });

    let parseConfigBoolean;
    let parseConfigBooleanDefaultTrue;
    
    beforeEach(() => {
        resetModules();
        const parser = require('../../../src/utils/config-boolean-parser');
        parseConfigBoolean = parser.parseConfigBoolean;
        parseConfigBooleanDefaultTrue = parser.parseConfigBooleanDefaultTrue;
    });
    
    describe('parseConfigBoolean with default false', () => {
        describe('when value is boolean', () => {
            it('should return true for boolean true', () => {
                expect(parseConfigBoolean(true)).toBe(true);
            });
            
            it('should return false for boolean false', () => {
                expect(parseConfigBoolean(false)).toBe(false);
            });
        });
        
        describe('when value is string', () => {
            it('should return true for string "true"', () => {
                expect(parseConfigBoolean('true')).toBe(true);
                expect(parseConfigBoolean('TRUE')).toBe(true);
                expect(parseConfigBoolean('True')).toBe(true);
                expect(parseConfigBoolean('  true  ')).toBe(true);
            });
            
            it('should return false for string "false"', () => {
                expect(parseConfigBoolean('false')).toBe(false);
                expect(parseConfigBoolean('FALSE')).toBe(false);
                expect(parseConfigBoolean('False')).toBe(false);
                expect(parseConfigBoolean('  false  ')).toBe(false);
            });
            
            it('should return false for empty string', () => {
                expect(parseConfigBoolean('')).toBe(false);
                expect(parseConfigBoolean('   ')).toBe(false);
            });
            
            it('should return false for other string values', () => {
                expect(parseConfigBoolean('yes')).toBe(false);
                expect(parseConfigBoolean('no')).toBe(false);
                expect(parseConfigBoolean('1')).toBe(false);
                expect(parseConfigBoolean('0')).toBe(false);
                expect(parseConfigBoolean('enabled')).toBe(false);
                expect(parseConfigBoolean('disabled')).toBe(false);
            });
        });
        
        describe('when value is undefined or null', () => {
            it('should return false (default) for undefined', () => {
                expect(parseConfigBoolean(undefined)).toBe(false);
                expect(parseConfigBoolean()).toBe(false);
            });
            
            it('should return false (default) for null', () => {
                expect(parseConfigBoolean(null)).toBe(false);
            });
        });
        
        describe('when value is other types', () => {
            it('should return false for numbers', () => {
                expect(parseConfigBoolean(0)).toBe(false);
                expect(parseConfigBoolean(1)).toBe(false);
                expect(parseConfigBoolean(-1)).toBe(false);
            });
            
            it('should return false for objects', () => {
                expect(parseConfigBoolean({})).toBe(false);
                expect(parseConfigBoolean([])).toBe(false);
            });
        });
        
        describe('with custom default value', () => {
            it('should use custom default for undefined', () => {
                expect(parseConfigBoolean(undefined, true)).toBe(true);
                expect(parseConfigBoolean(undefined, false)).toBe(false);
            });
            
            it('should use custom default for null', () => {
                expect(parseConfigBoolean(null, true)).toBe(true);
                expect(parseConfigBoolean(null, false)).toBe(false);
            });
            
            it('should use custom default for unrecognized strings', () => {
                expect(parseConfigBoolean('maybe', true)).toBe(true);
                expect(parseConfigBoolean('unknown', false)).toBe(false);
            });
        });
    });
    
    describe('parseConfigBooleanDefaultTrue', () => {
        it('should default to true for undefined', () => {
            expect(parseConfigBooleanDefaultTrue(undefined)).toBe(true);
            expect(parseConfigBooleanDefaultTrue()).toBe(true);
        });
        
        it('should default to true for null', () => {
            expect(parseConfigBooleanDefaultTrue(null)).toBe(true);
        });
        
        it('should return false for string "false"', () => {
            expect(parseConfigBooleanDefaultTrue('false')).toBe(false);
        });
        
        it('should return true for string "true"', () => {
            expect(parseConfigBooleanDefaultTrue('true')).toBe(true);
        });
        
        it('should return false for boolean false', () => {
            expect(parseConfigBooleanDefaultTrue(false)).toBe(false);
        });
        
        it('should return true for boolean true', () => {
            expect(parseConfigBooleanDefaultTrue(true)).toBe(true);
        });
        
        it('should default to true for unrecognized values', () => {
            expect(parseConfigBooleanDefaultTrue('yes')).toBe(true);
            expect(parseConfigBooleanDefaultTrue('enabled')).toBe(true);
            expect(parseConfigBooleanDefaultTrue(1)).toBe(true);
        });
    });
    
    describe('real-world INI parsing scenarios', () => {
        it('should handle typical INI parser output', () => {
            // INI parsers typically return strings
            const iniValues = {
                'ttsEnabled': 'false',
                'debugEnabled': 'true',
                'logChatMessages': '',
                'autoProcess': undefined
            };
            
            expect(parseConfigBoolean(iniValues.ttsEnabled)).toBe(false);
            expect(parseConfigBoolean(iniValues.debugEnabled)).toBe(true);
            expect(parseConfigBoolean(iniValues.logChatMessages)).toBe(false);
            expect(parseConfigBooleanDefaultTrue(iniValues.autoProcess)).toBe(true);
        });
        
        it('should handle mixed boolean and string configs', () => {
            // Some configs might be pre-processed or come from different sources
            const mixedConfigs = [
                { value: true, expected: true },
                { value: false, expected: false },
                { value: 'true', expected: true },
                { value: 'false', expected: false },
                { value: 'TRUE', expected: true },
                { value: 'FALSE', expected: false },
                { value: '0', expected: false },
                { value: 'no', expected: false },
                { value: '', expected: false }
            ];
            
            mixedConfigs.forEach(({ value, expected }) => {
                expect(parseConfigBoolean(value)).toBe(expected);
            });
        });
    });
});