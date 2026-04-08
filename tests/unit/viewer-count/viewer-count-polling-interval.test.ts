import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const { restoreAllMocks } = load('../../helpers/bun-mock-utils');
const { noOpLogger } = load('../../helpers/mock-factories');
const { createConfigFixture } = load('../../helpers/config-fixture');

describe('ViewerCountSystem polling interval validation', () => {
    let ViewerCountSystem;

    beforeEach(() => {
        ({ ViewerCountSystem } = load('../../../src/utils/viewer-count.ts'));
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
