const { describe, it, expect } = require('bun:test');
const SelfMessageDetectionService = require('../../../src/services/SelfMessageDetectionService');

const createPlainConfig = ({ general = {}, twitch, youtube, tiktok } = {}) => {
    return {
        general,
        twitch,
        youtube,
        tiktok
    };
};

describe('SelfMessageDetectionService', () => {
    describe('isFilteringEnabled', () => {
        it('uses platform override when provided', () => {
            const config = createPlainConfig({
                general: { ignoreSelfMessages: false },
                twitch: { ignoreSelfMessages: true }
            });
            const service = new SelfMessageDetectionService(config);

            expect(service.isFilteringEnabled('twitch')).toBe(true);
            expect(service.isFilteringEnabled('youtube')).toBe(false);
        });

        it('falls back to general setting when no override exists', () => {
            const config = createPlainConfig({
                general: { ignoreSelfMessages: true },
                tiktok: {}
            });
            const service = new SelfMessageDetectionService(config);

            expect(service.isFilteringEnabled('tiktok')).toBe(true);
        });

        it('returns false when config is missing or has error', () => {
            const service = new SelfMessageDetectionService(null);
            expect(service.isFilteringEnabled('twitch')).toBe(false);

            // Config that causes an error during property access
            const throwingConfig = new Proxy({}, {
                get() {
                    throw new Error('boom');
                }
            });
            const serviceWithThrow = new SelfMessageDetectionService(throwingConfig);
            expect(serviceWithThrow.isFilteringEnabled('youtube')).toBe(false);
        });
    });

    describe('isSelfMessage', () => {
        it('detects Twitch self messages by explicit flag or username match', () => {
            const service = new SelfMessageDetectionService(createPlainConfig());
            const platformConfig = { username: 'Streamer' };

            expect(service.isSelfMessage('twitch', { self: true }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('twitch', { username: 'streamer' }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('twitch', { context: { username: 'Streamer' } }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('twitch', { username: 'Viewer' }, platformConfig)).toBe(false);
        });

        it('detects YouTube self messages via broadcaster indicators', () => {
            const service = new SelfMessageDetectionService(createPlainConfig());
            const platformConfig = { username: 'ChannelOwner' };

            expect(service.isSelfMessage('youtube', { username: 'channelowner' }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('youtube', { isBroadcaster: true }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('youtube', { author: { isChatOwner: true } }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('youtube', { badges: ['Owner'] }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('youtube', { username: 'Viewer' }, platformConfig)).toBe(false);
        });

        it('detects TikTok self messages via username or userId match', () => {
            const service = new SelfMessageDetectionService(createPlainConfig());
            const platformConfig = { username: 'Creator', userId: 'tt-streamer-1' };

            expect(service.isSelfMessage('tiktok', { username: 'creator' }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('tiktok', { userId: 'tt-streamer-1' }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('tiktok', { username: 'Viewer' }, platformConfig)).toBe(false);
        });
    });

    describe('shouldFilterMessage', () => {
        it('returns false when filtering disabled even if self message', () => {
            const config = createPlainConfig({
                general: { ignoreSelfMessages: false }
            });
            const service = new SelfMessageDetectionService(config);

            expect(service.shouldFilterMessage('twitch', { self: true }, { username: 'Streamer' })).toBe(false);
        });

        it('filters self messages when enabled', () => {
            const config = createPlainConfig({
                general: { ignoreSelfMessages: true }
            });
            const service = new SelfMessageDetectionService(config);

            expect(service.shouldFilterMessage('twitch', { self: true }, { username: 'Streamer' })).toBe(true);
        });
    });

    describe('validateConfiguration', () => {
        it('warns when general setting is missing or invalid overrides are used', () => {
            const config = createPlainConfig({
                general: {},
                twitch: { ignoreSelfMessages: 'maybe' }
            });
            const service = new SelfMessageDetectionService(config);
            const result = service.validateConfiguration();

            expect(result.isValid).toBe(true);
            expect(result.warnings.length).toBeGreaterThan(0);
        });
    });
});