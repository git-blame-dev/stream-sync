const { CONFIG_SCHEMA, getFieldsRequiredWhenEnabled, DEFAULTS } = require('../core/config-schema');

class ConfigValidator {
    static _normalizeGreetingIdentityUsername(platform, username) {
        let normalizedUsername = String(username).trim().toLowerCase();
        if (platform === 'youtube') {
            normalizedUsername = normalizedUsername.replace(/^@+/, '');
        }
        return normalizedUsername;
    }

    static _parseGreetingCustomProfileLine(profileId, rawValue) {
        if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
            throw new Error(`greetings.${profileId} must be a non-empty string`);
        }

        const commaIndex = rawValue.indexOf(',');
        if (commaIndex === -1) {
            throw new Error(`greetings.${profileId} must include a comma separator`);
        }

        const identityPart = rawValue.slice(0, commaIndex).trim();
        const commandPart = rawValue.slice(commaIndex + 1).trim();

        if (!commandPart.startsWith('!')) {
            throw new Error(`greetings.${profileId} command must start with !`);
        }

        if (!identityPart) {
            throw new Error(`greetings.${profileId} requires at least one platform:username identity`);
        }

        const identityTokens = identityPart
            .split('|')
            .map((token) => token.trim())
            .filter((token) => token.length > 0);

        if (identityTokens.length === 0) {
            throw new Error(`greetings.${profileId} requires at least one platform:username identity`);
        }

        const identities = identityTokens.map((token) => {
            const separatorIndex = token.indexOf(':');
            if (separatorIndex === -1) {
                throw new Error(`greetings.${profileId} has invalid identity token: ${token}`);
            }

            const platform = token.slice(0, separatorIndex).trim().toLowerCase();
            const usernameRaw = token.slice(separatorIndex + 1).trim();

            if (!['tiktok', 'youtube', 'twitch'].includes(platform)) {
                throw new Error(`greetings.${profileId} has unsupported platform: ${platform}`);
            }

            const normalizedUsername = ConfigValidator._normalizeGreetingIdentityUsername(platform, usernameRaw);
            if (!normalizedUsername) {
                throw new Error(`greetings.${profileId} has empty username for platform ${platform}`);
            }

            return `${platform}:${normalizedUsername}`;
        });

