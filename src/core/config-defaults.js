const DEFAULTS = {
    LOG_DIRECTORY: './logs',

    general: {
        cmdCoolDown: 60,
        globalCmdCoolDown: 60,
        viewerCountPollingInterval: 60,
        debugEnabled: false,
        messagesEnabled: true,
        commandsEnabled: true,
        greetingsEnabled: true,
        farewellsEnabled: true,
        followsEnabled: true,
        giftsEnabled: true,
        raidsEnabled: true,
        paypiggiesEnabled: true,
        greetNewCommentors: false,
        filterOldMessages: true,
        logChatMessages: true,
        keywordParsingEnabled: true,
        ignoreSelfMessages: false,
        userSuppressionEnabled: true,
        maxNotificationsPerUser: 5,
        suppressionWindow: 60,
        suppressionDuration: 300,
        suppressionCleanupInterval: 300,
        ttsEnabled: false,
        streamDetectionEnabled: true,
        streamRetryInterval: 15,
        streamMaxRetries: -1,
        continuousMonitoringInterval: 60,
        envFileReadEnabled: true,
        envFileWriteEnabled: true,
        viewerCountScene: 'viewer-count-scene',
        chatMsgTxt: 'chat-message-text',
        chatMsgScene: 'chat-message-scene',
        chatMsgGroup: 'chat-message-group',
        fallbackUsername: 'Unknown User',
        anonymousUsername: 'Anonymous User',
        envFilePath: './.env',
        maxMessageLength: 500
    },

    http: {
        defaultTimeoutMs: 10000,
        reachabilityTimeoutMs: 5000,
        enhancedTimeoutMs: 3000,
        enhancedReachabilityTimeoutMs: 3000
    },

    youtube: {
        enabled: false,
        viewerCountEnabled: true,
        retryAttempts: 3,
        maxStreams: 2,
        streamPollingInterval: 60,
        fullCheckInterval: 300000,
        dataLoggingEnabled: false,
        enableAPI: false,
        streamDetectionMethod: 'youtubei',
        viewerCountMethod: 'youtubei'
    },

    twitch: {
        enabled: false,
        viewerCountEnabled: true,
        eventsubEnabled: true,
        dataLoggingEnabled: false,
        tokenStorePath: './data/twitch-tokens.json'
    },

    tiktok: {
        enabled: false,
        viewerCountEnabled: true,
        viewerCountSource: 'websocket',
        greetingsEnabled: true,
        giftAggregationEnabled: true,
        dataLoggingEnabled: false
    },

    streamelements: {
        enabled: false,
        dataLoggingEnabled: false
    },

    spam: {
        detectionWindow: 5,
        maxIndividualNotifications: 2
    },

    displayQueue: {
        autoProcess: true,
        chatOptimization: true,
        maxQueueSize: 100
    },

    retry: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        enableRetry: true
    },

    intervals: {
        pollInterval: 5000,
        connectionTimeout: 30000,
        keepAliveInterval: 30000,
        healthCheckInterval: 60000
    },

    connectionLimits: {
        maxConnections: 3,
        maxConcurrentRequests: 5,
        maxStreamsPerConnection: 1
    },

    api: {
        requestTimeout: 5000
    },

    logging: {
        level: 'info',
        enableDebug: false,
        enableConsole: true,
        enableFile: false,
        maxFileSize: 10485760,
        platformDataLoggingEnabled: false,
        streamelementsDataLoggingEnabled: false
    },

    timing: {
        fadeDuration: 750,
        notificationClearDelay: 500,
        transitionDelay: 200,
        chatMessageDuration: 4500,
        defaultNotificationDuration: 3000,
        greetingDuration: 3000,
        followDuration: 3000,
        giftDuration: 3000,
        memberDuration: 3000,
        raidDuration: 3000
    },

    handcam: {
        glowEnabled: false,
        sourceName: 'handcam-source',
        sceneName: 'handcam-scene',
        glowFilterName: 'Glow',
        maxSize: 50,
        rampUpDuration: 0.5,
        holdDuration: 6.0,
        rampDownDuration: 0.5,
        totalSteps: 30,
        incrementPercent: 3.33,
        easingEnabled: true,
        animationInterval: 16
    },

    cooldowns: {
        defaultCooldown: 5,
        heavyCommandCooldown: 30,
        heavyCommandThreshold: 3,
        heavyCommandWindow: 60,
        maxEntries: 1000
    },

    obs: {
        enabled: false,
        connectionTimeoutMs: 10000,
        address: 'ws://localhost:4455',
        notificationTxt: 'notification-text',
        chatMsgTxt: 'chat-message-text',
        notificationScene: 'notification-scene',
        notificationMsgGroup: 'notification-group',
        ttsTxt: 'tts-text',
        ttsScene: 'tts-scene'
    },

    goals: {
        enabled: false,
        goalScene: 'goals-scene',
        tiktokGoalEnabled: true,
        tiktokGoalTarget: 1000,
        tiktokGoalCurrency: 'coins',
        tiktokPaypiggyEquivalent: 50,
        youtubeGoalEnabled: true,
        youtubeGoalTarget: 1.00,
        youtubeGoalCurrency: 'dollars',
        youtubePaypiggyPrice: 4.99,
        twitchGoalEnabled: true,
        twitchGoalTarget: 100,
        twitchGoalCurrency: 'bits',
        twitchPaypiggyEquivalent: 350
    },

    gifts: {
        giftVideoSource: 'gift-video',
        giftAudioSource: 'gift-audio',
        giftScene: 'gift-scene',
        lowValueThreshold: 10,
        spamDetectionEnabled: true,
        spamDetectionWindow: 5,
        maxIndividualNotifications: 2
    },

    tts: {
        deduplicationEnabled: true,
        debugDeduplication: false,
        onlyForGifts: false,
        voice: 'default',
        rate: 1.0,
        volume: 1.0,
        twitchDeduplicationEnabled: true,
        youtubeDeduplicationEnabled: true,
        tiktokDeduplicationEnabled: true,
        performanceWarningThreshold: 50
    },

    farewell: {
        enabled: false
    },

    commands: {
        enabled: false
    }
};

module.exports = { DEFAULTS };
