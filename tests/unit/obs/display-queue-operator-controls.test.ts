import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';

import { PRIORITY_LEVELS } from '../../../src/core/constants';
import type { DisplayQueueItem } from '../../../src/interfaces/DisplayQueue';
import { DisplayQueue } from '../../../src/obs/display-queue';

type Key = 'messagesEnabled' | 'followsEnabled' | 'giftsEnabled';
function controls(values: Partial<Record<Key, boolean>> = {}) {
    const listeners = new Set<(snapshot: { controls: Record<Key, boolean> }) => void>();
    const current = { messagesEnabled: true, followsEnabled: true, giftsEnabled: true, ...values };
    return {
        isEnabled: (key: Key) => current[key],
        subscribe: (listener: (snapshot: { controls: Record<Key, boolean> }) => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        disable: (key: Key) => { current[key] = false; listeners.forEach((listener) => listener({ controls: { ...current } })); },
    };
}

const item = (type: string, message = type): DisplayQueueItem => ({
    type, platform: 'twitch', data: { username: 'user', message },
});

function makeQueue(operatorControls?: ReturnType<typeof controls>) {
    const rows: string[] = [];
    const bus = new EventEmitter();
    bus.on('display:row', (row: { type: string }) => rows.push(row.type));
    const dependencies = { delay: async () => {}, sourcesManager: { updateTextSource: async () => {}, clearTextSource: async () => {} },
        ...(operatorControls ? { operatorControls: operatorControls as never } : {}) } as never;
    const queue = new DisplayQueue({ call: async () => ({}) }, { autoProcess: false, rowIntervalMs: 0 }, { PRIORITY_LEVELS }, bus, dependencies);
    queue.effects.handleChatTTSEffects = async () => {};
    queue.effects.handleNotificationEffects = async () => {};
    return { queue, rows };
}

describe('DisplayQueue operator controls', () => {
    it('suppresses disabled output and effects', async () => {
        const operatorControls = controls({ messagesEnabled: false });
        const { queue, rows } = makeQueue(operatorControls);
        let effects = 0;
        queue.effects.handleChatTTSEffects = async () => { effects++; };
        queue.addItem(item('chat'));
        await queue.processQueue();
        expect(rows).toEqual([]);
        expect(effects).toBe(0);
    });

    it('does not credit disabled monetization', async () => {
        const operatorControls = controls({ giftsEnabled: false });
        const { queue } = makeQueue(operatorControls);
        let accounting = 0;
        queue.effects.processMonetizationGoal = async () => { accounting++; };
        queue.addItem(item('platform:gift'));
        await queue.effectChain;
        expect(accounting).toBe(0);
    });

    it('removes disabled waiting items while preserving order and categories', () => {
        const operatorControls = controls();
        const { queue } = makeQueue(operatorControls);
        queue.addItem(item('chat', 'chat'));
        queue.addItem(item('platform:follow', 'follow'));
        queue.addItem(item('platform:gift', 'gift'));
        operatorControls.disable('followsEnabled');
        expect(queue.state.queue.flatMap((entry) => 'children' in entry ? (entry as { children: DisplayQueueItem[] }).children.map((child) => child.data.message) : [entry.data.message])).toEqual(['gift', 'chat']);
    });

    it('filters disabled children from mixed sequences', () => {
        const operatorControls = controls({ followsEnabled: false });
        const { queue } = makeQueue(operatorControls);
        queue.addSequence([item('chat', 'chat'), item('platform:follow', 'follow'), item('platform:gift', 'gift')]);
        expect(queue.state.getQueueLength()).toBe(2);
        expect((queue.state.queue[0] as { children: DisplayQueueItem[] }).children.map((child) => child.data.message)).toEqual(['chat', 'gift']);
    });

    it('removes reserved unseen sequence children on control updates', async () => {
        const operatorControls = controls();
        const { queue, rows } = makeQueue(operatorControls);
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => { release = resolve; });
        queue.effects.handleChatTTSEffects = async (current) => { if (current.data.message === 'first') await blocked; };
        queue.addSequence([item('chat', 'first'), item('platform:follow', 'second')]);
        const processing = queue.processQueue();
        while (queue.activeSequenceRemaining.length === 0) await Promise.resolve();
        operatorControls.disable('followsEnabled');
        release();
        await processing;
        expect(rows).toEqual(['chat']);
    });

    it('keeps existing behavior without controls', async () => {
        const { queue, rows } = makeQueue();
        queue.addItem(item('chat'));
        await queue.processQueue();
        expect(rows).toEqual(['chat']);
    });
});
