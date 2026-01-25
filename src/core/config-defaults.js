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
        envFileWriteEnabled: true
    },

    youtube: {
        retryAttempts: 3,
        maxStreams: 2,
        streamPollingInterval: 60,
        fullCheckInterval: 300000,
        dataLoggingEnabled: false
    },

    twitch: {
        enabled: false,
        eventsubEnabled: true,
        dataLoggingEnabled: false
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
        maxFileSize: 10485760
    },

    timing: {
        fadeDuration: 750,
        notificationClearDelay: 500,
        transitionDelay: 200,
        chatMessageDuration: 4500
    },

    handcam: {
        glowEnabled: false,
        sourceName: 'handcam-source',
        sceneName: 'handcam-scene',
        glowFilterName: 'Glow',
        maxSize: 50,
        rampUpDuration: 500,
        holdDuration: 6000,
        rampDownDuration: 500,
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
        connectionTimeoutMs: 10000
    }
};

module.exports = { DEFAULTS };
