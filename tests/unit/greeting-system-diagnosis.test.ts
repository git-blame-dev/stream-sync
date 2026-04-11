import { afterEach, describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';

import { createMockFn, restoreAllMocks } from '../helpers/bun-mock-utils';

const nodeRequire = createRequire(import.meta.url);

type LoggerLike = {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};

type FlexibleMock = ReturnType<typeof createMockFn> & {
    mockResolvedValue: (value: unknown) => FlexibleMock;
};

const { noOpLogger } = nodeRequire('../helpers/mock-factories') as {
    noOpLogger: LoggerLike;
};
const { createConfigFixture } = nodeRequire('../helpers/config-fixture') as {
    createConfigFixture: (overrides?: Record<string, unknown>) => Record<string, unknown>;
};

type MockFn = ReturnType<typeof createMockFn>;

type RouterInstance = {
    runtime: {
        displayQueue: { addItem: MockFn };
    };
    queueGreeting: (platform: string, username: string) => Promise<void>;
};

const { ChatNotificationRouter } = nodeRequire('../../src/services/ChatNotificationRouter.js') as {
    ChatNotificationRouter: new (deps: {
        runtime: Record<string, unknown>;
        logger: LoggerLike;
        config: Record<string, unknown>;
    }) => RouterInstance;
};

type RouterOverrides = {
    displayQueue?: { addItem: MockFn } | null;
    vfxCommandService?: { getVFXConfig: MockFn } | null;
};

describe('Greeting System Diagnosis', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const buildRouter = (overrides: RouterOverrides = {}) => {
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
            config: createConfigFixture()
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
                getVFXConfig: (createMockFn() as FlexibleMock).mockResolvedValue(vfxConfig)
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
