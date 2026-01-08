
const { PlatformConnectionFactory } = require('../../../src/utils/platform-connection-factory');

const createMockLogger = () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
});

describe('TikTok connection creation', () => {
  it('wraps connector instances so they expose EventEmitter methods for listener setup', async () => {
    // Arrange: a connector that only implements connect (no emitter surface)
    const bareConnectorInstance = { connect: jest.fn().mockResolvedValue(true) };
    const TikTokWebSocketClient = jest.fn(() => bareConnectorInstance);
    const logger = createMockLogger();
    const factory = new PlatformConnectionFactory(logger);

    // Act: build the connection through the factory
    const connection = factory.createTikTokConnection(
      { username: 'hero_stream' },
      { logger, TikTokWebSocketClient }
    );

    // Assert: EventEmitter surface is present and functional
    const handler = jest.fn();
    connection.on('connected', handler);
    connection.emit('connected', 'payload');

    expect(typeof connection.on).toBe('function');
    expect(typeof connection.emit).toBe('function');
    expect(typeof connection.removeAllListeners).toBe('function');
    expect(handler).toHaveBeenCalledWith('payload');
  });
});
