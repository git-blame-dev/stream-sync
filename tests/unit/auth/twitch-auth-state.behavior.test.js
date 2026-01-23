const { describe, expect, it } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const TwitchAuthState = require('../../../src/auth/TwitchAuthState');

describe('TwitchAuthState behavior', () => {
    it('executes immediately when ready and tracks queue size', async () => {
        const state = new TwitchAuthState(noOpLogger);
        const op = createMockFn().mockResolvedValue('ok');

        await expect(state.executeWhenReady(op)).resolves.toBe('ok');
        expect(op).toHaveBeenCalled();
        expect(state.getState()).toBe('READY');
        expect(state.getQueuedCount()).toBe(0);
    });

    it('queues during refresh and flushes on success', async () => {
        const state = new TwitchAuthState(noOpLogger);
        const op = createMockFn().mockResolvedValue('done');
        state.startRefresh();

        const queued = state.executeWhenReady(op);
        expect(state.getQueuedCount()).toBe(1);

        state.finishRefresh(true);
        await expect(queued).resolves.toBe('done');
        expect(state.getQueuedCount()).toBe(0);
        expect(state.getState()).toBe('READY');
    });

    it('rejects queued operations on failure and blocks further execution', async () => {
        const state = new TwitchAuthState(noOpLogger);
        state.startRefresh();

        const queued = state.executeWhenReady(() => 'noop');
        state.finishRefresh(false);

        await expect(queued).rejects.toThrow('Authentication refresh failed');
        await expect(state.executeWhenReady(() => {})).rejects.toThrow('Authentication is in error state');
        expect(state.getState()).toBe('ERROR');
    });

    it('routes errors from queued operations through platform error handler', async () => {
        const handler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        const mockCreateErrorHandler = createMockFn().mockReturnValue(handler);

        const state = new TwitchAuthState(noOpLogger, {
            createPlatformErrorHandler: mockCreateErrorHandler
        });
        state.startRefresh();

        const queued = state.executeWhenReady(() => {
            throw new Error('boom');
        });

        state.finishRefresh(true);
        await expect(queued).rejects.toThrow('boom');
        expect(handler.handleEventProcessingError).toHaveBeenCalledWith(
            expect.any(Error),
            'auth-state',
            null,
            expect.stringContaining('queued')
        );
    });
});
