const { TTSService } = require('../../src/services/TTSService');
const { EventBus } = require('../../src/core/EventBus');
const { safeSetTimeout } = require('../../src/utils/timeout-validator');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');

function waitForEvent(eventBus, eventName, timeout = 2000) {
    return new Promise((resolve, reject) => {
        const timeoutId = safeSetTimeout(() => {
            reject(new Error(`Event '${eventName}' not emitted within ${timeout}ms`));
        }, timeout);

        eventBus.once(eventName, (data) => {
            clearTimeout(timeoutId);
            resolve(data);
        });
    });
}

function waitForEventMatching(eventBus, eventName, predicate, timeout = 2000) {
    return new Promise((resolve, reject) => {
        const timeoutId = safeSetTimeout(() => {
            eventBus.off(eventName, handler);
            reject(new Error(`Event '${eventName}' not emitted within ${timeout}ms`));
        }, timeout);

        const handler = (data) => {
            if (predicate(data)) {
                clearTimeout(timeoutId);
                eventBus.off(eventName, handler);
                resolve(data);
            }
        };

        eventBus.on(eventName, handler);
    });
}

describe('TTS Service behavior', () => {
    let ttsService;
    let eventBus;
    let mockConfigService;
    let primaryProvider;
    let fallbackProvider;
    let logger;

    beforeEach(() => {
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
    });

    it('emits speech-requested and speech-completed for the primary provider', async () => {
        ttsService = new TTSService(mockConfigService, eventBus, { logger, provider: primaryProvider });

        const requestedPromise = waitForEvent(eventBus, PlatformEvents.TTS_SPEECH_REQUESTED);
        const completedPromise = waitForEvent(eventBus, PlatformEvents.TTS_SPEECH_COMPLETED);

        const result = await ttsService.speak('Hello world');

        expect(result).toBeTruthy();

        const requestedEvent = await requestedPromise;
        const completedEvent = await completedPromise;

        expect(requestedEvent.text).toContain('Hello world');
        expect(completedEvent.provider).toBe('primary');
    });

    it('switches to the fallback provider when the primary provider fails', async () => {
        primaryProvider.speak = jest.fn().mockRejectedValue(new Error('primary down'));
        ttsService = new TTSService(mockConfigService, eventBus, {
            logger,
            provider: primaryProvider,
            fallbackProvider
        });

        const switchPromise = waitForEvent(eventBus, 'tts:provider-switched');
        const completedPromise = waitForEvent(eventBus, PlatformEvents.TTS_SPEECH_COMPLETED);

        await ttsService.speak('Use fallback');

        const switchEvent = await switchPromise;
        const completedEvent = await completedPromise;

        expect(switchEvent).toEqual(expect.objectContaining({
            from: primaryProvider.name,
            to: fallbackProvider.name
        }));
        expect(completedEvent.provider).toBe('fallback');
    });

    it('emits speech-failed when all providers fail', async () => {
        primaryProvider.speak = jest.fn().mockRejectedValue(new Error('primary down'));
        fallbackProvider.speak = jest.fn().mockRejectedValue(new Error('fallback down'));
        ttsService = new TTSService(mockConfigService, eventBus, {
            logger,
            provider: primaryProvider,
            fallbackProvider
        });

        const failPromise = waitForEvent(eventBus, PlatformEvents.TTS_SPEECH_FAILED);

        await ttsService.speak('Total failure');

        const failEvent = await failPromise;
        expect(failEvent.error).toBe('fallback down');
    });

    it('respects platform-specific TTS enablement settings', async () => {
        mockConfigService.getTTSConfig = () => ({
            enabled: true,
            platformSettings: {
                twitch: { enabled: false },
                tiktok: { enabled: true }
            }
        });

        const requestedEvents = [];
        eventBus.on(PlatformEvents.TTS_SPEECH_REQUESTED, (data) => {
            if (data.source === 'tts-service') {
                requestedEvents.push(data);
            }
        });

        ttsService = new TTSService(mockConfigService, eventBus, { logger, provider: primaryProvider });

        const requestedPromise = waitForEventMatching(
            eventBus,
            PlatformEvents.TTS_SPEECH_REQUESTED,
            (data) => data.source === 'tts-service' && data.platform === 'tiktok'
        );

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

        const requestedEvent = await requestedPromise;

        expect(requestedEvent.text).toContain('Should speak');
        expect(requestedEvents).toHaveLength(1);
        expect(requestedEvents[0].platform).toBe('tiktok');
    });
});
