import { describe, expect, it } from 'bun:test';
import { DisplayQueue } from '../../../src/obs/display-queue';
import { PRIORITY_LEVELS } from '../../../src/core/constants';
import type { DisplayQueueItem } from '../../../src/interfaces/DisplayQueue';
import { createOperatorControlService, OPERATOR_CONTROL_KEYS, type OperatorControls } from '../../../src/services/operator/operator-control-service';

describe('DisplayQueue priority ordering', () => {
    it('selects farewell before a waiting source-chat/command sequence after greetings are disabled', async () => {
        const controls = await createOperatorControlService({
            defaults: Object.fromEntries(OPERATOR_CONTROL_KEYS.map((key) => [key, true])) as OperatorControls,
            filePath: '/synthetic/operator-controls.json',
            fs: { readFile: async () => '{}', mkdir: async () => {}, writeFile: async () => {}, rename: async () => {}, unlink: async () => {} }
        });
        const spoken: string[] = [];
        const presented: string[] = [];
        const queue = new DisplayQueue({ call: async () => ({}) }, {
            autoProcess: false, rowIntervalMs: 0, ttsChatEnabled: true, ttsNotificationsEnabled: true,
            obs: { ttsTxt: 'synthetic-tts', ttsMethod: 'neural-tts' }
        }, { PRIORITY_LEVELS }, { emit: () => {} }, {
            operatorControls: controls, delay: async () => {},
            onPresentationStarted: (item) => { presented.push(item.type); },
            fetch: async (_url, init) => {
                if (init?.method === 'POST') spoken.push((JSON.parse(String(init.body)) as { text: string }).text);
                return new Response(null, { status: 200 });
            }
        });
        queue.addSequence([
            { type: 'chat', platform: 'twitch', priority: 1, data: { username: 'synthetic-chat', message: 'synthetic message' } },
            { type: 'greeting', platform: 'twitch', priority: 4, data: { username: 'synthetic-viewer', ttsMessage: 'synthetic greeting' } },
            { type: 'command', platform: 'twitch', priority: 2, data: { username: 'synthetic-viewer', ttsMessage: 'synthetic command' } }
        ]);
        queue.addItem({ type: 'farewell', platform: 'twitch', priority: 3, data: { username: 'synthetic-viewer', ttsMessage: 'synthetic farewell' } });
        await controls.setEnabled('greetingsEnabled', false);
        await queue.processQueue();
        expect(spoken).toEqual(['synthetic farewell', 'synthetic-chat says synthetic message', 'synthetic command']);
        expect(presented).toEqual(['farewell', 'command']);
        expect(queue.getQueueLength()).toBe(0);
        await queue.stop();
    });
    function createQueue() {
        const started: string[] = [];
        const queue = new DisplayQueue({ call: async () => ({}) }, {
            autoProcess: false, rowIntervalMs: 0, ttsNotificationsEnabled: false,
            obs: { ttsTxt: 'synthetic-tts' }
        }, { PRIORITY_LEVELS }, { emit: () => {} }, {
            delay: async () => {},
            onPresentationStarted: (item) => { started.push(String(item.data.username)); }
        });
        return { queue, started };
    }

    const item = (name: string, priority: number): DisplayQueueItem => ({
        type: 'platform:follow', platform: 'twitch', priority, data: { username: name }
    });

    it('selects the highest priority pending presentation, stably for ties', async () => {
        const { queue, started } = createQueue();
        queue.addItem(item('synthetic-low', 1));
        queue.addItem(item('synthetic-high-first', 5));
        queue.addItem(item('synthetic-high-second', 5));
        await queue.processQueue();
        expect(started).toEqual(['synthetic-high-first', 'synthetic-high-second', 'synthetic-low']);
        await queue.stop();
    });

    it('retains explicit priority zero', async () => {
        const { queue, started } = createQueue();
        queue.addItem(item('synthetic-zero', 0));
        queue.addItem(item('synthetic-one', 1));
        expect(queue.queue[1]?.priority).toBe(0);
        await queue.processQueue();
        expect(started).toEqual(['synthetic-one', 'synthetic-zero']);
        await queue.stop();
    });
});
