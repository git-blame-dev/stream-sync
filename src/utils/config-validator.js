const { DEFAULTS } = require('../core/config-defaults');

class ConfigValidator {
    constructor(logger) {
        this.logger = logger;
    }

    validateRetryConfig(config = {}, defaults = {}) {
        const defaultRetryConfig = { ...DEFAULTS.retry, ...defaults };

        return {
            maxRetries: ConfigValidator.parseNumber(config.maxRetries, { defaultValue: defaultRetryConfig.maxRetries, min: 0, max: 20 }),
            baseDelay: ConfigValidator.parseNumber(config.baseDelay, { defaultValue: defaultRetryConfig.baseDelay, min: 100, max: 10000 }),
            maxDelay: ConfigValidator.parseNumber(config.maxDelay, { defaultValue: defaultRetryConfig.maxDelay, min: 1000, max: 300000 }),
            enableRetry: ConfigValidator.parseBoolean(config.enableRetry, defaultRetryConfig.enableRetry)
        };
    }

    validateIntervalConfig(config = {}, defaults = {}) {
        const defaultIntervalConfig = { ...DEFAULTS.intervals, ...defaults };

        return {
            pollInterval: ConfigValidator.parseNumber(config.pollInterval, { defaultValue: defaultIntervalConfig.pollInterval, min: 1000, max: 60000 }),
            connectionTimeout: ConfigValidator.parseNumber(config.connectionTimeout, { defaultValue: defaultIntervalConfig.connectionTimeout, min: 5000, max: 120000 }),
            keepAliveInterval: ConfigValidator.parseNumber(config.keepAliveInterval, { defaultValue: defaultIntervalConfig.keepAliveInterval, min: 10000, max: 300000 }),
            healthCheckInterval: ConfigValidator.parseNumber(config.healthCheckInterval, { defaultValue: defaultIntervalConfig.healthCheckInterval, min: 30000, max: 600000 })
        };
    }

    validateConnectionLimits(config = {}, defaults = {}) {
        const defaultLimits = { ...DEFAULTS.connectionLimits, ...defaults };

        return {
            maxConnections: ConfigValidator.parseNumber(config.maxConnections, { defaultValue: defaultLimits.maxConnections, min: 1, max: 10 }),
            maxConcurrentRequests: ConfigValidator.parseNumber(config.maxConcurrentRequests, { defaultValue: defaultLimits.maxConcurrentRequests, min: 1, max: 20 }),
            maxStreamsPerConnection: ConfigValidator.parseNumber(config.maxStreamsPerConnection, { defaultValue: defaultLimits.maxStreamsPerConnection, min: 1, max: 5 })
        };
    }

    validateApiConfig(config = {}, platformName = 'unknown') {
        const validated = {
            apiKey: ConfigValidator.parseSecret(config.apiKey),
            enabled: ConfigValidator.parseBoolean(config.enabled, false),
            useAPI: ConfigValidator.parseBoolean(config.useAPI, true),
            useScraping: ConfigValidator.parseBoolean(config.useScraping, false),
            requestTimeout: ConfigValidator.parseNumber(config.requestTimeout, { defaultValue: DEFAULTS.api.requestTimeout, min: 1000, max: 30000 })
        };

        if (validated.enabled && validated.useAPI && !validated.apiKey) {
            this.logger.warn(
                `API usage enabled but no API key provided for ${platformName}`,
                platformName
            );
        }

        return validated;
    }

    validateLoggingConfig(config = {}) {
        return {
            level: ConfigValidator.parseString(config.level, DEFAULTS.logging.level),
            enableDebug: ConfigValidator.parseBoolean(config.enableDebug, DEFAULTS.logging.enableDebug),
            enableConsole: ConfigValidator.parseBoolean(config.enableConsole, DEFAULTS.logging.enableConsole),
            enableFile: ConfigValidator.parseBoolean(config.enableFile, DEFAULTS.logging.enableFile),
            logPath: ConfigValidator.parseString(config.logPath, DEFAULTS.LOG_DIRECTORY),
            maxFileSize: ConfigValidator.parseNumber(config.maxFileSize, { defaultValue: DEFAULTS.logging.maxFileSize, min: 1048576, max: 104857600 })
        };
    }

