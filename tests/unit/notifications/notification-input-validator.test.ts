const { describe, expect, it } = require('bun:test');
export {};

const { NotificationInputValidator } = require('../../../src/notifications/notification-input-validator');

describe('NotificationInputValidator', () => {
    const notificationConfigs = {
        'platform:follow': { settingKey: 'followsEnabled', commandKey: 'follows' },
        'platform:gift': { settingKey: 'giftsEnabled', commandKey: 'gifts' }
    };

    it('rejects non-string platform values', () => {
        const validator = new NotificationInputValidator(notificationConfigs);

        const result = validator.validatePlatform(123);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid platform type');
    });

    it('rejects unsupported platform values', () => {
        const validator = new NotificationInputValidator(notificationConfigs);

        const result = validator.validatePlatform('discord');

        expect(result.success).toBe(false);
        expect(result.error).toBe('Unsupported platform');
    });

    it('rejects non-object data payloads', () => {
        const validator = new NotificationInputValidator(notificationConfigs);

        const result = validator.validateData(null);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid notification data');
    });

    it('rejects unsupported paid alias types as unknown', () => {
        const validator = new NotificationInputValidator(notificationConfigs);

        const result = validator.validateType('subscription', { username: 'test-user' });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown notification type');
    });

    it('rejects unknown notification types', () => {
        const validator = new NotificationInputValidator(notificationConfigs);

        const result = validator.validateType('platform:unknown', { username: 'test-user' });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown notification type');
    });

    it('rejects incoming type mismatch', () => {
        const validator = new NotificationInputValidator(notificationConfigs);

        const result = validator.validateType('platform:follow', { type: 'platform:gift', username: 'test-user' });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Unknown notification type');
    });

    it('returns canonical type metadata for valid input', () => {
        const validator = new NotificationInputValidator(notificationConfigs);

        const result = validator.validateType('platform:gift', { type: 'platform:gift', username: 'test-user' });

        expect(result.success).toBe(true);
        expect(result.canonicalType).toBe('platform:gift');
        expect(result.config).toEqual(notificationConfigs['platform:gift']);
        expect(result.isMonetizationType).toBe(true);
    });
});
