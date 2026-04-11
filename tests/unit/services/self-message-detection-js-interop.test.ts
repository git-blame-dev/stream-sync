import { describe, expect, it } from 'bun:test';

const selfMessageDetectionModule = require('../../../src/services/SelfMessageDetectionService.js');

describe('self message detection JS interop', () => {
    it('exposes SelfMessageDetectionService as a named export from the JS wrapper', () => {
        expect(typeof selfMessageDetectionModule.SelfMessageDetectionService).toBe('function');
    });

    it('constructs the named wrapper export with config', () => {
        const service = new selfMessageDetectionModule.SelfMessageDetectionService({
            twitch: { ignoreSelfMessages: false },
            youtube: { ignoreSelfMessages: false },
            tiktok: { ignoreSelfMessages: false }
        });

        expect(service.isFilteringEnabled('twitch')).toBe(false);
    });
});
