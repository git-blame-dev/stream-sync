const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');

const createErrorHandlerMock = () => ({
  handleEventProcessingError: createMockFn(),
  handleConnectionError: createMockFn(),
  handleConfigurationError: createMockFn(),
  handleCleanupError: createMockFn()
});

mockModule('fs', () => ({
  mkdirSync: createMockFn()
}));

mockModule('../../../src/utils/dependency-validator', () => ({
  validateYouTubePlatformDependencies: createMockFn(() => true),
  validateLoggerInterface: createMockFn(() => true)
}));

mockModule('../../../src/utils/youtube-connection-manager', () => ({
  YouTubeConnectionManager: createMockFn(() => ({
    connectToStream: createMockFn(),
    getConnectionCount: createMockFn(() => 0),
    getAllVideoIds: createMockFn(() => []),
    getActiveVideoIds: createMockFn(() => []),
    hasConnection: createMockFn(() => false),
    disconnectFromStream: createMockFn(),
    cleanupAllConnections: createMockFn(),
    removeConnection: createMockFn(),
    getConnection: createMockFn(() => ({
      on: createMockFn(),
      start: createMockFn(),
      sendMessage: createMockFn()
    })),
    setConnectionReady: createMockFn(),
    getConnectionStatus: createMockFn(() => ({ ready: true }))
  }))
}));

mockModule('../../../src/utils/youtube-notification-dispatcher', () => ({
  YouTubeNotificationDispatcher: createMockFn(() => ({
    dispatchSuperChat: createMockFn(),
    dispatchSuperSticker: createMockFn(),
    dispatchMembership: createMockFn(),
    dispatchGiftMembership: createMockFn()
  }))
}));

mockModule('../../../src/utils/youtube-author-extractor', () => ({
  extractAuthor: createMockFn(() => ({ name: 'MockUser', displayName: 'MockUser' }))
}));

mockModule('../../../src/utils/notification-builder', () => ({
  build: createMockFn((payload) => ({ ...payload, built: true }))
}));

mockModule('../../../src/utils/platform-error-handler', () => ({
  createPlatformErrorHandler: createMockFn(() => createErrorHandlerMock())
}));

mockModule('../../../src/utils/config-normalizer', () => {
  const defaults = {
    retryAttempts: 3,
    maxStreams: 5,
    streamPollingInterval: 60,
    fullCheckInterval: 300000,
    dataLoggingEnabled: false,
    dataLoggingPath: './logs'
  };

  return {
    normalizeYouTubeConfig: createMockFn((config = {}) => ({ ...defaults, ...config })),
    DEFAULT_YOUTUBE_CONFIG: defaults
  };
});

mockModule('../../../src/utils/timeout-validator', () => ({
  validateTimeout: createMockFn((value) => value),
  safeSetInterval: createMockFn((fn) => {
    fn();
    return { ref: 'timer' };
  })
}));

const mockTextProcessing = {
  extractMessageText: createMockFn(() => 'mock message')
};

mockModule('../../../src/utils/text-processing', () => ({
  createTextProcessingManager: createMockFn(() => mockTextProcessing),
  TextProcessingManager: createMockFn(),
  formatTimestampCompact: createMockFn()
}));

mockModule('../../../src/utils/viewer-count-providers', () => ({
  ViewerCountProviderFactory: {
    createYouTubeProvider: createMockFn(() => ({
      getViewerCount: createMockFn().mockResolvedValue(0),
      getViewerCountForVideo: createMockFn().mockResolvedValue(0)
    }))
  }
}));

mockModule('../../../src/utils/youtube-user-agent-manager', () => ({
  YouTubeUserAgentManager: createMockFn(() => ({
    getNextUserAgent: createMockFn(() => 'agent')
  }))
}));

mockModule('../../../src/services/ChatFileLoggingService', () => {
  return createMockFn().mockImplementation(() => ({
    logRawPlatformData: createMockFn().mockResolvedValue(true),
    logUnknownEvent: createMockFn().mockResolvedValue(true)
  }));
});

const notificationBuilder = require('../../../src/utils/notification-builder');
const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const { validateYouTubePlatformDependencies } = require('../../../src/utils/dependency-validator');
const { createTextProcessingManager } = require('../../../src/utils/text-processing');
const { validateTimeout, safeSetInterval } = require('../../../src/utils/timeout-validator');
const authorExtractorModule = require('../../../src/utils/youtube-author-extractor');
const { YouTubePlatform } = require('../../../src/platforms/youtube');

const TEST_TIMESTAMP_MS = 1700000000000;
const TEST_TIMESTAMP_ISO = new Date(TEST_TIMESTAMP_MS).toISOString();

const seedMockImplementations = () => {
  validateYouTubePlatformDependencies.mockReturnValue(true);
  notificationBuilder.build.mockImplementation((payload) => ({ ...payload, built: true }));
  createPlatformErrorHandler.mockImplementation(() => createErrorHandlerMock());
  createTextProcessingManager.mockImplementation(() => mockTextProcessing);
  mockTextProcessing.extractMessageText.mockImplementation(() => 'mock message');
  validateTimeout.mockImplementation((value) => value);
  safeSetInterval.mockImplementation((fn) => {
    fn();
    return { ref: 'timer' };
  });
  authorExtractorModule.extractAuthor.mockImplementation(() => ({ name: 'MockUser', displayName: 'MockUser', id: 'mock-channel' }));
};

