
jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const { PlatformInitializationManager } = require('../../../src/utils/platform-initialization-manager');

describe('PlatformInitializationManager behavior edges', () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    };
    let sharedHandler;

    beforeEach(() => {
        jest.clearAllMocks();
        sharedHandler = {
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        };
        createPlatformErrorHandler.mockReturnValue(sharedHandler);
    });

    it('prevents reinitialization unless forced', () => {
        const manager = new PlatformInitializationManager('twitch', logger);

        expect(manager.beginInitialization()).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization()).toBe(false);
        manager.configure({ allowReinitialization: true });
        expect(manager.beginInitialization()).toBe(true);
    });

    it('routes initialization errors through platform error handler when max attempts exceeded', () => {
        const manager = new PlatformInitializationManager('youtube', logger);
        manager.configure({ maxAttempts: 1 });

        expect(manager.beginInitialization()).toBe(true);
        expect(manager.beginInitialization()).toBe(false);
        expect(sharedHandler.logOperationalError).toHaveBeenCalled();
    });

    it('routes failures with errors through handleEventProcessingError and records state', () => {
        const manager = new PlatformInitializationManager('tiktok', logger);

        manager.beginInitialization();
        manager.markInitializationFailure(new Error('boom'), { stage: 'connect' });

        const state = manager.getInitializationState();
        expect(state.success).toBe(false);
        expect(state.preventedAttempts).toBe(0);
        expect(sharedHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('allows forced reinitialization even after successes while respecting max attempts', () => {
        const manager = new PlatformInitializationManager('twitch', logger);
        manager.configure({ allowReinitialization: true, maxAttempts: 2 });

        expect(manager.beginInitialization(true)).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization(true)).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization(true)).toBe(false);
        expect(sharedHandler.logOperationalError).toHaveBeenCalled();
    });

    it('logs operational error when failure is not an Error instance', () => {
        const manager = new PlatformInitializationManager('youtube', logger);

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
        const manager = new PlatformInitializationManager('tiktok', logger);
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
        const manager = new PlatformInitializationManager('tiktok', logger);

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
        createPlatformErrorHandler.mockReturnValueOnce(sharedHandler);
        const manager = new PlatformInitializationManager('twitch', logger);
        manager.errorHandler = null;

        manager.beginInitialization();
        manager.markInitializationFailure(new Error('lazy failure'), { stage: 'lazy' });

        expect(createPlatformErrorHandler).toHaveBeenCalledWith(logger, 'twitch');
        expect(sharedHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('records failure and statistics even when already prevented by max attempts', () => {
        const manager = new PlatformInitializationManager('twitch', logger);
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
        const manager = new PlatformInitializationManager('youtube', logger);

        expect(manager.beginInitialization()).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization(true)).toBe(true);
        expect(manager.getStatistics().preventedReinitializations).toBe(0);
    });

    it('ignores invalid maxAttempts configuration', () => {
        const manager = new PlatformInitializationManager('tiktok', logger);
        manager.configure({ maxAttempts: 0 });

        expect(manager.maxAttempts).toBe(5);
        expect(manager.beginInitialization()).toBe(true);
    });

    it('allows configured reinitialization without forcing after success', () => {
        const manager = new PlatformInitializationManager('tiktok', logger);
        manager.configure({ allowReinitialization: true, maxAttempts: 2 });

        expect(manager.beginInitialization()).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization()).toBe(true);
        expect(manager.getStatistics().initializationAttempts).toBe(2);
        expect(manager.getStatistics().preventedReinitializations).toBe(0);
    });

    it('tracks prevented attempts in initialization state when skipping reinit', () => {
        const manager = new PlatformInitializationManager('youtube', logger);

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
        const manager = new PlatformInitializationManager('youtube', logger);
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
        const manager = new PlatformInitializationManager('twitch', logger);

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
        const manager = new PlatformInitializationManager('youtube', logger);

        manager.configure({ allowReinitialization: 'yes', maxAttempts: 'ten' });

        expect(manager.allowReinitialization).toBe(false);
        expect(manager.maxAttempts).toBe(5);

        expect(manager.beginInitialization()).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization()).toBe(false);
        expect(manager.getStatistics().preventedReinitializations).toBe(1);
    });

    it('logs operational error when failure lacks Error instance', () => {
        const manager = new PlatformInitializationManager('youtube', logger);

        manager.beginInitialization();
        manager.markInitializationFailure(null, { stage: 'config' });

        expect(sharedHandler.logOperationalError).toHaveBeenCalledWith(
            expect.stringContaining('Initialization failed'),
            'youtube',
            { stage: 'config' }
        );
    });

    it('creates error handler when missing and routes failure', () => {
        const manager = new PlatformInitializationManager('twitch', logger);
        manager.errorHandler = null;
        createPlatformErrorHandler.mockReturnValueOnce(sharedHandler);

        manager.beginInitialization();
        manager.markInitializationFailure(new Error('boom'), { stage: 'connect' });

        expect(createPlatformErrorHandler).toHaveBeenCalledWith(logger, 'twitch');
        expect(sharedHandler.handleEventProcessingError).toHaveBeenCalledWith(
            expect.any(Error),
            'initialization',
            { stage: 'connect' },
            expect.stringContaining('Initialization failed'),
            'twitch'
        );
    });

    it('creates error handler for non-Error failures when missing and logs operational error', () => {
        const manager = new PlatformInitializationManager('youtube', logger);
        manager.errorHandler = null;
        createPlatformErrorHandler.mockReturnValueOnce(sharedHandler);

        manager.beginInitialization();
        manager.markInitializationFailure('string failure', { stage: 'nonerror' });

        expect(createPlatformErrorHandler).toHaveBeenCalledWith(logger, 'youtube');
        expect(sharedHandler.logOperationalError).toHaveBeenCalledWith(
            expect.stringContaining('Initialization failed'),
            'youtube',
            { stage: 'nonerror' }
        );
        expect(manager.getInitializationState().error).toBe('Unknown error');
    });

    it('uses default error-handler context when platform name is missing', () => {
        const manager = new PlatformInitializationManager(undefined, logger);
        manager.errorHandler = null;
        createPlatformErrorHandler.mockReturnValueOnce(sharedHandler);

        manager.beginInitialization();
        manager.markInitializationFailure(new Error('missing name'), { stage: 'no-name' });

        expect(createPlatformErrorHandler).toHaveBeenCalledWith(logger, 'platform-initialization');
        expect(sharedHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('halts forced reinitialization when max attempts exceeded', () => {
        const manager = new PlatformInitializationManager('tiktok', logger);
        manager.configure({ allowReinitialization: true, maxAttempts: 2 });

        expect(manager.beginInitialization(true)).toBe(true);
        manager.markInitializationSuccess();
        expect(manager.beginInitialization(true)).toBe(true);
        manager.markInitializationSuccess();

        expect(manager.beginInitialization(true)).toBe(false);
        expect(sharedHandler.logOperationalError).toHaveBeenCalled();
    });

    it('computes success rate in statistics', () => {
        const manager = new PlatformInitializationManager('youtube', logger);

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
