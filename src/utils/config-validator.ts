import { CONFIG_SCHEMA, DEFAULTS, getYouTubeCapabilityErrors, getFieldsRequiredWhenEnabled, isConfigFieldSpec } from '../core/config-schema';
import type {
    ConfigFieldSpec,
    ConfigDefaultSectionName,
    ConfigSectionName,
    ConfigValidationResult,
    MemberProfile,
    NormalizedConfigSection,
    NormalizedSchemaSection,
    ConfigSchema,
    ParseNumberOptions,
    RawConfig,
    RawConfigSection,
    RowVisualEffectId
} from '../core/types/config-types';
import { DEFAULT_HTTP_USER_AGENTS, parseUserAgentList } from '../core/http-config';
import { isLogThreshold } from '../core/logger/levels';
import { isRowVisualEffectId, normalizeRowSpriteUrl, normalizeRowTheme } from '../core/row-presentation';
import { normalizeProfileIdentityKey } from './profile-identity-key-normalizer';

type NumericDefaultField<S extends ConfigDefaultSectionName> = {
    [F in keyof typeof CONFIG_SCHEMA[S]]: typeof CONFIG_SCHEMA[S][F] extends { type: 'number'; default: number } ? F : never
}[keyof typeof CONFIG_SCHEMA[S]];

const PROFILE_FIELDS = new Set(['identities', 'greetingCommand', 'rowTheme', 'rowEffects', 'rowSpriteUrl']);

class ConfigValidator {
    static _readEnvString(envKey: string): string {
        const value = process.env[envKey];
        if (value === undefined || value === null) return '';
        return String(value).trim();
    }

    static parseBoolean(value: unknown, defaultValue: boolean): boolean;
    static parseBoolean(value: unknown, defaultValue: unknown): boolean | null;
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

    static parseString(value: unknown, defaultValue: string): string;
    static parseString(value: unknown, defaultValue: unknown): string | null;
    static parseString(value: unknown, defaultValue: unknown): string | null {
        if (value === undefined || value === null) {
            return defaultValue === undefined || defaultValue === null ? null : String(defaultValue).trim();
        }
        return String(value).trim();
    }

    static parseNumber(value: unknown, options: ParseNumberOptions & { defaultValue: number }): number;
    static parseNumber(value: unknown, options?: ParseNumberOptions): number | null;
    static parseNumber(value: unknown, options: ParseNumberOptions = {}): number | null {
        const { defaultValue, min, max, allowZero = true, requireInteger = false } = options;
        const fallback = typeof defaultValue === 'number' ? defaultValue : null;
        if (value === undefined || value === null) return fallback;
        if (typeof value === 'string' && value.trim().length === 0) return fallback;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        if (requireInteger && !Number.isInteger(parsed)) return fallback;
        if (!allowZero && parsed === 0) return fallback;
        if (typeof min === 'number' && parsed < min) return fallback;
        if (typeof max === 'number' && parsed > max) return fallback;
        return parsed;
    }

    static _parseNumberFromSchema<S extends ConfigDefaultSectionName>(section: S, field: NumericDefaultField<S>, value: unknown): number;
    static _parseNumberFromSchema(section: ConfigDefaultSectionName, field: string, value: unknown): number | null;
    static _parseNumberFromSchema(section: ConfigDefaultSectionName, field: string, value: unknown): number | null {
        const spec = (CONFIG_SCHEMA as ConfigSchema)[section]?.[field];
        if (!isConfigFieldSpec(spec)) {
            return null;
        }

        return ConfigValidator.parseNumber(value, {
            defaultValue: (DEFAULTS[section] as Record<string, unknown>)[field],
            ...(spec.min === undefined ? {} : { min: spec.min }),
            ...(spec.max === undefined ? {} : { max: spec.max }),
            ...(spec.allowZero === undefined ? {} : { allowZero: spec.allowZero }),
            requireInteger: spec.integer === true
        });
    }

