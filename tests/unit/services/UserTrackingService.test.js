const { UserTrackingService, createUserTrackingService } = require('../../../src/services/UserTrackingService');

describe('UserTrackingService', () => {
    it('returns true for first message and false for repeats', () => {
        const service = new UserTrackingService();

        expect(service.isFirstMessage('user-1', { platform: 'twitch' })).toBe(true);
        expect(service.isFirstMessage('user-1', { platform: 'twitch' })).toBe(false);
    });

    it('returns false when userId is missing', () => {
        const service = new UserTrackingService();

        expect(service.isFirstMessage(null, { platform: 'tiktok' })).toBe(false);
        expect(service.isFirstMessage('', { platform: 'youtube' })).toBe(false);
    });

    it('does not emit events when checking first message', () => {
        const eventBus = { emit: jest.fn() };
        const service = new UserTrackingService(eventBus);

        service.isFirstMessage('user-2', { username: 'Viewer', platform: 'twitch' });

        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('creates a service instance via factory', () => {
        const service = createUserTrackingService();

        expect(service).toBeInstanceOf(UserTrackingService);
    });
});
