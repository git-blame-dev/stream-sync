const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');

describe('ViewerCountSystem polling interval validation', () => {
    let ViewerCountSystem;

    beforeEach(() => {
        ({ ViewerCountSystem } = require('../../../src/utils/viewer-count'));
    });

    afterEach(() => {
        restoreAllMocks();
    });

    test('does not start polling when interval is zero or negative', () => {
        const config = createConfigFixture({
            general: { viewerCountPollingIntervalMs: -5000 }
        });

        const system = new ViewerCountSystem({
            platforms: { twitch: {}, youtube: {} },
            logger: noOpLogger,
            config
        });

        system.startPolling();

        expect(system.isPolling).toBe(false);
        expect(Object.keys(system.pollingHandles)).toHaveLength(0);
    });
});
