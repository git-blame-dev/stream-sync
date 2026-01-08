
const { initializeTestLogging, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { createMockLogger } = require('../helpers/mock-factories');
const ChatNotificationRouter = require('../../src/services/ChatNotificationRouter');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Greeting System Diagnosis', () => {
    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    const buildRouter = (overrides = {}) => {
        const logger = createMockLogger('debug');
        const displayQueue = overrides.displayQueue || { addItem: jest.fn() };
        const runtime = {
            config: { general: { greetingsEnabled: true } },
            displayQueue,
            vfxService: null,
            vfxCommandService: overrides.vfxCommandService || null
        };

        return new ChatNotificationRouter({ runtime, logger });
    };

    test('queueGreeting enqueues greeting items with username preserved', async () => {
        const router = buildRouter();
        const addItemSpy = router.runtime.displayQueue.addItem;

        await router.queueGreeting('tiktok', 'ItzBurgs');

        expect(addItemSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'greeting',
            platform: 'tiktok',
            data: expect.objectContaining({
                username: 'ItzBurgs'
            })
        }));
    });

    test('queueGreeting preserves required VFX fields when available', async () => {
        const vfxConfig = {
            commandKey: 'greetings',
            command: '!hello',
            filename: 'hello-there2',
            mediaSource: 'greeting-source',
            vfxFilePath: './vfx',
            duration: 5000
        };
        const router = buildRouter({
            vfxCommandService: {
                getVFXConfig: jest.fn().mockResolvedValue(vfxConfig)
            }
        });

        await router.queueGreeting('youtube', 'TestUser');

        expect(router.runtime.displayQueue.addItem).toHaveBeenCalledWith(expect.objectContaining({
            type: 'greeting',
            vfxConfig: expect.objectContaining({
                commandKey: 'greetings',
                command: '!hello',
                filename: 'hello-there2',
                mediaSource: 'greeting-source',
                vfxFilePath: './vfx'
            })
        }));
    });

    test('queueGreeting exits silently when displayQueue missing', async () => {
        const router = buildRouter({ displayQueue: null });

        await expect(router.queueGreeting('tiktok', 'Userless')).resolves.toBeUndefined();
    });
});
