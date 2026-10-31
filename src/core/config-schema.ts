import type { ConfigFieldSpec, ConfigSchema, ConfigSectionSpec } from './types/config-types';
import { GUI_CONFIG_DEFAULTS } from './constants';

const DEFAULT_ENHANCED_TIMEOUT_MS = 6_000;

const CONFIG_SCHEMA = {
    general: {
        debugEnabled: { type: 'boolean', default: false },
        messagesEnabled: { type: 'boolean', default: true },
        commandsEnabled: { type: 'boolean', default: true },
        greetingsEnabled: { type: 'boolean', default: true },
        farewellsEnabled: { type: 'boolean', default: true },
        followsEnabled: { type: 'boolean', default: true },
        giftsEnabled: { type: 'boolean', default: true },
        raidsEnabled: { type: 'boolean', default: true },
        sharesEnabled: { type: 'boolean', default: true },
        paypiggiesEnabled: { type: 'boolean', default: true },
        filterOldMessages: { type: 'boolean', default: true },
        logChatMessages: { type: 'boolean', default: true },
        keywordParsingEnabled: { type: 'boolean', default: true },
        ignoreSelfMessages: { type: 'boolean', default: false },
        envFileReadEnabled: { type: 'boolean', default: true },
        envFileWriteEnabled: { type: 'boolean', default: true },
        viewerCountPollingInterval: { type: 'number', default: 60 },
        maxMessageLength: { type: 'number', default: 500 },
        fallbackUsername: { type: 'string', default: 'Unknown User' },
        anonymousUsername: { type: 'string', default: 'Anonymous User' },
        envFilePath: { type: 'string', default: './.env' }
    },

    http: {
        userAgents: { type: 'stringArray', default: null },
        defaultTimeoutMs: { type: 'number', default: 10000, min: 1, integer: true },
        reachabilityTimeoutMs: { type: 'number', default: 5000, min: 1, integer: true },
        enhancedTimeoutMs: { type: 'number', default: DEFAULT_ENHANCED_TIMEOUT_MS, min: 1, integer: true },
        enhancedReachabilityTimeoutMs: { type: 'number', default: 3000, min: 1, integer: true }
    },

    youtube: {
        enabled: { type: 'boolean', default: false },
        username: { type: 'string', requiredWhenEnabled: true, default: '' },
        viewerCountEnabled: { type: 'boolean', default: true },
        viewerCountSource: { type: 'string', userDefined: true },
        maxStreams: { type: 'number', default: 2 },
        streamPollingInterval: { type: 'number', default: 60 },
        fullCheckInterval: { type: 'number', default: 300000 },
        dataLoggingEnabled: { type: 'boolean', default: false },
        enableAPI: { type: 'boolean', default: false },
        streamDetectionMethod: { type: 'string', default: 'youtubei', enum: ['youtubei'] },
        viewerCountMethod: { type: 'string', default: 'youtubei', enum: ['youtubei'] },
        chatMode: { type: 'string', default: 'live', enum: ['live', 'top'] },
        messagesEnabled: { type: 'boolean', inheritFrom: 'general' },
        commandsEnabled: { type: 'boolean', inheritFrom: 'general' },
        greetingsEnabled: { type: 'boolean', inheritFrom: 'general' },
        farewellsEnabled: { type: 'boolean', inheritFrom: 'general' },
        followsEnabled: { type: 'boolean', inheritFrom: 'general' },
        giftsEnabled: { type: 'boolean', inheritFrom: 'general' },
        raidsEnabled: { type: 'boolean', inheritFrom: 'general' },
        paypiggiesEnabled: { type: 'boolean', inheritFrom: 'general' },
        ignoreSelfMessages: { type: 'boolean', inheritFrom: 'general' },
        pollInterval: { type: 'number', userDefined: true }
    },

    twitch: {
        enabled: { type: 'boolean', default: false },
        username: { type: 'string', requiredWhenEnabled: true, default: '' },
        channel: { type: 'string', requiredWhenEnabled: true, default: '' },
        viewerCountEnabled: { type: 'boolean', default: true },
        viewerCountSource: { type: 'string', userDefined: true },
        dataLoggingEnabled: { type: 'boolean', default: false },
        tokenStorePath: { type: 'string', default: './data/twitch-tokens.json' },
        messagesEnabled: { type: 'boolean', inheritFrom: 'general' },
        commandsEnabled: { type: 'boolean', inheritFrom: 'general' },
        greetingsEnabled: { type: 'boolean', inheritFrom: 'general' },
        farewellsEnabled: { type: 'boolean', inheritFrom: 'general' },
        followsEnabled: { type: 'boolean', inheritFrom: 'general' },
        giftsEnabled: { type: 'boolean', inheritFrom: 'general' },
        raidsEnabled: { type: 'boolean', inheritFrom: 'general' },
        paypiggiesEnabled: { type: 'boolean', inheritFrom: 'general' },
        ignoreSelfMessages: { type: 'boolean', inheritFrom: 'general' },
        pollInterval: { type: 'number', userDefined: true }
    },

    tiktok: {
        enabled: { type: 'boolean', default: false },
        username: { type: 'string', requiredWhenEnabled: true, default: '' },
        viewerCountEnabled: { type: 'boolean', default: true },
        viewerCountSource: { type: 'string', userDefined: true },
        giftAggregationEnabled: { type: 'boolean', default: true },
        dataLoggingEnabled: { type: 'boolean', default: false },
        messagesEnabled: { type: 'boolean', inheritFrom: 'general' },
        commandsEnabled: { type: 'boolean', inheritFrom: 'general' },
        greetingsEnabled: { type: 'boolean', inheritFrom: 'general' },
        farewellsEnabled: { type: 'boolean', inheritFrom: 'general' },
        followsEnabled: { type: 'boolean', inheritFrom: 'general' },
        giftsEnabled: { type: 'boolean', inheritFrom: 'general' },
        raidsEnabled: { type: 'boolean', inheritFrom: 'general' },
        paypiggiesEnabled: { type: 'boolean', inheritFrom: 'general' },
        sharesEnabled: { type: 'boolean', inheritFrom: 'general' },
        ignoreSelfMessages: { type: 'boolean', inheritFrom: 'general' },
        pollInterval: { type: 'number', userDefined: true }
    },

    streamelements: {
        enabled: { type: 'boolean', default: false },
        dataLoggingEnabled: { type: 'boolean', default: false },
        dataLoggingPath: { type: 'string', userDefined: true }
    },

    spam: {
        enabled: { type: 'boolean', default: true },
        lowValueThreshold: { type: 'number', default: 10, min: 0, allowZero: false },
        detectionWindow: { type: 'number', default: 5, min: 1, integer: true },
        maxIndividualNotifications: { type: 'number', default: 2, min: 1, integer: true },
        tiktokEnabled: { type: 'boolean', default: true },
        tiktokLowValueThreshold: { type: 'number', userDefined: true, min: 0, allowZero: false },
        twitchEnabled: { type: 'boolean', default: true },
        twitchLowValueThreshold: { type: 'number', userDefined: true, min: 0, allowZero: false },
        youtubeEnabled: { type: 'boolean', default: false },
        youtubeLowValueThreshold: { type: 'number', default: 1.00, min: 0, allowZero: false }
    },

    displayQueue: {
        autoProcess: { type: 'boolean', default: true },
        maxQueueSize: { type: 'number', default: 100 },
        rowIntervalMs: { type: 'number', default: 1000, min: 0 }
    },

    gui: {
        enableDock: { type: 'boolean', default: false },
        enableOverlay: { type: 'boolean', default: false },
        enableNotifications: { type: 'boolean', default: false },
        enableOperator: { type: 'boolean', default: false },
        enableChatFeed: { type: 'boolean', default: false },
        dockFeedMode: { type: 'string', default: 'all', enum: ['all', 'chat', 'non-chat'] },
        dockMaxMessages: { type: 'number', default: 200, min: 1, max: 2000, integer: true },
        overlayFeedMode: { type: 'string', default: 'all', enum: ['all', 'chat', 'non-chat'] },
        host: { type: 'string', default: '127.0.0.1' },
        port: { type: 'number', default: 3399, min: 0, max: 65535, integer: true },
        messageCharacterLimit: { type: 'number', default: 0, min: 0, integer: true },
        overlayMaxMessages: { type: 'number', default: GUI_CONFIG_DEFAULTS.overlayMaxMessages, min: 1, integer: true },
        overlayMaxLinesPerMessage: { type: 'number', default: GUI_CONFIG_DEFAULTS.overlayMaxLinesPerMessage, min: 1, integer: true },
        minimalOverlayMaxMessages: { type: 'number', default: 6, min: 1, max: 100, integer: true },
        minimalCompactRows: { type: 'boolean', default: true },
        minimalRowBackgroundsEnabled: { type: 'boolean', default: false },
        minimalMaxDisplayableBadges: { type: 'number', default: 3, min: 0, integer: true },
        streamSupporterChatEffectsEnabled: { type: 'boolean', default: true },
        showMessages: { type: 'boolean', default: true },
        showCommands: { type: 'boolean', default: true },
        showGreetings: { type: 'boolean', default: true },
        showFarewells: { type: 'boolean', default: true },
        showFollows: { type: 'boolean', default: true },
        showShares: { type: 'boolean', default: true },
        showRaids: { type: 'boolean', default: true },
        showGifts: { type: 'boolean', default: true },
        showPaypiggies: { type: 'boolean', default: true },
        showGiftPaypiggies: { type: 'boolean', default: true },
        showEnvelopes: { type: 'boolean', default: true },
        notificationIdleHoldMs: { type: 'number', default: 5000, min: 0, integer: true },
        monetizationIdleHoldMs: { type: 'number', default: 30000, min: 0, integer: true },
        notificationTransitionMs: { type: 'number', default: 1000, min: 0, integer: true },
        memberRowTheme: { type: 'string', default: 'green', enum: ['green', 'red', 'gold'] },
        memberRowEffects: { type: 'stringArray', default: ['sheen'] }
    },

    logging: {
        consoleLevel: { type: 'string', userDefined: true },
        fileLevel: { type: 'string', userDefined: true },
        fileLoggingEnabled: { type: 'boolean', userDefined: true },
        fileMaxBytes: { type: 'number', default: 20971520, min: 65536, integer: true },
        fileQueueMaxBytes: { type: 'number', default: 2097152, min: 65536, integer: true }
    },

    handcam: {
        enabled: { type: 'boolean', default: false },
        sourceName: { type: 'string', default: 'handcam-source' },
        glowFilterName: { type: 'string', default: 'Glow' },
        maxSize: { type: 'number', default: 50, min: 1, max: 100 },
        rampUpDuration: { type: 'number', default: 0.5, min: 0.1, max: 10.0 },
        holdDuration: { type: 'number', default: 8.0, min: 0 },
        rampDownDuration: { type: 'number', default: 0.5, min: 0.1, max: 10.0 },
        totalSteps: { type: 'number', default: 30 },
        easingEnabled: { type: 'boolean', default: true }
    },

    cooldowns: {
        cmdCooldown: { type: 'number', default: 60, min: 10, max: 3600 },
        globalCmdCooldown: { type: 'number', default: 60, min: 10, max: 3600 },
        defaultCooldown: { type: 'number', default: 60, min: 10, max: 3600 },
        heavyCommandCooldown: { type: 'number', default: 60, min: 60, max: 3600 },
        heavyCommandThreshold: { type: 'number', default: 3, min: 2, max: 20 },
        heavyCommandWindow: { type: 'number', default: 60 },
        maxEntries: { type: 'number', default: 1000 }
    },

    obs: {
        enabled: { type: 'boolean', default: false },
        connectionTimeoutMs: { type: 'number', default: 10000 },
        address: { type: 'string', default: 'ws://localhost:4455' },
        ttsChatEnabled: { type: 'boolean', default: false },
        ttsNotificationsEnabled: { type: 'boolean', default: true },
        neuralTtsEndpoint: { type: 'string', default: 'http://127.0.0.1:8765' },
        neuralTtsVoice: { type: 'string', userDefined: true },
        neuralTtsCommand: { type: 'string', userDefined: true }
    },

    goals: {
        enabled: { type: 'boolean', default: false },
        tiktokGoalEnabled: { type: 'boolean', default: true },
        tiktokGoalSource: { type: 'string', userDefined: true },
        tiktokGoalTarget: { type: 'number', default: 1000 },
        tiktokGoalCurrency: { type: 'string', default: 'coins' },
        youtubeGoalEnabled: { type: 'boolean', default: true },
        youtubeGoalSource: { type: 'string', userDefined: true },
        youtubeGoalTarget: { type: 'number', default: 1.00 },
        youtubeGoalCurrency: { type: 'string', default: 'dollars' },
        twitchGoalEnabled: { type: 'boolean', default: true },
        twitchGoalSource: { type: 'string', userDefined: true },
        twitchGoalTarget: { type: 'number', default: 100 },
        twitchGoalCurrency: { type: 'string', default: 'bits' }
    },

    fundingGoal: {
        enabled: { type: 'boolean', default: false },
        id: { type: 'string', default: 'support' },
        label: { type: 'string', default: 'Support Goal' },
        targetUsd: { type: 'number', default: 100, min: 0, allowZero: false }
    },

    monetizationValues: {
        tiktokGiftUnitUsd: { type: 'number', default: 0.005, min: 0 },
        twitchBitUsd: { type: 'number', default: 0.01, min: 0 },
        youtubeJewelUsd: { type: 'number', default: 0.005, min: 0 },
        tiktokMembershipUsd: { type: 'number', default: 2.10, min: 0 },
        twitchMembershipUsd: { type: 'number', default: 3.50, min: 0 },
        youtubeMembershipUsd: { type: 'number', default: 3.89, min: 0 }
    },

    gifts: {
        command: { type: 'string', userDefined: true },
        giftVideoSource: { type: 'string', default: 'gift-video' },
        giftAudioSource: { type: 'string', default: 'gift-audio' }
    },

    envelopes: {
        command: { type: 'string', userDefined: true }
    },

    farewell: {
        command: { type: 'string', userDefined: true },
        timeout: { type: 'number', default: 300, min: 1, integer: true }
    },

    commands: {
        _dynamic: true
    },

    shares: {
        command: { type: 'string', userDefined: true }
    },

    vfx: {
        filePath: { type: 'string', userDefined: true }
    },

    follows: {
        command: { type: 'string', userDefined: true }
    },

    raids: {
        command: { type: 'string', userDefined: true }
    },

    paypiggies: {
        command: { type: 'string', userDefined: true }
    },

    greetings: {
        command: { type: 'string', userDefined: true }
    }
} as const satisfies ConfigSchema;

