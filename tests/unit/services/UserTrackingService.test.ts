const { describe, it, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { UserTrackingService, createUserTrackingService } = require('../../../src/services/UserTrackingService.ts');

describe('UserTrackingService', () => {
    it('returns true for first message and false for repeats', () => {
        const service = new UserTrackingService();

        expect(service.isFirstMessage('testUserId1', { platform: 'twitch' })).toBe(true);
        expect(service.isFirstMessage('testUserId1', { platform: 'twitch' })).toBe(false);
    });

    it('returns false when userId is missing', () => {
        const service = new UserTrackingService();

        expect(service.isFirstMessage(null, { platform: 'tiktok' })).toBe(false);
        expect(service.isFirstMessage('', { platform: 'youtube' })).toBe(false);
    });

    it('does not emit events when checking first message', () => {
        const eventBus = { emit: createMockFn() };
        const service = new UserTrackingService(eventBus);

        service.isFirstMessage('testUserId2', { username: 'testViewer', platform: 'twitch' });

        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('creates a service instance via factory', () => {
        const service = createUserTrackingService();

        expect(service).toBeInstanceOf(UserTrackingService);
    });

    it('returns false when seen user lookup throws an error', () => {
        const service = new UserTrackingService();
        const unsafeService = service as any;
        unsafeService.seenUsers = {
            has: () => {
                throw new Error('lookup failure');
            },
            add: () => {}
        };

        expect(service.isFirstMessage('testUserId3', { platform: 'youtube' })).toBe(false);
    });

    it('returns false when seen user lookup throws a non-error value', () => {
        const service = new UserTrackingService();
        const unsafeService = service as any;
        unsafeService.seenUsers = {
            has: () => {
                throw 'lookup failure';
            },
            add: () => {}
        };

        expect(service.isFirstMessage('testUserId4', { platform: 'tiktok' })).toBe(false);
    });
});
