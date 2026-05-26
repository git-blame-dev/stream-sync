import { ConfigValidator } from '../../src/utils/config-validator';
import { buildConfig } from '../../src/core/config-builders';

type ConfigSectionFixture = Record<string, unknown>;
type RawTestConfig = Record<string, ConfigSectionFixture> & {
    general: ConfigSectionFixture;
    obs: ConfigSectionFixture;
    cooldowns: ConfigSectionFixture;
    gui: ConfigSectionFixture;
    tiktok: ConfigSectionFixture;
    twitch: ConfigSectionFixture;
    youtube: ConfigSectionFixture;
};
type BuiltTestConfig = ReturnType<typeof buildConfig>;
type TestConfigKnownSections = {
    general: {
        debugEnabled: boolean;
        gracefulExit: unknown;
        maxMessageLength: number;
        viewerCountPollingIntervalMs: number;
        keywordParsingEnabled?: boolean;
        logChatMessages?: boolean;
        filterOldMessages?: boolean;
    };
    obs: {
        address?: string;
        password?: string;
        enabled?: boolean;
        connectionTimeoutMs?: number;
        chatMsgTxt: string;
        chatMsgScene: string;
        chatMsgGroup: string;
        ttsEnabled: boolean;
        notificationMsgGroup: string;
        notificationTxt: string;
        notificationScene: string;
        chatPlatformLogos: Record<string, string>;
        notificationPlatformLogos: Record<string, string>;
    };
    displayQueue: {
        autoProcess: boolean;
        maxQueueSize: number;
    };
    cooldowns: {
        cmdCooldown: number;
        cmdCooldownMs: number;
        defaultCooldownMs: number;
        heavyCommandCooldownMs: number;
        heavyCommandThreshold: number;
        heavyCommandWindowMs: number;
        globalCmdCooldownMs: number;
        maxEntries: number;
    };
    timing: {
        transitionDelay: number;
        notificationClearDelay: number;
        chatMessageDuration: number;
        fadeDuration: number;
    };
    http: {
        userAgents: string[];
    };
    twitch: {
        enabled: boolean;
        tokenStorePath?: string;
        clientId?: string;
        username?: string;
    };
    youtube: ConfigSectionFixture;
    tiktok: ConfigSectionFixture;
    handcam: {
        enabled: boolean;
        maxSize: number | string;
        rampUpDuration: number | string;
        holdDuration: number | string;
        rampDownDuration: number | string;
        totalSteps: number | string;
        easingEnabled: boolean;
        sourceName: string;
        glowFilterName: string;
    };
    gifts: ConfigSectionFixture;
    gui?: {
        enableDock?: boolean;
        enableOverlay?: boolean;
        port?: number;
        showGifts?: boolean;
    };
    spam: ConfigSectionFixture;
    commands: Record<string, string>;
    farewell: Record<string, string> & {
        timeout: number;
    };
    greetings?: ConfigSectionFixture & {
        customVfxProfiles?: Record<string, ConfigSectionFixture>;
    };
    vfx: {
        filePath: string;
    };
};
type TestConfigFixture = Record<string, ConfigSectionFixture> & BuiltTestConfig & {
    [Section in keyof TestConfigKnownSections]: ConfigSectionFixture & TestConfigKnownSections[Section];
};
type ConfigFixtureSectionName = keyof BuiltTestConfig | keyof TestConfigKnownSections;
type ConfigFixtureSection<Section extends ConfigFixtureSectionName> = Section extends keyof TestConfigKnownSections
    ? TestConfigKnownSections[Section]
    : Section extends keyof BuiltTestConfig
        ? BuiltTestConfig[Section]
        : never;
type ConfigSectionOverride<Section> = Section extends object
    ? { [Key in keyof Section]?: Section[Key] | undefined } & ConfigSectionFixture
    : ConfigSectionFixture;
type ConfigFixtureOverrides = Partial<{
    [Section in ConfigFixtureSectionName]: ConfigSectionOverride<ConfigFixtureSection<Section>>;
}>;

const RAW_TEST_CONFIG = {
    general: {
        debugEnabled: 'false',
        viewerCountPollingInterval: '60',
        maxMessageLength: '500'
    },
    obs: {
        enabled: 'false',
        address: 'ws://localhost:4455',
        connectionTimeoutMs: '5000',
        chatMsgGroup: 'test-chat-grp',
        notificationMsgGroup: 'test-notification-grp',
        chatPlatformLogoTwitch: 'test-twitch-img',
        chatPlatformLogoYouTube: 'test-youtube-img',
        chatPlatformLogoTikTok: 'test-tiktok-img',
        notificationPlatformLogoTwitch: 'test-twitch-img',
        notificationPlatformLogoYouTube: 'test-youtube-img',
        notificationPlatformLogoTikTok: 'test-tiktok-img'
    },
    timing: {
        fadeDuration: '750',
        transitionDelay: '200',
        chatMessageDuration: '4000',
        notificationClearDelay: '500'
    },
    handcam: {
        enabled: 'false',
        sourceName: 'test-handcam',
        glowFilterName: 'Glow',
        maxSize: '50',
        rampUpDuration: '0.5',
        holdDuration: '8.0',
        rampDownDuration: '0.5',
        totalSteps: '30',
        easingEnabled: 'true'
    },
    cooldowns: {
        defaultCooldown: '60',
        heavyCommandCooldown: '300',
        heavyCommandThreshold: '4',
        heavyCommandWindow: '360',
        maxEntries: '1000',
        cmdCooldown: '60',
        globalCmdCooldown: '60'
    },
    commands: {},
    tiktok: { enabled: 'false', viewerCountSource: 'test-tiktok-viewer-count' },
    twitch: { enabled: 'false', viewerCountSource: 'test-twitch-viewer-count' },
    youtube: { enabled: 'false', viewerCountSource: 'test-youtube-viewer-count' },
    http: {},
    spam: {
        enabled: 'true',
        detectionWindow: '60',
        maxIndividualNotifications: '5',
        lowValueThreshold: '10'
    },
    gui: {
        enableDock: 'false',
        enableOverlay: 'false',
        host: '127.0.0.1',
        port: '3399',
        messageCharacterLimit: '0',
        overlayMaxMessages: '3',
        overlayMaxLinesPerMessage: '3',
        showMessages: 'true',
        showCommands: 'true',
        showGreetings: 'true',
        showFarewells: 'true',
        showFollows: 'true',
        showShares: 'true',
        showRaids: 'true',
        showGifts: 'true',
        showPaypiggies: 'true',
        showGiftPaypiggies: 'true',
        showEnvelopes: 'true'
    }
};

