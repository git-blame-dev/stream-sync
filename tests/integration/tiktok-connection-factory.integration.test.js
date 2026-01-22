const { describe, expect, it } = require('bun:test');
const { noOpLogger } = require('../helpers/mock-factories');

const { EventEmitter } = require('events');
const { DependencyFactory } = require('../../src/utils/dependency-factory');
const { TikTokPlatform } = require('../../src/platforms/tiktok');

const mockRetrySystem = {
    resetRetryCount: () => {},
    handleConnectionError: () => {},
    delay: () => Promise.resolve()
};

describe('TikTokPlatform connection factory integration', () => {

    const config = { enabled: true, username: 'factory_tester' };

    const createPlatform = () => {
        class MockTikTokWebSocketClient extends EventEmitter {
            constructor() {
                super();
                this.isConnected = false;
                this.isConnecting = false;
            }
            async connect() {
                this.isConnected = true;
                this.emit('connected', { roomId: 'room-test', isLive: true, status: 2 });
                return { roomId: 'room-test' };
            }
            disconnect() {
                this.isConnected = false;
                this.emit('disconnected', { code: 1000, reason: 'intentional' });
            }
        }

        const factory = new DependencyFactory();
        const dependencies = factory.createTiktokDependencies(config, {
            TikTokWebSocketClient: MockTikTokWebSocketClient,
            logger: noOpLogger,
            retrySystem: mockRetrySystem
        });
        return new TikTokPlatform(config, dependencies);
    };

    it('creates an event-emitter-capable connection when connecting', async () => {
        const platform = createPlatform();

        await platform.initialize({});

        expect(typeof platform.connection.on).toBe('function');
        expect(typeof platform.connection.removeAllListeners).toBe('function');
    });
});
