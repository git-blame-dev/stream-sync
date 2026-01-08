const createErrorHandlerMock = () => ({
  handleEventProcessingError: jest.fn(),
  handleConnectionError: jest.fn(),
  handleConfigurationError: jest.fn(),
  handleCleanupError: jest.fn()
});

jest.mock('fs', () => ({
  mkdirSync: jest.fn()
}));

jest.mock('../../../src/utils/dependency-validator', () => ({
  validateYouTubePlatformDependencies: jest.fn(() => true),
  validateLoggerInterface: jest.fn(() => true)
}));

jest.mock('../../../src/utils/youtube-connection-manager', () => ({
  YouTubeConnectionManager: jest.fn(() => ({
    connectToStream: jest.fn(),
    getConnectionCount: jest.fn(() => 0),
    getAllVideoIds: jest.fn(() => []),
    getActiveVideoIds: jest.fn(() => []),
    hasConnection: jest.fn(() => false),
    disconnectFromStream: jest.fn(),
    cleanupAllConnections: jest.fn(),
    removeConnection: jest.fn(),
    getConnection: jest.fn(() => ({
      on: jest.fn(),
      start: jest.fn(),
      sendMessage: jest.fn()
    })),
    setConnectionReady: jest.fn(),
    getConnectionStatus: jest.fn(() => ({ ready: true }))
  }))
}));

jest.mock('../../../src/utils/youtube-notification-dispatcher', () => ({
  YouTubeNotificationDispatcher: jest.fn(() => ({
    dispatchSuperChat: jest.fn(),
    dispatchSuperSticker: jest.fn(),
    dispatchMembership: jest.fn(),
    dispatchGiftMembership: jest.fn()
  }))
}));

jest.mock('../../../src/utils/youtube-author-extractor', () => ({
  extractAuthor: jest.fn(() => ({ name: 'MockUser', displayName: 'MockUser' }))
}));

jest.mock('../../../src/utils/notification-builder', () => ({
  build: jest.fn((payload) => ({ ...payload, built: true }))
}));

jest.mock('../../../src/utils/platform-error-handler', () => ({
  createPlatformErrorHandler: jest.fn(() => createErrorHandlerMock())
}));

jest.mock('../../../src/utils/config-normalizer', () => {
  const defaults = {
    retryAttempts: 3,
    maxStreams: 5,
    streamPollingInterval: 60,
    fullCheckInterval: 300000,
    dataLoggingEnabled: false,
    dataLoggingPath: './logs'
  };

  return {
    normalizeYouTubeConfig: jest.fn((config = {}) => ({ ...defaults, ...config })),
    DEFAULT_YOUTUBE_CONFIG: defaults
  };
});

jest.mock('../../../src/utils/timeout-validator', () => ({
  validateTimeout: jest.fn((value) => value),
  safeSetInterval: jest.fn((fn) => {
    fn();
    return { ref: 'timer' };
  })
}));

const mockTextProcessing = {
  extractMessageText: jest.fn(() => 'mock message')
};

jest.mock('../../../src/utils/text-processing', () => ({
  createTextProcessingManager: jest.fn(() => mockTextProcessing),
  TextProcessingManager: jest.fn(),
  formatTimestampCompact: jest.fn()
}));

jest.mock('../../../src/utils/viewer-count-providers', () => ({
  ViewerCountProviderFactory: {
    createYouTubeProvider: jest.fn(() => ({
      getViewerCount: jest.fn().mockResolvedValue(0),
      getViewerCountForVideo: jest.fn().mockResolvedValue(0)
    }))
  }
}));

jest.mock('../../../src/utils/youtube-user-agent-manager', () => ({
  YouTubeUserAgentManager: jest.fn(() => ({
    getNextUserAgent: jest.fn(() => 'agent')
  }))
}));

jest.mock('../../../src/services/ChatFileLoggingService', () => {
  return jest.fn().mockImplementation(() => ({
    logRawPlatformData: jest.fn().mockResolvedValue(true),
    logUnknownEvent: jest.fn().mockResolvedValue(true)
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
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
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
      detectLiveStreams: jest.fn().mockResolvedValue({
        success: true,
        videoIds: []
      })
    },
    viewerService: {
      setActiveStream: jest.fn(),
      clearActiveStream: jest.fn(),
      cleanup: jest.fn()
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
    jest.clearAllMocks();
    seedMockImplementations();
  });

  it('suppresses anonymous/junk notifications', async () => {
    const anonymousExtractor = {
      extractAuthor: jest.fn(() => ({ name: '', displayName: '   ' }))
    };
    const { platform, logger } = createPlatformInstance({
      AuthorExtractor: anonymousExtractor
    });
    platform.handlers.onEngagement = jest.fn();

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
      extractAuthor: jest.fn(() => ({ name: 'Kit', displayName: 'Kit', id: 'yt-kit' }))
    };
    const customNotificationBuilder = {
      build: jest.fn((payload) => ({ ...payload, built: true }))
    };
    const { platform } = createPlatformInstance({
      AuthorExtractor: engagementExtractor,
      NotificationBuilder: customNotificationBuilder
    });
    const handler = jest.fn();
    const eventType = 'engagement';
    const handlerName = `on${eventType.charAt(0).toUpperCase() + eventType.slice(1)}`;
    platform.handlers[handlerName] = handler;

    platform.unifiedNotificationProcessor.shouldSuppressNotification = jest.fn(() => false);

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
    jest.clearAllMocks();
    seedMockImplementations();
  });

  it('routes dispatcher failures through the platform error handler', async () => {
    const errorHandler = createErrorHandlerMock();
    createPlatformErrorHandler.mockImplementation(() => errorHandler);
    const { platform } = createPlatformInstance();
    const dispatcher = platform.notificationDispatcher;
    const error = new Error('boom');
    dispatcher.dispatchSuperChat = jest.fn().mockRejectedValue(error);

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
