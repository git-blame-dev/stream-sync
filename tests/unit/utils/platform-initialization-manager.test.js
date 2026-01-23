const { describe, expect, beforeEach, it } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { PlatformInitializationManager } = require('../../../src/utils/platform-initialization-manager');

describe('PlatformInitializationManager', () => {
    let mockHandler;

    beforeEach(() => {
        mockHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
    });

    it('prevents reinitialization by default and tracks prevented attempts', () => {
        const manager = new PlatformInitializationManager('twitch', noOpLogger);
        manager.errorHandler = mockHandler;

        expect(manager.beginInitialization()).toBe(true);
        manager.markInitializationSuccess();

        const shouldProceed = manager.beginInitialization();
        expect(shouldProceed).toBe(false);
        expect(manager.preventedReinitializations).toBe(1);
    });

    it('allows forced reinitialization when configured or forced', () => {
        const manager = new PlatformInitializationManager('twitch', noOpLogger);
        manager.errorHandler = mockHandler;

        manager.beginInitialization();
        manager.markInitializationSuccess();

        manager.configure({ allowReinitialization: true });
        expect(manager.beginInitialization()).toBe(true);

        manager.configure({ allowReinitialization: false });
        expect(manager.beginInitialization(true)).toBe(true);
    });

    it('enforces maxAttempts and routes operational error when exceeded', () => {
        const manager = new PlatformInitializationManager('twitch', noOpLogger);
        manager.errorHandler = mockHandler;

        manager.configure({ maxAttempts: 1 });

        expect(manager.beginInitialization()).toBe(true);
        manager.markInitializationFailure(new Error('boom'));

        const proceed = manager.beginInitialization();
        expect(proceed).toBe(false);
        expect(mockHandler.logOperationalError).toHaveBeenCalledWith(
            expect.stringContaining('Maximum initialization attempts'),
            'twitch',
            expect.objectContaining({ attempt: 2 })
        );
    });

    it('routes initialization failure errors through platform error handler', () => {
        const manager = new PlatformInitializationManager('twitch', noOpLogger);
        manager.errorHandler = mockHandler;
        const err = new Error('init failed');

        manager.beginInitialization();
        manager.markInitializationFailure(err, { context: 'startup' });

        expect(mockHandler.handleEventProcessingError).toHaveBeenCalledWith(
            err,
            'initialization',
            expect.objectContaining({ context: 'startup' }),
            expect.stringContaining('init failed'),
            'twitch'
        );
    });

    it('logs operational error when failure receives non-Error payload', () => {
        const manager = new PlatformInitializationManager('twitch', noOpLogger);
        manager.errorHandler = mockHandler;

        manager.beginInitialization();
        manager.markInitializationFailure(null, { context: 'disabled' });

        expect(mockHandler.logOperationalError).toHaveBeenCalledWith(
            expect.stringContaining('Initialization failed'),
            'twitch',
            expect.objectContaining({ context: 'disabled' })
        );
    });

    it('tracks statistics and reset state', () => {
        const manager = new PlatformInitializationManager('twitch', noOpLogger);

        manager.beginInitialization();
        manager.markInitializationSuccess({ detail: 'first' });

        const stats = manager.getStatistics();
        expect(stats.initializationCount).toBe(1);
        expect(stats.initializationAttempts).toBe(1);
        expect(stats.isInitialized).toBe(true);
        expect(stats.lastInitialization).toEqual(expect.objectContaining({
            success: true,
            detail: 'first'
        }));

        manager.reset();
        const resetStats = manager.getStatistics();
        expect(resetStats.initializationCount).toBe(0);
        expect(resetStats.initializationAttempts).toBe(0);
        expect(resetStats.isInitialized).toBe(false);
    });
});
