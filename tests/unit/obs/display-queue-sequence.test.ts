import { describe, expect, it } from 'bun:test';
import { DisplayQueue } from '../../../src/obs/display-queue';
import { PRIORITY_LEVELS } from '../../../src/core/constants';
import type { DisplayQueueItem } from '../../../src/interfaces/DisplayQueue';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

const item = (name: string, priority = 1): DisplayQueueItem => ({
    type: 'platform:follow', platform: 'twitch', priority,
    data: { username: name, message: name }
});

function createQueue(maxQueueSize?: number, onStart?: (item: DisplayQueueItem) => Promise<void>) {
    const started: string[] = [];
    const queue = new DisplayQueue({ call: async () => ({}) }, {
        autoProcess: false, rowIntervalMs: 0, ttsNotificationsEnabled: false,
        obs: {},
        ...(maxQueueSize === undefined ? {} : { maxQueueSize })
    }, { PRIORITY_LEVELS }, { emit: () => {} }, {
        delay: async () => {},
        onPresentationStarted: async (entry) => {
            started.push(String(entry.data.username));
            await onStart?.(entry);
        }
    });
    return { queue, started };
}

describe('DisplayQueue sequences', () => {
    it('selects a sequence by its maximum priority and reserves child effect order', async () => {
        const entered = deferred();
        const release = deferred();
        const { queue, started } = createQueue(undefined, async (entry) => {
            if (entry.data.username === 'synthetic-first') { entered.resolve(); await release.promise; }
        });
        queue.addItem(item('synthetic-unrelated', 2));
        queue.addSequence([item('synthetic-first'), item('synthetic-second', 5), item('synthetic-third')]);
        const processing = queue.processQueue();
        await entered.promise;
        queue.addItem(item('synthetic-urgent', 10));
        expect(started).toEqual(['synthetic-first']);
        release.resolve();
        await processing;
        expect(started).toEqual(['synthetic-first', 'synthetic-second', 'synthetic-third', 'synthetic-urgent', 'synthetic-unrelated']);
        await queue.stop();
    });

    it('does not interrupt an unrelated active presentation', async () => {
        const entered = deferred();
        const release = deferred();
        const { queue, started } = createQueue(undefined, async (entry) => {
            if (entry.data.username === 'synthetic-active') { entered.resolve(); await release.promise; }
        });
        queue.addItem(item('synthetic-active'));
        const processing = queue.processQueue();
        await entered.promise;
        queue.addSequence([item('synthetic-next', 5), item('synthetic-last')]);
        expect(started).toEqual(['synthetic-active']);
        release.resolve();
        await processing;
        expect(started).toEqual(['synthetic-active', 'synthetic-next', 'synthetic-last']);
        await queue.stop();
    });

    it('atomically rejects capacity overflow including active and reserved children', async () => {
        const entered = deferred();
        const release = deferred();
        const { queue } = createQueue(3, async () => { entered.resolve(); await release.promise; });
        queue.addSequence([item('synthetic-active'), item('synthetic-reserved')]);
        const processing = queue.processQueue();
        await entered.promise;
        expect(queue.getQueueLength()).toBe(2);
        const before = [...queue.queue];
        expect(() => queue.addSequence([item('synthetic-overflow-one'), item('synthetic-overflow-two')])).toThrow('capacity');
        expect(queue.queue).toEqual(before);
        queue.addItem(item('synthetic-admitted'));
        expect(queue.getQueueLength()).toBe(3);
        release.resolve();
        await processing;
        expect(queue.getQueueLength()).toBe(0);
        await queue.stop();
    });

    it('clears pending children without starting a concurrent runner or retiring active accounting', async () => {
        const entered = deferred();
        const release = deferred();
        const { queue, started } = createQueue(undefined, async (entry) => {
            if (entry.data.username === 'synthetic-active') { entered.resolve(); await release.promise; }
        });
        queue.addSequence([item('synthetic-active'), item('synthetic-cleared')]);
        const processing = queue.processQueue();
        await entered.promise;
        queue.clearQueue();
        expect(queue.getQueueLength()).toBe(1);
        queue.config.autoProcess = true;
        queue.addSequence([item('synthetic-new-first'), item('synthetic-new-last')]);
        expect(started).toEqual(['synthetic-active']);
        release.resolve();
        await processing;
        expect(started).toEqual(['synthetic-active', 'synthetic-new-first', 'synthetic-new-last']);
        await queue.stop();
    });

    it('continues after a qualified accounting callback fails, without retrying it', async () => {
        const { queue, started } = createQueue(undefined, async (entry) => {
            if (entry.data.username === 'synthetic-failed') throw new Error('synthetic accounting failure');
        });
        queue.addSequence([item('synthetic-failed'), item('synthetic-continued')]);
        await queue.processQueue();
        expect(started).toEqual(['synthetic-failed', 'synthetic-continued']);
        await queue.stop();
    });
});
