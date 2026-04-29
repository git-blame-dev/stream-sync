import { describe, expect, it } from 'bun:test';
import { SelfMessageDetectionService } from '../../../src/services/SelfMessageDetectionService';

describe('self message detection JS interop', () => {
it('exposes SelfMessageDetectionService as a named export from the JS wrapper', () => {
expect(typeof SelfMessageDetectionService).toBe('function');
});

it('constructs the named wrapper export with config', () => {
const service = new SelfMessageDetectionService({
            twitch: { ignoreSelfMessages: false },
            youtube: { ignoreSelfMessages: false },
            tiktok: { ignoreSelfMessages: false }
        });

        expect(service.isFilteringEnabled('twitch')).toBe(false);
    });
});
