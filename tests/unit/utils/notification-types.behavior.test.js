const {
    clearCache,
    isNotificationType,
    isChatType,
    isValidDisplayItemType,
    getNotificationConfig,
    getNotificationDuration,
    getAllNotificationTypes
} = require('../../../src/utils/notification-types');

describe('notification-types behavior', () => {
    beforeEach(() => {
        clearCache();
    });

    it('validates notification types and chat handling', () => {
        expect(isNotificationType('envelope')).toBe(true);
        expect(isNotificationType('chat')).toBe(true);
        expect(isNotificationType(null)).toBe(false);

        expect(isChatType('chat')).toBe(true);
        expect(isValidDisplayItemType('chat')).toBe(true);
        expect(isValidDisplayItemType('unknown')).toBe(false);
    });

    it('returns configs, durations, and all types', () => {
        const config = getNotificationConfig('platform:gift');
        expect(config).toBeDefined();
        expect(config).not.toHaveProperty('duration');
        expect(getNotificationDuration('platform:gift')).toBe(0);
        expect(getNotificationConfig('invalid')).toBeNull();
        expect(getNotificationDuration('invalid')).toBe(0);

        const allTypes = getAllNotificationTypes();
        expect(allTypes).toContain('platform:envelope');
        expect(allTypes).toContain('chat');
    });
});
