const { describe, expect, it } = require('bun:test');
const { ConfigValidator } = require('../../src/utils/config-validator');
const { _buildConfig } = require('../../src/core/config');
const { getRawTestConfig } = require('../helpers/config-fixture');

describe('Config build pipeline integration', () => {
    describe('buildConfig includes all sections required by main.js', () => {
        it('contains all config sections accessed by main.js', () => {
            const rawConfig = getRawTestConfig();
            const normalized = ConfigValidator.normalize(rawConfig);
            const built = _buildConfig(normalized);

            expect(built.general).toBeDefined();
            expect(built.http).toBeDefined();
            expect(built.obs).toBeDefined();
            expect(built.twitch).toBeDefined();
            expect(built.youtube).toBeDefined();
            expect(built.tiktok).toBeDefined();
            expect(built.handcam).toBeDefined();
            expect(built.gifts).toBeDefined();
            expect(built.displayQueue).toBeDefined();
            expect(built.timing).toBeDefined();
            expect(built.spam).toBeDefined();
            expect(built.cooldowns).toBeDefined();
            expect(built.tts).toBeDefined();
            expect(built.vfx).toBeDefined();
            expect(built.goals).toBeDefined();
            expect(built.streamelements).toBeDefined();
            expect(built.commands).toBeDefined();
            expect(built.logging).toBeDefined();
        });

        it('displayQueue section contains required fields for DisplayQueue', () => {
            const rawConfig = getRawTestConfig();
            const normalized = ConfigValidator.normalize(rawConfig);
            const built = _buildConfig(normalized);

            expect(built.displayQueue.autoProcess).toBeDefined();
            expect(built.displayQueue.maxQueueSize).toBeDefined();
            expect(built.displayQueue.chatOptimization).toBeDefined();
            expect(typeof built.displayQueue.autoProcess).toBe('boolean');
            expect(typeof built.displayQueue.maxQueueSize).toBe('number');
            expect(typeof built.displayQueue.chatOptimization).toBe('boolean');
        });

        it('platform sections contain fields needed for DisplayQueue gating', () => {
            const rawConfig = getRawTestConfig();
            const normalized = ConfigValidator.normalize(rawConfig);
            const built = _buildConfig(normalized);

            expect(built.youtube).toBeDefined();
            expect(built.twitch).toBeDefined();
            expect(built.tiktok).toBeDefined();

            expect(built.youtube.enabled).toBeDefined();
            expect(built.twitch.enabled).toBeDefined();
            expect(built.tiktok.enabled).toBeDefined();
        });

        it('timing section contains fields needed for display timing', () => {
            const rawConfig = getRawTestConfig();
            const normalized = ConfigValidator.normalize(rawConfig);
            const built = _buildConfig(normalized);

            expect(built.timing.transitionDelay).toBeDefined();
            expect(built.timing.notificationClearDelay).toBeDefined();
            expect(built.timing.chatMessageDuration).toBeDefined();
            expect(typeof built.timing.transitionDelay).toBe('number');
            expect(typeof built.timing.notificationClearDelay).toBe('number');
            expect(typeof built.timing.chatMessageDuration).toBe('number');
        });

        it('obs section contains platform logo mappings', () => {
            const rawConfig = getRawTestConfig();
            const normalized = ConfigValidator.normalize(rawConfig);
            const built = _buildConfig(normalized);

            expect(built.obs.chatPlatformLogos).toBeDefined();
            expect(built.obs.notificationPlatformLogos).toBeDefined();
            expect(built.obs.chatPlatformLogos.twitch).toBeDefined();
            expect(built.obs.chatPlatformLogos.youtube).toBeDefined();
            expect(built.obs.chatPlatformLogos.tiktok).toBeDefined();
        });

        it('general section contains required startup fields', () => {
            const rawConfig = getRawTestConfig();
            const normalized = ConfigValidator.normalize(rawConfig);
            const built = _buildConfig(normalized);

            expect(built.general.debugEnabled).toBeDefined();
            expect(built.general.ttsEnabled).toBeDefined();
            expect(built.general.chatMsgTxt).toBeDefined();
            expect(built.general.chatMsgScene).toBeDefined();
            expect(built.general.envFilePath).toBeDefined();
            expect(built.general.envFileReadEnabled).toBeDefined();
            expect(built.general.envFileWriteEnabled).toBeDefined();
        });
    });

    describe('normalize → build pipeline preserves types', () => {
        it('boolean fields remain booleans through pipeline', () => {
            const rawConfig = {
                ...getRawTestConfig(),
                general: { debugEnabled: 'true', ttsEnabled: 'false' },
                displayQueue: { autoProcess: 'true', chatOptimization: 'false' }
            };
            const normalized = ConfigValidator.normalize(rawConfig);
            const built = _buildConfig(normalized);

            expect(typeof built.general.debugEnabled).toBe('boolean');
            expect(built.general.debugEnabled).toBe(true);
            expect(typeof built.general.ttsEnabled).toBe('boolean');
            expect(built.general.ttsEnabled).toBe(false);
            expect(typeof built.displayQueue.autoProcess).toBe('boolean');
            expect(built.displayQueue.autoProcess).toBe(true);
            expect(typeof built.displayQueue.chatOptimization).toBe('boolean');
            expect(built.displayQueue.chatOptimization).toBe(false);
        });

        it('number fields remain numbers through pipeline', () => {
            const rawConfig = {
                ...getRawTestConfig(),
                displayQueue: { maxQueueSize: '200' },
                timing: { transitionDelay: '500', chatMessageDuration: '6000' }
            };
            const normalized = ConfigValidator.normalize(rawConfig);
            const built = _buildConfig(normalized);

            expect(typeof built.displayQueue.maxQueueSize).toBe('number');
            expect(built.displayQueue.maxQueueSize).toBe(200);
            expect(typeof built.timing.transitionDelay).toBe('number');
            expect(built.timing.transitionDelay).toBe(500);
            expect(typeof built.timing.chatMessageDuration).toBe('number');
            expect(built.timing.chatMessageDuration).toBe(6000);
        });
    });

    describe('defaults applied correctly through pipeline', () => {
        it('displayQueue defaults applied when section missing', () => {
            const rawConfig = getRawTestConfig();
            delete rawConfig.displayQueue;
            const normalized = ConfigValidator.normalize(rawConfig);
            const built = _buildConfig(normalized);

            expect(built.displayQueue.autoProcess).toBe(true);
            expect(built.displayQueue.maxQueueSize).toBe(100);
            expect(built.displayQueue.chatOptimization).toBe(true);
        });

        it('timing defaults applied when section missing', () => {
            const rawConfig = getRawTestConfig();
            delete rawConfig.timing;
            const normalized = ConfigValidator.normalize(rawConfig);
            const built = _buildConfig(normalized);

            expect(built.timing.transitionDelay).toBeDefined();
            expect(built.timing.notificationClearDelay).toBeDefined();
            expect(built.timing.chatMessageDuration).toBeDefined();
        });
    });

    describe('platform configs include inherited flags', () => {
        it('platform sections include messagesEnabled for gating', () => {
            const rawConfig = {
                ...getRawTestConfig(),
                twitch: { enabled: 'true', username: 'test-user', clientId: 'test-id', channel: 'test-channel', messagesEnabled: 'false' }
            };
            const normalized = ConfigValidator.normalize(rawConfig);
            const built = _buildConfig(normalized);

            expect(built.twitch.messagesEnabled).toBe(false);
        });

        it('platform sections inherit from general when not explicitly set', () => {
            const rawConfig = {
                ...getRawTestConfig(),
                general: { messagesEnabled: 'true' },
                tiktok: { enabled: 'false' }
            };
            const normalized = ConfigValidator.normalize(rawConfig);
            const built = _buildConfig(normalized);

            expect(built.general.messagesEnabled).toBe(true);
            expect(built.tiktok.messagesEnabled).toBe(true);
        });
    });
});