    static normalizeFromSchema<S extends ConfigSectionName>(sectionName: S, rawData: RawConfigSection): NormalizedSchemaSection<S> {
        if (sectionName === 'youtube') {
            const errors = getYouTubeCapabilityErrors(rawData);
            if (errors.length) throw new Error(errors.join(' '));
        }
        const sectionSchema = (CONFIG_SCHEMA as ConfigSchema)[sectionName];
        if (!sectionSchema || sectionSchema._dynamic) return {} as NormalizedSchemaSection<S>;

        const result: NormalizedConfigSection = {};
        for (const [fieldName, spec] of Object.entries(sectionSchema)) {
            if (!isConfigFieldSpec(spec)) continue;
            result[fieldName] = ConfigValidator._normalizeFieldFromSpec(rawData[fieldName], spec);
        }
        return result as NormalizedSchemaSection<S>;
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

    static _parseInheritableFlags(raw: RawConfigSection) {
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

    static _parseShareFlag(raw: RawConfigSection) {
        return {
            sharesEnabled: ConfigValidator.parseBoolean(raw.sharesEnabled, null)
        };
    }

    static normalize(rawConfig: RawConfig, environment: Readonly<Record<string, string | undefined>> = process.env) {
        return {
            general: ConfigValidator._normalizeGeneralSection(rawConfig.general || {}),
            http: ConfigValidator._normalizeHttpSection(rawConfig.http || {}),
            obs: ConfigValidator._normalizeObsSection(rawConfig.obs || {}),
            tiktok: ConfigValidator._normalizeTiktokSection(rawConfig.tiktok || {}),
            twitch: ConfigValidator._normalizeTwitchSection(rawConfig.twitch || {}, environment),
            youtube: ConfigValidator._normalizeYoutubeSection(rawConfig.youtube || {}),
            handcam: ConfigValidator._normalizeHandcamSection(rawConfig.handcam || {}),
            goals: ConfigValidator._normalizeGoalsSection(rawConfig.goals || {}),
            fundingGoal: ConfigValidator._normalizeFundingGoalSection(rawConfig.fundingGoal || {}),
            monetizationValues: ConfigValidator.normalizeFromSchema('monetizationValues', rawConfig.monetizationValues || {}),
            gifts: ConfigValidator._normalizeGiftsSection(rawConfig.gifts || {}),
            envelopes: ConfigValidator._normalizeEnvelopesSection(rawConfig.envelopes || {}),
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
            shares: ConfigValidator._normalizeSharesSection(rawConfig.shares || {}),
            profiles: ConfigValidator._normalizeProfiles(rawConfig.profile || {})
        };
    }

    static _normalizeGeneralSection(raw: RawConfigSection) {
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

    static _normalizeHttpSection(raw: RawConfigSection) {
        const parsedAgents = parseUserAgentList(raw.userAgents);

        return {
            userAgents: parsedAgents.length > 0 ? parsedAgents : DEFAULT_HTTP_USER_AGENTS.slice(),
            defaultTimeoutMs: ConfigValidator._parseNumberFromSchema('http', 'defaultTimeoutMs', raw.defaultTimeoutMs),
            reachabilityTimeoutMs: ConfigValidator._parseNumberFromSchema('http', 'reachabilityTimeoutMs', raw.reachabilityTimeoutMs),
            enhancedTimeoutMs: ConfigValidator._parseNumberFromSchema('http', 'enhancedTimeoutMs', raw.enhancedTimeoutMs),
            enhancedReachabilityTimeoutMs: ConfigValidator._parseNumberFromSchema('http', 'enhancedReachabilityTimeoutMs', raw.enhancedReachabilityTimeoutMs)
        };
    }

    static _normalizeObsSection(raw: RawConfigSection) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.obs.enabled),
            address: ConfigValidator.parseString(raw.address, DEFAULTS.obs.address),
            connectionTimeoutMs: ConfigValidator.parseNumber(raw.connectionTimeoutMs, { defaultValue: DEFAULTS.obs.connectionTimeoutMs }),
            ttsChatEnabled: ConfigValidator.parseBoolean(raw.ttsChatEnabled, DEFAULTS.obs.ttsChatEnabled),
            ttsNotificationsEnabled: ConfigValidator.parseBoolean(raw.ttsNotificationsEnabled, DEFAULTS.obs.ttsNotificationsEnabled),
            neuralTtsEndpoint: ConfigValidator.parseString(raw.neuralTtsEndpoint, DEFAULTS.obs.neuralTtsEndpoint),
            neuralTtsVoice: ConfigValidator.parseString(raw.neuralTtsVoice, ''),
            neuralTtsCommand: ConfigValidator.parseString(raw.neuralTtsCommand, '')
        };
    }

