import { describe, expect, it } from 'bun:test';
import { PlatformLifecycleService } from '../../../src/services/PlatformLifecycleService';

describe('platform lifecycle JS interop', () => {
it('exposes PlatformLifecycleService as a named export from the JS wrapper', () => {
expect(typeof PlatformLifecycleService).toBe('function');
});

it('constructs the named wrapper export with config and event bus', () => {
const service = new PlatformLifecycleService({
            config: {
                twitch: { enabled: false },
                youtube: { enabled: false },
                tiktok: { enabled: false }
            },
            eventBus: { emit() {} }
        });

        expect(service.getStatus().initializedPlatforms).toEqual([]);
        service.dispose();
    });
});
