const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { useFakeTimers, useRealTimers, runOnlyPendingTimers } = require('../../helpers/bun-timers');
const { noOpLogger } = require('../../helpers/mock-factories');

const { TTSService } = require('../../../src/services/TTSService');
const { EventBus } = require('../../../src/core/EventBus');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');

const flushPromises = () => Promise.resolve();

describe('TTS Service behavior', () => {
    let ttsService;
    let eventBus;
    let mockConfigService;
    let primaryProvider;
    let fallbackProvider;

    beforeEach(() => {
        useFakeTimers();
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
            speak: createMockFn(async () => ({ success: true, duration: 10 })),
            stop: createMockFn(async () => true),
            dispose: createMockFn(async () => true)
        };

        fallbackProvider = {
            name: 'FallbackTTS',
            isAvailable: () => true,
            speak: createMockFn(async () => ({ success: true, duration: 10 })),
            stop: createMockFn(async () => true),
            dispose: createMockFn(async () => true)
        };
    });

    afterEach(async () => {
        restoreAllMocks();
        if (ttsService) {
            await ttsService.dispose();
        }
        useRealTimers();
    });

    it('uses the primary provider when it is available', async () => {
        ttsService = new TTSService(mockConfigService, eventBus, { logger: noOpLogger, provider: primaryProvider });

        const result = await ttsService.speak('Hello world');

        expect(result).toBeTruthy();
        await flushPromises();
        runOnlyPendingTimers();
        await flushPromises();

        expect(primaryProvider.speak).toHaveBeenCalled();
        expect(fallbackProvider.speak).not.toHaveBeenCalled();
    });

    it('switches to the fallback provider when the primary provider fails', async () => {
        primaryProvider.speak = createMockFn().mockRejectedValue(new Error('primary down'));
        ttsService = new TTSService(mockConfigService, eventBus, {
            logger: noOpLogger,
            provider: primaryProvider,
            fallbackProvider
        });

        await ttsService.speak('Use fallback');
        await flushPromises();
        runOnlyPendingTimers();
        await flushPromises();

        expect(primaryProvider.speak).toHaveBeenCalled();
        expect(fallbackProvider.speak).toHaveBeenCalled();
        expect(ttsService.stats.providerSwitches).toBe(1);
    });

    it('attempts fallback when all providers fail', async () => {
        primaryProvider.speak = createMockFn().mockRejectedValue(new Error('primary down'));
        fallbackProvider.speak = createMockFn().mockRejectedValue(new Error('fallback down'));
        ttsService = new TTSService(mockConfigService, eventBus, {
            logger: noOpLogger,
            provider: primaryProvider,
            fallbackProvider
        });

        await ttsService.speak('Total failure');
        await flushPromises();
        runOnlyPendingTimers();
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

        ttsService = new TTSService(mockConfigService, eventBus, { logger: noOpLogger, provider: primaryProvider });

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
        runOnlyPendingTimers();
        await flushPromises();

        expect(primaryProvider.speak).toHaveBeenCalledTimes(1);
        const call = primaryProvider.speak.mock.calls[0];
        expect(call[0]).toBe('Should speak');
    });
});