function isConfigFieldSpec(value: ConfigSectionSpec[string]): value is ConfigFieldSpec {
    return typeof value === 'object' && value !== null && 'type' in value;
}

function getFieldsRequiredWhenEnabled(sectionName: string): string[] {
    const sectionSchema = (CONFIG_SCHEMA as ConfigSchema)[sectionName];
    if (!sectionSchema) {
        return [];
    }

    return Object.entries(sectionSchema)
        .filter(([, spec]) => isConfigFieldSpec(spec) && spec.requiredWhenEnabled === true)
        .map(([fieldName]) => fieldName);
}

function buildDefaultsFromSchema(): SchemaDefaults {
    const defaults: Record<string, Record<string, unknown>> = {};
    for (const [sectionName, sectionSpec] of Object.entries(CONFIG_SCHEMA)) {
        if ('_dynamic' in sectionSpec && sectionSpec._dynamic) continue;
        defaults[sectionName] = {};
        for (const [fieldName, fieldSpec] of Object.entries(sectionSpec)) {
            if (isConfigFieldSpec(fieldSpec) && fieldSpec.default !== undefined) {
                defaults[sectionName][fieldName] = fieldSpec.default;
            }
        }
    }
    return defaults as SchemaDefaults;
}

type SchemaDefaults = {
    [S in Exclude<keyof typeof CONFIG_SCHEMA, 'commands'>]: {
        [F in keyof typeof CONFIG_SCHEMA[S]]: typeof CONFIG_SCHEMA[S][F] extends { default: infer D }
            ? D extends string ? string : D extends number ? number : D extends boolean ? boolean : D
            : undefined
    }
};

const DEFAULTS = {
    LOG_DIRECTORY: './logs',
    ...buildDefaultsFromSchema()
} as SchemaDefaults & { LOG_DIRECTORY: string };

export {
    CONFIG_SCHEMA,
    isConfigFieldSpec,
    getFieldsRequiredWhenEnabled,
    buildDefaultsFromSchema,
    DEFAULT_ENHANCED_TIMEOUT_MS,
    DEFAULTS
};

// Legacy selectors remain readable so unsupported requests fail before normalization
// can replace them with a working default or secret collection can prompt for a key.
export function getYouTubeCapabilityErrors(config: Record<string, unknown> = {}): string[] {
    const errors: string[] = [];
    if (config.enableAPI === true || String(config.enableAPI).trim().toLowerCase() === 'true') {
        errors.push('YouTube Data API is not supported: set youtube.enableAPI=false and use youtubei for stream detection and viewer counts.');
    }
    for (const field of ['streamDetectionMethod', 'viewerCountMethod']) {
        if (String(config[field]).trim().toLowerCase() === 'api') {
            errors.push(`YouTube Data API is not supported: set youtube.${field}=youtubei; no YouTube API key is required.`);
        }
    }
    return errors;
}
