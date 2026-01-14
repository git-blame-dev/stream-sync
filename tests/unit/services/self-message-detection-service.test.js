const { describe, it, expect } = require('bun:test');
const SelfMessageDetectionService = require('../../../src/services/SelfMessageDetectionService');

const createConfigStub = ({ general = {}, platforms = {} } = {}) => {
    const getSectionData = (section) => {
        if (section === 'general') {
            return general;
        }
        return platforms[section] || {};
    };

    const get = (section, key, fallback) => {
        const data = getSectionData(section);
        if (!Object.prototype.hasOwnProperty.call(data, key)) {
            return fallback;
        }
        return data[key];
    };

    const getBoolean = (section, key, fallback) => {
        const value = get(section, key, fallback);
        if (value === true || value === false) {
            return value;
        }
        if (typeof value === 'string') {
            const normalized = value.toLowerCase();
            if (normalized === 'true') {
                return true;
            }
            if (normalized === 'false') {
                return false;
            }
        }
        return fallback;
    };

    return {
        get,
        getBoolean,
        getSection: (section) => getSectionData(section)
    };
};

describe('SelfMessageDetectionService', () => {
    describe('isFilteringEnabled', () => {
        it('uses platform override when provided', () => {
            const config = createConfigStub({
                general: { ignoreSelfMessages: false },
                platforms: {
                    twitch: { ignoreSelfMessages: true }
                }
            });
            const service = new SelfMessageDetectionService(config);

            expect(service.isFilteringEnabled('twitch')).toBe(true);
            expect(service.isFilteringEnabled('youtube')).toBe(false);
        });

        it('falls back to general setting when no override exists', () => {
            const config = createConfigStub({
                general: { ignoreSelfMessages: true },
                platforms: {
                    tiktok: {}
                }
            });
            const service = new SelfMessageDetectionService(config);

            expect(service.isFilteringEnabled('tiktok')).toBe(true);
        });

        it('returns false when config is missing or throws', () => {
            const service = new SelfMessageDetectionService(null);
            expect(service.isFilteringEnabled('twitch')).toBe(false);

            const throwingConfig = {
                get: () => {
                    throw new Error('boom');
                },
                getBoolean: () => {
                    throw new Error('boom');
                }
            };
            const serviceWithThrow = new SelfMessageDetectionService(throwingConfig);
            expect(serviceWithThrow.isFilteringEnabled('youtube')).toBe(false);
        });
    });

    describe('isSelfMessage', () => {
        it('detects Twitch self messages by explicit flag or username match', () => {
            const service = new SelfMessageDetectionService(createConfigStub());
            const platformConfig = { username: 'Streamer' };

            expect(service.isSelfMessage('twitch', { self: true }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('twitch', { username: 'streamer' }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('twitch', { context: { username: 'Streamer' } }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('twitch', { username: 'Viewer' }, platformConfig)).toBe(false);
        });

        it('detects YouTube self messages via broadcaster indicators', () => {
            const service = new SelfMessageDetectionService(createConfigStub());
            const platformConfig = { username: 'ChannelOwner' };

            expect(service.isSelfMessage('youtube', { username: 'channelowner' }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('youtube', { isBroadcaster: true }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('youtube', { author: { isChatOwner: true } }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('youtube', { badges: ['Owner'] }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('youtube', { username: 'Viewer' }, platformConfig)).toBe(false);
        });

        it('detects TikTok self messages via username or userId match', () => {
            const service = new SelfMessageDetectionService(createConfigStub());
            const platformConfig = { username: 'Creator', userId: 'tt-streamer-1' };

            expect(service.isSelfMessage('tiktok', { username: 'creator' }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('tiktok', { userId: 'tt-streamer-1' }, platformConfig)).toBe(true);
            expect(service.isSelfMessage('tiktok', { username: 'Viewer' }, platformConfig)).toBe(false);
        });
    });

    describe('shouldFilterMessage', () => {
        it('returns false when filtering disabled even if self message', () => {
            const config = createConfigStub({
                general: { ignoreSelfMessages: false }
            });
            const service = new SelfMessageDetectionService(config);

            expect(service.shouldFilterMessage('twitch', { self: true }, { username: 'Streamer' })).toBe(false);
        });

        it('filters self messages when enabled', () => {
            const config = createConfigStub({
                general: { ignoreSelfMessages: true }
            });
            const service = new SelfMessageDetectionService(config);

            expect(service.shouldFilterMessage('twitch', { self: true }, { username: 'Streamer' })).toBe(true);
        });
    });

    describe('validateConfiguration', () => {
        it('warns when general setting is missing or invalid overrides are used', () => {
            const config = createConfigStub({
                general: {},
                platforms: {
                    twitch: { ignoreSelfMessages: 'maybe' }
                }
            });
            const service = new SelfMessageDetectionService(config);
            const result = service.validateConfiguration();

            expect(result.isValid).toBe(true);
            expect(result.warnings.length).toBeGreaterThan(0);
        });
    });
});
