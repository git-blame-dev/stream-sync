const { describe, expect, it } = require('bun:test');
const { ConfigValidator } = require('../../../src/utils/config-validator');

describe('Config field presence - all normalizers return expected fields', () => {
    describe('_normalizeGeneralSection', () => {
        const EXPECTED_FIELDS = [
            'debugEnabled',
            'messagesEnabled',
            'commandsEnabled',
            'greetingsEnabled',
            'farewellsEnabled',
            'followsEnabled',
            'giftsEnabled',
            'raidsEnabled',
            'sharesEnabled',
            'paypiggiesEnabled',
            'greetNewCommentors',
            'filterOldMessages',
            'logChatMessages',
            'keywordParsingEnabled',
            'ignoreSelfMessages',
            'userSuppressionEnabled',
            'ttsEnabled',
            'streamDetectionEnabled',
            'envFileReadEnabled',
            'envFileWriteEnabled',
            'cmdCoolDown',
            'globalCmdCoolDown',
            'viewerCountPollingInterval',
            'maxNotificationsPerUser',
            'suppressionWindow',
            'suppressionDuration',
            'suppressionCleanupInterval',
            'streamRetryInterval',
            'streamMaxRetries',
            'continuousMonitoringInterval',
            'maxMessageLength',
            'viewerCountScene',
            'chatMsgTxt',
            'chatMsgScene',
            'chatMsgGroup',
            'fallbackUsername',
            'anonymousUsername',
            'envFilePath'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeGeneralSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });

        it('preserves field values from raw config', () => {
            const raw = {
                debugEnabled: 'true',
                cmdCoolDown: '120',
                fallbackUsername: 'TestUser'
            };
            const result = ConfigValidator._normalizeGeneralSection(raw);

            expect(result.debugEnabled).toBe(true);
            expect(result.cmdCoolDown).toBe(120);
            expect(result.fallbackUsername).toBe('TestUser');
        });
    });

    describe('_normalizeHttpSection', () => {
        const EXPECTED_FIELDS = [
            'userAgents',
            'defaultTimeoutMs',
            'reachabilityTimeoutMs',
            'enhancedTimeoutMs',
            'enhancedReachabilityTimeoutMs'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeHttpSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeObsSection', () => {
        const EXPECTED_FIELDS = [
            'enabled',
            'address',
            'connectionTimeoutMs',
            'notificationTxt',
            'notificationScene',
            'notificationMsgGroup',
            'ttsTxt',
            'chatPlatformLogoTwitch',
            'chatPlatformLogoYouTube',
            'chatPlatformLogoTikTok',
            'notificationPlatformLogoTwitch',
            'notificationPlatformLogoYouTube',
            'notificationPlatformLogoTikTok'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeObsSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeTiktokSection', () => {
        const EXPECTED_FIELDS = [
            'enabled',
            'username',
            'viewerCountEnabled',
            'viewerCountSource',
            'greetingsEnabled',
            'giftAggregationEnabled',
            'dataLoggingEnabled',
            'greetNewCommentors',
            'messagesEnabled',
            'commandsEnabled',
            'farewellsEnabled',
            'followsEnabled',
            'giftsEnabled',
            'raidsEnabled',
            'paypiggiesEnabled',
            'ignoreSelfMessages',
            'pollInterval'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeTiktokSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });

        it('preserves viewerCountSource from raw config', () => {
            const raw = { viewerCountSource: 'tiktok viewer count' };
            const result = ConfigValidator._normalizeTiktokSection(raw);

            expect(result.viewerCountSource).toBe('tiktok viewer count');
        });
    });

    describe('_normalizeTwitchSection', () => {
        const EXPECTED_FIELDS = [
            'enabled',
            'username',
            'clientId',
            'channel',
            'viewerCountEnabled',
            'viewerCountSource',
            'eventsubEnabled',
            'dataLoggingEnabled',
            'tokenStorePath',
            'greetNewCommentors',
            'messagesEnabled',
            'commandsEnabled',
            'farewellsEnabled',
            'followsEnabled',
            'giftsEnabled',
            'raidsEnabled',
            'paypiggiesEnabled',
            'ignoreSelfMessages',
            'pollInterval'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeTwitchSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });

        it('preserves viewerCountSource from raw config', () => {
            const raw = { viewerCountSource: 'twitch viewer count' };
            const result = ConfigValidator._normalizeTwitchSection(raw);

            expect(result.viewerCountSource).toBe('twitch viewer count');
        });
    });

    describe('_normalizeYoutubeSection', () => {
        const EXPECTED_FIELDS = [
            'enabled',
            'username',
            'viewerCountEnabled',
            'viewerCountSource',
            'retryAttempts',
            'maxStreams',
            'streamPollingInterval',
            'fullCheckInterval',
            'dataLoggingEnabled',
            'enableAPI',
            'streamDetectionMethod',
            'viewerCountMethod',
            'greetNewCommentors',
            'messagesEnabled',
            'commandsEnabled',
            'farewellsEnabled',
            'followsEnabled',
            'giftsEnabled',
            'raidsEnabled',
            'paypiggiesEnabled',
            'ignoreSelfMessages',
            'pollInterval'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeYoutubeSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });

        it('preserves viewerCountSource from raw config', () => {
            const raw = { viewerCountSource: 'youtube viewer count' };
            const result = ConfigValidator._normalizeYoutubeSection(raw);

            expect(result.viewerCountSource).toBe('youtube viewer count');
        });
    });

    describe('_normalizeHandcamSection', () => {
        const EXPECTED_FIELDS = [
            'glowEnabled',
            'sourceName',
            'sceneName',
            'glowFilterName',
            'maxSize',
            'rampUpDuration',
            'holdDuration',
            'rampDownDuration',
            'totalSteps',
            'incrementPercent',
            'easingEnabled',
            'animationInterval'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeHandcamSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeGoalsSection', () => {
        const EXPECTED_FIELDS = [
            'enabled',
            'goalScene',
            'tiktokGoalEnabled',
            'tiktokGoalSource',
            'tiktokGoalTarget',
            'tiktokGoalCurrency',
            'tiktokPaypiggyEquivalent',
            'youtubeGoalEnabled',
            'youtubeGoalSource',
            'youtubeGoalTarget',
            'youtubeGoalCurrency',
            'youtubePaypiggyPrice',
            'twitchGoalEnabled',
            'twitchGoalSource',
            'twitchGoalTarget',
            'twitchGoalCurrency',
            'twitchPaypiggyEquivalent'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeGoalsSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeGiftsSection', () => {
        const EXPECTED_FIELDS = [
            'command',
            'giftVideoSource',
            'giftAudioSource',
            'giftScene'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeGiftsSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeTimingSection', () => {
        const EXPECTED_FIELDS = [
            'fadeDuration',
            'notificationClearDelay',
            'transitionDelay',
            'chatMessageDuration'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeTimingSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeCooldownsSection', () => {
        const EXPECTED_FIELDS = [
            'defaultCooldown',
            'heavyCommandCooldown',
            'heavyCommandThreshold',
            'heavyCommandWindow',
            'maxEntries'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeCooldownsSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeTtsSection', () => {
        const EXPECTED_FIELDS = [
            'onlyForGifts',
            'voice',
            'rate',
            'volume'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeTtsSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeSpamSection', () => {
        const EXPECTED_FIELDS = [
            'enabled',
            'lowValueThreshold',
            'detectionWindow',
            'maxIndividualNotifications',
            'tiktokEnabled',
            'tiktokLowValueThreshold',
            'twitchEnabled',
            'twitchLowValueThreshold',
            'youtubeEnabled',
            'youtubeLowValueThreshold'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeSpamSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeDisplayQueueSection', () => {
        const EXPECTED_FIELDS = [
            'autoProcess',
            'chatOptimization',
            'maxQueueSize'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeDisplayQueueSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeRetrySection', () => {
        const EXPECTED_FIELDS = [
            'maxRetries',
            'baseDelay',
            'maxDelay',
            'enableRetry'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeRetrySection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeIntervalsSection', () => {
        const EXPECTED_FIELDS = [
            'pollInterval',
            'connectionTimeout',
            'keepAliveInterval',
            'healthCheckInterval'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeIntervalsSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeConnectionLimitsSection', () => {
        const EXPECTED_FIELDS = [
            'maxConnections',
            'maxConcurrentRequests',
            'maxStreamsPerConnection'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeConnectionLimitsSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeApiSection', () => {
        const EXPECTED_FIELDS = [
            'requestTimeout'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeApiSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeLoggingSection', () => {
        it('returns empty object (logging handled separately in config.js)', () => {
            const result = ConfigValidator._normalizeLoggingSection({});

            expect(result).toEqual({});
        });
    });

    describe('_normalizeFarewellSection', () => {
        const EXPECTED_FIELDS = [
            'enabled',
            'command'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeFarewellSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeVfxSection', () => {
        const EXPECTED_FIELDS = [
            'vfxFilePath'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeVfxSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeStreamElementsSection', () => {
        const EXPECTED_FIELDS = [
            'enabled',
            'youtubeChannelId',
            'twitchChannelId',
            'dataLoggingEnabled'
        ];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeStreamElementsSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeFollowsSection', () => {
        const EXPECTED_FIELDS = ['command'];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeFollowsSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeRaidsSection', () => {
        const EXPECTED_FIELDS = ['command'];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeRaidsSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizePaypiggiesSection', () => {
        const EXPECTED_FIELDS = ['command'];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizePaypiggiesSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeGreetingsSection', () => {
        const EXPECTED_FIELDS = ['command'];

        it('returns all expected fields', () => {
            const result = ConfigValidator._normalizeGreetingsSection({});

            EXPECTED_FIELDS.forEach(field => {
                expect(result).toHaveProperty(field);
            });
        });
    });

    describe('_normalizeCommandsSection', () => {
        it('returns enabled field', () => {
            const result = ConfigValidator._normalizeCommandsSection({});

            expect(result).toHaveProperty('enabled');
        });

        it('preserves command definitions', () => {
            const raw = {
                enabled: 'true',
                'test-cmd': '!test, vfx top'
            };
            const result = ConfigValidator._normalizeCommandsSection(raw);

            expect(result.enabled).toBe(true);
            expect(result['test-cmd']).toBe('!test, vfx top');
        });
    });
});

describe('Platform config viewerCountSource consistency', () => {
    it('all platform normalizers handle viewerCountSource identically', () => {
        const testSource = 'test-viewer-count-source';

        const tiktokResult = ConfigValidator._normalizeTiktokSection({ viewerCountSource: testSource });
        const twitchResult = ConfigValidator._normalizeTwitchSection({ viewerCountSource: testSource });
        const youtubeResult = ConfigValidator._normalizeYoutubeSection({ viewerCountSource: testSource });

        expect(tiktokResult.viewerCountSource).toBe(testSource);
        expect(twitchResult.viewerCountSource).toBe(testSource);
        expect(youtubeResult.viewerCountSource).toBe(testSource);
    });

    it('all platform normalizers return empty string as default for viewerCountSource', () => {
        const tiktokResult = ConfigValidator._normalizeTiktokSection({});
        const twitchResult = ConfigValidator._normalizeTwitchSection({});
        const youtubeResult = ConfigValidator._normalizeYoutubeSection({});

        expect(typeof tiktokResult.viewerCountSource).toBe('string');
        expect(typeof twitchResult.viewerCountSource).toBe('string');
        expect(typeof youtubeResult.viewerCountSource).toBe('string');
    });
});
