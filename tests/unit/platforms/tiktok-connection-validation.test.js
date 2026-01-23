const { describe, it, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { PlatformConnectionFactory } = require('../../../src/utils/platform-connection-factory');

describe('TikTok connection creation', () => {
  it('wraps connector instances so they expose EventEmitter methods for listener setup', async () => {
    const bareConnectorInstance = { connect: createMockFn().mockResolvedValue(true) };
    const TikTokWebSocketClient = createMockFn(() => bareConnectorInstance);
    const factory = new PlatformConnectionFactory(noOpLogger);

    const connection = factory.createTikTokConnection(
      { username: 'testStream' },
      { logger: noOpLogger, TikTokWebSocketClient }
    );

    const handlerCalls = [];
    connection.on('connected', (payload) => handlerCalls.push(payload));
    connection.emit('connected', 'payload');

    expect(typeof connection.on).toBe('function');
    expect(typeof connection.emit).toBe('function');
    expect(typeof connection.removeAllListeners).toBe('function');
    expect(handlerCalls).toHaveLength(1);
    expect(handlerCalls[0]).toBe('payload');
  });
});