function getRawTestConfig(): RawTestConfig {
    return JSON.parse(JSON.stringify(RAW_TEST_CONFIG)) as RawTestConfig;
}

function createSourcesConfigFixture(overrides: ConfigSectionFixture = {}) {
    return {
        chatGroupName: 'test-chat-group',
        notificationGroupName: 'test-notification-group',
        fadeDelay: 750,
        ...overrides
    };
}

function createStreamElementsConfigFixture(overrides: ConfigSectionFixture = {}) {
    return {
        enabled: true,
        dataLoggingEnabled: false,
        dataLoggingPath: './logs',
        ...overrides
    };
}

function createHandcamConfigFixture(overrides: ConfigSectionFixture = {}) {
    return {
        enabled: true,
        sourceName: 'test-handcam-source',
        glowFilterName: 'test-glow-filter',
        maxSize: 50,
        rampUpDuration: 0.5,
        holdDuration: 8.0,
        rampDownDuration: 0.5,
        totalSteps: 30,
        easingEnabled: true,
        ...overrides
    };
}

function createTikTokConfigFixture(overrides: ConfigSectionFixture = {}) {
    return {
        enabled: true,
        username: 'test-tiktok-user',
        dataLoggingEnabled: false,
        dataLoggingPath: './logs',
        ...overrides
    };
}

function createTwitchConfigFixture(overrides: ConfigSectionFixture = {}) {
    return {
        enabled: true,
        username: 'test-twitch-user',
        channel: 'test-twitch-channel',
        clientId: 'test-client-id',
        broadcasterId: 'test-broadcaster-id',
        dataLoggingEnabled: false,
        dataLoggingPath: './logs',
        ...overrides
    };
}

function createYouTubeConfigFixture(overrides: ConfigSectionFixture = {}) {
    return {
        enabled: true,
        username: 'test-youtube-channel',
        streamDetectionMethod: 'youtubei',
        chatMode: 'live',
        dataLoggingEnabled: false,
        dataLoggingPath: './logs',
        ...overrides
    };
}

function applyInheritableOverrides(
    generalOverrides: ConfigFixtureOverrides['general'] | undefined,
    platformConfig: TestConfigFixture['tiktok'],
    platformOverrides: ConfigFixtureOverrides['tiktok'] | undefined
): TestConfigFixture['tiktok'] {
    if (!generalOverrides) return { ...platformConfig, ...platformOverrides };
    
    const inheritableFlags = Object.keys(ConfigValidator._parseInheritableFlags({}));
    const propagated: ConfigSectionFixture = { ...platformConfig };
    
    for (const flag of inheritableFlags) {
        if (generalOverrides[flag] !== undefined) {
            propagated[flag] = generalOverrides[flag];
        }
    }

    if (Object.prototype.hasOwnProperty.call(platformConfig, 'sharesEnabled') && generalOverrides.sharesEnabled !== undefined) {
        propagated.sharesEnabled = generalOverrides.sharesEnabled;
    }
    
    return { ...propagated, ...platformOverrides };
}

function createConfigFixture(overrides: ConfigFixtureOverrides = {}): TestConfigFixture {
    const normalized = ConfigValidator.normalize(getRawTestConfig());
    const base = buildConfig(normalized);
    
    const {
        general: generalOverrides,
        cooldowns: cooldownsOverrides,
        commands: commandsOverrides,
        obs: obsOverrides,
        timing: timingOverrides,
        spam: spamOverrides,
        http: httpOverrides,
        gui: guiOverrides,
        handcam: handcamOverrides,
        tiktok: tiktokOverrides,
        twitch: twitchOverrides,
        youtube: youtubeOverrides,
        ...restOverrides
    } = overrides;
    
    const config = {
        ...base,
        general: { ...base.general, ...generalOverrides },
        cooldowns: { ...base.cooldowns, ...cooldownsOverrides },
        commands: { ...base.commands, ...commandsOverrides },
        obs: { ...base.obs, ...obsOverrides },
        timing: { ...base.timing, ...timingOverrides },
        spam: { ...base.spam, ...spamOverrides },
        http: { ...base.http, ...httpOverrides },
        gui: { ...base.gui, ...guiOverrides },
        handcam: { ...base.handcam, ...handcamOverrides },
        tiktok: applyInheritableOverrides(generalOverrides, base.tiktok, tiktokOverrides),
        twitch: applyInheritableOverrides(generalOverrides, base.twitch, twitchOverrides),
        youtube: applyInheritableOverrides(generalOverrides, base.youtube, youtubeOverrides)
    } as TestConfigFixture;

    return { ...config, ...restOverrides } as TestConfigFixture;
}

export {
    createSourcesConfigFixture,
    createStreamElementsConfigFixture,
    createHandcamConfigFixture,
    createTikTokConfigFixture,
    createTwitchConfigFixture,
    createYouTubeConfigFixture,
    createConfigFixture,
    getRawTestConfig
};
