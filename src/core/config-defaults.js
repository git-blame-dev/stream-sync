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
    }
};

module.exports = { DEFAULTS };
