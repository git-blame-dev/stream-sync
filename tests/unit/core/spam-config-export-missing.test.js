
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

            it('should provide spam config as accessible property', () => {
                const { config } = require('../../../src/core/config');

                expect(config.spam).toBeDefined();
                expect(typeof config.spam).toBe('object');
                expect(config.spam.enabled).toBeDefined();
            });
        });

        describe('and verifying spam configuration content', () => {
            it('should FAIL if required spam properties are missing', () => {
                const { config } = require('../../../src/core/config');
                const spam = config.spam;

                expect(spam).toBeDefined();

                expect(spam.enabled).toBeDefined();
                expect(spam.enabled).not.toBeUndefined();

                expect(spam.detectionWindow).toBeDefined();
                expect(spam.detectionWindow).not.toBeUndefined();

                expect(spam.maxIndividualNotifications).toBeDefined();
                expect(spam.maxIndividualNotifications).not.toBeUndefined();

                expect(spam.lowValueThreshold).toBeDefined();
                expect(spam.lowValueThreshold).not.toBeUndefined();
            });

            it('should FAIL if spam properties have incorrect types', () => {
                const { config } = require('../../../src/core/config');
                const spam = config.spam;

                expect(typeof spam.enabled).toBe('boolean');
                expect(typeof spam.detectionWindow).toBe('number');
                expect(typeof spam.maxIndividualNotifications).toBe('number');
                expect(typeof spam.lowValueThreshold).toBe('number');

                expect(Number.isInteger(spam.detectionWindow)).toBe(true);
                expect(Number.isInteger(spam.maxIndividualNotifications)).toBe(true);
                expect(Number.isFinite(spam.lowValueThreshold)).toBe(true);

                expect(spam.detectionWindow).toBeGreaterThan(0);
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
                expect(spamConfig.enabled).toBeDefined();
                expect(spamConfig.detectionWindow).toBeDefined();
                expect(spamConfig.maxIndividualNotifications).toBeDefined();
                expect(spamConfig.lowValueThreshold).toBeDefined();
            });

            it('should FAIL if spam config cannot be used to create SpamDetectionConfig', () => {
                const { config } = require('../../../src/core/config');
                const spamConfig = config.spam;

                expect(spamConfig).toBeTruthy();
                expect(typeof spamConfig).toBe('object');

                expect(spamConfig.enabled).toBeDefined();
                expect(spamConfig.detectionWindow).toBeDefined();
                expect(spamConfig.maxIndividualNotifications).toBeDefined();
                expect(spamConfig.lowValueThreshold).toBeDefined();

                expect(typeof spamConfig.enabled).toBe('boolean');
                expect(typeof spamConfig.detectionWindow).toBe('number');
                expect(typeof spamConfig.maxIndividualNotifications).toBe('number');
                expect(typeof spamConfig.lowValueThreshold).toBe('number');
            });
        });
    });

    describe('when ensuring no regression in NotificationManager', () => {
        describe('and verifying NotificationManager can initialize spam detection', () => {
            it('should FAIL if spam config cannot be used to create spam detector service', () => {
                const { config } = require('../../../src/core/config');

                expect(config.spam).toBeDefined();
                expect(config.spam.enabled).toBeDefined();
                expect(config.spam.detectionWindow).toBeDefined();
                expect(config.spam.maxIndividualNotifications).toBeDefined();
                expect(config.spam.lowValueThreshold).toBeDefined();

                expect(typeof config.spam.enabled).toBe('boolean');
                expect(typeof config.spam.detectionWindow).toBe('number');
                expect(typeof config.spam.maxIndividualNotifications).toBe('number');
                expect(typeof config.spam.lowValueThreshold).toBe('number');

                expect(config.spam.detectionWindow).toBeGreaterThan(0);
                expect(config.spam.maxIndividualNotifications).toBeGreaterThan(0);
                expect(config.spam.lowValueThreshold).toBeGreaterThanOrEqual(0);
            });
        });
    });
});
