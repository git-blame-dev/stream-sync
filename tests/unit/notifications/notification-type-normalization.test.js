const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');

const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('Notification type normalization', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let items;
    let notificationManager;

    beforeEach(() => {
        items = [];

        const displayQueue = {
            addItem: async (item) => {
                items.push(item);
                return true;
            }
        };

        const eventBus = {
            emit: createMockFn(),
            subscribe: createMockFn(() => () => {})
        };

        const config = createConfigFixture({
            general: {
                followsEnabled: true,
                giftsEnabled: true
            }
        });

        notificationManager = new NotificationManager({
            logger: noOpLogger,
            displayQueue,
            eventBus,
            constants: require('../../../src/core/constants'),
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() },
            config,
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            ttsService: { speak: createMockFn() }
        });
    });

    it('accepts matching payload types for follow notifications', async () => {
        const result = await notificationManager.handleNotification('platform:follow', 'tiktok', {
            username: 'alice',
            userId: 'tiktok-1',
            type: 'platform:follow'
        });

        expect(result).toEqual(expect.objectContaining({
            success: true,
            notificationType: 'platform:follow',
            platform: 'tiktok'
        }));
        expect(items).toHaveLength(1);
        expect(items[0].type).toBe('platform:follow');
    });

    it('rejects short notification types without normalization', async () => {
        const result = await notificationManager.handleNotification('gift', 'tiktok', {
            username: 'bob',
            userId: 'tiktok-2'
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            error: 'Unknown notification type',
            notificationType: 'gift'
        }));
        expect(items).toHaveLength(0);
    });
});
