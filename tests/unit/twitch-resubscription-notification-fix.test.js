
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { spyOn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { unmockModule, requireActual, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

const {
  initializeTestLogging,
  TEST_TIMEOUTS
} = require('../helpers/test-setup');

const {
  noOpLogger
} = require('../helpers/mock-factories');

const {
  setupAutomatedCleanup
} = require('../helpers/mock-lifecycle');

const { EventEmitter } = require('events');

unmockModule('../../src/platforms/twitch-eventsub');
const TwitchEventSub = requireActual('../../src/platforms/twitch-eventsub');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true
});

describe('TwitchEventSub Resubscription Notification Fix', () => {
  let eventSub;
  let emitSpy;
  let mockLogger;

  beforeEach(() => {
    mockLogger = noOpLogger;
    const mockAuthManager = {
      getState: () => 'READY',
      getUserId: () => '123',
      authState: { executeWhenReady: async (fn) => fn() },
      getAccessToken: async () => 'token'
    };
    class MockChatFileLoggingService {
      constructor() {}
    }

    eventSub = new TwitchEventSub(
      { clientId: 'cid', accessToken: 'token', channel: 'streamer', username: 'streamer', dataLoggingEnabled: false },
      { logger: mockLogger, authManager: mockAuthManager, ChatFileLoggingService: MockChatFileLoggingService }
    );

    emitSpy = spyOn(EventEmitter.prototype, 'emit').mockImplementation(() => {});
  });

  afterEach(() => {
    restoreAllMocks();
  
        restoreAllModuleMocks();});

  describe('when resubscription message received', () => {
    it('emits canonical paypiggyMessage payload with months and tier', () => {
      const resubEvent = {
        user_id: '900000003',
        user_name: 'example_user_13',
        tier: '1000',
        cumulative_months: 3,
        timestamp: '2024-01-01T00:00:00Z',
        message: {
          text: '',
          emotes: null
        }
      };

      eventSub._handlePaypiggyMessageEvent(resubEvent);

      const [eventType, payload] = emitSpy.mock.calls[0];
      expect(eventType).toBe('paypiggyMessage');
      expect(payload).toMatchObject({
        type: 'paypiggy',
        username: 'example_user_13',
        userId: '900000003',
        tier: '1000',
        months: 3,
        message: '',
        timestamp: resubEvent.timestamp
      });
    });

    it('emits canonical paypiggyMessage with message text and premium tier', () => {
      const resubEvent = {
        user_id: '123456789',
        user_name: 'premium_user',
        tier: '2000',
        cumulative_months: 12,
        timestamp: '2024-01-01T00:00:00Z',
        message: {
          text: 'Love the streams!',
          emotes: null
        }
      };

      eventSub._handlePaypiggyMessageEvent(resubEvent);

      const [eventType, payload] = emitSpy.mock.calls[0];
      expect(eventType).toBe('paypiggyMessage');
      expect(payload).toMatchObject({
        type: 'paypiggy',
        username: 'premium_user',
        tier: '2000',
        months: 12,
        message: 'Love the streams!',
        timestamp: resubEvent.timestamp
      });
    });
  });

  describe('when standard subscription event received', () => {
    it('emits canonical paypiggy payload with normalized months', () => {
      const subEvent = {
        user_id: 'sub123',
        user_name: 'new_subscriber',
        tier: '2000',
        cumulative_months: 6,
        timestamp: '2024-01-01T00:00:00Z',
        is_gift: false
      };

      eventSub._handlePaypiggyEvent(subEvent);

      const [eventType, payload] = emitSpy.mock.calls[0];
      expect(eventType).toBe('paypiggy');
      expect(payload).toMatchObject({
        type: 'paypiggy',
        username: 'new_subscriber',
        userId: 'sub123',
        tier: '2000',
        months: 6,
        timestamp: subEvent.timestamp
      });
    });
  });
}, TEST_TIMEOUTS.FAST);