        return {
            profileId,
            command: commandPart,
            identities
        };
    }

    static _readEnvString(envKey) {
        const value = process.env[envKey];
        if (value === undefined || value === null) return '';
        return String(value).trim();
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
        const { defaultValue, min, max, allowZero = true, requireInteger = false } = options;
        if (value === undefined || value === null) return defaultValue;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return defaultValue;
        if (requireInteger && !Number.isInteger(parsed)) return defaultValue;
        if (!allowZero && parsed === 0) return defaultValue;
        if (typeof min === 'number' && parsed < min) return defaultValue;
        if (typeof max === 'number' && parsed > max) return defaultValue;
        return parsed;
    }

    static _parseNumberFromSchema(section, field, value) {
        const spec = CONFIG_SCHEMA[section][field];
        return ConfigValidator.parseNumber(value, {
            defaultValue: DEFAULTS[section][field],
            min: spec.min,
            max: spec.max,
            requireInteger: spec.integer === true
        });
    }

    static normalizeFromSchema(sectionName, rawData) {
        const sectionSchema = CONFIG_SCHEMA[sectionName];
        if (!sectionSchema || sectionSchema._dynamic) return {};

        const result = {};
        for (const [fieldName, spec] of Object.entries(sectionSchema)) {
            result[fieldName] = ConfigValidator._normalizeFieldFromSpec(rawData[fieldName], spec);
        }
        return result;
    }

    static _normalizeFieldFromSpec(value, spec) {
        if (spec.userDefined) {
            return value === undefined || value === null ? null : ConfigValidator.parseString(value, null);
        }

        if (spec.inheritFrom) {
            return value === undefined || value === null ? null : ConfigValidator.parseBoolean(value, null);
        }

        const defaultValue = spec.default ?? null;

        switch (spec.type) {
            case 'boolean':
                return ConfigValidator.parseBoolean(value, defaultValue);
            case 'number':
                return ConfigValidator.parseNumber(value, {
                    defaultValue,
                    min: spec.min,
                    max: spec.max,
                    requireInteger: spec.integer === true
                });
            case 'string':
                if (spec.enum) {
                    const parsed = ConfigValidator.parseString(value, defaultValue)?.toLowerCase();
                    return spec.enum.includes(parsed) ? parsed : defaultValue;
                }
                return ConfigValidator.parseString(value, defaultValue);
            default:
                return defaultValue;
        }
    }

    static _parseInheritableFlags(raw) {
        return {
            messagesEnabled: ConfigValidator.parseBoolean(raw.messagesEnabled, null),
            commandsEnabled: ConfigValidator.parseBoolean(raw.commandsEnabled, null),
            greetingsEnabled: ConfigValidator.parseBoolean(raw.greetingsEnabled, null),
            farewellsEnabled: ConfigValidator.parseBoolean(raw.farewellsEnabled, null),
            followsEnabled: ConfigValidator.parseBoolean(raw.followsEnabled, null),
            giftsEnabled: ConfigValidator.parseBoolean(raw.giftsEnabled, null),
            raidsEnabled: ConfigValidator.parseBoolean(raw.raidsEnabled, null),
            paypiggiesEnabled: ConfigValidator.parseBoolean(raw.paypiggiesEnabled, null),
            ignoreSelfMessages: ConfigValidator.parseBoolean(raw.ignoreSelfMessages, null)
        };
    }

    static _parseShareFlag(raw) {
        return {
            sharesEnabled: ConfigValidator.parseBoolean(raw.sharesEnabled, null)
        };
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
            envelopes: ConfigValidator._normalizeEnvelopesSection(rawConfig.envelopes || {}),
            timing: ConfigValidator._normalizeTimingSection(rawConfig.timing || {}),
            cooldowns: ConfigValidator._normalizeCooldownsSection(rawConfig.cooldowns || {}),
            spam: ConfigValidator._normalizeSpamSection(rawConfig.spam || {}),
            displayQueue: ConfigValidator._normalizeDisplayQueueSection(rawConfig.displayQueue || {}),
            logging: ConfigValidator._normalizeLoggingSection(rawConfig.logging || {}),
            gui: ConfigValidator._normalizeGuiSection(rawConfig.gui || {}),
            farewell: ConfigValidator._normalizeFarewellSection(rawConfig.farewell || {}),
            commands: ConfigValidator._normalizeCommandsSection(rawConfig.commands || {}),
            vfx: ConfigValidator._normalizeVfxSection(rawConfig.vfx || {}),
            streamelements: ConfigValidator._normalizeStreamElementsSection(rawConfig.streamelements || {}),
            follows: ConfigValidator._normalizeFollowsSection(rawConfig.follows || {}),
            raids: ConfigValidator._normalizeRaidsSection(rawConfig.raids || {}),
            paypiggies: ConfigValidator._normalizePaypiggiesSection(rawConfig.paypiggies || {}),
            greetings: ConfigValidator._normalizeGreetingsSection(rawConfig.greetings || {}),
            shares: ConfigValidator._normalizeSharesSection(rawConfig.shares || {})
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
            filterOldMessages: ConfigValidator.parseBoolean(raw.filterOldMessages, DEFAULTS.general.filterOldMessages),
            logChatMessages: ConfigValidator.parseBoolean(raw.logChatMessages, DEFAULTS.general.logChatMessages),
            keywordParsingEnabled: ConfigValidator.parseBoolean(raw.keywordParsingEnabled, DEFAULTS.general.keywordParsingEnabled),
            ignoreSelfMessages: ConfigValidator.parseBoolean(raw.ignoreSelfMessages, DEFAULTS.general.ignoreSelfMessages),
            envFileReadEnabled: ConfigValidator.parseBoolean(raw.envFileReadEnabled, DEFAULTS.general.envFileReadEnabled),
            envFileWriteEnabled: ConfigValidator.parseBoolean(raw.envFileWriteEnabled, DEFAULTS.general.envFileWriteEnabled),
            viewerCountPollingInterval: ConfigValidator.parseNumber(raw.viewerCountPollingInterval, { defaultValue: DEFAULTS.general.viewerCountPollingInterval }),
            maxMessageLength: ConfigValidator.parseNumber(raw.maxMessageLength, { defaultValue: DEFAULTS.general.maxMessageLength }),
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
            ttsEnabled: ConfigValidator.parseBoolean(raw.ttsEnabled, DEFAULTS.obs.ttsEnabled),
            chatMsgTxt: ConfigValidator.parseString(raw.chatMsgTxt, DEFAULTS.obs.chatMsgTxt),
            chatMsgScene: ConfigValidator.parseString(raw.chatMsgScene, DEFAULTS.obs.chatMsgScene),
            chatMsgGroup: ConfigValidator.parseString(raw.chatMsgGroup, DEFAULTS.obs.chatMsgGroup),
            notificationTxt: ConfigValidator.parseString(raw.notificationTxt, DEFAULTS.obs.notificationTxt),
            notificationScene: ConfigValidator.parseString(raw.notificationScene, DEFAULTS.obs.notificationScene),
            notificationMsgGroup: ConfigValidator.parseString(raw.notificationMsgGroup, DEFAULTS.obs.notificationMsgGroup),
            ttsTxt: ConfigValidator.parseString(raw.ttsTxt, DEFAULTS.obs.ttsTxt),
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
            viewerCountSource: ConfigValidator.parseString(raw.viewerCountSource, null),
            giftAggregationEnabled: ConfigValidator.parseBoolean(raw.giftAggregationEnabled, DEFAULTS.tiktok.giftAggregationEnabled),
            dataLoggingEnabled: ConfigValidator.parseBoolean(raw.dataLoggingEnabled, DEFAULTS.tiktok.dataLoggingEnabled),
            ...ConfigValidator._parseInheritableFlags(raw),
            ...ConfigValidator._parseShareFlag(raw),
            pollInterval: ConfigValidator.parseNumber(raw.pollInterval, { defaultValue: null })
        };
    }

    static _normalizeTwitchSection(raw) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.twitch.enabled),
            username: ConfigValidator.parseString(raw.username, ''),
            clientId: ConfigValidator._readEnvString('TWITCH_CLIENT_ID'),
            channel: ConfigValidator.parseString(raw.channel, ''),
            viewerCountEnabled: ConfigValidator.parseBoolean(raw.viewerCountEnabled, DEFAULTS.twitch.viewerCountEnabled),
            viewerCountSource: ConfigValidator.parseString(raw.viewerCountSource, null),
            dataLoggingEnabled: ConfigValidator.parseBoolean(raw.dataLoggingEnabled, DEFAULTS.twitch.dataLoggingEnabled),
            tokenStorePath: ConfigValidator.parseString(raw.tokenStorePath, DEFAULTS.twitch.tokenStorePath),
            ...ConfigValidator._parseInheritableFlags(raw),
            pollInterval: ConfigValidator.parseNumber(raw.pollInterval, { defaultValue: null })
        };
    }

    static _normalizeYoutubeSection(raw) {
        const method = ConfigValidator.parseString(raw.streamDetectionMethod, DEFAULTS.youtube.streamDetectionMethod).toLowerCase();
        const viewerMethod = ConfigValidator.parseString(raw.viewerCountMethod, DEFAULTS.youtube.viewerCountMethod).toLowerCase();
        const chatMode = ConfigValidator.parseString(raw.chatMode, DEFAULTS.youtube.chatMode).toLowerCase();

        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.youtube.enabled),
            username: ConfigValidator.parseString(raw.username, ''),
            viewerCountEnabled: ConfigValidator.parseBoolean(raw.viewerCountEnabled, DEFAULTS.youtube.viewerCountEnabled),
            viewerCountSource: ConfigValidator.parseString(raw.viewerCountSource, null),
            maxStreams: ConfigValidator.parseNumber(raw.maxStreams, { defaultValue: DEFAULTS.youtube.maxStreams }),
            streamPollingInterval: ConfigValidator.parseNumber(raw.streamPollingInterval, { defaultValue: DEFAULTS.youtube.streamPollingInterval }),
            fullCheckInterval: ConfigValidator.parseNumber(raw.fullCheckInterval, { defaultValue: DEFAULTS.youtube.fullCheckInterval }),
            dataLoggingEnabled: ConfigValidator.parseBoolean(raw.dataLoggingEnabled, DEFAULTS.youtube.dataLoggingEnabled),
            enableAPI: ConfigValidator.parseBoolean(raw.enableAPI, DEFAULTS.youtube.enableAPI),
            streamDetectionMethod: ['youtubei', 'api'].includes(method) ? method : DEFAULTS.youtube.streamDetectionMethod,
            viewerCountMethod: ['youtubei', 'api'].includes(viewerMethod) ? viewerMethod : DEFAULTS.youtube.viewerCountMethod,
            chatMode: ['live', 'top'].includes(chatMode) ? chatMode : DEFAULTS.youtube.chatMode,
            ...ConfigValidator._parseInheritableFlags(raw),
            pollInterval: ConfigValidator.parseNumber(raw.pollInterval, { defaultValue: null })
        };
    }

    static _normalizeHandcamSection(raw) {
        const num = (field) => ConfigValidator._parseNumberFromSchema('handcam', field, raw[field]);
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.handcam.enabled),
            sourceName: ConfigValidator.parseString(raw.sourceName, DEFAULTS.handcam.sourceName),
            glowFilterName: ConfigValidator.parseString(raw.glowFilterName, DEFAULTS.handcam.glowFilterName),
            maxSize: num('maxSize'),
            rampUpDuration: num('rampUpDuration'),
            holdDuration: num('holdDuration'),
            rampDownDuration: num('rampDownDuration'),
            totalSteps: num('totalSteps'),
            easingEnabled: ConfigValidator.parseBoolean(raw.easingEnabled, DEFAULTS.handcam.easingEnabled)
        };
    }

    static _normalizeGoalsSection(raw) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.goals.enabled),
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
            giftAudioSource: ConfigValidator.parseString(raw.giftAudioSource, DEFAULTS.gifts.giftAudioSource)
        };
    }

    static _normalizeEnvelopesSection(raw) {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizeTimingSection(raw) {
        return {
            fadeDuration: ConfigValidator.parseNumber(raw.fadeDuration, { defaultValue: DEFAULTS.timing.fadeDuration }),
            notificationClearDelay: ConfigValidator.parseNumber(raw.notificationClearDelay, { defaultValue: DEFAULTS.timing.notificationClearDelay }),
            transitionDelay: ConfigValidator.parseNumber(raw.transitionDelay, { defaultValue: DEFAULTS.timing.transitionDelay }),
            chatMessageDuration: ConfigValidator.parseNumber(raw.chatMessageDuration, { defaultValue: DEFAULTS.timing.chatMessageDuration })
        };
    }

    static _normalizeCooldownsSection(raw) {
        const num = (field) => ConfigValidator._parseNumberFromSchema('cooldowns', field, raw[field]);
        return {
            cmdCooldown: num('cmdCooldown'),
            globalCmdCooldown: num('globalCmdCooldown'),
            defaultCooldown: num('defaultCooldown'),
            heavyCommandCooldown: num('heavyCommandCooldown'),
            heavyCommandThreshold: num('heavyCommandThreshold'),
            heavyCommandWindow: num('heavyCommandWindow'),
            maxEntries: num('maxEntries')
        };
    }

    static _normalizeSpamSection(raw) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.spam.enabled),
            lowValueThreshold: ConfigValidator.parseNumber(raw.lowValueThreshold, { defaultValue: DEFAULTS.spam.lowValueThreshold }),
            detectionWindow: ConfigValidator.parseNumber(raw.detectionWindow, { defaultValue: DEFAULTS.spam.detectionWindow }),
            maxIndividualNotifications: ConfigValidator.parseNumber(raw.maxIndividualNotifications, { defaultValue: DEFAULTS.spam.maxIndividualNotifications }),
            tiktokEnabled: ConfigValidator.parseBoolean(raw.tiktokEnabled, DEFAULTS.spam.tiktokEnabled),
            tiktokLowValueThreshold: ConfigValidator.parseNumber(raw.tiktokLowValueThreshold, { defaultValue: DEFAULTS.spam.tiktokLowValueThreshold }),
            twitchEnabled: ConfigValidator.parseBoolean(raw.twitchEnabled, DEFAULTS.spam.twitchEnabled),
            twitchLowValueThreshold: ConfigValidator.parseNumber(raw.twitchLowValueThreshold, { defaultValue: DEFAULTS.spam.twitchLowValueThreshold }),
            youtubeEnabled: ConfigValidator.parseBoolean(raw.youtubeEnabled, DEFAULTS.spam.youtubeEnabled),
            youtubeLowValueThreshold: ConfigValidator.parseNumber(raw.youtubeLowValueThreshold, { defaultValue: DEFAULTS.spam.youtubeLowValueThreshold })
        };
    }

    static _normalizeDisplayQueueSection(raw) {
        return {
            autoProcess: ConfigValidator.parseBoolean(raw.autoProcess, DEFAULTS.displayQueue.autoProcess),
            maxQueueSize: ConfigValidator.parseNumber(raw.maxQueueSize, { defaultValue: DEFAULTS.displayQueue.maxQueueSize })
        };
    }

    static _normalizeLoggingSection(raw) {
        return {
            consoleLevel: ConfigValidator.parseString(raw.consoleLevel, null),
            fileLevel: ConfigValidator.parseString(raw.fileLevel, null),
            fileLoggingEnabled: ConfigValidator.parseBoolean(raw.fileLoggingEnabled, null)
        };
    }

    static _normalizeGuiSection(raw) {
        const normalized = ConfigValidator.normalizeFromSchema('gui', raw);

        if (normalized.host === '') {
            normalized.host = DEFAULTS.gui.host;
        }

        return normalized;
    }

    static _normalizeFarewellSection(raw) {
        return {
            command: ConfigValidator.parseString(raw.command, ''),
            timeout: ConfigValidator.parseNumber(raw.timeout, { defaultValue: 300, min: 1, requireInteger: true })
        };
    }

    static _normalizeCommandsSection(raw) {
        const normalized = {};

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
            filePath: ConfigValidator.parseString(raw.filePath, '')
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
        const customVfxProfiles = {};
        for (const [key, value] of Object.entries(raw)) {
            if (key === 'command') {
                continue;
            }

            const profileId = String(key).trim();
            if (!profileId) {
                throw new Error('greetings profile key must be non-empty');
            }

            const parsedProfile = ConfigValidator._parseGreetingCustomProfileLine(profileId, value);
            for (const identityKey of parsedProfile.identities) {
                if (Object.prototype.hasOwnProperty.call(customVfxProfiles, identityKey)) {
                    throw new Error(`greetings custom VFX identity mapped more than once: ${identityKey}`);
                }

                customVfxProfiles[identityKey] = {
                    profileId: parsedProfile.profileId,
                    command: parsedProfile.command
                };
            }
        }

        return {
            command: ConfigValidator.parseString(raw.command, ''),
            customVfxProfiles
        };
    }

    static _normalizeSharesSection(raw) {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static validate(config) {
        const errors = [];

        ConfigValidator._validateRequiredSections(config, errors);
        ConfigValidator.validateRequiredFields(config, errors);
        ConfigValidator._validateStreamElements(config, errors);

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static validateRequiredFields(config, errors) {
        const platformSections = ['youtube', 'twitch', 'tiktok'];

        for (const sectionName of platformSections) {
            const sectionConfig = config[sectionName];
            if (!sectionConfig || !sectionConfig.enabled) continue;

            const requiredFields = getFieldsRequiredWhenEnabled(sectionName);
            for (const fieldName of requiredFields) {
                const value = sectionConfig[fieldName];
                if (!value || (typeof value === 'string' && value.trim() === '')) {
                    errors.push(`Missing required configuration: ${sectionName}.${fieldName} (required when ${sectionName} is enabled)`);
                }
            }

            if (sectionName === 'twitch' && !ConfigValidator._readEnvString('TWITCH_CLIENT_ID')) {
                errors.push('Missing required environment variable: TWITCH_CLIENT_ID (required when twitch is enabled)');
            }
        }
    }

    static _validateRequiredSections(config, errors) {
        if (!config.general || typeof config.general !== 'object') {
            errors.push('Missing required configuration section: general');
        }
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

}

module.exports = {
    ConfigValidator
};