    static parseBoolean(value, defaultValue) {
        if (value === undefined || value === null) return defaultValue;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const lowerValue = value.toLowerCase();
            if (lowerValue === 'true') return true;
            if (lowerValue === 'false') return false;
            return defaultValue;
        }
        return defaultValue;
    }

    static parseString(value, defaultValue) {
        if (value === undefined || value === null) return defaultValue;
        return String(value).trim();
    }

    static parseNumber(value, options = {}) {
        const { defaultValue, min, max, allowZero = true } = options;
        if (value === undefined || value === null) return defaultValue;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return defaultValue;
        if (!allowZero && parsed === 0) return defaultValue;
        if (typeof min === 'number' && parsed < min) return defaultValue;
        if (typeof max === 'number' && parsed > max) return defaultValue;
        return parsed;
    }

    static parseSecret(value) {
        const parsed = ConfigValidator.parseString(value);
        if (typeof parsed !== 'string') {
            return undefined;
        }
        const trimmed = parsed.trim();
        return trimmed.length ? trimmed : undefined;
    }

    static requireBoolean(value, fieldName) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const lowerValue = value.toLowerCase();
            if (lowerValue === 'true') return true;
            if (lowerValue === 'false') return false;
        }
        throw new Error(`${fieldName} must be a boolean`);
    }

    static requireString(value, fieldName, options = {}) {
        const { allowEmpty = false } = options;
        if (value === undefined || value === null) {
            throw new Error(`${fieldName} is required`);
        }
        const str = String(value).trim();
        if (!allowEmpty && str.length === 0) {
            throw new Error(`${fieldName} cannot be empty`);
        }
        return str;
    }

    static requireNumber(value, fieldName, options = {}) {
        const { min, max, integer = false } = options;
        if (value === undefined || value === null) {
            throw new Error(`${fieldName} is required`);
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            throw new Error(`${fieldName} must be a valid number`);
        }
        if (integer && !Number.isInteger(parsed)) {
            throw new Error(`${fieldName} must be an integer`);
        }
        if (typeof min === 'number' && parsed < min) {
            throw new Error(`${fieldName} must be at least ${min}`);
        }
        if (typeof max === 'number' && parsed > max) {
            throw new Error(`${fieldName} must be at most ${max}`);
        }
        return parsed;
    }

    static normalize(rawConfig) {
        return {
            general: ConfigValidator._normalizeGeneralSection(rawConfig.general || {}),
            http: ConfigValidator._normalizeHttpSection(rawConfig.http || {}),
            obs: ConfigValidator._normalizeObsSection(rawConfig.obs || {}),
            tiktok: ConfigValidator._normalizeTiktokSection(rawConfig.tiktok || {}),
            twitch: ConfigValidator._normalizeTwitchSection(rawConfig.twitch || {}),
            youtube: ConfigValidator._normalizeYoutubeSection(rawConfig.youtube || {}),
            handcam: ConfigValidator._normalizeHandcamSection(rawConfig.handcam || {}),
            goals: ConfigValidator._normalizeGoalsSection(rawConfig.goals || {}),
            gifts: ConfigValidator._normalizeGiftsSection(rawConfig.gifts || {}),
            timing: ConfigValidator._normalizeTimingSection(rawConfig.timing || {}),
            cooldowns: ConfigValidator._normalizeCooldownsSection(rawConfig.cooldowns || {}),
            tts: ConfigValidator._normalizeTtsSection(rawConfig.tts || {}),
            spam: ConfigValidator._normalizeSpamSection(rawConfig.spam || {}),
            displayQueue: ConfigValidator._normalizeDisplayQueueSection(rawConfig.displayQueue || {}),
            retry: ConfigValidator._normalizeRetrySection(rawConfig.retry || {}),
            intervals: ConfigValidator._normalizeIntervalsSection(rawConfig.intervals || {}),
            connectionLimits: ConfigValidator._normalizeConnectionLimitsSection(rawConfig.connectionLimits || {}),
            api: ConfigValidator._normalizeApiSection(rawConfig.api || {}),
            logging: ConfigValidator._normalizeLoggingSection(rawConfig.logging || {}),
            farewell: ConfigValidator._normalizeFarewellSection(rawConfig.farewell || {}),
            commands: ConfigValidator._normalizeCommandsSection(rawConfig.commands || {}),
            vfx: ConfigValidator._normalizeVfxSection(rawConfig.vfx || {}),
            streamelements: ConfigValidator._normalizeStreamElementsSection(rawConfig.streamelements || {}),
            follows: ConfigValidator._normalizeFollowsSection(rawConfig.follows || {}),
            raids: ConfigValidator._normalizeRaidsSection(rawConfig.raids || {}),
            paypiggies: ConfigValidator._normalizePaypiggiesSection(rawConfig.paypiggies || {}),
            greetings: ConfigValidator._normalizeGreetingsSection(rawConfig.greetings || {})
        };
    }

    static _normalizeGeneralSection(raw) {
        return {
            debugEnabled: ConfigValidator.parseBoolean(raw.debugEnabled, DEFAULTS.general.debugEnabled),
            messagesEnabled: ConfigValidator.parseBoolean(raw.messagesEnabled, DEFAULTS.general.messagesEnabled),
            commandsEnabled: ConfigValidator.parseBoolean(raw.commandsEnabled, DEFAULTS.general.commandsEnabled),
            greetingsEnabled: ConfigValidator.parseBoolean(raw.greetingsEnabled, DEFAULTS.general.greetingsEnabled),
            farewellsEnabled: ConfigValidator.parseBoolean(raw.farewellsEnabled, DEFAULTS.general.farewellsEnabled),
            followsEnabled: ConfigValidator.parseBoolean(raw.followsEnabled, DEFAULTS.general.followsEnabled),
            giftsEnabled: ConfigValidator.parseBoolean(raw.giftsEnabled, DEFAULTS.general.giftsEnabled),
            raidsEnabled: ConfigValidator.parseBoolean(raw.raidsEnabled, DEFAULTS.general.raidsEnabled),
            sharesEnabled: ConfigValidator.parseBoolean(raw.sharesEnabled, DEFAULTS.general.sharesEnabled),
            paypiggiesEnabled: ConfigValidator.parseBoolean(raw.paypiggiesEnabled, DEFAULTS.general.paypiggiesEnabled),
            greetNewCommentors: ConfigValidator.parseBoolean(raw.greetNewCommentors, DEFAULTS.general.greetNewCommentors),
            filterOldMessages: ConfigValidator.parseBoolean(raw.filterOldMessages, DEFAULTS.general.filterOldMessages),
            logChatMessages: ConfigValidator.parseBoolean(raw.logChatMessages, DEFAULTS.general.logChatMessages),
            keywordParsingEnabled: ConfigValidator.parseBoolean(raw.keywordParsingEnabled, DEFAULTS.general.keywordParsingEnabled),
            ignoreSelfMessages: ConfigValidator.parseBoolean(raw.ignoreSelfMessages, DEFAULTS.general.ignoreSelfMessages),
            userSuppressionEnabled: ConfigValidator.parseBoolean(raw.userSuppressionEnabled, DEFAULTS.general.userSuppressionEnabled),
            ttsEnabled: ConfigValidator.parseBoolean(raw.ttsEnabled, DEFAULTS.general.ttsEnabled),
            streamDetectionEnabled: ConfigValidator.parseBoolean(raw.streamDetectionEnabled, DEFAULTS.general.streamDetectionEnabled),
            envFileReadEnabled: ConfigValidator.parseBoolean(raw.envFileReadEnabled, DEFAULTS.general.envFileReadEnabled),
            envFileWriteEnabled: ConfigValidator.parseBoolean(raw.envFileWriteEnabled, DEFAULTS.general.envFileWriteEnabled),
            cmdCoolDown: ConfigValidator.parseNumber(raw.cmdCoolDown, { defaultValue: DEFAULTS.general.cmdCoolDown }),
            globalCmdCoolDown: ConfigValidator.parseNumber(raw.globalCmdCoolDown, { defaultValue: DEFAULTS.general.globalCmdCoolDown }),
            viewerCountPollingInterval: ConfigValidator.parseNumber(raw.viewerCountPollingInterval, { defaultValue: DEFAULTS.general.viewerCountPollingInterval }),
            maxNotificationsPerUser: ConfigValidator.parseNumber(raw.maxNotificationsPerUser, { defaultValue: DEFAULTS.general.maxNotificationsPerUser }),
            suppressionWindow: ConfigValidator.parseNumber(raw.suppressionWindow, { defaultValue: DEFAULTS.general.suppressionWindow }),
            suppressionDuration: ConfigValidator.parseNumber(raw.suppressionDuration, { defaultValue: DEFAULTS.general.suppressionDuration }),
            suppressionCleanupInterval: ConfigValidator.parseNumber(raw.suppressionCleanupInterval, { defaultValue: DEFAULTS.general.suppressionCleanupInterval }),
            streamRetryInterval: ConfigValidator.parseNumber(raw.streamRetryInterval, { defaultValue: DEFAULTS.general.streamRetryInterval }),
            streamMaxRetries: ConfigValidator.parseNumber(raw.streamMaxRetries, { defaultValue: DEFAULTS.general.streamMaxRetries }),
            continuousMonitoringInterval: ConfigValidator.parseNumber(raw.continuousMonitoringInterval, { defaultValue: DEFAULTS.general.continuousMonitoringInterval }),
            maxMessageLength: ConfigValidator.parseNumber(raw.maxMessageLength, { defaultValue: DEFAULTS.general.maxMessageLength }),
            viewerCountScene: ConfigValidator.parseString(raw.viewerCountScene, DEFAULTS.general.viewerCountScene),
            chatMsgTxt: ConfigValidator.parseString(raw.chatMsgTxt, DEFAULTS.general.chatMsgTxt),
            chatMsgScene: ConfigValidator.parseString(raw.chatMsgScene, DEFAULTS.general.chatMsgScene),
            chatMsgGroup: ConfigValidator.parseString(raw.chatMsgGroup, DEFAULTS.general.chatMsgGroup),
            fallbackUsername: ConfigValidator.parseString(raw.fallbackUsername, DEFAULTS.general.fallbackUsername),
            anonymousUsername: ConfigValidator.parseString(raw.anonymousUsername, DEFAULTS.general.anonymousUsername),
            envFilePath: ConfigValidator.parseString(raw.envFilePath, DEFAULTS.general.envFilePath)
        };
    }

    static _normalizeHttpSection(raw) {
        const { DEFAULT_HTTP_USER_AGENTS, parseUserAgentList } = require('../core/http-config');
        const parsedAgents = parseUserAgentList(raw.userAgents);

        return {
            userAgents: parsedAgents.length > 0 ? parsedAgents : DEFAULT_HTTP_USER_AGENTS.slice(),
            defaultTimeoutMs: ConfigValidator.parseNumber(raw.defaultTimeoutMs, { defaultValue: DEFAULTS.http.defaultTimeoutMs }),
            reachabilityTimeoutMs: ConfigValidator.parseNumber(raw.reachabilityTimeoutMs, { defaultValue: DEFAULTS.http.reachabilityTimeoutMs }),
            enhancedTimeoutMs: ConfigValidator.parseNumber(raw.enhancedTimeoutMs, { defaultValue: DEFAULTS.http.enhancedTimeoutMs }),
            enhancedReachabilityTimeoutMs: ConfigValidator.parseNumber(raw.enhancedReachabilityTimeoutMs, { defaultValue: DEFAULTS.http.enhancedReachabilityTimeoutMs })
        };
    }

    static _normalizeObsSection(raw) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.obs.enabled),
            address: ConfigValidator.parseString(raw.address, DEFAULTS.obs.address),
            connectionTimeoutMs: ConfigValidator.parseNumber(raw.connectionTimeoutMs, { defaultValue: DEFAULTS.obs.connectionTimeoutMs }),
            notificationTxt: ConfigValidator.parseString(raw.notificationTxt, DEFAULTS.obs.notificationTxt),
            chatMsgTxt: ConfigValidator.parseString(raw.chatMsgTxt, DEFAULTS.obs.chatMsgTxt),
            notificationScene: ConfigValidator.parseString(raw.notificationScene, DEFAULTS.obs.notificationScene),
            notificationMsgGroup: ConfigValidator.parseString(raw.notificationMsgGroup, DEFAULTS.obs.notificationMsgGroup),
            ttsTxt: ConfigValidator.parseString(raw.ttsTxt, DEFAULTS.obs.ttsTxt),
            ttsScene: ConfigValidator.parseString(raw.ttsScene, DEFAULTS.obs.ttsScene),
            chatPlatformLogoTwitch: ConfigValidator.parseString(raw.chatPlatformLogoTwitch, ''),
            chatPlatformLogoYouTube: ConfigValidator.parseString(raw.chatPlatformLogoYouTube, ''),
            chatPlatformLogoTikTok: ConfigValidator.parseString(raw.chatPlatformLogoTikTok, ''),
            notificationPlatformLogoTwitch: ConfigValidator.parseString(raw.notificationPlatformLogoTwitch, ''),
            notificationPlatformLogoYouTube: ConfigValidator.parseString(raw.notificationPlatformLogoYouTube, ''),
            notificationPlatformLogoTikTok: ConfigValidator.parseString(raw.notificationPlatformLogoTikTok, '')
        };
    }

    static _normalizeTiktokSection(raw) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.tiktok.enabled),
            username: ConfigValidator.parseString(raw.username, ''),
            viewerCountEnabled: ConfigValidator.parseBoolean(raw.viewerCountEnabled, DEFAULTS.tiktok.viewerCountEnabled),
            viewerCountSource: ConfigValidator.parseString(raw.viewerCountSource, DEFAULTS.tiktok.viewerCountSource),
            greetingsEnabled: ConfigValidator.parseBoolean(raw.greetingsEnabled, DEFAULTS.tiktok.greetingsEnabled),
            giftAggregationEnabled: ConfigValidator.parseBoolean(raw.giftAggregationEnabled, DEFAULTS.tiktok.giftAggregationEnabled),
            dataLoggingEnabled: ConfigValidator.parseBoolean(raw.dataLoggingEnabled, DEFAULTS.tiktok.dataLoggingEnabled),
            greetNewCommentors: ConfigValidator.parseBoolean(raw.greetNewCommentors, null),
            messagesEnabled: ConfigValidator.parseBoolean(raw.messagesEnabled, null),
            commandsEnabled: ConfigValidator.parseBoolean(raw.commandsEnabled, null),
            farewellsEnabled: ConfigValidator.parseBoolean(raw.farewellsEnabled, null),
            followsEnabled: ConfigValidator.parseBoolean(raw.followsEnabled, null),
            giftsEnabled: ConfigValidator.parseBoolean(raw.giftsEnabled, null),
            raidsEnabled: ConfigValidator.parseBoolean(raw.raidsEnabled, null),
            paypiggiesEnabled: ConfigValidator.parseBoolean(raw.paypiggiesEnabled, null),
            ignoreSelfMessages: ConfigValidator.parseBoolean(raw.ignoreSelfMessages, null),
            pollInterval: ConfigValidator.parseNumber(raw.pollInterval, { defaultValue: null })
        };
    }

    static _normalizeTwitchSection(raw) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.twitch.enabled),
            username: ConfigValidator.parseString(raw.username, ''),
            channel: ConfigValidator.parseString(raw.channel, ''),
            viewerCountEnabled: ConfigValidator.parseBoolean(raw.viewerCountEnabled, DEFAULTS.twitch.viewerCountEnabled),
            eventsubEnabled: ConfigValidator.parseBoolean(raw.eventsub_enabled, DEFAULTS.twitch.eventsubEnabled),
            dataLoggingEnabled: ConfigValidator.parseBoolean(raw.dataLoggingEnabled, DEFAULTS.twitch.dataLoggingEnabled),
            tokenStorePath: ConfigValidator.parseString(raw.tokenStorePath, DEFAULTS.twitch.tokenStorePath),
            greetNewCommentors: ConfigValidator.parseBoolean(raw.greetNewCommentors, null),
            messagesEnabled: ConfigValidator.parseBoolean(raw.messagesEnabled, null),
            commandsEnabled: ConfigValidator.parseBoolean(raw.commandsEnabled, null),
            farewellsEnabled: ConfigValidator.parseBoolean(raw.farewellsEnabled, null),
            followsEnabled: ConfigValidator.parseBoolean(raw.followsEnabled, null),
            giftsEnabled: ConfigValidator.parseBoolean(raw.giftsEnabled, null),
            raidsEnabled: ConfigValidator.parseBoolean(raw.raidsEnabled, null),
            paypiggiesEnabled: ConfigValidator.parseBoolean(raw.paypiggiesEnabled, null),
            ignoreSelfMessages: ConfigValidator.parseBoolean(raw.ignoreSelfMessages, null),
            pollInterval: ConfigValidator.parseNumber(raw.pollInterval, { defaultValue: null })
        };
    }

    static _normalizeYoutubeSection(raw) {
        const method = ConfigValidator.parseString(raw.streamDetectionMethod, DEFAULTS.youtube.streamDetectionMethod).toLowerCase();
        const viewerMethod = ConfigValidator.parseString(raw.viewerCountMethod, DEFAULTS.youtube.viewerCountMethod).toLowerCase();

        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.youtube.enabled),
            username: ConfigValidator.parseString(raw.username, ''),
            viewerCountEnabled: ConfigValidator.parseBoolean(raw.viewerCountEnabled, DEFAULTS.youtube.viewerCountEnabled),
            retryAttempts: ConfigValidator.parseNumber(raw.retryAttempts, { defaultValue: DEFAULTS.youtube.retryAttempts }),
            maxStreams: ConfigValidator.parseNumber(raw.maxStreams, { defaultValue: DEFAULTS.youtube.maxStreams }),
            streamPollingInterval: ConfigValidator.parseNumber(raw.streamPollingInterval, { defaultValue: DEFAULTS.youtube.streamPollingInterval }),
            fullCheckInterval: ConfigValidator.parseNumber(raw.fullCheckInterval, { defaultValue: DEFAULTS.youtube.fullCheckInterval }),
            dataLoggingEnabled: ConfigValidator.parseBoolean(raw.dataLoggingEnabled, DEFAULTS.youtube.dataLoggingEnabled),
            enableAPI: ConfigValidator.parseBoolean(raw.enableAPI, DEFAULTS.youtube.enableAPI),
            streamDetectionMethod: ['youtubei', 'api'].includes(method) ? method : DEFAULTS.youtube.streamDetectionMethod,
            viewerCountMethod: ['youtubei', 'api'].includes(viewerMethod) ? viewerMethod : DEFAULTS.youtube.viewerCountMethod,
            greetNewCommentors: ConfigValidator.parseBoolean(raw.greetNewCommentors, null),
            messagesEnabled: ConfigValidator.parseBoolean(raw.messagesEnabled, null),
            commandsEnabled: ConfigValidator.parseBoolean(raw.commandsEnabled, null),
            farewellsEnabled: ConfigValidator.parseBoolean(raw.farewellsEnabled, null),
            followsEnabled: ConfigValidator.parseBoolean(raw.followsEnabled, null),
            giftsEnabled: ConfigValidator.parseBoolean(raw.giftsEnabled, null),
            raidsEnabled: ConfigValidator.parseBoolean(raw.raidsEnabled, null),
            paypiggiesEnabled: ConfigValidator.parseBoolean(raw.paypiggiesEnabled, null),
            ignoreSelfMessages: ConfigValidator.parseBoolean(raw.ignoreSelfMessages, null),
            pollInterval: ConfigValidator.parseNumber(raw.pollInterval, { defaultValue: null })
        };
    }

    static _normalizeHandcamSection(raw) {
        return {
            glowEnabled: ConfigValidator.parseBoolean(raw.glowEnabled, DEFAULTS.handcam.glowEnabled),
            sourceName: ConfigValidator.parseString(raw.sourceName, DEFAULTS.handcam.sourceName),
            sceneName: ConfigValidator.parseString(raw.sceneName, DEFAULTS.handcam.sceneName),
            glowFilterName: ConfigValidator.parseString(raw.glowFilterName, DEFAULTS.handcam.glowFilterName),
            maxSize: ConfigValidator.parseNumber(raw.maxSize, { defaultValue: DEFAULTS.handcam.maxSize }),
            rampUpDuration: ConfigValidator.parseNumber(raw.rampUpDuration, { defaultValue: DEFAULTS.handcam.rampUpDuration }),
            holdDuration: ConfigValidator.parseNumber(raw.holdDuration, { defaultValue: DEFAULTS.handcam.holdDuration }),
            rampDownDuration: ConfigValidator.parseNumber(raw.rampDownDuration, { defaultValue: DEFAULTS.handcam.rampDownDuration }),
            totalSteps: ConfigValidator.parseNumber(raw.totalSteps, { defaultValue: DEFAULTS.handcam.totalSteps }),
            incrementPercent: ConfigValidator.parseNumber(raw.incrementPercent, { defaultValue: DEFAULTS.handcam.incrementPercent }),
            easingEnabled: ConfigValidator.parseBoolean(raw.easingEnabled, DEFAULTS.handcam.easingEnabled),
            animationInterval: ConfigValidator.parseNumber(raw.animationInterval, { defaultValue: DEFAULTS.handcam.animationInterval })
        };
    }

    static _normalizeGoalsSection(raw) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.goals.enabled),
            goalScene: ConfigValidator.parseString(raw.goalScene, DEFAULTS.goals.goalScene),
            tiktokGoalEnabled: ConfigValidator.parseBoolean(raw.tiktokGoalEnabled, DEFAULTS.goals.tiktokGoalEnabled),
            tiktokGoalSource: ConfigValidator.parseString(raw.tiktokGoalSource, ''),
            tiktokGoalTarget: ConfigValidator.parseNumber(raw.tiktokGoalTarget, { defaultValue: DEFAULTS.goals.tiktokGoalTarget }),
            tiktokGoalCurrency: ConfigValidator.parseString(raw.tiktokGoalCurrency, DEFAULTS.goals.tiktokGoalCurrency),
            tiktokPaypiggyEquivalent: ConfigValidator.parseNumber(raw.tiktokPaypiggyEquivalent, { defaultValue: DEFAULTS.goals.tiktokPaypiggyEquivalent }),
            youtubeGoalEnabled: ConfigValidator.parseBoolean(raw.youtubeGoalEnabled, DEFAULTS.goals.youtubeGoalEnabled),
            youtubeGoalSource: ConfigValidator.parseString(raw.youtubeGoalSource, ''),
            youtubeGoalTarget: ConfigValidator.parseNumber(raw.youtubeGoalTarget, { defaultValue: DEFAULTS.goals.youtubeGoalTarget }),
            youtubeGoalCurrency: ConfigValidator.parseString(raw.youtubeGoalCurrency, DEFAULTS.goals.youtubeGoalCurrency),
            youtubePaypiggyPrice: ConfigValidator.parseNumber(raw.youtubePaypiggyPrice, { defaultValue: DEFAULTS.goals.youtubePaypiggyPrice }),
            twitchGoalEnabled: ConfigValidator.parseBoolean(raw.twitchGoalEnabled, DEFAULTS.goals.twitchGoalEnabled),
            twitchGoalSource: ConfigValidator.parseString(raw.twitchGoalSource, ''),
            twitchGoalTarget: ConfigValidator.parseNumber(raw.twitchGoalTarget, { defaultValue: DEFAULTS.goals.twitchGoalTarget }),
            twitchGoalCurrency: ConfigValidator.parseString(raw.twitchGoalCurrency, DEFAULTS.goals.twitchGoalCurrency),
            twitchPaypiggyEquivalent: ConfigValidator.parseNumber(raw.twitchPaypiggyEquivalent, { defaultValue: DEFAULTS.goals.twitchPaypiggyEquivalent })
        };
    }

    static _normalizeGiftsSection(raw) {
        return {
            command: ConfigValidator.parseString(raw.command, ''),
            giftVideoSource: ConfigValidator.parseString(raw.giftVideoSource, DEFAULTS.gifts.giftVideoSource),
            giftAudioSource: ConfigValidator.parseString(raw.giftAudioSource, DEFAULTS.gifts.giftAudioSource),
            giftScene: ConfigValidator.parseString(raw.giftScene, DEFAULTS.gifts.giftScene),
            lowValueThreshold: ConfigValidator.parseNumber(raw.lowValueThreshold, { defaultValue: DEFAULTS.gifts.lowValueThreshold }),
            spamDetectionEnabled: ConfigValidator.parseBoolean(raw.spamDetectionEnabled, DEFAULTS.gifts.spamDetectionEnabled),
            spamDetectionWindow: ConfigValidator.parseNumber(raw.spamDetectionWindow, { defaultValue: DEFAULTS.gifts.spamDetectionWindow }),
            maxIndividualNotifications: ConfigValidator.parseNumber(raw.maxIndividualNotifications, { defaultValue: DEFAULTS.gifts.maxIndividualNotifications })
        };
    }

    static _normalizeTimingSection(raw) {
        return {
            fadeDuration: ConfigValidator.parseNumber(raw.fadeDuration, { defaultValue: DEFAULTS.timing.fadeDuration }),
            notificationClearDelay: ConfigValidator.parseNumber(raw.notificationClearDelay, { defaultValue: DEFAULTS.timing.notificationClearDelay }),
            transitionDelay: ConfigValidator.parseNumber(raw.transitionDelay, { defaultValue: DEFAULTS.timing.transitionDelay }),
            chatMessageDuration: ConfigValidator.parseNumber(raw.chatMessageDuration, { defaultValue: DEFAULTS.timing.chatMessageDuration }),
            defaultNotificationDuration: ConfigValidator.parseNumber(raw.defaultNotificationDuration, { defaultValue: DEFAULTS.timing.defaultNotificationDuration }),
            greetingDuration: ConfigValidator.parseNumber(raw.greetingDuration, { defaultValue: DEFAULTS.timing.greetingDuration }),
            followDuration: ConfigValidator.parseNumber(raw.followDuration, { defaultValue: DEFAULTS.timing.followDuration }),
            giftDuration: ConfigValidator.parseNumber(raw.giftDuration, { defaultValue: DEFAULTS.timing.giftDuration }),
            memberDuration: ConfigValidator.parseNumber(raw.memberDuration, { defaultValue: DEFAULTS.timing.memberDuration }),
            raidDuration: ConfigValidator.parseNumber(raw.raidDuration, { defaultValue: DEFAULTS.timing.raidDuration })
        };
    }

    static _normalizeCooldownsSection(raw) {
        return {
            defaultCooldown: ConfigValidator.parseNumber(raw.defaultCooldown, { defaultValue: DEFAULTS.cooldowns.defaultCooldown }),
            heavyCommandCooldown: ConfigValidator.parseNumber(raw.heavyCommandCooldown, { defaultValue: DEFAULTS.cooldowns.heavyCommandCooldown }),
            heavyCommandThreshold: ConfigValidator.parseNumber(raw.heavyCommandThreshold, { defaultValue: DEFAULTS.cooldowns.heavyCommandThreshold }),
            heavyCommandWindow: ConfigValidator.parseNumber(raw.heavyCommandWindow, { defaultValue: DEFAULTS.cooldowns.heavyCommandWindow }),
            maxEntries: ConfigValidator.parseNumber(raw.maxEntries, { defaultValue: DEFAULTS.cooldowns.maxEntries })
        };
    }

    static _normalizeTtsSection(raw) {
        return {
            deduplicationEnabled: ConfigValidator.parseBoolean(raw.deduplicationEnabled, DEFAULTS.tts.deduplicationEnabled),
            debugDeduplication: ConfigValidator.parseBoolean(raw.debugDeduplication, DEFAULTS.tts.debugDeduplication),
            onlyForGifts: ConfigValidator.parseBoolean(raw.onlyForGifts, DEFAULTS.tts.onlyForGifts),
            voice: ConfigValidator.parseString(raw.voice, DEFAULTS.tts.voice),
            rate: ConfigValidator.parseNumber(raw.rate, { defaultValue: DEFAULTS.tts.rate }),
            volume: ConfigValidator.parseNumber(raw.volume, { defaultValue: DEFAULTS.tts.volume }),
            twitchDeduplicationEnabled: ConfigValidator.parseBoolean(raw.twitchDeduplicationEnabled, DEFAULTS.tts.twitchDeduplicationEnabled),
            youtubeDeduplicationEnabled: ConfigValidator.parseBoolean(raw.youtubeDeduplicationEnabled, DEFAULTS.tts.youtubeDeduplicationEnabled),
            tiktokDeduplicationEnabled: ConfigValidator.parseBoolean(raw.tiktokDeduplicationEnabled, DEFAULTS.tts.tiktokDeduplicationEnabled),
            performanceWarningThreshold: ConfigValidator.parseNumber(raw.performanceWarningThreshold, { defaultValue: DEFAULTS.tts.performanceWarningThreshold })
        };
    }

    static _normalizeSpamSection(raw) {
        return {
            detectionWindow: ConfigValidator.parseNumber(raw.detectionWindow, { defaultValue: DEFAULTS.spam.detectionWindow }),
            maxIndividualNotifications: ConfigValidator.parseNumber(raw.maxIndividualNotifications, { defaultValue: DEFAULTS.spam.maxIndividualNotifications })
        };
    }

    static _normalizeDisplayQueueSection(raw) {
        return {
            autoProcess: ConfigValidator.parseBoolean(raw.autoProcess, DEFAULTS.displayQueue.autoProcess),
            chatOptimization: ConfigValidator.parseBoolean(raw.chatOptimization, DEFAULTS.displayQueue.chatOptimization),
            maxQueueSize: ConfigValidator.parseNumber(raw.maxQueueSize, { defaultValue: DEFAULTS.displayQueue.maxQueueSize })
        };
    }

    static _normalizeRetrySection(raw) {
        return {
            maxRetries: ConfigValidator.parseNumber(raw.maxRetries, { defaultValue: DEFAULTS.retry.maxRetries }),
            baseDelay: ConfigValidator.parseNumber(raw.baseDelay, { defaultValue: DEFAULTS.retry.baseDelay }),
            maxDelay: ConfigValidator.parseNumber(raw.maxDelay, { defaultValue: DEFAULTS.retry.maxDelay }),
            enableRetry: ConfigValidator.parseBoolean(raw.enableRetry, DEFAULTS.retry.enableRetry)
        };
    }

    static _normalizeIntervalsSection(raw) {
        return {
            pollInterval: ConfigValidator.parseNumber(raw.pollInterval, { defaultValue: DEFAULTS.intervals.pollInterval }),
            connectionTimeout: ConfigValidator.parseNumber(raw.connectionTimeout, { defaultValue: DEFAULTS.intervals.connectionTimeout }),
            keepAliveInterval: ConfigValidator.parseNumber(raw.keepAliveInterval, { defaultValue: DEFAULTS.intervals.keepAliveInterval }),
            healthCheckInterval: ConfigValidator.parseNumber(raw.healthCheckInterval, { defaultValue: DEFAULTS.intervals.healthCheckInterval })
        };
    }

    static _normalizeConnectionLimitsSection(raw) {
        return {
            maxConnections: ConfigValidator.parseNumber(raw.maxConnections, { defaultValue: DEFAULTS.connectionLimits.maxConnections }),
            maxConcurrentRequests: ConfigValidator.parseNumber(raw.maxConcurrentRequests, { defaultValue: DEFAULTS.connectionLimits.maxConcurrentRequests }),
            maxStreamsPerConnection: ConfigValidator.parseNumber(raw.maxStreamsPerConnection, { defaultValue: DEFAULTS.connectionLimits.maxStreamsPerConnection })
        };
    }

    static _normalizeApiSection(raw) {
        return {
            requestTimeout: ConfigValidator.parseNumber(raw.requestTimeout, { defaultValue: DEFAULTS.api.requestTimeout })
        };
    }

    static _normalizeLoggingSection(raw) {
        return {
            level: ConfigValidator.parseString(raw.level, DEFAULTS.logging.level),
            enableDebug: ConfigValidator.parseBoolean(raw.enableDebug, DEFAULTS.logging.enableDebug),
            enableConsole: ConfigValidator.parseBoolean(raw.enableConsole, DEFAULTS.logging.enableConsole),
            enableFile: ConfigValidator.parseBoolean(raw.enableFile, DEFAULTS.logging.enableFile),
            maxFileSize: ConfigValidator.parseNumber(raw.maxFileSize, { defaultValue: DEFAULTS.logging.maxFileSize }),
            platformDataLoggingEnabled: ConfigValidator.parseBoolean(raw.platformDataLoggingEnabled, DEFAULTS.logging.platformDataLoggingEnabled),
            streamelementsDataLoggingEnabled: ConfigValidator.parseBoolean(raw.streamelementsDataLoggingEnabled, DEFAULTS.logging.streamelementsDataLoggingEnabled)
        };
    }

    static _normalizeFarewellSection(raw) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.farewell.enabled),
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizeCommandsSection(raw) {
        const normalized = {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.commands.enabled)
        };

        for (const [key, value] of Object.entries(raw)) {
            if (key === 'enabled') continue;
            if (typeof value === 'string') {
                normalized[key] = value;
            }
        }

        return normalized;
    }

    static _normalizeVfxSection(raw) {
        return {
            vfxFilePath: ConfigValidator.parseString(raw.vfxFilePath, '')
        };
    }

    static _normalizeStreamElementsSection(raw) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.streamelements.enabled),
            youtubeChannelId: ConfigValidator.parseString(raw.youtubeChannelId, ''),
            twitchChannelId: ConfigValidator.parseString(raw.twitchChannelId, ''),
            dataLoggingEnabled: ConfigValidator.parseBoolean(raw.dataLoggingEnabled, DEFAULTS.streamelements.dataLoggingEnabled)
        };
    }

    static _normalizeFollowsSection(raw) {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizeRaidsSection(raw) {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizePaypiggiesSection(raw) {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizeGreetingsSection(raw) {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static validate(config) {
        const errors = [];
        const warnings = [];

        ConfigValidator._validateRequiredSections(config, errors);
        ConfigValidator._validatePlatformUsernames(config, errors);
        ConfigValidator._validateStreamElements(config, errors);
        ConfigValidator._validateCooldownRanges(config, warnings);
        ConfigValidator._validateHandcamRanges(config, warnings);
        ConfigValidator._validateRetryRanges(config, warnings);

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    static _validateRequiredSections(config, errors) {
        const requiredSections = ['general', 'obs', 'commands'];
        requiredSections.forEach(section => {
            if (!config[section] || typeof config[section] !== 'object') {
                errors.push(`Missing required configuration section: ${section}`);
            }
        });
    }

    static _validatePlatformUsernames(config, errors) {
        const platforms = ['youtube', 'tiktok', 'twitch'];
        const platformDisplayNames = {
            youtube: 'YouTube',
            tiktok: 'TikTok',
            twitch: 'Twitch'
        };

        platforms.forEach(platform => {
            const platformConfig = config[platform];
            if (platformConfig && platformConfig.enabled && !platformConfig.username) {
                const displayName = platformDisplayNames[platform];
                errors.push(`Missing required configuration: ${displayName} username`);
            }
        });
    }

    static _validateStreamElements(config, errors) {
        if (config.streamelements && config.streamelements.enabled) {
            const hasYoutubeChannel = config.streamelements.youtubeChannelId && 
                config.streamelements.youtubeChannelId.trim().length > 0;
            const hasTwitchChannel = config.streamelements.twitchChannelId && 
                config.streamelements.twitchChannelId.trim().length > 0;

            if (!hasYoutubeChannel && !hasTwitchChannel) {
                errors.push('Missing required configuration: StreamElements channel ID (YouTube or Twitch)');
            }
        }
    }

    static _validateCooldownRanges(config, warnings) {
        if (!config.cooldowns) return;

        const cooldown = config.cooldowns;

        if (cooldown.defaultCooldown < 10 || cooldown.defaultCooldown > 3600) {
            warnings.push('cooldowns.defaultCooldown should be between 10 and 3600 seconds');
        }

        if (cooldown.heavyCommandCooldown < 60 || cooldown.heavyCommandCooldown > 3600) {
            warnings.push('cooldowns.heavyCommandCooldown should be between 60 and 3600 seconds');
        }

        if (cooldown.heavyCommandThreshold < 2 || cooldown.heavyCommandThreshold > 20) {
            warnings.push('cooldowns.heavyCommandThreshold should be between 2 and 20');
        }
    }

    static _validateHandcamRanges(config, warnings) {
        if (!config.handcam) return;

        const handcam = config.handcam;

        if (handcam.maxSize < 1 || handcam.maxSize > 100) {
            warnings.push('handcam.maxSize should be between 1 and 100');
        }

        if (handcam.rampUpDuration < 0.1 || handcam.rampUpDuration > 10.0) {
            warnings.push('handcam.rampUpDuration should be between 0.1 and 10.0 seconds');
        }

        if (handcam.holdDuration < 0.1 || handcam.holdDuration > 10.0) {
            warnings.push('handcam.holdDuration should be between 0.1 and 10.0 seconds');
        }

        if (handcam.rampDownDuration < 0.1 || handcam.rampDownDuration > 10.0) {
            warnings.push('handcam.rampDownDuration should be between 0.1 and 10.0 seconds');
        }
    }

    static _validateRetryRanges(config, warnings) {
        if (!config.retry) return;

        const retry = config.retry;

        if (retry.baseDelay < 100 || retry.baseDelay > 30000) {
            warnings.push('retry.baseDelay should be between 100 and 30000 milliseconds');
        }

        if (retry.maxDelay < 1000 || retry.maxDelay > 300000) {
            warnings.push('retry.maxDelay should be between 1000 and 300000 milliseconds');
        }

        if (retry.maxRetries < 0 || retry.maxRetries > 20) {
            warnings.push('retry.maxRetries should be between 0 and 20');
        }
    }
}

module.exports = {
    ConfigValidator
};
