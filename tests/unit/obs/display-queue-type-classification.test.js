const {
    isNotificationType,
    isChatType
} = require('../../../src/obs/display-queue');

describe('display-queue type classification', () => {
    it('validates notification types', () => {
        expect(isNotificationType('platform:envelope')).toBe(true);
        expect(isNotificationType('chat')).toBe(false);
        expect(isNotificationType(null)).toBe(false);
    });

    it('validates chat types', () => {
        expect(isChatType('chat')).toBe(true);
    });
});
