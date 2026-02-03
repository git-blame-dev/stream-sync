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
        redemptionsEnabled: { type: 'boolean', default: true },
        filterOldMessages: { type: 'boolean', default: true },
        logChatMessages: { type: 'boolean', default: true },
        keywordParsingEnabled: { type: 'boolean', default: true },
        ignoreSelfMessages: { type: 'boolean', default: false },
        userSuppressionEnabled: { type: 'boolean', default: true },
        ttsEnabled: { type: 'boolean', default: false },
        streamDetectionEnabled: { type: 'boolean', default: true },
        envFileReadEnabled: { type: 'boolean', default: true },
        envFileWriteEnabled: { type: 'boolean', default: true },
        cmdCoolDown: { type: 'number', default: 60 },
        globalCmdCoolDown: { type: 'number', default: 60 },
        viewerCountPollingInterval: { type: 'number', default: 60 },
        maxNotificationsPerUser: { type: 'number', default: 5 },
        suppressionWindow: { type: 'number', default: 60 },
        suppressionDuration: { type: 'number', default: 300 },
        suppressionCleanupInterval: { type: 'number', default: 300 },
        streamRetryInterval: { type: 'number', default: 15 },
        streamMaxRetries: { type: 'number', default: -1 },
        continuousMonitoringInterval: { type: 'number', default: 60 },
        maxMessageLength: { type: 'number', default: 500 },
        chatMsgTxt: { type: 'string', default: 'chat-message-text' },
        chatMsgScene: { type: 'string', default: 'chat-message-scene' },
        chatMsgGroup: { type: 'string', default: 'chat-message-group' },
        fallbackUsername: { type: 'string', default: 'Unknown User' },
        anonymousUsername: { type: 'string', default: 'Anonymous User' },
        envFilePath: { type: 'string', default: './.env' }
    },

    http: {
        userAgents: { type: 'stringArray', default: null },
        defaultTimeoutMs: { type: 'number', default: 10000 },
        reachabilityTimeoutMs: { type: 'number', default: 5000 },
        enhancedTimeoutMs: { type: 'number', default: 3000 },
        enhancedReachabilityTimeoutMs: { type: 'number', default: 3000 }
    },

    youtube: {
        enabled: { type: 'boolean', default: false },
        username: { type: 'string', requiredWhenEnabled: true, default: '' },
        viewerCountEnabled: { type: 'boolean', default: true },
        viewerCountSource: { type: 'string', userDefined: true },
        retryAttempts: { type: 'number', default: 3 },
        maxStreams: { type: 'number', default: 2 },
        streamPollingInterval: { type: 'number', default: 60 },
        fullCheckInterval: { type: 'number', default: 300000 },
        dataLoggingEnabled: { type: 'boolean', default: false },
        enableAPI: { type: 'boolean', default: false },
        streamDetectionMethod: { type: 'string', default: 'youtubei', enum: ['youtubei', 'api'] },
        viewerCountMethod: { type: 'string', default: 'youtubei', enum: ['youtubei', 'api'] },
        messagesEnabled: { type: 'boolean', inheritFrom: 'general' },
        commandsEnabled: { type: 'boolean', inheritFrom: 'general' },
        greetingsEnabled: { type: 'boolean', inheritFrom: 'general' },
        farewellsEnabled: { type: 'boolean', inheritFrom: 'general' },
        followsEnabled: { type: 'boolean', inheritFrom: 'general' },
        giftsEnabled: { type: 'boolean', inheritFrom: 'general' },
        raidsEnabled: { type: 'boolean', inheritFrom: 'general' },
        paypiggiesEnabled: { type: 'boolean', inheritFrom: 'general' },
        redemptionsEnabled: { type: 'boolean', inheritFrom: 'general' },
        sharesEnabled: { type: 'boolean', inheritFrom: 'general' },
        ignoreSelfMessages: { type: 'boolean', inheritFrom: 'general' },
        pollInterval: { type: 'number', userDefined: true }
    },

    twitch: {
        enabled: { type: 'boolean', default: false },
        username: { type: 'string', requiredWhenEnabled: true, default: '' },
        clientId: { type: 'string', requiredWhenEnabled: true, default: '' },
        channel: { type: 'string', requiredWhenEnabled: true, default: '' },
        viewerCountEnabled: { type: 'boolean', default: true },
        viewerCountSource: { type: 'string', userDefined: true },
        eventsubEnabled: { type: 'boolean', default: true },
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
        redemptionsEnabled: { type: 'boolean', inheritFrom: 'general' },
        sharesEnabled: { type: 'boolean', inheritFrom: 'general' },
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
        redemptionsEnabled: { type: 'boolean', inheritFrom: 'general' },
        sharesEnabled: { type: 'boolean', inheritFrom: 'general' },
        ignoreSelfMessages: { type: 'boolean', inheritFrom: 'general' },
        pollInterval: { type: 'number', userDefined: true }
    },

    streamelements: {
        enabled: { type: 'boolean', default: false },
        youtubeChannelId: { type: 'string', userDefined: true },
        twitchChannelId: { type: 'string', userDefined: true },
        dataLoggingEnabled: { type: 'boolean', default: false }
    },

    spam: {
        enabled: { type: 'boolean', default: true },
        lowValueThreshold: { type: 'number', default: 10 },
        detectionWindow: { type: 'number', default: 5 },
        maxIndividualNotifications: { type: 'number', default: 2 },
        tiktokEnabled: { type: 'boolean', default: true },
        tiktokLowValueThreshold: { type: 'number', userDefined: true },
        twitchEnabled: { type: 'boolean', default: true },
        twitchLowValueThreshold: { type: 'number', userDefined: true },
        youtubeEnabled: { type: 'boolean', default: false },
        youtubeLowValueThreshold: { type: 'number', default: 1.00 }
    },

    displayQueue: {
        autoProcess: { type: 'boolean', default: true },
        chatOptimization: { type: 'boolean', default: true },
        maxQueueSize: { type: 'number', default: 100 }
    },

    retry: {
        maxRetries: { type: 'number', default: 3, min: 0, max: 20 },
        baseDelay: { type: 'number', default: 1000, min: 100, max: 30000 },
        maxDelay: { type: 'number', default: 30000, min: 1000, max: 300000 },
        enableRetry: { type: 'boolean', default: true }
    },

    intervals: {
        pollInterval: { type: 'number', default: 5000 },
        connectionTimeout: { type: 'number', default: 30000 },
        keepAliveInterval: { type: 'number', default: 30000 },
        healthCheckInterval: { type: 'number', default: 60000 }
    },

    connectionLimits: {
        maxConnections: { type: 'number', default: 3 },
        maxConcurrentRequests: { type: 'number', default: 5 },
        maxStreamsPerConnection: { type: 'number', default: 1 }
    },

    api: {
        requestTimeout: { type: 'number', default: 5000 }
    },

    logging: {
        consoleLevel: { type: 'string', userDefined: true },
        fileLevel: { type: 'string', userDefined: true },
        fileLoggingEnabled: { type: 'boolean', userDefined: true }
    },

    timing: {
        fadeDuration: { type: 'number', default: 750 },
        notificationClearDelay: { type: 'number', default: 500 },
        transitionDelay: { type: 'number', default: 200 },
        chatMessageDuration: { type: 'number', default: 4500 }
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
        defaultCooldown: { type: 'number', default: 60, min: 10, max: 3600 },
        heavyCommandCooldown: { type: 'number', default: 30, min: 60, max: 3600 },
        heavyCommandThreshold: { type: 'number', default: 3, min: 2, max: 20 },
        heavyCommandWindow: { type: 'number', default: 60 },
        maxEntries: { type: 'number', default: 1000 }
    },

    obs: {
        enabled: { type: 'boolean', default: false },
        connectionTimeoutMs: { type: 'number', default: 10000 },
        address: { type: 'string', default: 'ws://localhost:4455' },
        notificationTxt: { type: 'string', default: 'notification-text' },
        notificationScene: { type: 'string', default: 'notification-scene' },
        notificationMsgGroup: { type: 'string', default: 'notification-group' },
        ttsTxt: { type: 'string', default: 'tts-text' },
        chatPlatformLogoTwitch: { type: 'string', userDefined: true },
        chatPlatformLogoYouTube: { type: 'string', userDefined: true },
        chatPlatformLogoTikTok: { type: 'string', userDefined: true },
        notificationPlatformLogoTwitch: { type: 'string', userDefined: true },
        notificationPlatformLogoYouTube: { type: 'string', userDefined: true },
        notificationPlatformLogoTikTok: { type: 'string', userDefined: true }
    },

    goals: {
        enabled: { type: 'boolean', default: false },
        tiktokGoalEnabled: { type: 'boolean', default: true },
        tiktokGoalSource: { type: 'string', userDefined: true },
        tiktokGoalTarget: { type: 'number', default: 1000 },
        tiktokGoalCurrency: { type: 'string', default: 'coins' },
        tiktokPaypiggyEquivalent: { type: 'number', default: 50 },
        youtubeGoalEnabled: { type: 'boolean', default: true },
        youtubeGoalSource: { type: 'string', userDefined: true },
        youtubeGoalTarget: { type: 'number', default: 1.00 },
        youtubeGoalCurrency: { type: 'string', default: 'dollars' },
        youtubePaypiggyPrice: { type: 'number', default: 4.99 },
        twitchGoalEnabled: { type: 'boolean', default: true },
        twitchGoalSource: { type: 'string', userDefined: true },
        twitchGoalTarget: { type: 'number', default: 100 },
        twitchGoalCurrency: { type: 'string', default: 'bits' },
        twitchPaypiggyEquivalent: { type: 'number', default: 350 }
    },

    gifts: {
        command: { type: 'string', userDefined: true },
        giftVideoSource: { type: 'string', default: 'gift-video' },
        giftAudioSource: { type: 'string', default: 'gift-audio' }
    },

    tts: {
        onlyForGifts: { type: 'boolean', default: false },
        voice: { type: 'string', default: 'default' },
        rate: { type: 'number', default: 1.0 },
        volume: { type: 'number', default: 1.0 }
    },

    farewell: {
        command: { type: 'string', userDefined: true }
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
};

function getFieldsRequiredWhenEnabled(sectionName) {
    const sectionSchema = CONFIG_SCHEMA[sectionName];
    if (!sectionSchema) return [];

    return Object.entries(sectionSchema)
        .filter(([, spec]) => spec.requiredWhenEnabled === true)
        .map(([fieldName]) => fieldName);
}

module.exports = {
    CONFIG_SCHEMA,
    getFieldsRequiredWhenEnabled
};
