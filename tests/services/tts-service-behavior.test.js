const { TTSService } = require('../../src/services/TTSService');
const { EventBus } = require('../../src/core/EventBus');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');

const flushPromises = () => Promise.resolve();

describe('TTS Service behavior', () => {
    let ttsService;
    let eventBus;
    let mockConfigService;
    let primaryProvider;
    let fallbackProvider;
    let logger;

    beforeEach(() => {
        jest.useFakeTimers();
        eventBus = new EventBus();
        mockConfigService = {
            getTTSConfig: () => ({
                enabled: true,
                voice: 'en-US-Neural',
                rate: 1.0,
                volume: 1.0
            }),
            set: () => true
        };

        primaryProvider = {
            name: 'PrimaryTTS',
            isAvailable: () => true,
            speak: jest.fn(async () => ({ success: true, duration: 10 })),
            stop: jest.fn(async () => true),
            dispose: jest.fn(async () => true)
        };

        fallbackProvider = {
            name: 'FallbackTTS',
            isAvailable: () => true,
            speak: jest.fn(async () => ({ success: true, duration: 10 })),
            stop: jest.fn(async () => true),
            dispose: jest.fn(async () => true)
        };

        logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    });

    afterEach(async () => {
        if (ttsService) {
            await ttsService.dispose();
        }
        jest.useRealTimers();
    });

    it('uses the primary provider when it is available', async () => {
        ttsService = new TTSService(mockConfigService, eventBus, { logger, provider: primaryProvider });

        const result = await ttsService.speak('Hello world');

        expect(result).toBeTruthy();
        await flushPromises();
        jest.runOnlyPendingTimers();
        await flushPromises();

        expect(primaryProvider.speak).toHaveBeenCalled();
        expect(fallbackProvider.speak).not.toHaveBeenCalled();
    });

    it('switches to the fallback provider when the primary provider fails', async () => {
        primaryProvider.speak = jest.fn().mockRejectedValue(new Error('primary down'));
        ttsService = new TTSService(mockConfigService, eventBus, {
            logger,
            provider: primaryProvider,
            fallbackProvider
        });

        await ttsService.speak('Use fallback');
        await flushPromises();
        jest.runOnlyPendingTimers();
        await flushPromises();

        expect(primaryProvider.speak).toHaveBeenCalled();
        expect(fallbackProvider.speak).toHaveBeenCalled();
        expect(ttsService.stats.providerSwitches).toBe(1);
    });

    it('attempts fallback when all providers fail', async () => {
        primaryProvider.speak = jest.fn().mockRejectedValue(new Error('primary down'));
        fallbackProvider.speak = jest.fn().mockRejectedValue(new Error('fallback down'));
        ttsService = new TTSService(mockConfigService, eventBus, {
            logger,
            provider: primaryProvider,
            fallbackProvider
        });

        await ttsService.speak('Total failure');
        await flushPromises();
        jest.runOnlyPendingTimers();
        await flushPromises();

        expect(primaryProvider.speak).toHaveBeenCalled();
        expect(fallbackProvider.speak).toHaveBeenCalled();
    });

    it('respects platform-specific TTS enablement settings', async () => {
        mockConfigService.getTTSConfig = () => ({
            enabled: true,
            platformSettings: {
                twitch: { enabled: false },
                tiktok: { enabled: true }
            }
        });

        ttsService = new TTSService(mockConfigService, eventBus, { logger, provider: primaryProvider });

        eventBus.emit(PlatformEvents.TTS_SPEECH_REQUESTED, {
            text: 'Should not speak',
            notificationType: 'gift',
            platform: 'twitch'
        });
        eventBus.emit(PlatformEvents.TTS_SPEECH_REQUESTED, {
            text: 'Should speak',
            notificationType: 'gift',
            platform: 'tiktok'
        });

        await flushPromises();
        jest.runOnlyPendingTimers();
        await flushPromises();

        expect(primaryProvider.speak).toHaveBeenCalledTimes(1);
        const call = primaryProvider.speak.mock.calls[0];
        expect(call[0]).toBe('Should speak');
    });
});
