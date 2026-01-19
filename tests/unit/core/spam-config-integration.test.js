
const { config } = require('../../../src/core/config');

describe('Spam Configuration Integration', () => {
    describe('when accessing spam configuration', () => {
        it('should expose spam configuration via config.spam', () => {
            expect(config.spam).toBeDefined();
            expect(typeof config.spam).toBe('object');
        });

        it('should have all required spam detection properties', () => {
            const spamConfig = config.spam;

            expect(spamConfig.lowValueThreshold).toBeDefined();
            expect(spamConfig.spamDetectionEnabled).toBeDefined();
            expect(spamConfig.spamDetectionWindow).toBeDefined();
            expect(spamConfig.maxIndividualNotifications).toBeDefined();
        });

        it('should map to existing gift configuration values', () => {
            const spamConfig = config.spam;
            const giftConfig = config.gifts;

            expect(spamConfig.lowValueThreshold).toBe(giftConfig.lowValueThreshold);
            expect(spamConfig.spamDetectionEnabled).toBe(giftConfig.spamDetectionEnabled);
            expect(spamConfig.spamDetectionWindow).toBe(giftConfig.spamDetectionWindow);
            expect(spamConfig.maxIndividualNotifications).toBe(giftConfig.maxIndividualNotifications);
        });

        it('should provide proper default values', () => {
            const spamConfig = config.spam;

            expect(typeof spamConfig.lowValueThreshold).toBe('number');
            expect(typeof spamConfig.spamDetectionEnabled).toBe('boolean');
            expect(typeof spamConfig.spamDetectionWindow).toBe('number');
            expect(typeof spamConfig.maxIndividualNotifications).toBe('number');

            expect(spamConfig.lowValueThreshold).toBeGreaterThan(0);
            expect(spamConfig.spamDetectionWindow).toBeGreaterThan(0);
            expect(spamConfig.maxIndividualNotifications).toBeGreaterThan(0);
        });
    });

    describe('when using with NotificationManager', () => {
        it('should be compatible with NotificationManager spam detection initialization', () => {
            const spamConfig = config.spam;

            const expectedProperties = [
                'lowValueThreshold',
                'spamDetectionEnabled',
                'spamDetectionWindow',
                'maxIndividualNotifications'
            ];

            expectedProperties.forEach(property => {
                expect(spamConfig).toHaveProperty(property);
                expect(spamConfig[property]).not.toBeUndefined();
            });
        });

        it('should be accessible via this.app.config.spam pattern', () => {
            const mockApp = { config };

            expect(mockApp.config).toBeDefined();
            expect(mockApp.config.spam).toBeDefined();
            expect(mockApp.config && mockApp.config.spam).toBeTruthy();
        });
    });

    describe('gift configuration properties', () => {
        it('should expose the canonical gift configuration properties', () => {
            const giftConfig = config.gifts;

            expect(giftConfig.command).toBeDefined();
            expect(giftConfig.giftVideoSource).toBeDefined();
            expect(giftConfig.giftAudioSource).toBeDefined();
            expect(giftConfig.scene).toBeDefined();
            expect(giftConfig.lowValueThreshold).toBeDefined();
            expect(giftConfig.spamDetectionEnabled).toBeDefined();
            expect(giftConfig.spamDetectionWindow).toBeDefined();
            expect(giftConfig.maxIndividualNotifications).toBeDefined();
        });

        it('should not break any existing functionality', () => {
            const giftConfig = config.gifts;

            expect(typeof giftConfig.lowValueThreshold).toBe('number');
            expect(typeof giftConfig.spamDetectionEnabled).toBe('boolean');
            expect(typeof giftConfig.spamDetectionWindow).toBe('number');
            expect(typeof giftConfig.maxIndividualNotifications).toBe('number');
        });
    });

    describe('configuration values', () => {
        it('should reflect changes in config.ini settings', () => {
            const { configManager } = require('../../../src/core/config');
            const spamConfig = config.spam;

            expect(spamConfig.lowValueThreshold).toBe(configManager.getNumber('gifts', 'lowValueThreshold', 10));
            expect(spamConfig.spamDetectionEnabled).toBe(configManager.getBoolean('gifts', 'spamDetectionEnabled', true));
            expect(spamConfig.spamDetectionWindow).toBe(configManager.getNumber('gifts', 'spamDetectionWindow', 5));
            expect(spamConfig.maxIndividualNotifications).toBe(configManager.getNumber('gifts', 'maxIndividualNotifications', 2));
        });
    });
});
