import { describe, expect, it } from 'bun:test';

const chatNotificationRouterModule = require('../../../src/services/ChatNotificationRouter.ts');

describe('chat notification router JS interop', () => {
    it('exposes ChatNotificationRouter as a named export from the JS wrapper', () => {
        expect(typeof chatNotificationRouterModule.ChatNotificationRouter).toBe('function');
    });

    it('constructs the named wrapper export with runtime dependencies', () => {
        const router = new chatNotificationRouterModule.ChatNotificationRouter({
            runtime: {
                userTrackingService: { isFirstMessage: () => false },
                displayQueue: { addItem() {} },
                handleUnifiedNotification: async () => ({ success: true })
            },
            logger: { debug() {}, info() {}, warn() {}, error() {} },
            config: { general: { maxMessageLength: 500 } }
        });

        expect(typeof router.handleChatMessage).toBe('function');
    });
});