const createLogger = () => ({
  debug: createMockFn(),
  info: createMockFn(),
  warn: createMockFn(),
  error: createMockFn()
});

const createPlatformInstance = (overrides = {}) => {
  const logger = overrides.logger || createLogger();
  const {
    AuthorExtractor: authorExtractorOverride,
    NotificationBuilder: notificationBuilderOverride,
    ...restOverrides
  } = overrides;

  const dependencies = {
    logger,
    streamDetectionService: {
      detectLiveStreams: createMockFn().mockResolvedValue({
        success: true,
        videoIds: []
      })
    },
    viewerService: {
      setActiveStream: createMockFn(),
      clearActiveStream: createMockFn(),
      cleanup: createMockFn()
    },
    USER_AGENTS: ['unit-agent'],
    Innertube: null,
    AuthorExtractor: authorExtractorOverride || require('../../../src/utils/youtube-author-extractor'),
    NotificationBuilder: notificationBuilderOverride,
    ...restOverrides
  };

  if (!dependencies.NotificationBuilder) {
    dependencies.NotificationBuilder = notificationBuilder;
  }

  const platform = new YouTubePlatform({ enabled: true, username: 'unit-test-youtube' }, dependencies);
  platform.handlers = platform.handlers || {};
  return { platform, dependencies, logger };
};

describe('YouTubePlatform unified notification processing', () => {
  beforeEach(() => {
    clearAllMocks();
    seedMockImplementations();
  });

  afterEach(() => {
    restoreAllMocks();
    restoreAllModuleMocks();
    resetModules();
  });

  it('suppresses anonymous/junk notifications', async () => {
    const anonymousExtractor = {
      extractAuthor: createMockFn(() => ({ name: '', displayName: '   ' }))
    };
    const { platform, logger } = createPlatformInstance({
      AuthorExtractor: anonymousExtractor
    });
    platform.handlers.onEngagement = createMockFn();

    const result = await platform.unifiedNotificationProcessor.processNotification({ item: {} }, 'engagement');

    expect(result).toBeUndefined();
    expect(platform.handlers.onEngagement).not.toHaveBeenCalled();
    const suppressedCall = logger.debug.mock.calls.find(([message]) => message.includes('Suppressed'));
    expect(suppressedCall).toBeDefined();
    const [message, context, metadata] = suppressedCall;
    expect(message).toContain('Suppressed');
    expect(context).toBe('youtube');
    expect(metadata.author.name).toBe('');
  });

  it('builds notifications and invokes the handler when author is valid', async () => {
    const engagementExtractor = {
      extractAuthor: createMockFn(() => ({ name: 'Kit', displayName: 'Kit', id: 'yt-kit' }))
    };
    const customNotificationBuilder = {
      build: createMockFn((payload) => ({ ...payload, built: true }))
    };
    const { platform } = createPlatformInstance({
      AuthorExtractor: engagementExtractor,
      NotificationBuilder: customNotificationBuilder
    });
    const handler = createMockFn();
    const eventType = 'engagement';
    const handlerName = `on${eventType.charAt(0).toUpperCase() + eventType.slice(1)}`;
    platform.handlers[handlerName] = handler;

    platform.unifiedNotificationProcessor.shouldSuppressNotification = createMockFn(() => false);

    const notification = await platform.unifiedNotificationProcessor.processNotification(
      { item: { id: 'LCC.test-engagement-001', timestampUsec: String(TEST_TIMESTAMP_MS * 1000) } },
      eventType,
      { extra: 'value' }
    );

    expect(platform.errorHandler).toBeDefined();
    expect(engagementExtractor.extractAuthor).toHaveBeenCalled();
    expect(platform.unifiedNotificationProcessor.shouldSuppressNotification).toHaveReturnedWith(false);

    if (platform.errorHandler && typeof platform.errorHandler.handleEventProcessingError === 'function') {
      expect(platform.errorHandler.handleEventProcessingError).not.toHaveBeenCalled();
    }

    expect(notification).toMatchObject({
      platform: 'youtube',
      type: eventType,
      message: 'mock message',
      extra: 'value',
      username: 'Kit',
      userId: 'yt-kit',
      id: 'LCC.test-engagement-001',
      timestamp: TEST_TIMESTAMP_ISO
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual(notification);
  });
});

describe('YouTubeBaseEventHandler error handling', () => {
  beforeEach(() => {
    clearAllMocks();
    seedMockImplementations();
  });

  afterEach(() => {
    restoreAllMocks();
    restoreAllModuleMocks();
    resetModules();
  });

  it('routes dispatcher failures through the platform error handler', async () => {
    const errorHandler = createErrorHandlerMock();
    createPlatformErrorHandler.mockImplementation(() => errorHandler);
    const { platform } = createPlatformInstance();
    const dispatcher = platform.notificationDispatcher;
    const error = new Error('boom');
    dispatcher.dispatchSuperChat = createMockFn().mockRejectedValue(error);

    await platform.baseEventHandler.handleEvent({ payload: true }, {
      eventType: 'superchat',
      dispatchMethod: 'dispatchSuperChat'
    });

    expect(errorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);
    const [handledError, eventType, payload, message] = errorHandler.handleEventProcessingError.mock.calls[0];
    expect(handledError).toBe(error);
    expect(eventType).toBe('superchat');
    expect(payload).toEqual({ payload: true });
    expect(message).toContain('Error handling superchat');
  });
});
