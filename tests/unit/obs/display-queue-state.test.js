const { describe, expect, it } = require('bun:test');

const { DisplayQueueState } = require('../../../src/obs/display-queue-state');

describe('DisplayQueueState', () => {
    const getPriority = (type) => ({
        high: 10,
        medium: 5,
        low: 1,
        chat: 2
    })[type] ?? 0;

    it('orders items by priority with higher values first', () => {
        const state = new DisplayQueueState({ maxQueueSize: 10, getPriority });

        state.addItem({ type: 'low', platform: 'test', data: { username: 'test-user' } });
        state.addItem({ type: 'high', platform: 'test', data: { username: 'test-user' } });

        expect(state.queue.map(item => item.type)).toEqual(['high', 'low']);
    });

    it('preserves FIFO ordering for same-priority items', () => {
        const state = new DisplayQueueState({ maxQueueSize: 10, getPriority });

        state.addItem({ type: 'medium', platform: 'test', data: { username: 'test-user-1' } });
        state.addItem({ type: 'medium', platform: 'test', data: { username: 'test-user-2' } });

        expect(state.queue.map(item => item.data.username)).toEqual(['test-user-1', 'test-user-2']);
    });

    it('replaces older chat items and records last chat item', () => {
        const state = new DisplayQueueState({ maxQueueSize: 10, getPriority });

        state.addItem({ type: 'chat', platform: 'test', data: { username: 'test-user-1', message: 'first' } });
        state.addItem({ type: 'chat', platform: 'test', data: { username: 'test-user-2', message: 'second' } });

        expect(state.queue.length).toBe(1);
        expect(state.queue[0].data.message).toBe('second');
        expect(state.lastChatItem.data.message).toBe('second');
    });

    it('enforces maxQueueSize limits', () => {
        const state = new DisplayQueueState({ maxQueueSize: 1, getPriority });

        state.addItem({ type: 'low', platform: 'test', data: { username: 'test-user' } });

        expect(() => {
            state.addItem({ type: 'high', platform: 'test', data: { username: 'test-user' } });
        }).toThrow('Queue at capacity (1)');
    });
});
