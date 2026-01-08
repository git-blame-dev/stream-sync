
const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

describe('PlatformEventRouter envelope gating', () => {
    const createRouter = (configService) => new PlatformEventRouter({
        eventBus: { subscribe: jest.fn(() => jest.fn()), emit: jest.fn() },
        runtime: {
            handleEnvelopeNotification: jest.fn()
        },
        notificationManager: { handleNotification: jest.fn() },
        configService,
        logger: { debug: () => {}, warn: () => {}, info: () => {} }
    });

    it('respects giftsEnabled config gating for envelope events', async () => {
        const configService = {
            areNotificationsEnabled: jest.fn((settingKey) => {
                if (settingKey === 'giftsEnabled') return false;
                return true;
            })
        };

        const router = createRouter(configService);

        await router.routeEvent({
            platform: 'tiktok',
            type: 'envelope',
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
