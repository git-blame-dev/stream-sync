const { describe, it, expect } = require('bun:test');

const { UserTrackingService } = require('../../../src/services/UserTrackingService.ts');

describe('UserTrackingService behavior', () => {
    it('reports first message once and tracks seen users', () => {
        const service = new UserTrackingService();

        expect(service.hasSeenUser('test-user-1')).toBe(false);
        expect(service.isFirstMessage('test-user-1', { platform: 'twitch' })).toBe(true);
        expect(service.hasSeenUser('test-user-1')).toBe(true);
        expect(service.isFirstMessage('test-user-1', { platform: 'twitch' })).toBe(false);
    });

    it('marks users as seen directly through markMessageSeen', () => {
        const service = new UserTrackingService();

        expect(service.markMessageSeen('test-user-2', { platform: 'youtube' })).toBe(true);
        expect(service.hasSeenUser('test-user-2')).toBe(true);
    });

    it('treats missing user IDs as non-trackable', () => {
        const service = new UserTrackingService();

        expect(service.hasSeenUser('')).toBe(true);
        expect(service.markMessageSeen('')).toBe(false);
        expect(service.isFirstMessage('')).toBe(false);
    });
});
