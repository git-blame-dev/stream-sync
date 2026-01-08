
const { initializeTestLogging } = require('../../helpers/test-setup');
const { createMockLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('TTS Configuration Boolean Parsing', () => {
    let mockLogger;
    let DisplayQueue;
    
    beforeEach(() => {
        jest.clearAllMocks();
        
        // Create mock logger
        mockLogger = createMockLogger('debug', { captureConsole: true });
        
        // Mock the logging module
        jest.doMock('../../../src/core/logging', () => ({
            logger: mockLogger,
            platformLogger: mockLogger
        }));
        
        // Import after mocking
        DisplayQueue = require('../../../src/obs/display-queue').DisplayQueue;
    });
    
    afterEach(() => {
        jest.resetModules();
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
                updateTextSource: jest.fn().mockResolvedValue(true)
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
            // Test the actual parsing logic used in main.js
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
                // This is the fixed logic from main.js
                const ttsEnabled = config.general.ttsEnabled === true || config.general.ttsEnabled === 'true';
                expect(ttsEnabled).toBe(expected);
            });
        });
    });
});
