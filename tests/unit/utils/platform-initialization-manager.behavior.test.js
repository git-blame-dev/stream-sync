const { describe, expect, beforeEach, it } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { PlatformInitializationManager } = require('../../../src/utils/platform-initialization-manager');

describe('PlatformInitializationManager behavior edges', () => {
    let sharedHandler;
    let mockCreateErrorHandler;

    beforeEach(() => {
        sharedHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };

        mockCreateErrorHandler = createMockFn().mockReturnValue(sharedHandler);
    });

    function createManager(platformName, deps = {}) {
        return new PlatformInitializationManager(platformName, noOpLogger, {
            createPlatformErrorHandler: mockCreateErrorHandler,
            ...deps
        });
    }

    it('prevents reinitialization unless forced', () => {
        const manager = createManager('twitch');

        expect(manager.beginInitialization()).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization()).toBe(false);
        manager.configure({ allowReinitialization: true });
        expect(manager.beginInitialization()).toBe(true);
    });

    it('routes initialization errors through platform error handler when max attempts exceeded', () => {
        const manager = createManager('youtube');
        manager.configure({ maxAttempts: 1 });

        expect(manager.beginInitialization()).toBe(true);
        expect(manager.beginInitialization()).toBe(false);
        expect(sharedHandler.logOperationalError).toHaveBeenCalled();
    });

    it('routes failures with errors through handleEventProcessingError and records state', () => {
        const manager = createManager('tiktok');

        manager.beginInitialization();
        manager.markInitializationFailure(new Error('boom'), { stage: 'connect' });

        const state = manager.getInitializationState();
        expect(state.success).toBe(false);
        expect(state.preventedAttempts).toBe(0);
        expect(sharedHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('allows forced reinitialization even after successes while respecting max attempts', () => {
        const manager = createManager('twitch');
        manager.configure({ allowReinitialization: true, maxAttempts: 2 });

        expect(manager.beginInitialization(true)).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization(true)).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization(true)).toBe(false);
        expect(sharedHandler.logOperationalError).toHaveBeenCalled();
    });

    it('logs operational error when failure is not an Error instance', () => {
        const manager = createManager('youtube');

        manager.beginInitialization();
        manager.markInitializationFailure('string failure', { stage: 'config' });

        const state = manager.getInitializationState();
        expect(state.success).toBe(false);
        expect(state.stage).toBe('config');
        expect(state.error).toBe('Unknown error');
        expect(sharedHandler.logOperationalError).toHaveBeenCalledWith(
            expect.stringContaining('Initialization failed'),
            'youtube',
            { stage: 'config' }
        );
    });

    it('heals corrupted counters and state before beginning initialization', () => {
        const manager = createManager('tiktok');
        manager.initializationAttempts = undefined;
        manager.initializationCount = undefined;
        manager.preventedReinitializations = undefined;
        manager.initializationState = null;

        const shouldProceed = manager.beginInitialization();

        expect(shouldProceed).toBe(true);
        const state = manager.getInitializationState();
        expect(state.totalAttempts).toBe(1);
        expect(state.preventedAttempts).toBe(0);
        expect(state.isInitialized).toBe(false);
    });

    it('tracks failure state and can reset cleanly', () => {
        const manager = createManager('tiktok');

        manager.beginInitialization();
        manager.markInitializationFailure(new Error('fail'), { stage: 'config' });

        const stats = manager.getStatistics();
        expect(stats.initializationAttempts).toBe(1);
        expect(stats.isInitialized).toBe(false);
        expect(sharedHandler.handleEventProcessingError).toHaveBeenCalled();

        manager.reset();
        expect(manager.getStatistics().initializationAttempts).toBe(0);
    });

    it('creates platform error handler lazily on first failure', () => {
        const lazyHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        const lazyMockCreate = createMockFn().mockReturnValue(lazyHandler);
        const manager = new PlatformInitializationManager('twitch', noOpLogger, {
            createPlatformErrorHandler: lazyMockCreate
        });
        manager.errorHandler = null;

        manager.beginInitialization();
        manager.markInitializationFailure(new Error('lazy failure'), { stage: 'lazy' });

        expect(lazyMockCreate).toHaveBeenCalledWith(noOpLogger, 'twitch');
        expect(lazyHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('records failure and statistics even when already prevented by max attempts', () => {
        const manager = createManager('twitch');
        manager.configure({ maxAttempts: 1 });

        manager.beginInitialization();
        manager.markInitializationFailure(new Error('first fail'), { stage: 'first' });

        expect(manager.beginInitialization()).toBe(false);
        const stats = manager.getStatistics();
        expect(stats.initializationAttempts).toBe(2);
        expect(stats.initializationCount).toBe(0);
        expect(stats.isInitialized).toBe(false);
        expect(sharedHandler.logOperationalError).toHaveBeenCalled();
    });

    it('allows forced reinitialization even when allowReinitialization is false', () => {
        const manager = createManager('youtube');

        expect(manager.beginInitialization()).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization(true)).toBe(true);
        expect(manager.getStatistics().preventedReinitializations).toBe(0);
    });

    it('ignores invalid maxAttempts configuration', () => {
        const manager = createManager('tiktok');
        manager.configure({ maxAttempts: 0 });

        expect(manager.maxAttempts).toBe(5);
        expect(manager.beginInitialization()).toBe(true);
    });

    it('allows configured reinitialization without forcing after success', () => {
        const manager = createManager('tiktok');
        manager.configure({ allowReinitialization: true, maxAttempts: 2 });

        expect(manager.beginInitialization()).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization()).toBe(true);
        expect(manager.getStatistics().initializationAttempts).toBe(2);
        expect(manager.getStatistics().preventedReinitializations).toBe(0);
    });

    it('tracks prevented attempts in initialization state when skipping reinit', () => {
        const manager = createManager('youtube');

        manager.beginInitialization();
        manager.markInitializationSuccess();

        expect(manager.beginInitialization()).toBe(false);
        const state = manager.getInitializationState();
        expect(state.isInitialized).toBe(true);
        expect(state.preventedAttempts).toBe(1);
        expect(manager.getStatistics().preventedReinitializations).toBe(1);
    });

    it('requires a logger', () => {
        expect(() => new PlatformInitializationManager('tiktok')).toThrow('PlatformInitializationManager requires a logger');
    });

    it('skips initialization when platform disabled in config and records prevention', () => {
        const manager = createManager('youtube');
        manager.configure({ allowReinitialization: false, maxAttempts: 3 });

        manager.beginInitialization();
        manager.markInitializationSuccess({ enabled: false });

        const proceed = manager.beginInitialization();
        expect(proceed).toBe(false);
        const stats = manager.getStatistics();
        expect(stats.preventedReinitializations).toBe(1);
        expect(stats.isInitialized).toBe(true);
    });

    it('reset clears prevented attempts and state after failures', () => {
        const manager = createManager('twitch');

        manager.beginInitialization();
        manager.markInitializationFailure(new Error('init failed'));
        manager.beginInitialization();
        manager.markInitializationSuccess();

        manager.reset();

        const stats = manager.getStatistics();
        expect(stats.preventedReinitializations).toBe(0);
        expect(stats.initializationAttempts).toBe(0);
        expect(stats.isInitialized).toBe(false);
    });

    it('ignores non-boolean reinit configuration and keeps prevention in place', () => {
        const manager = createManager('youtube');

        manager.configure({ allowReinitialization: 'yes', maxAttempts: 'ten' });

        expect(manager.allowReinitialization).toBe(false);
        expect(manager.maxAttempts).toBe(5);

        expect(manager.beginInitialization()).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization()).toBe(false);
        expect(manager.getStatistics().preventedReinitializations).toBe(1);
    });

    it('logs operational error when failure lacks Error instance', () => {
        const manager = createManager('youtube');

        manager.beginInitialization();
        manager.markInitializationFailure(null, { stage: 'config' });

        expect(sharedHandler.logOperationalError).toHaveBeenCalledWith(
            expect.stringContaining('Initialization failed'),
            'youtube',
            { stage: 'config' }
        );
    });

    it('creates error handler when missing and routes failure', () => {
        const lazyHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        const lazyMockCreate = createMockFn().mockReturnValue(lazyHandler);
        const manager = new PlatformInitializationManager('twitch', noOpLogger, {
            createPlatformErrorHandler: lazyMockCreate
        });
        manager.errorHandler = null;

        manager.beginInitialization();
        manager.markInitializationFailure(new Error('boom'), { stage: 'connect' });

        expect(lazyMockCreate).toHaveBeenCalledWith(noOpLogger, 'twitch');
        expect(lazyHandler.handleEventProcessingError).toHaveBeenCalledWith(
            expect.any(Error),
            'initialization',
            { stage: 'connect' },
            expect.stringContaining('Initialization failed'),
            'twitch'
        );
    });

    it('creates error handler for non-Error failures when missing and logs operational error', () => {
        const lazyHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        const lazyMockCreate = createMockFn().mockReturnValue(lazyHandler);
        const manager = new PlatformInitializationManager('youtube', noOpLogger, {
            createPlatformErrorHandler: lazyMockCreate
        });
        manager.errorHandler = null;

        manager.beginInitialization();
        manager.markInitializationFailure('string failure', { stage: 'nonerror' });

        expect(lazyMockCreate).toHaveBeenCalledWith(noOpLogger, 'youtube');
        expect(lazyHandler.logOperationalError).toHaveBeenCalledWith(
            expect.stringContaining('Initialization failed'),
            'youtube',
            { stage: 'nonerror' }
        );
        expect(manager.getInitializationState().error).toBe('Unknown error');
    });

    it('uses default error-handler context when platform name is missing', () => {
        const lazyHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        const lazyMockCreate = createMockFn().mockReturnValue(lazyHandler);
        const manager = new PlatformInitializationManager(undefined, noOpLogger, {
            createPlatformErrorHandler: lazyMockCreate
        });
        manager.errorHandler = null;

        manager.beginInitialization();
        manager.markInitializationFailure(new Error('missing name'), { stage: 'no-name' });

        expect(lazyMockCreate).toHaveBeenCalledWith(noOpLogger, 'platform-initialization');
        expect(lazyHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('halts forced reinitialization when max attempts exceeded', () => {
        const manager = createManager('tiktok');
        manager.configure({ allowReinitialization: true, maxAttempts: 2 });

        expect(manager.beginInitialization(true)).toBe(true);
        manager.markInitializationSuccess();
        expect(manager.beginInitialization(true)).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization(true)).toBe(false);
        expect(sharedHandler.logOperationalError).toHaveBeenCalled();
    });

    it('computes success rate in statistics', () => {
        const manager = createManager('youtube');

        manager.beginInitialization();
        manager.markInitializationSuccess();
        manager.beginInitialization();
        manager.markInitializationFailure(new Error('fail'));

        const stats = manager.getStatistics();
        expect(stats.initializationAttempts).toBe(2);
        expect(stats.initializationCount).toBe(1);
        expect(stats.successRate).toBeCloseTo(50);
    });
});
