import { describe, expect, test } from 'bun:test';
import { createConfigFixture } from '../helpers/config-fixture';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { noOpLogger } from '../helpers/mock-factories';
import { ChatNotificationRouter } from '../../src/services/ChatNotificationRouter';

describe('Greeting admission', () => {
    test('queueGreeting exits when the runtime genuinely has no display queue', async () => {
        const config = createConfigFixture({ general: { greetingsEnabled: true } });
        const runtime = { config };
        expect(runtime).not.toHaveProperty('displayQueue');
        const router = new ChatNotificationRouter({ runtime, config, logger: noOpLogger });
        await expect(router.queueGreeting('tiktok', 'Synthetic Viewer', {})).resolves.toBeUndefined();
    });

    test('queueGreeting admits the exact username into the real root queue', async () => {
        const h = await createMainPresentationFixture();
        try {
            await h.start();
            expect(h.runtime.displayQueue).toBe(h.queue);
            expect(h.queue.queue).toHaveLength(0);
            await h.runtime.chatNotificationRouter!.queueGreeting('tiktok', 'Synthetic Viewer', {});
            expect(h.queue.queue).toHaveLength(1);
            expect(h.queue.queue[0]).toMatchObject({ type: 'greeting', platform: 'tiktok', data: { username: 'Synthetic Viewer' } });
        } finally { await h.dispose(); }
    });

    test('queueGreeting retains fields selected by the real parser', async () => {
        const h = await createMainPresentationFixture();
        h.config.vfx.filePath = '/synthetic-only';
        h.config.commands.synthetic = '!hello,Synthetic Greeting,,5000';
        h.config.greetings!.command = '!hello';
        try {
            await h.start();
            await h.runtime.chatNotificationRouter!.queueGreeting('youtube', 'Synthetic Viewer', {});
            expect(h.queue.queue).toHaveLength(1);
            expect(h.queue.queue[0]).toMatchObject({ type: 'greeting', vfxConfig: {
                commandKey: 'synthetic', command: '!hello', filename: 'synthetic',
                mediaSource: 'Synthetic Greeting', vfxFilePath: '/synthetic-only', duration: 5000,
            } });
        } finally { await h.dispose(); }
    });
});