    static _normalizeTiktokSection(raw: RawConfigSection) {
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

    static _normalizeTwitchSection(raw: RawConfigSection, environment: Readonly<Record<string, string | undefined>> = process.env) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.twitch.enabled),
            username: ConfigValidator.parseString(raw.username, ''),
            clientId: String(environment.TWITCH_CLIENT_ID ?? '').trim(),
            channel: ConfigValidator.parseString(raw.channel, ''),
            viewerCountEnabled: ConfigValidator.parseBoolean(raw.viewerCountEnabled, DEFAULTS.twitch.viewerCountEnabled),
            viewerCountSource: ConfigValidator.parseString(raw.viewerCountSource, null),
            dataLoggingEnabled: ConfigValidator.parseBoolean(raw.dataLoggingEnabled, DEFAULTS.twitch.dataLoggingEnabled),
            tokenStorePath: ConfigValidator.parseString(raw.tokenStorePath, DEFAULTS.twitch.tokenStorePath),
            ...ConfigValidator._parseInheritableFlags(raw),
            pollInterval: ConfigValidator.parseNumber(raw.pollInterval, { defaultValue: null })
        };
    }

    static _normalizeYoutubeSection(raw: RawConfigSection) {
        const errors = getYouTubeCapabilityErrors(raw);
        if (errors.length) throw new Error(errors.join(' '));
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
            streamDetectionMethod: ['youtubei'].includes(method) ? method : DEFAULTS.youtube.streamDetectionMethod,
            viewerCountMethod: ['youtubei'].includes(viewerMethod) ? viewerMethod : DEFAULTS.youtube.viewerCountMethod,
            chatMode: ['live', 'top'].includes(chatMode) ? chatMode : DEFAULTS.youtube.chatMode,
            ...ConfigValidator._parseInheritableFlags(raw),
            pollInterval: ConfigValidator.parseNumber(raw.pollInterval, { defaultValue: null })
        };
    }

    static _normalizeHandcamSection(raw: RawConfigSection) {
        const num = (field: NumericDefaultField<'handcam'>) => ConfigValidator._parseNumberFromSchema('handcam', field, raw[field]);
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

    static _normalizeGoalsSection(raw: RawConfigSection) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.goals.enabled),
            tiktokGoalEnabled: ConfigValidator.parseBoolean(raw.tiktokGoalEnabled, DEFAULTS.goals.tiktokGoalEnabled),
            tiktokGoalSource: ConfigValidator.parseString(raw.tiktokGoalSource, ''),
            tiktokGoalTarget: ConfigValidator.parseNumber(raw.tiktokGoalTarget, { defaultValue: DEFAULTS.goals.tiktokGoalTarget }),
            tiktokGoalCurrency: ConfigValidator.parseString(raw.tiktokGoalCurrency, DEFAULTS.goals.tiktokGoalCurrency),
            youtubeGoalEnabled: ConfigValidator.parseBoolean(raw.youtubeGoalEnabled, DEFAULTS.goals.youtubeGoalEnabled),
            youtubeGoalSource: ConfigValidator.parseString(raw.youtubeGoalSource, ''),
            youtubeGoalTarget: ConfigValidator.parseNumber(raw.youtubeGoalTarget, { defaultValue: DEFAULTS.goals.youtubeGoalTarget }),
            youtubeGoalCurrency: ConfigValidator.parseString(raw.youtubeGoalCurrency, DEFAULTS.goals.youtubeGoalCurrency),
            twitchGoalEnabled: ConfigValidator.parseBoolean(raw.twitchGoalEnabled, DEFAULTS.goals.twitchGoalEnabled),
            twitchGoalSource: ConfigValidator.parseString(raw.twitchGoalSource, ''),
            twitchGoalTarget: ConfigValidator.parseNumber(raw.twitchGoalTarget, { defaultValue: DEFAULTS.goals.twitchGoalTarget }),
            twitchGoalCurrency: ConfigValidator.parseString(raw.twitchGoalCurrency, DEFAULTS.goals.twitchGoalCurrency)
        };
    }

    static _normalizeFundingGoalSection(raw: RawConfigSection) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.fundingGoal.enabled),
            id: ConfigValidator.parseString(raw.id, DEFAULTS.fundingGoal.id) || DEFAULTS.fundingGoal.id,
            label: ConfigValidator.parseString(raw.label, DEFAULTS.fundingGoal.label) || DEFAULTS.fundingGoal.label,
            targetUsd: ConfigValidator._parseNumberFromSchema('fundingGoal', 'targetUsd', raw.targetUsd)
        };
    }

    static _normalizeGiftsSection(raw: RawConfigSection) {
        return {
            command: ConfigValidator.parseString(raw.command, ''),
            giftVideoSource: ConfigValidator.parseString(raw.giftVideoSource, DEFAULTS.gifts.giftVideoSource),
            giftAudioSource: ConfigValidator.parseString(raw.giftAudioSource, DEFAULTS.gifts.giftAudioSource)
        };
    }

    static _normalizeEnvelopesSection(raw: RawConfigSection) {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizeCooldownsSection(raw: RawConfigSection) {
        const num = (field: NumericDefaultField<'cooldowns'>) => ConfigValidator._parseNumberFromSchema('cooldowns', field, raw[field]);
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

    static _normalizeSpamSection(raw: RawConfigSection) {
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

    static _normalizeDisplayQueueSection(raw: RawConfigSection) {
        return {
            autoProcess: ConfigValidator.parseBoolean(raw.autoProcess, DEFAULTS.displayQueue.autoProcess),
            maxQueueSize: ConfigValidator.parseNumber(raw.maxQueueSize, { defaultValue: DEFAULTS.displayQueue.maxQueueSize }),
            rowIntervalMs: ConfigValidator.parseNumber(raw.rowIntervalMs, { defaultValue: DEFAULTS.displayQueue.rowIntervalMs, min: 0 })
        };
    }

    static _normalizeLoggingSection(raw: RawConfigSection) {
        const normalizeLevel = (value: unknown): string | null => {
            const level = ConfigValidator.parseString(value, null)?.toLowerCase() ?? null;
            return isLogThreshold(level) ? level : null;
        };

        return {
            consoleLevel: normalizeLevel(raw.consoleLevel),
            fileLevel: normalizeLevel(raw.fileLevel),
            fileLoggingEnabled: ConfigValidator.parseBoolean(raw.fileLoggingEnabled, null)
        };
    }

    static _normalizeGuiSection(raw: RawConfigSection) {
        const configuredTheme = normalizeRowTheme(raw.memberRowTheme);
        if (raw.memberRowTheme !== undefined && configuredTheme === undefined) {
            throw new Error(`Unknown member row theme: ${String(raw.memberRowTheme)}`);
        }

        const normalized = ConfigValidator.normalizeFromSchema('gui', raw);
        const memberRowEffects = ConfigValidator._parseEffects(raw.memberRowEffects, ['sheen']);

        if (normalized.host === '') {
            normalized.host = DEFAULTS.gui.host;
        }

        return { ...normalized, memberRowEffects };
    }

    static _normalizeFarewellSection(raw: RawConfigSection) {
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

    static _normalizeVfxSection(raw: RawConfigSection) {
        return {
            filePath: ConfigValidator.parseString(raw.filePath, '')
        };
    }

    static _normalizeStreamElementsSection(raw: RawConfigSection) {
        return {
            enabled: ConfigValidator.parseBoolean(raw.enabled, DEFAULTS.streamelements.enabled),
            youtubeChannelId: ConfigValidator.parseString(raw.youtubeChannelId, ''),
            twitchChannelId: ConfigValidator.parseString(raw.twitchChannelId, ''),
            dataLoggingEnabled: ConfigValidator.parseBoolean(raw.dataLoggingEnabled, DEFAULTS.streamelements.dataLoggingEnabled)
        };
    }

    static _normalizeFollowsSection(raw: RawConfigSection) {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizeRaidsSection(raw: RawConfigSection) {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizePaypiggiesSection(raw: RawConfigSection) {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static _normalizeGreetingsSection(raw: RawConfigSection) {
        return { command: ConfigValidator.parseString(raw.command, '') };
    }

    static _parseEffects(value: unknown, fallback: readonly RowVisualEffectId[]): RowVisualEffectId[] {
        const values = Array.isArray(value) ? value : String(value ?? fallback.join(',')).split(',');
        const result: RowVisualEffectId[] = [];
        for (const item of values) {
            const effect = String(item).trim().toLowerCase();
            if (!effect) continue;
            if (!isRowVisualEffectId(effect)) throw new Error(`Unknown row effect: ${effect}`);
            if (!result.includes(effect)) result.push(effect);
        }
        return result;
    }

    static _normalizeProfiles(raw: RawConfigSection): Record<string, MemberProfile> {
        const profiles: Record<string, MemberProfile> = {};
        const identities = new Set<string>();

        for (const [id, value] of Object.entries(raw)) {
            if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
                throw new Error(`Invalid profile id: ${id}`);
            }
            if (!value || typeof value !== 'object') {
                throw new Error(`profile.${id} must be a section`);
            }

            const section = value as RawConfigSection;
            for (const key of Object.keys(section)) {
                if (!PROFILE_FIELDS.has(key)) throw new Error(`Unknown profile.${id}.${key}`);
            }

            const identityTokens = String(section.identities ?? '')
                .split('|')
                .map(token => token.trim())
                .filter(Boolean);
            if (identityTokens.length === 0) {
                throw new Error(`profile.${id}.identities is required`);
            }

            const normalizedIdentities = identityTokens.map(token => {
                const match = /^([^:]+):(.+)$/.exec(token);
                if (!match) {
                    throw new Error(`Invalid profile identity: ${token}`);
                }

                const key = normalizeProfileIdentityKey(match[1], match[2]);
                if (!key) throw new Error(`Invalid profile identity: ${token}`);
                if (identities.has(key)) throw new Error(`Duplicate profile identity: ${key}`);
                identities.add(key);
                return key;
            });

            const greetingCommand = ConfigValidator.parseString(section.greetingCommand, null);
            if (!greetingCommand?.startsWith('!')) {
                throw new Error(`profile.${id}.greetingCommand must start with !`);
            }

            const rowTheme = normalizeRowTheme(section.rowTheme);
            if (section.rowTheme !== undefined && rowTheme === undefined) {
                throw new Error(`Invalid profile theme: ${String(section.rowTheme).trim().toLowerCase()}`);
            }

            const spriteUrl = normalizeRowSpriteUrl(section.rowSpriteUrl);
            if (section.rowSpriteUrl !== undefined && spriteUrl === undefined) {
                throw new Error(`Invalid profile sprite URL: ${id}`);
            }

            profiles[id] = {
                id,
                identities: normalizedIdentities,
                greetingCommand,
                ...(rowTheme ? { rowTheme } : {}),
                ...(section.rowEffects === undefined ? {} : { rowEffects: ConfigValidator._parseEffects(section.rowEffects, []) }),
                ...(spriteUrl ? { spriteUrl } : {})
            };
        }

        return profiles;
    }

    static _normalizeSharesSection(raw: RawConfigSection) {
        return {
            command: ConfigValidator.parseString(raw.command, '')
        };
    }

    static validate(config: RawConfig): ConfigValidationResult {
        const errors: string[] = [];

        errors.push(...getYouTubeCapabilityErrors(config.youtube));
        ConfigValidator._validateRequiredSections(config, errors);
        ConfigValidator.validateRequiredFields(config, errors);
        ConfigValidator._validateStreamElements(config, errors);

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    static validateRequiredFields(config: RawConfig, errors: string[]): void {
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

    static _validateRequiredSections(config: RawConfig, errors: string[]): void {
        if (!config.general || typeof config.general !== 'object') {
            errors.push('Missing required configuration section: general');
        }
    }

    static _validateStreamElements(config: RawConfig, errors: string[]): void {
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
