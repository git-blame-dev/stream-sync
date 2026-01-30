const { describe, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');

const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

describe('PlatformEventRouter envelope gating', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const createRouter = (config) => new PlatformEventRouter({
        eventBus: { subscribe: createMockFn(() => createMockFn()), emit: createMockFn() },
        runtime: {
            handleEnvelopeNotification: createMockFn()
        },
        notificationManager: { handleNotification: createMockFn() },
        config,
        logger: noOpLogger
    });

    it('respects giftsEnabled config gating for envelope events', async () => {
        const config = createConfigFixture({ general: { giftsEnabled: false } });

        const router = createRouter(config);

        await router.routeEvent({
            platform: 'tiktok',
            type: 'platform:envelope',
            data: {
                username: 'ChestUser',
                userId: 'user-1',
                timestamp: new Date().toISOString(),
                metadata: {}
            }
        });

        expect(router.runtime.handleEnvelopeNotification).not.toHaveBeenCalled();
    });
});
