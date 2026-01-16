
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const TwitchAuthManager = require('../../../src/auth/TwitchAuthManager');

function createContextConfiguration(context, overrides = {}) {
    return {
        clientId: `${context}-client-id`,
        clientSecret: `${context}-client-secret`,
        accessToken: `${context}-access-token`,
        refreshToken: `${context}-refresh-token`,
        channel: `${context}-channel`,
        context: context,
        ...overrides
    };
}

function createAuthManagerInstance(context, config) {
    return TwitchAuthManager.getInstance(config, {
        logger: noOpLogger,
        context
    });
}

function expectInstanceIndependence(instance1, instance2, context1, context2) {
    expect(instance1).not.toBe(instance2);
    const config1 = instance1.getConfig();
    const config2 = instance2.getConfig();
    expect(config1.context).toBe(context1);
    expect(config2.context).toBe(context2);
    expect(config1.context).not.toBe(config2.context);
}

function expectProperLifecycleManagement(instance, expectedContext) {
    expect(instance.getState()).toBeDefined();
    expect(instance.getConfig().context).toBe(expectedContext);
    expect(typeof instance.initialize).toBe('function');
    expect(typeof instance.cleanup).toBe('function');
}

class InstanceTracker {
    constructor() {
        this.instances = new Map();
    }

    register(context, instance) {
        this.instances.set(context, instance);
    }

    async cleanupAll() {
        const cleanupPromises = Array.from(this.instances.values()).map(
            instance => instance.cleanup().catch(() => {})
        );
        await Promise.all(cleanupPromises);
        this.instances.clear();
    }
}

