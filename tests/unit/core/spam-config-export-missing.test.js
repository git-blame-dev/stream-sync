
const { initializeTestLogging } = require('../../helpers/test-setup');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('Spam Config Export Missing', () => {
    describe('when config module is imported', () => {
        describe('and checking for spam configuration export', () => {
            it('should FAIL if config.spam is not properly defined in the main config object', () => {
                delete require.cache[require.resolve('../../../src/core/config')];

                const { config } = require('../../../src/core/config');

                expect(config.spam).toBeDefined();
                expect(config.spam).not.toBeUndefined();
                expect(config.spam).not.toBeNull();
            });

            it('should FAIL if spam property is not enumerable in config object', () => {
                const { config } = require('../../../src/core/config');

                const enumerableProps = Object.keys(config);
                expect(enumerableProps).toContain('spam');

                const ownProps = Object.getOwnPropertyNames(config);
                expect(ownProps).toContain('spam');
            });

            it('should FAIL if spam getter is not correctly implemented', () => {
                const { config } = require('../../../src/core/config');

                const spamDescriptor = Object.getOwnPropertyDescriptor(config, 'spam');
                expect(spamDescriptor).toBeDefined();

                expect(spamDescriptor.get).toBeDefined();
                expect(typeof spamDescriptor.get).toBe('function');

                const spamResult = spamDescriptor.get.call(config);
                expect(spamResult).toBeDefined();
                expect(typeof spamResult).toBe('object');
            });
        });

        describe('and verifying spam configuration content', () => {
            it('should FAIL if required spam properties are missing', () => {
                const { config } = require('../../../src/core/config');
                const spam = config.spam;

                expect(spam).toBeDefined();

                expect(spam.spamDetectionEnabled).toBeDefined();
                expect(spam.spamDetectionEnabled).not.toBeUndefined();

                expect(spam.spamDetectionWindow).toBeDefined();
                expect(spam.spamDetectionWindow).not.toBeUndefined();

                expect(spam.maxIndividualNotifications).toBeDefined();
                expect(spam.maxIndividualNotifications).not.toBeUndefined();

                expect(spam.lowValueThreshold).toBeDefined();
                expect(spam.lowValueThreshold).not.toBeUndefined();
            });

            it('should FAIL if spam properties have incorrect types', () => {
                const { config } = require('../../../src/core/config');
                const spam = config.spam;

                expect(typeof spam.spamDetectionEnabled).toBe('boolean');
                expect(typeof spam.spamDetectionWindow).toBe('number');
                expect(typeof spam.maxIndividualNotifications).toBe('number');
                expect(typeof spam.lowValueThreshold).toBe('number');

                expect(Number.isInteger(spam.spamDetectionWindow)).toBe(true);
                expect(Number.isInteger(spam.maxIndividualNotifications)).toBe(true);
                expect(Number.isFinite(spam.lowValueThreshold)).toBe(true);

                expect(spam.spamDetectionWindow).toBeGreaterThan(0);
                expect(spam.maxIndividualNotifications).toBeGreaterThan(0);
                expect(spam.lowValueThreshold).toBeGreaterThan(0);
            });
        });
    });

    describe('when simulating NotificationManager usage', () => {
        describe('and accessing spam config through app.config pattern', () => {
            it('should FAIL if the app.config.spam access pattern fails', () => {
                const { config } = require('../../../src/core/config');

                const mockApp = {
                    config: config,
                    obs: { connection: null }
                };

                const hasConfig = mockApp.config;
                const hasSpamConfig = mockApp.config && mockApp.config.spam;

                expect(hasConfig).toBeTruthy();
                expect(hasSpamConfig).toBeTruthy();

                const spamConfig = mockApp.config.spam;
                expect(spamConfig.spamDetectionEnabled).toBeDefined();
                expect(spamConfig.spamDetectionWindow).toBeDefined();
                expect(spamConfig.maxIndividualNotifications).toBeDefined();
                expect(spamConfig.lowValueThreshold).toBeDefined();
            });

            it('should FAIL if spam config cannot be used to create SpamDetectionConfig', () => {
                const { config } = require('../../../src/core/config');
                const spamConfig = config.spam;

                expect(spamConfig).toBeTruthy();
                expect(typeof spamConfig).toBe('object');

                expect(spamConfig.spamDetectionEnabled).toBeDefined();
                expect(spamConfig.spamDetectionWindow).toBeDefined();
                expect(spamConfig.maxIndividualNotifications).toBeDefined();
                expect(spamConfig.lowValueThreshold).toBeDefined();

                expect(typeof spamConfig.spamDetectionEnabled).toBe('boolean');
                expect(typeof spamConfig.spamDetectionWindow).toBe('number');
                expect(typeof spamConfig.maxIndividualNotifications).toBe('number');
                expect(typeof spamConfig.lowValueThreshold).toBe('number');
            });
        });
    });

    describe('when testing the fix implementation', () => {
        describe('and verifying the unified spam configuration', () => {
            it('should provide correct default values from config.ini defaults', () => {
                const { config, configManager } = require('../../../src/core/config');
                const spam = config.spam;

                expect(spam.spamDetectionEnabled).toBe(configManager.getBoolean('gifts', 'spamDetectionEnabled', true));
                expect(spam.spamDetectionWindow).toBe(configManager.getNumber('gifts', 'spamDetectionWindow', 5));
                expect(spam.maxIndividualNotifications).toBe(configManager.getNumber('gifts', 'maxIndividualNotifications', 2));
                expect(spam.lowValueThreshold).toBe(configManager.getNumber('gifts', 'lowValueThreshold', 10));
            });
        });
    });

    describe('when ensuring no regression in NotificationManager', () => {
        describe('and verifying NotificationManager can initialize spam detection', () => {
            it('should FAIL if spam config cannot be used to create spam detector service', () => {
                const { config } = require('../../../src/core/config');

                expect(config.spam).toBeDefined();
                expect(config.spam.spamDetectionEnabled).toBeDefined();
                expect(config.spam.spamDetectionWindow).toBeDefined();
                expect(config.spam.maxIndividualNotifications).toBeDefined();
                expect(config.spam.lowValueThreshold).toBeDefined();

                expect(typeof config.spam.spamDetectionEnabled).toBe('boolean');
                expect(typeof config.spam.spamDetectionWindow).toBe('number');
                expect(typeof config.spam.maxIndividualNotifications).toBe('number');
                expect(typeof config.spam.lowValueThreshold).toBe('number');

                expect(config.spam.spamDetectionWindow).toBeGreaterThan(0);
                expect(config.spam.maxIndividualNotifications).toBeGreaterThan(0);
                expect(config.spam.lowValueThreshold).toBeGreaterThanOrEqual(0);
            });
        });
    });
});
