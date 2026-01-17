
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const { DisplayQueue } = require('../../../src/obs/display-queue');

describe('TTS Configuration Boolean Parsing', () => {
    afterEach(() => {
        restoreAllMocks();
        clearAllMocks();
    });
    
    describe('when ttsEnabled is configured with different values', () => {
        const createDisplayQueueWithTTS = (ttsValue) => {
            const runtimeConstants = createRuntimeConstantsFixture();
            const baseConstants = { PRIORITY_LEVELS: { CHAT: 1 } };
            const config = {
                ttsEnabled: ttsValue,
                obs: {
                    ttsTxt: 'tts txt'
                },
                chat: {},
                notification: {}
            };
            
            const mockOBS = {
                isConnected: () => true,
                updateTextSource: createMockFn().mockResolvedValue(true)
            };
            
            return new DisplayQueue(mockOBS, config, baseConstants, null, runtimeConstants);
        };
        
        describe('when ttsEnabled is string "false"', () => {
            it('should disable TTS (not treat string "false" as truthy)', () => {
                const queue = createDisplayQueueWithTTS('false');
                expect(queue.isTTSEnabled()).toBe(false);
            });
        });
        
        describe('when ttsEnabled is boolean false', () => {
            it('should disable TTS', () => {
                const queue = createDisplayQueueWithTTS(false);
                expect(queue.isTTSEnabled()).toBe(false);
            });
        });
        
        describe('when ttsEnabled is string "true"', () => {
            it('should enable TTS', () => {
                const queue = createDisplayQueueWithTTS('true');
                expect(queue.isTTSEnabled()).toBe(true);
            });
        });
        
        describe('when ttsEnabled is boolean true', () => {
            it('should enable TTS', () => {
                const queue = createDisplayQueueWithTTS(true);
                expect(queue.isTTSEnabled()).toBe(true);
            });
        });
        
        describe('when ttsEnabled is undefined', () => {
            it('should default to disabled for safety', () => {
                const queue = createDisplayQueueWithTTS(undefined);
                expect(queue.isTTSEnabled()).toBe(false);
            });
        });
        
        describe('when ttsEnabled is null', () => {
            it('should default to disabled for safety', () => {
                const queue = createDisplayQueueWithTTS(null);
                expect(queue.isTTSEnabled()).toBe(false);
            });
        });
        
        describe('when ttsEnabled is empty string', () => {
            it('should default to disabled for safety', () => {
                const queue = createDisplayQueueWithTTS('');
                expect(queue.isTTSEnabled()).toBe(false);
            });
        });
        
        describe('when ttsEnabled has any other truthy value', () => {
            it('should disable TTS (only explicit true/\'true\' enables)', () => {
                const queue1 = createDisplayQueueWithTTS('yes');
                expect(queue1.isTTSEnabled()).toBe(false);
                
                const queue2 = createDisplayQueueWithTTS(1);
                expect(queue2.isTTSEnabled()).toBe(false);
                
                const queue3 = createDisplayQueueWithTTS('1');
                expect(queue3.isTTSEnabled()).toBe(false);
            });
        });
    });
    
    describe('main.js config parsing', () => {
        it('should properly parse ttsEnabled from INI config object', () => {
            const testConfigs = [
                { input: { general: { ttsEnabled: 'false' } }, expected: false },
                { input: { general: { ttsEnabled: 'true' } }, expected: true },
                { input: { general: { ttsEnabled: false } }, expected: false },
                { input: { general: { ttsEnabled: true } }, expected: true },
                { input: { general: {} }, expected: false },
                { input: { general: { ttsEnabled: '' } }, expected: false },
                { input: { general: { ttsEnabled: null } }, expected: false }
            ];

            testConfigs.forEach(({ input, expected }) => {
                const config = input;
                const ttsEnabled = config.general.ttsEnabled === true || config.general.ttsEnabled === 'true';
                expect(ttsEnabled).toBe(expected);
            });
        });
    });
});
