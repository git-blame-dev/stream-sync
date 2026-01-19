const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');
const ChatNotificationRouter = require('../../src/services/ChatNotificationRouter');

describe('Greeting System Diagnosis', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const buildRouter = (overrides = {}) => {
        const logger = noOpLogger;
        const displayQueue = overrides.displayQueue || { addItem: createMockFn() };
        const runtime = {
            config: { general: { greetingsEnabled: true } },
            displayQueue,
            vfxService: null,
            vfxCommandService: overrides.vfxCommandService || null
        };

        return new ChatNotificationRouter({
            runtime,
            logger,
            runtimeConstants: createRuntimeConstantsFixture()
        });
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
                getVFXConfig: createMockFn().mockResolvedValue(vfxConfig)
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
