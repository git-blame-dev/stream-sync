import { describe, it, expect } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const { createMockFn } = load('../helpers/bun-mock-utils');
const { noOpLogger } = load('../helpers/mock-factories');
const PlatformLifecycleService = load('../../src/services/PlatformLifecycleService.ts');

describe('Platform lifecycle startup smoke E2E', () => {
    it('initializes and disconnects an enabled platform without stream detection', async () => {
        const service = new PlatformLifecycleService({
            config: { twitch: { enabled: true } },
            logger: noOpLogger
        });

        const initialize = createMockFn().mockResolvedValue(true);
        const cleanup = createMockFn().mockResolvedValue();
        const MockPlatform = createMockFn().mockImplementation(() => ({
            initialize,
            cleanup,
            on: createMockFn()
        }));

        await service.initializeAllPlatforms({ twitch: MockPlatform });

        expect(service.isPlatformAvailable('twitch')).toBe(true);

        await service.disconnectAll();

        expect(service.isPlatformAvailable('twitch')).toBe(false);
    });
});
