const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { clearAllMocks } = require('../../helpers/bun-mock-utils');
const InnertubeInstanceManagerModule = require('../../../src/services/innertube-instance-manager');

const INNERTUBE_INSTANCE_TTL = 300000;
const INNERTUBE_MIN_TTL = 60000;

describe('InnertubeInstanceManager timeouts', () => {
    beforeEach(async () => {
        await InnertubeInstanceManagerModule.cleanup();
        InnertubeInstanceManagerModule._resetInstance();
    });

    afterEach(async () => {
        await InnertubeInstanceManagerModule.cleanup();
        InnertubeInstanceManagerModule._resetInstance();
        clearAllMocks();
    });

    test('uses the platform default TTL when no override is provided', () => {
        const manager = InnertubeInstanceManagerModule.getInstance();

        expect(manager.instanceTimeout).toBe(INNERTUBE_INSTANCE_TTL);
    });

    test('enforces the platform minimum TTL even when configured lower', () => {
        const belowMinimum = INNERTUBE_MIN_TTL - 1;
        const manager = InnertubeInstanceManagerModule.getInstance({ instanceTimeout: belowMinimum });

        expect(manager.instanceTimeout).toBe(INNERTUBE_MIN_TTL);
    });
});
