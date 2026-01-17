const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');
const { noOpLogger } = require('../../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');

const { TTSService, createTTSService } = require('../../../src/services/TTSService');
const testClock = require('../../helpers/test-clock');

describe('TTSService', () => {
    let ttsService;
    let mockConfigService;
    let mockEventBus;

    afterEach(() => {
        restoreAllModuleMocks();
    });

    beforeEach(() => {
        clearAllMocks();

        mockEventBus = {
            emit: createMockFn()
        };

        mockConfigService = {
            getTTSConfig: createMockFn(() => ({
                enabled: true,
                deduplicationEnabled: true,
                debugDeduplication: false,
                onlyForGifts: false,
                voice: 'default',
                rate: 1.0,
                volume: 1.0
            })),
            set: createMockFn(() => true)
        };
    });

    describe('Constructor', () => {
        it('should initialize with ConfigService and EventBus', () => {
            ttsService = new TTSService(mockConfigService, mockEventBus, { logger: noOpLogger });

            expect(ttsService.configService).toBe(mockConfigService);
            expect(ttsService.eventBus).toBe(mockEventBus);
            expect(ttsService.ttsQueue).toEqual([]);
            expect(ttsService.isProcessing).toBe(false);
            expect(ttsService.currentTTS).toBeNull();
        });

        it('should initialize without EventBus', () => {
            ttsService = new TTSService(mockConfigService, null, { logger: noOpLogger });

            expect(ttsService.configService).toBe(mockConfigService);
            expect(ttsService.eventBus).toBeNull();
        });

        it('should initialize performance stats', () => {
            ttsService = new TTSService(mockConfigService, null, { logger: noOpLogger });

            expect(ttsService.stats).toEqual({
                totalRequests: 0,
                successfulSpeech: 0,
                failedSpeech: 0,
                queuedItems: 0,
                avgProcessingTime: 0,
                providerSwitches: 0
            });
        });

    });

    describe('Factory Function', () => {
        it('should create TTSService instance', () => {
            const service = createTTSService(mockConfigService, mockEventBus, { logger: noOpLogger });

            expect(service).toBeInstanceOf(TTSService);
            expect(service.configService).toBe(mockConfigService);
            expect(service.eventBus).toBe(mockEventBus);
        });

        it('should create TTSService without EventBus', () => {
            const service = createTTSService(mockConfigService, null, { logger: noOpLogger });

            expect(service).toBeInstanceOf(TTSService);
            expect(service.eventBus).toBeNull();
        });
    });

    describe('speak()', () => {
        beforeEach(() => {
            ttsService = new TTSService(mockConfigService, mockEventBus, { logger: noOpLogger });
        });

        it('should speak text successfully', async () => {
            const result = await ttsService.speak('Hello world');

            expect(result).toBeTruthy();
            expect(ttsService.stats.totalRequests).toBe(1);
            expect(ttsService.stats.successfulSpeech).toBe(1);
        });

        it('should not speak when TTS disabled', async () => {
            mockConfigService.getTTSConfig.mockReturnValue({ enabled: false });

            const result = await ttsService.speak('Hello world');

            expect(result).toBe(false);
            expect(ttsService.stats.totalRequests).toBe(1);
            expect(ttsService.stats.successfulSpeech).toBe(0);
        });

        it('should preserve profanity in TTS text', async () => {
            const result = await ttsService.speak('Hello funky world');

            expect(result).toBeTruthy();
            expect(ttsService._cleanText('Hello funky world')).toBe('Hello funky world');
        });

        it('should filter out URLs', async () => {
            const result = await ttsService.speak('Check out https://example.com');

            expect(result).toBeTruthy();
            expect(ttsService._cleanText('Check out https://example.com')).toBe('Check out [filtered]');
        });

        it('should not speak empty text after cleaning', async () => {
            const result = await ttsService.speak('   ');

            expect(result).toBe(false);
            expect(ttsService.stats.successfulSpeech).toBe(0);
        });

        it('should truncate very long text with clean output', async () => {
            const longText = 'a'.repeat(600);

            const result = await ttsService.speak(longText);

            expect(result).toBeTruthy();
            const expectedTruncatedText = 'a'.repeat(500) + '...';

            expectNoTechnicalArtifacts(expectedTruncatedText);

            expect(ttsService.stats.totalRequests).toBe(1);
            expect(ttsService.stats.successfulSpeech).toBe(1);
        });

        it('should use custom voice options', async () => {
            const options = {
                voice: 'custom-voice',
                rate: 1.5,
                volume: 0.8,
                priority: 'high'
            };

            const result = await ttsService.speak('Hello', options);

            expect(result).toBeTruthy();
            expect(ttsService.stats.totalRequests).toBe(1);
        });

        it('should work without ConfigService', async () => {
            ttsService = new TTSService(null, mockEventBus, { logger: noOpLogger });

            const result = await ttsService.speak('Hello world');

            expect(result).toBe(false);
        });

        it('should work without EventBus', async () => {
            ttsService = new TTSService(mockConfigService, null, { logger: noOpLogger });

            const result = await ttsService.speak('Hello world');

            expect(result).toBeTruthy();
        });
    });

    describe('getStatus()', () => {
        beforeEach(() => {
            ttsService = new TTSService(mockConfigService, mockEventBus, { logger: noOpLogger });
        });

        it('should return complete TTS status', () => {
            ttsService.ttsQueue.push({ id: '1' }, { id: '2' });
            ttsService.isProcessing = true;
            ttsService.currentTTS = {
                id: 'current-123',
                text: 'Long text message that should be truncated',
                startTime: testClock.now()
            };
            ttsService.stats.totalRequests = 10;

            const status = ttsService.getStatus();

            expect(status).toEqual({
                isEnabled: true,
                isProcessing: true,
                queueLength: 2,
                currentTTS: {
                    id: 'current-123',
                    text: 'Long text message that should be truncated',
                    startTime: expect.any(Number)
                },
                stats: expect.objectContaining({
                    totalRequests: 10
                })
            });
        });

        it('should return status without current TTS', () => {
            const status = ttsService.getStatus();

            expect(status.currentTTS).toBeNull();
            expect(status.isProcessing).toBe(false);
            expect(status.queueLength).toBe(0);
        });

        it('should handle disabled TTS', () => {
            mockConfigService.getTTSConfig.mockReturnValue({ enabled: false });

            const status = ttsService.getStatus();

            expect(status.isEnabled).toBe(false);
        });
    });

    describe('getConfig()', () => {
        beforeEach(() => {
            ttsService = new TTSService(mockConfigService, mockEventBus, { logger: noOpLogger });
        });

        it('should return TTS configuration from ConfigService', () => {
            const config = ttsService.getConfig();

            expect(config).toEqual({
                enabled: true,
                deduplicationEnabled: true,
                debugDeduplication: false,
                onlyForGifts: false,
                voice: 'default',
                rate: 1.0,
                volume: 1.0
            });
            expect(mockConfigService.getTTSConfig).toHaveBeenCalled();
        });

        it('should return default config without ConfigService', () => {
            ttsService = new TTSService(null, null, { logger: noOpLogger });

            const config = ttsService.getConfig();

            expect(config).toEqual({
                enabled: false,
                voice: 'default',
                rate: 1.0,
                volume: 1.0
            });
        });
    });

    describe('updateConfig()', () => {
        beforeEach(() => {
            ttsService = new TTSService(mockConfigService, mockEventBus, { logger: noOpLogger });
        });

        it('should update TTS configuration', () => {
            const newConfig = {
                enabled: false,
                voice: 'custom',
                rate: 1.5
            };

            const result = ttsService.updateConfig(newConfig);

            expect(result).toBeTruthy();
            expect(mockConfigService.set).toHaveBeenCalled();
            const [section, configArg] = mockConfigService.set.mock.calls[0];
            expect(section).toBe('tts');
            expect(configArg).toEqual(newConfig);
            expect(mockEventBus.emit).not.toHaveBeenCalled();
        });

        it('should handle update failure', () => {
            mockConfigService.set.mockReturnValue(false);

            const result = ttsService.updateConfig({ enabled: false });

            expect(result).toBe(false);
            expect(mockEventBus.emit).not.toHaveBeenCalled();
        });

        it('should handle missing ConfigService', () => {
            ttsService = new TTSService(null, mockEventBus, { logger: noOpLogger });

            const result = ttsService.updateConfig({ enabled: false });

            expect(result).toBe(false);
            expect(mockEventBus.emit).not.toHaveBeenCalled();
        });

        it('should work without EventBus', () => {
            ttsService = new TTSService(mockConfigService, null, { logger: noOpLogger });

            const result = ttsService.updateConfig({ enabled: false });

            expect(result).toBeTruthy();
            expect(mockConfigService.set).toHaveBeenCalled();
        });
    });

    describe('Text Sanitization', () => {
        beforeEach(() => {
            ttsService = new TTSService(mockConfigService, mockEventBus, { logger: noOpLogger });
        });

        it('should preserve profanity', () => {
            const result = ttsService._cleanText('This is fucking awesome shit');
            expect(result).toBe('This is fucking awesome shit');
        });

        it('should remove URLs', () => {
            const result = ttsService._cleanText('Visit https://example.com for more info');
            expect(result).toBe('Visit [filtered] for more info');
        });

        it('should remove special characters', () => {
            const result = ttsService._cleanText('Hello @#$%^&*() world');
            expect(result).toBe('Hello [filtered] world');
        });

        it('should preserve basic punctuation', () => {
            const result = ttsService._cleanText("Hello, world! How's it going?");
            expect(result).toBe("Hello, world! How's it going?");
        });

        it('should handle null/undefined text', () => {
            expect(ttsService._cleanText(null)).toBe('');
            expect(ttsService._cleanText(undefined)).toBe('');
            expect(ttsService._cleanText('')).toBe('');
        });

        it('should handle non-string input', () => {
            expect(ttsService._cleanText(123)).toBe('');
            expect(ttsService._cleanText({})).toBe('');
        });

        it('should normalize whitespace', () => {
            const result = ttsService._cleanText('Hello     world   \n\n  test');
            expect(result).toBe('Hello world test');
        });

        it('should truncate long text', () => {
            const longText = 'a'.repeat(600);
            const result = ttsService._cleanText(longText);
            expect(result).toBe('a'.repeat(500) + '...');
        });
    });

    describe('Default Settings', () => {
        beforeEach(() => {
            ttsService = new TTSService(mockConfigService, mockEventBus, { logger: noOpLogger });
        });

        it('should get default voice setting', () => {
            const voice = ttsService._getDefaultVoice();
            expect(voice).toBe('default');
        });

        it('should get custom voice setting', () => {
            mockConfigService.getTTSConfig.mockReturnValue({
                voice: 'custom-voice'
            });

            const voice = ttsService._getDefaultVoice();
            expect(voice).toBe('custom-voice');
        });

        it('should get default rate setting', () => {
            const rate = ttsService._getDefaultRate();
            expect(rate).toBe(1.0);
        });

        it('should get custom rate setting', () => {
            mockConfigService.getTTSConfig.mockReturnValue({
                rate: 1.5
            });

            const rate = ttsService._getDefaultRate();
            expect(rate).toBe(1.5);
        });

        it('should get default volume setting', () => {
            const volume = ttsService._getDefaultVolume();
            expect(volume).toBe(1.0);
        });

        it('should get custom volume setting', () => {
            mockConfigService.getTTSConfig.mockReturnValue({
                volume: 0.7
            });

            const volume = ttsService._getDefaultVolume();
            expect(volume).toBe(0.7);
        });
    });
});
