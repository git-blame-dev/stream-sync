const { describe, it, expect } = require('bun:test');
const { ConnectionStateManager } = require('../../../src/utils/connection-state-manager');
const { noOpLogger } = require('../../helpers/mock-factories');

const createManager = (disconnectFn = () => {}) => {
    const mockConnection = {
        on: () => {},
        emit: () => {},
        removeAllListeners: () => {},
        connect: () => {},
        disconnect: disconnectFn
    };
    const connectionFactory = {
        createConnection: () => mockConnection
    };
    const manager = new ConnectionStateManager('tiktok', connectionFactory);
    manager.initialize({}, { logger: noOpLogger });
    manager.ensureConnection();
    return manager;
};

describe('ConnectionStateManager', () => {
    describe('cleanup', () => {
        it('handles disconnect methods that return undefined', () => {
            const manager = createManager(() => undefined);

            expect(() => manager.cleanup()).not.toThrow();
            expect(manager.getState()).toBe('disconnected');
        });

        it('handles disconnect methods that return Promises', () => {
            const manager = createManager(() => Promise.resolve());

            expect(() => manager.cleanup()).not.toThrow();
            expect(manager.getState()).toBe('disconnected');
        });

        it('handles disconnect methods that return rejected Promises gracefully', () => {
            const manager = createManager(() => Promise.reject(new Error('test-disconnect-error')));

            expect(() => manager.cleanup()).not.toThrow();
            expect(manager.getState()).toBe('disconnected');
        });

        it('resets connection state after cleanup', () => {
            const manager = createManager();
            manager.markConnected();

            manager.cleanup();

            const info = manager.getConnectionInfo();
            expect(info.state).toBe('disconnected');
            expect(info.hasConnection).toBe(false);
            expect(info.connectionTime).toBe(0);
            expect(info.lastError).toBeNull();
        });
    });
});