describe('TwitchAuthManager Instance Management', () => {
    let instanceTracker;

    beforeEach(() => {
        instanceTracker = new InstanceTracker();
    });

    afterEach(async () => {
        await instanceTracker.cleanupAll();
        TwitchAuthManager.resetInstance();
    });

    describe('Multiple Instance Support', () => {
        test('should support creating multiple independent instances for different contexts', () => {
            const botConfig = createContextConfiguration('bot-service');
            const adminConfig = createContextConfiguration('admin-panel');
            const analyticsConfig = createContextConfiguration('analytics-service');

            const botInstance = createAuthManagerInstance('bot-service', botConfig);
            const adminInstance = createAuthManagerInstance('admin-panel', adminConfig);
            const analyticsInstance = createAuthManagerInstance('analytics-service', analyticsConfig);

            instanceTracker.register('bot-service', botInstance);
            instanceTracker.register('admin-panel', adminInstance);
            instanceTracker.register('analytics-service', analyticsInstance);

            expectInstanceIndependence(botInstance, adminInstance, 'bot-service', 'admin-panel');
            expectInstanceIndependence(botInstance, analyticsInstance, 'bot-service', 'analytics-service');
            expectInstanceIndependence(adminInstance, analyticsInstance, 'admin-panel', 'analytics-service');

            expectProperLifecycleManagement(botInstance, 'bot-service');
            expectProperLifecycleManagement(adminInstance, 'admin-panel');
            expectProperLifecycleManagement(analyticsInstance, 'analytics-service');
        });

        test('should maintain independent initial states across instances', () => {
            const primaryConfig = createContextConfiguration('primary-bot');
            const backupConfig = createContextConfiguration('backup-bot');

            const primaryInstance = createAuthManagerInstance('primary-bot', primaryConfig);
            const backupInstance = createAuthManagerInstance('backup-bot', backupConfig);

            instanceTracker.register('primary-bot', primaryInstance);
            instanceTracker.register('backup-bot', backupInstance);
            expect(primaryInstance.getState()).toBe('UNINITIALIZED');
            expect(backupInstance.getState()).toBe('UNINITIALIZED');
            expect(primaryInstance.getLastError()).toBeNull();
            expect(backupInstance.getLastError()).toBeNull();

            expectInstanceIndependence(primaryInstance, backupInstance, 'primary-bot', 'backup-bot');
        });

        test('should maintain independent configurations for different auth contexts', () => {
            const streamBotConfig = createContextConfiguration('stream-bot', {
                accessToken: 'stream-bot-token'
            });
            const moderatorConfig = createContextConfiguration('moderator-tools', {
                accessToken: 'moderator-token'
            });
            const viewerAnalyticsConfig = createContextConfiguration('viewer-analytics', {
                accessToken: 'analytics-token'
            });

            const streamBotInstance = createAuthManagerInstance('stream-bot', streamBotConfig);
            const moderatorInstance = createAuthManagerInstance('moderator-tools', moderatorConfig);
            const analyticsInstance = createAuthManagerInstance('viewer-analytics', viewerAnalyticsConfig);

            instanceTracker.register('stream-bot', streamBotInstance);
            instanceTracker.register('moderator-tools', moderatorInstance);
            instanceTracker.register('viewer-analytics', analyticsInstance);
            expect(streamBotInstance.getConfig().accessToken).toBe('stream-bot-token');
            expect(moderatorInstance.getConfig().accessToken).toBe('moderator-token');
            expect(analyticsInstance.getConfig().accessToken).toBe('analytics-token');
        });
    });

    describe('Instance Lifecycle Management', () => {
        test('should support independent cleanup cycles', async () => {
            const longRunningConfig = createContextConfiguration('long-running-service');
            const temporaryConfig = createContextConfiguration('temporary-task');

            const longRunningInstance = createAuthManagerInstance('long-running-service', longRunningConfig);
            const temporaryInstance = createAuthManagerInstance('temporary-task', temporaryConfig);

            instanceTracker.register('long-running-service', longRunningInstance);
            instanceTracker.register('temporary-task', temporaryInstance);
            await temporaryInstance.cleanup();
            expect(longRunningInstance.getState()).toBe('UNINITIALIZED');
            expect(temporaryInstance.getState()).toBe('UNINITIALIZED');
            expectInstanceIndependence(longRunningInstance, temporaryInstance, 'long-running-service', 'temporary-task');
        });

        test('should support configuration updates without affecting other instances', () => {
            const serviceAConfig = createContextConfiguration('service-a');
            const serviceBConfig = createContextConfiguration('service-b');

            const serviceAInstance = createAuthManagerInstance('service-a', serviceAConfig);
            const serviceBInstance = createAuthManagerInstance('service-b', serviceBConfig);

            instanceTracker.register('service-a', serviceAInstance);
            instanceTracker.register('service-b', serviceBInstance);
            const updatedConfigA = createContextConfiguration('service-a', {
                accessToken: 'updated-token-for-a',
                channel: 'updated-channel-for-a'
            });
            serviceAInstance.updateConfig(updatedConfigA);
            expect(serviceAInstance.getConfig().accessToken).toBe('updated-token-for-a');
            expect(serviceAInstance.getConfig().channel).toBe('updated-channel-for-a');
            expect(serviceAInstance.getState()).toBe('UNINITIALIZED');
            expect(serviceBInstance.getConfig().accessToken).toBe('service-b-access-token');
            expect(serviceBInstance.getConfig().channel).toBe('service-b-channel');

            expectInstanceIndependence(serviceAInstance, serviceBInstance, 'service-a', 'service-b');
        });

        test('should support selective cleanup without affecting other instances', async () => {
            const contexts = ['service-1', 'service-2', 'service-3', 'service-4'];
            const instances = contexts.map(context => {
                const config = createContextConfiguration(context);
                const instance = createAuthManagerInstance(context, config);
                instanceTracker.register(context, instance);
                return instance;
            });
            instances.forEach((instance, index) => {
                expect(instance.getState()).toBe('UNINITIALIZED');
                expect(instance.getConfig().context).toBe(contexts[index]);
            });
            await instances[1].cleanup();
            await instances[3].cleanup();
            expect(instances[0].getState()).toBe('UNINITIALIZED');
            expect(instances[1].getState()).toBe('UNINITIALIZED');
            expect(instances[2].getState()).toBe('UNINITIALIZED');
            expect(instances[3].getState()).toBe('UNINITIALIZED');
            expectInstanceIndependence(instances[0], instances[2], 'service-1', 'service-3');
        });
    });

    describe('Resource Management', () => {
        test('should create independent instances for batch operations', () => {
            const batchInstances = [];
            const batchSize = 5;

            for (let i = 0; i < batchSize; i++) {
                const context = `batch-instance-${i}`;
                const config = createContextConfiguration(context);
                const instance = createAuthManagerInstance(context, config);

                expect(instance.getState()).toBe('UNINITIALIZED');
                expect(instance.getConfig().context).toBe(context);

                batchInstances.push(instance);
                instanceTracker.register(context, instance);
            }
            for (let i = 0; i < batchInstances.length; i++) {
                for (let j = i + 1; j < batchInstances.length; j++) {
                    expect(batchInstances[i]).not.toBe(batchInstances[j]);
                }
            }
        });

        test('should support creating many short-lived instances', async () => {
            const instanceCount = 10;
            const instances = [];

            for (let i = 0; i < instanceCount; i++) {
                const context = `short-lived-${i}`;
                const config = createContextConfiguration(context);
                const instance = createAuthManagerInstance(context, config);

                expect(instance.getState()).toBe('UNINITIALIZED');
                await instance.cleanup();
                expect(instance.getState()).toBe('UNINITIALIZED');

                instances.push(instance);
            }
            instances.forEach((instance, index) => {
                expect(instance.getConfig().context).toBe(`short-lived-${index}`);
            });
            const finalConfig = createContextConfiguration('final-test');
            const finalInstance = createAuthManagerInstance('final-test', finalConfig);
            instanceTracker.register('final-test', finalInstance);

            expect(finalInstance.getState()).toBe('UNINITIALIZED');
            expect(finalInstance.getConfig().context).toBe('final-test');
        });

        test('should support concurrent instance creation without interference', async () => {
            const concurrentContexts = [
                'concurrent-auth-1',
                'concurrent-auth-2',
                'concurrent-auth-3',
                'concurrent-auth-4'
            ];

            const results = await Promise.all(
                concurrentContexts.map(async (context) => {
                    const config = createContextConfiguration(context);
                    const instance = createAuthManagerInstance(context, config);
                    const updatedConfig = createContextConfiguration(context, {
                        accessToken: `updated-${context}-token`
                    });
                    instance.updateConfig(updatedConfig);

                    return { context, instance };
                })
            );
            results.forEach(({ context, instance }) => {
                expect(instance.getConfig().context).toBe(context);
                expect(instance.getConfig().accessToken).toBe(`updated-${context}-token`);
                expect(instance.getState()).toBe('UNINITIALIZED');

                instanceTracker.register(context, instance);
            });
            for (let i = 0; i < results.length; i++) {
                for (let j = i + 1; j < results.length; j++) {
                    expectInstanceIndependence(
                        results[i].instance,
                        results[j].instance,
                        results[i].context,
                        results[j].context
                    );
                }
            }
        });
    });
});
