
const { describe, test, expect, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

describe('PlatformEventRouter envelope gating', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const createRouter = (configService) => new PlatformEventRouter({
        eventBus: { subscribe: createMockFn(() => createMockFn()), emit: createMockFn() },
        runtime: {
            handleEnvelopeNotification: createMockFn()
        },
        notificationManager: { handleNotification: createMockFn() },
        configService,
        logger: { debug: () => {}, warn: () => {}, info: () => {} }
    });

    it('respects giftsEnabled config gating for envelope events', async () => {
        const configService = {
            areNotificationsEnabled: createMockFn((settingKey) => {
                if (settingKey === 'giftsEnabled') return false;
                return true;
            })
        };

        const router = createRouter(configService);

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
