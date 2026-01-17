const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

describe('ViewerCountSystem polling interval validation', () => {
    let ViewerCountSystem;

    beforeEach(() => {
        ({ ViewerCountSystem } = require('../../../src/utils/viewer-count'));
    });

    afterEach(() => {
        restoreAllMocks();
    });

    test('does not start polling when interval is zero or negative', () => {
        const runtimeConstants = createRuntimeConstantsFixture({
            VIEWER_COUNT_POLLING_INTERVAL_SECONDS: -5
        });

        const system = new ViewerCountSystem({
            platforms: { twitch: {}, youtube: {} },
            logger: noOpLogger,
            runtimeConstants
        });

        system.startPolling();

        expect(system.isPolling).toBe(false);
        expect(Object.keys(system.pollingHandles)).toHaveLength(0);
    });
});
