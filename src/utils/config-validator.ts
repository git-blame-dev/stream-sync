import { CONFIG_SCHEMA, DEFAULTS, getFieldsRequiredWhenEnabled, isConfigFieldSpec } from '../core/config-schema';
import type {
    ConfigFieldSpec,
    ConfigDefaultSectionName,
    ConfigSectionName,
    ConfigValidationResult,
    NormalizedConfig,
    NormalizedConfigSection,
    ParseNumberOptions,
    RawConfig,
    RawConfigSection
} from '../core/types/config-types';
import { DEFAULT_HTTP_USER_AGENTS, parseUserAgentList } from '../core/http-config';
import { normalizeGreetingIdentityKey } from './greeting-identity-key-normalizer';

class ConfigValidator {
    static _parseGreetingCustomProfileLine(profileId: string, rawValue: unknown): { profileId: string; command: string; identities: string[] } {
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
            .map((token: string) => token.trim())
            .filter((token: string) => token.length > 0);

        if (identityTokens.length === 0) {
            throw new Error(`greetings.${profileId} requires at least one platform:username identity`);
        }

        const identities = identityTokens.map((token: string) => {
            const separatorIndex = token.indexOf(':');
            if (separatorIndex === -1) {
                throw new Error(`greetings.${profileId} has invalid identity token: ${token}`);
            }

            const platform = token.slice(0, separatorIndex).trim().toLowerCase();
            const identityValueRaw = token.slice(separatorIndex + 1).trim();

            if (!['tiktok', 'youtube', 'twitch'].includes(platform)) {
                throw new Error(`greetings.${profileId} has unsupported platform: ${platform}`);
            }

            const normalizedIdentity = normalizeGreetingIdentityKey(platform, identityValueRaw);
            if (!normalizedIdentity) {
                throw new Error(`greetings.${profileId} has empty username for platform ${platform}`);
            }

            return `${platform}:${normalizedIdentity}`;
        });

        return {
            profileId,
            command: commandPart,
            identities
        };
    }

    static _readEnvString(envKey: string): string {
        const value = process.env[envKey];
        if (value === undefined || value === null) return '';
        return String(value).trim();
    }

