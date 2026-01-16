
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { createMockLogger } = require('../../helpers/mock-factories');

const TwitchAuthManager = require('../../../src/auth/TwitchAuthManager');

function createMockConfiguration(overrides = {}) {
    return {
        clientId: overrides.clientId || 'test-client-id',
        clientSecret: overrides.clientSecret || 'test-client-secret',
        accessToken: overrides.accessToken || 'test-access-token',
        refreshToken: overrides.refreshToken || 'test-refresh-token',
        channel: overrides.channel || 'test-channel',
        environment: overrides.environment || 'test',
        ...overrides
    };
}

function createAuthManager(config, dependencies = {}) {
    return TwitchAuthManager.getInstance(config, {
        logger: dependencies.logger || createMockLogger(),
        ...dependencies
    });
}

function expectConfigurationIsolation(authManager1, authManager2) {
    const config1 = authManager1.getConfig();
    const config2 = authManager2.getConfig();
    expect(config1).not.toBe(config2);
}

function expectConfigurationMatch(authManager, expectedConfig) {
    const actualConfig = authManager.getConfig();
    expect(actualConfig.environment).toBe(expectedConfig.environment);
    expect(actualConfig.accessToken).toBe(expectedConfig.accessToken);
    expect(actualConfig.channel).toBe(expectedConfig.channel);
}

describe('TwitchAuthManager Configuration Isolation', () => {
    afterEach(() => {
        TwitchAuthManager.resetInstance();
    });

    describe('Independent Configuration Management', () => {
        test('should maintain independent configurations for different auth manager instances', () => {
            const prodConfig = createMockConfiguration({
                environment: 'production',
                accessToken: 'prod-token-123',
                channel: 'prod-channel'
            });
            const testConfig = createMockConfiguration({
                environment: 'test',
                accessToken: 'test-token-456',
                channel: 'test-channel'
            });

            const prodAuthManager = createAuthManager(prodConfig);
            const testAuthManager = createAuthManager(testConfig);

            expectConfigurationMatch(prodAuthManager, prodConfig);
            expectConfigurationMatch(testAuthManager, testConfig);
            expectConfigurationIsolation(prodAuthManager, testAuthManager);
        });

        test('should allow configuration updates without affecting other instances', () => {
            const config1 = createMockConfiguration({
                environment: 'instance1',
                accessToken: 'token1'
            });
            const config2 = createMockConfiguration({
                environment: 'instance2',
                accessToken: 'token2'
            });

            const authManager1 = createAuthManager(config1);
            const authManager2 = createAuthManager(config2);

            const updatedConfig1 = createMockConfiguration({
                environment: 'instance1-updated',
                accessToken: 'token1-updated'
            });
            authManager1.updateConfig(updatedConfig1);

            expectConfigurationMatch(authManager1, updatedConfig1);
            expectConfigurationMatch(authManager2, config2);
            expectConfigurationIsolation(authManager1, authManager2);
        });

        test('should deep copy configuration to prevent shared state', () => {
            const sharedConfigObject = createMockConfiguration({ environment: 'shared' });

            const authManager1 = createAuthManager(sharedConfigObject);
            const authManager2 = createAuthManager(sharedConfigObject);

            sharedConfigObject.environment = 'modified';

            expect(authManager1.getConfig().environment).toBe('shared');
            expect(authManager2.getConfig().environment).toBe('shared');
        });
    });

    describe('State Independence', () => {
        test('should start with UNINITIALIZED state independently', () => {
            const config1 = createMockConfiguration({ environment: 'instance1' });
            const config2 = createMockConfiguration({ environment: 'instance2' });

            const authManager1 = createAuthManager(config1);
            const authManager2 = createAuthManager(config2);

            expect(authManager1.getState()).toBe('UNINITIALIZED');
            expect(authManager2.getState()).toBe('UNINITIALIZED');
        });

        test('should reset state independently via updateConfig', () => {
            const config1 = createMockConfiguration({ environment: 'instance1' });
            const config2 = createMockConfiguration({ environment: 'instance2' });

            const authManager1 = createAuthManager(config1);
            const authManager2 = createAuthManager(config2);

            authManager1.updateConfig(createMockConfiguration({ environment: 'updated' }));

            expect(authManager1.getState()).toBe('UNINITIALIZED');
            expect(authManager2.getState()).toBe('UNINITIALIZED');
        });

        test('should maintain independent error state via lastError', () => {
            const config1 = createMockConfiguration({ environment: 'instance1' });
            const config2 = createMockConfiguration({ environment: 'instance2' });

            const authManager1 = createAuthManager(config1);
            const authManager2 = createAuthManager(config2);

            expect(authManager1.getLastError()).toBeNull();
            expect(authManager2.getLastError()).toBeNull();
        });
    });

    describe('Resource Management Independence', () => {
        test('should allow cleanup of uninitialized instances without errors', async () => {
            const config1 = createMockConfiguration({ environment: 'instance1' });
            const config2 = createMockConfiguration({ environment: 'instance2' });

            const authManager1 = createAuthManager(config1);
            const authManager2 = createAuthManager(config2);

            await authManager1.cleanup();

            expect(authManager2.getState()).toBe('UNINITIALIZED');
            expectConfigurationMatch(authManager2, config2);
        });

        test('should create new instance on each getInstance call with independent config', () => {
            const configs = [
                createMockConfiguration({ environment: 'test1', accessToken: 'token1' }),
                createMockConfiguration({ environment: 'test2', accessToken: 'token2' }),
                createMockConfiguration({ environment: 'test3', accessToken: 'token3' })
            ];

            const authManagers = configs.map(config => createAuthManager(config));

            authManagers.forEach((manager, index) => {
                expectConfigurationMatch(manager, configs[index]);
            });

            expect(authManagers[0]).not.toBe(authManagers[1]);
            expect(authManagers[1]).not.toBe(authManagers[2]);
            expect(authManagers[0]).not.toBe(authManagers[2]);
        });
    });
});
