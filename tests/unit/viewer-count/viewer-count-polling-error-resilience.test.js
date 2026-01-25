const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');

describe('ViewerCountSystem polling resilience', () => {
    let ViewerCountSystem;

    beforeEach(() => {
        ({ ViewerCountSystem } = require('../../../src/utils/viewer-count'));
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
