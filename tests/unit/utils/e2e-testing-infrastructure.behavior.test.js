const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/timeout-validator', () => ({
    safeDelay: createMockFn(async () => {}),
    safeSetTimeout: createMockFn()
}));

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    }))
}));

const { safeDelay } = require('../../../src/utils/timeout-validator');
const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const {
    WebSocketMessageSimulator,
    CrossPlatformIntegrationTester,
    UserJourneyValidator
} = require('../../helpers/e2e-testing-infrastructure');

const fakePlatform = (result = 'ok') => ({
    handleWebSocketMessage: createMockFn(async () => result)
});

describe('e2e-testing-infrastructure behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    beforeEach(() => {
        });

    describe('WebSocketMessageSimulator', () => {
        it('processes messages through platform handler and emits success event', async () => {
            const simulator = new WebSocketMessageSimulator({ platform: 'twitch', logger: { debug: createMockFn() } });
            const platform = fakePlatform({ processed: true });
            const processedSpy = createMockFn();
            simulator.on('messageProcessed', processedSpy);

            const result = await simulator.injectRawWebSocketMessage({ data: 1 }, platform);

            expect(result).toEqual({ processed: true });
            expect(platform.handleWebSocketMessage).toHaveBeenCalledWith({ data: 1 });
            expect(processedSpy).toHaveBeenCalledWith(expect.objectContaining({ platform: 'twitch' }));
            expect(safeDelay).toHaveBeenCalled();
        });

        it('routes errors through platform error handler and emits error event', async () => {
            const logger = { debug: createMockFn() };
            const handler = { handleEventProcessingError: createMockFn(), logOperationalError: createMockFn() };
            createPlatformErrorHandler.mockReturnValue(handler);
            const simulator = new WebSocketMessageSimulator({ platform: 'yt', logger });
            const platform = { handleWebSocketMessage: createMockFn(async () => { throw new Error('boom'); }) };
            const errorSpy = createMockFn();
            simulator.on('messageProcessingError', errorSpy);

            await expect(simulator.injectRawWebSocketMessage({ bad: true }, platform)).rejects.toThrow('boom');

            expect(handler.handleEventProcessingError).toHaveBeenCalledWith(
                expect.any(Error),
                'simulator',
                expect.objectContaining({ platform: 'yt' }),
                expect.stringContaining('WebSocket message injection failed'),
                'e2e-testing'
            );
            expect(errorSpy).toHaveBeenCalled();
        });
    });

    describe('CrossPlatformIntegrationTester', () => {
        it('processes simultaneous events across platforms and returns per-platform results', async () => {
            const tester = new CrossPlatformIntegrationTester({ twitch: fakePlatform('t-ok') }, { logger: { debug: createMockFn() } });

            const outcome = await tester.processSimultaneousEvents({ twitch: { foo: 'bar' } });

            expect(outcome.results.twitch.success).toBe(true);
            expect(outcome.processing.platformCount).toBe(1);
            expect(outcome.systemState.history.length).toBeGreaterThan(0);
        });

        it('captures tester errors via platform error handler when platform missing', async () => {
            const handler = { handleEventProcessingError: createMockFn(), logOperationalError: createMockFn() };
            createPlatformErrorHandler.mockReturnValue(handler);
            const tester = new CrossPlatformIntegrationTester({}, { logger: { debug: createMockFn() } });

            await expect(tester.processSimultaneousEvents({ twitch: { foo: 'bar' } })).rejects.toThrow();

            expect(handler.handleEventProcessingError).toHaveBeenCalled();
        });
    });

    describe('UserJourneyValidator', () => {
        it('validates journey success through all stages', async () => {
            const validator = new UserJourneyValidator({ logger: { debug: createMockFn() } });
            const journey = await validator.validateCompleteUserJourney(
                { platform: 'twitch', rawWebSocketData: { subscription_type: 'chat', event: {} } },
                { obsDisplay: true, ttsOutput: true, logOutput: true }
            );

            expect(journey.success).toBe(true);
            expect(journey.stages).toHaveLength(5);
            expect(validator.getJourneyHistory()).toHaveLength(1);
        });

        it('flags content quality failures for missing content and malicious links', async () => {
            const validator = new UserJourneyValidator({ logger: { debug: createMockFn() } });
            const result = await validator.validateContentQualityInFlow({ message: 'visit https://malicious-site.example.invalid' });

            expect(result.passed).toBe(false);
            expect(result.blockedElements).toContain('https://malicious-site.example.invalid');
            expect(result.checks.some(c => c.name === 'malicious_link_detection' && !c.passed)).toBe(true);
        });
    });
});
