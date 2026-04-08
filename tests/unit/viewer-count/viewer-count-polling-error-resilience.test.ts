import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const { createMockFn, restoreAllMocks } = load('../../helpers/bun-mock-utils');
const { noOpLogger } = load('../../helpers/mock-factories');
const { createConfigFixture } = load('../../helpers/config-fixture');

describe('ViewerCountSystem polling resilience', () => {
    let ViewerCountSystem;

    beforeEach(() => {
        ({ ViewerCountSystem } = load('../../../src/utils/viewer-count.ts'));
    });

    afterEach(() => {
        restoreAllMocks();
    });

    function createSystem({ streamLive = true } = {}) {
        const platform = {
            getViewerCount: createMockFn().mockRejectedValue(new Error('fetch failed'))
        };

        const system = new ViewerCountSystem({
            platforms: { twitch: platform },
            logger: noOpLogger,
            config: createConfigFixture()
        });

        system.streamStatus.twitch = streamLive;

        return { system, platform };
    }

    test('skips polling when stream is offline', async () => {
        const { system } = createSystem({ streamLive: false });

        await system.pollPlatform('twitch');

        expect(system.counts.twitch).toBe(0);
    });

    test('continues polling cycle when provider throws', async () => {
        const { system } = createSystem({ streamLive: true });

        await system.pollPlatform('twitch');

        expect(system.counts.twitch).toBe(0);
    });
});