    static parseBoolean(value: unknown, defaultValue: unknown): boolean | null {
        const fallback = typeof defaultValue === 'boolean' ? defaultValue : null;
        if (value === undefined || value === null) return fallback;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const lowerValue = value.toLowerCase();
            if (lowerValue === 'true') return true;
            if (lowerValue === 'false') return false;
            return fallback;
        }
        return fallback;
    }

    static parseString(value: unknown, defaultValue: unknown): string | null {
        if (value === undefined || value === null) {
            return defaultValue === undefined || defaultValue === null ? null : String(defaultValue).trim();
        }
        return String(value).trim();
    }

    static parseNumber(value: unknown, options: ParseNumberOptions = {}): number | null {
        const { defaultValue, min, max, allowZero = true, requireInteger = false } = options;
        const fallback = typeof defaultValue === 'number' ? defaultValue : null;
        if (value === undefined || value === null) return fallback;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        if (requireInteger && !Number.isInteger(parsed)) return fallback;
        if (!allowZero && parsed === 0) return fallback;
        if (typeof min === 'number' && parsed < min) return fallback;
        if (typeof max === 'number' && parsed > max) return fallback;
        return parsed;
    }

    static _parseNumberFromSchema(section: ConfigDefaultSectionName, field: string, value: unknown): number | null {
        const spec = CONFIG_SCHEMA[section]?.[field];
        if (!isConfigFieldSpec(spec)) {
            return null;
        }

        return ConfigValidator.parseNumber(value, {
            defaultValue: DEFAULTS[section][field],
            ...(spec.min === undefined ? {} : { min: spec.min }),
            ...(spec.max === undefined ? {} : { max: spec.max }),
            ...(spec.allowZero === undefined ? {} : { allowZero: spec.allowZero }),
            requireInteger: spec.integer === true
        });
    }

    static normalizeFromSchema(sectionName: ConfigSectionName, rawData: RawConfigSection): NormalizedConfigSection {
        const sectionSchema = CONFIG_SCHEMA[sectionName];
        if (!sectionSchema || sectionSchema._dynamic) return {};

        const result: NormalizedConfigSection = {};
        for (const [fieldName, spec] of Object.entries(sectionSchema)) {
            if (!isConfigFieldSpec(spec)) continue;
            result[fieldName] = ConfigValidator._normalizeFieldFromSpec(rawData[fieldName], spec);
        }
        return result;
    }

    static _normalizeFieldFromSpec(value: unknown, spec: ConfigFieldSpec): unknown {
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
                    ...(spec.min === undefined ? {} : { min: spec.min }),
                    ...(spec.max === undefined ? {} : { max: spec.max }),
                    ...(spec.allowZero === undefined ? {} : { allowZero: spec.allowZero }),
                    requireInteger: spec.integer === true
                });
            case 'string':
                if (spec.enum) {
                    const parsed = ConfigValidator.parseString(value, defaultValue)?.toLowerCase() ?? null;
                    return parsed !== null && spec.enum.includes(parsed) ? parsed : defaultValue;
                }
                return ConfigValidator.parseString(value, defaultValue);
            default:
                return defaultValue;
        }
    }

    static _parseInheritableFlags(raw: RawConfigSection): NormalizedConfigSection {
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

    static _parseShareFlag(raw: RawConfigSection): NormalizedConfigSection {
        return {
            sharesEnabled: ConfigValidator.parseBoolean(raw.sharesEnabled, null)
        };
    }

    static normalize(rawConfig: RawConfig): NormalizedConfig {
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

    static _normalizeGeneralSection(raw: RawConfigSection): NormalizedConfigSection {
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

    static _normalizeHttpSection(raw: RawConfigSection): NormalizedConfigSection {
        const parsedAgents = parseUserAgentList(raw.userAgents);

        return {
            userAgents: parsedAgents.length > 0 ? parsedAgents : DEFAULT_HTTP_USER_AGENTS.slice(),
            defaultTimeoutMs: ConfigValidator.parseNumber(raw.defaultTimeoutMs, { defaultValue: DEFAULTS.http.defaultTimeoutMs }),
            reachabilityTimeoutMs: ConfigValidator.parseNumber(raw.reachabilityTimeoutMs, { defaultValue: DEFAULTS.http.reachabilityTimeoutMs }),
            enhancedTimeoutMs: ConfigValidator.parseNumber(raw.enhancedTimeoutMs, { defaultValue: DEFAULTS.http.enhancedTimeoutMs }),
            enhancedReachabilityTimeoutMs: ConfigValidator.parseNumber(raw.enhancedReachabilityTimeoutMs, { defaultValue: DEFAULTS.http.enhancedReachabilityTimeoutMs })
        };
    }

    static _normalizeObsSection(raw: RawConfigSection): NormalizedConfigSection {
        const hasTtsNotificationsEnabled = Object.prototype.hasOwnProperty.call(raw, 'ttsNotificationsEnabled');
        const hasLegacyTtsEnabled = Object.prototype.hasOwnProperty.call(raw, 'ttsEnabled');

        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.obs.enabled),
            address: ConfigValidator.parseString(raw.address, DEFAULTS.obs.address),
            connectionTimeoutMs: ConfigValidator.parseNumber(raw.connectionTimeoutMs, { defaultValue: DEFAULTS.obs.connectionTimeoutMs }),
            ttsEnabled: ConfigValidator.parseBoolean(raw.ttsEnabled, DEFAULTS.obs.ttsEnabled),
            ttsChatEnabled: ConfigValidator.parseBoolean(raw.ttsChatEnabled, DEFAULTS.obs.ttsChatEnabled),
            ttsNotificationsEnabled: hasTtsNotificationsEnabled
                ? ConfigValidator.parseBoolean(raw.ttsNotificationsEnabled, DEFAULTS.obs.ttsNotificationsEnabled)
                : ConfigValidator.parseBoolean(
                    hasLegacyTtsEnabled ? raw.ttsEnabled : undefined,
                    DEFAULTS.obs.ttsNotificationsEnabled
                ),
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

    static _normalizeTiktokSection(raw: RawConfigSection): NormalizedConfigSection {
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

    static _normalizeTwitchSection(raw: RawConfigSection): NormalizedConfigSection {
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

    static _normalizeYoutubeSection(raw: RawConfigSection): NormalizedConfigSection {
        const method = (ConfigValidator.parseString(raw.streamDetectionMethod, DEFAULTS.youtube.streamDetectionMethod) ?? '').toLowerCase();
        const viewerMethod = (ConfigValidator.parseString(raw.viewerCountMethod, DEFAULTS.youtube.viewerCountMethod) ?? '').toLowerCase();
        const chatMode = (ConfigValidator.parseString(raw.chatMode, DEFAULTS.youtube.chatMode) ?? '').toLowerCase();

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

    static _normalizeHandcamSection(raw: RawConfigSection): NormalizedConfigSection {
        const num = (field: string) => ConfigValidator._parseNumberFromSchema('handcam', field, raw[field]);
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

    static _normalizeGoalsSection(raw: RawConfigSection): NormalizedConfigSection {
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

    static _normalizeGiftsSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            command: ConfigValidator.parseString(raw.command, ''),
            giftVideoSource: ConfigValidator.parseString(raw.giftVideoSource, DEFAULTS.gifts.giftVideoSource),
            giftAudioSource: ConfigValidator.parseString(raw.giftAudioSource, DEFAULTS.gifts.giftAudioSource)
        };
    }

    static _normalizeEnvelopesSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizeTimingSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            fadeDuration: ConfigValidator.parseNumber(raw.fadeDuration, { defaultValue: DEFAULTS.timing.fadeDuration }),
            notificationClearDelay: ConfigValidator.parseNumber(raw.notificationClearDelay, { defaultValue: DEFAULTS.timing.notificationClearDelay }),
            transitionDelay: ConfigValidator.parseNumber(raw.transitionDelay, { defaultValue: DEFAULTS.timing.transitionDelay }),
            chatMessageDuration: ConfigValidator.parseNumber(raw.chatMessageDuration, { defaultValue: DEFAULTS.timing.chatMessageDuration })
        };
    }

    static _normalizeCooldownsSection(raw: RawConfigSection): NormalizedConfigSection {
        const num = (field: string) => ConfigValidator._parseNumberFromSchema('cooldowns', field, raw[field]);
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

    static _normalizeSpamSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.spam.enabled),
            lowValueThreshold: ConfigValidator.parseNumber(raw.lowValueThreshold, { defaultValue: DEFAULTS.spam.lowValueThreshold, min: 0, allowZero: false }),
            detectionWindow: ConfigValidator.parseNumber(raw.detectionWindow, { defaultValue: DEFAULTS.spam.detectionWindow, min: 1, requireInteger: true }),
            maxIndividualNotifications: ConfigValidator.parseNumber(raw.maxIndividualNotifications, { defaultValue: DEFAULTS.spam.maxIndividualNotifications, min: 1, requireInteger: true }),
            tiktokEnabled: ConfigValidator.parseBoolean(raw.tiktokEnabled, DEFAULTS.spam.tiktokEnabled),
            tiktokLowValueThreshold: ConfigValidator.parseNumber(raw.tiktokLowValueThreshold, { defaultValue: DEFAULTS.spam.tiktokLowValueThreshold, min: 0, allowZero: false }),
            twitchEnabled: ConfigValidator.parseBoolean(raw.twitchEnabled, DEFAULTS.spam.twitchEnabled),
            twitchLowValueThreshold: ConfigValidator.parseNumber(raw.twitchLowValueThreshold, { defaultValue: DEFAULTS.spam.twitchLowValueThreshold, min: 0, allowZero: false }),
            youtubeEnabled: ConfigValidator.parseBoolean(raw.youtubeEnabled, DEFAULTS.spam.youtubeEnabled),
            youtubeLowValueThreshold: ConfigValidator.parseNumber(raw.youtubeLowValueThreshold, { defaultValue: DEFAULTS.spam.youtubeLowValueThreshold, min: 0, allowZero: false })
        };
    }

    static _normalizeDisplayQueueSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            autoProcess: ConfigValidator.parseBoolean(raw.autoProcess, DEFAULTS.displayQueue.autoProcess),
            maxQueueSize: ConfigValidator.parseNumber(raw.maxQueueSize, { defaultValue: DEFAULTS.displayQueue.maxQueueSize })
        };
    }

    static _normalizeLoggingSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            consoleLevel: ConfigValidator.parseString(raw.consoleLevel, null),
            fileLevel: ConfigValidator.parseString(raw.fileLevel, null),
            fileLoggingEnabled: ConfigValidator.parseBoolean(raw.fileLoggingEnabled, null)
        };
    }

    static _normalizeGuiSection(raw: RawConfigSection): NormalizedConfigSection {
        const normalized = ConfigValidator.normalizeFromSchema('gui', raw);

        if (normalized.host === '') {
            normalized.host = DEFAULTS.gui.host;
        }

        return normalized;
    }

    static _normalizeFarewellSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            command: ConfigValidator.parseString(raw.command, ''),
            timeout: ConfigValidator.parseNumber(raw.timeout, { defaultValue: 300, min: 1, requireInteger: true })
        };
    }

    static _normalizeCommandsSection(raw: RawConfigSection): Record<string, string> {
        const normalized: Record<string, string> = {};

        for (const [key, value] of Object.entries(raw)) {
            if (key === 'enabled') continue;
            if (typeof value === 'string') {
                normalized[key] = value;
            }
        }

        return normalized;
    }

    static _normalizeVfxSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            filePath: ConfigValidator.parseString(raw.filePath, '')
        };
    }

    static _normalizeStreamElementsSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.streamelements.enabled),
            youtubeChannelId: ConfigValidator.parseString(raw.youtubeChannelId, ''),
            twitchChannelId: ConfigValidator.parseString(raw.twitchChannelId, ''),
            dataLoggingEnabled: ConfigValidator.parseBoolean(raw.dataLoggingEnabled, DEFAULTS.streamelements.dataLoggingEnabled)
        };
    }

    static _normalizeFollowsSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizeRaidsSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizePaypiggiesSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizeGreetingsSection(raw: RawConfigSection): NormalizedConfigSection {
        const customVfxProfiles: Record<string, { profileId: string; command: string }> = {};
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

    static _normalizeSharesSection(raw: RawConfigSection): NormalizedConfigSection {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static validate(config: NormalizedConfig): ConfigValidationResult {
        const errors: string[] = [];

        ConfigValidator._validateRequiredSections(config, errors);
        ConfigValidator.validateRequiredFields(config, errors);
        ConfigValidator._validateStreamElements(config, errors);

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static validateRequiredFields(config: NormalizedConfig, errors: string[]): void {
        const platformSections: ConfigSectionName[] = ['youtube', 'twitch', 'tiktok'];

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

    static _validateRequiredSections(config: NormalizedConfig, errors: string[]): void {
        if (!config.general || typeof config.general !== 'object') {
            errors.push('Missing required configuration section: general');
        }
    }

    static _validateStreamElements(config: NormalizedConfig, errors: string[]): void {
        if (config.streamelements && config.streamelements.enabled) {
            const youtubeChannelId = config.streamelements.youtubeChannelId;
            const twitchChannelId = config.streamelements.twitchChannelId;
            const hasYoutubeChannel = typeof youtubeChannelId === 'string' && youtubeChannelId.trim().length > 0;
            const hasTwitchChannel = typeof twitchChannelId === 'string' && twitchChannelId.trim().length > 0;

            if (!hasYoutubeChannel && !hasTwitchChannel) {
                errors.push('Missing required configuration: StreamElements channel ID (YouTube or Twitch)');
            }
        }
    }

}

export { ConfigValidator };
export default { ConfigValidator };
