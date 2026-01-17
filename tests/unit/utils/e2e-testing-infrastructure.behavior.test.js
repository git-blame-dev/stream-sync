const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
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
    });

    beforeEach(() => {
        clearAllMocks();
    });

    describe('WebSocketMessageSimulator', () => {
        it('processes messages through platform handler and emits success event', async () => {
            const simulator = new WebSocketMessageSimulator({ platform: 'twitch', logger: noOpLogger });
            const platform = fakePlatform({ processed: true });
            const processedSpy = createMockFn();
            simulator.on('messageProcessed', processedSpy);

            const result = await simulator.injectRawWebSocketMessage({ data: 1 }, platform);

            expect(result).toEqual({ processed: true });
            expect(platform.handleWebSocketMessage).toHaveBeenCalledWith({ data: 1 });
            expect(processedSpy).toHaveBeenCalledWith(expect.objectContaining({ platform: 'twitch' }));
        });

        it('routes errors through platform error handler and emits error event', async () => {
            const simulator = new WebSocketMessageSimulator({ platform: 'yt', logger: noOpLogger });
            const platform = { handleWebSocketMessage: createMockFn(async () => { throw new Error('boom'); }) };
            const errorSpy = createMockFn();
            simulator.on('messageProcessingError', errorSpy);

            await expect(simulator.injectRawWebSocketMessage({ bad: true }, platform)).rejects.toThrow('boom');

            expect(errorSpy).toHaveBeenCalled();
            expect(errorSpy.mock.calls[0][0]).toMatchObject({
                platform: 'yt',
                message: { bad: true }
            });
            expect(errorSpy.mock.calls[0][0].error).toBeInstanceOf(Error);
        });
    });

    describe('CrossPlatformIntegrationTester', () => {
        it('processes simultaneous events across platforms and returns per-platform results', async () => {
            const tester = new CrossPlatformIntegrationTester({ twitch: fakePlatform('t-ok') }, { logger: noOpLogger });

            const outcome = await tester.processSimultaneousEvents({ twitch: { foo: 'bar' } });

            expect(outcome.results.twitch.success).toBe(true);
            expect(outcome.processing.platformCount).toBe(1);
            expect(outcome.systemState.history.length).toBeGreaterThan(0);
        });

        it('throws when platform is missing from registry', async () => {
            const tester = new CrossPlatformIntegrationTester({}, { logger: noOpLogger });

            await expect(tester.processSimultaneousEvents({ twitch: { foo: 'bar' } })).rejects.toThrow('Platform twitch not available');
        });
    });

    describe('UserJourneyValidator', () => {
        it('validates journey success through all stages', async () => {
            const validator = new UserJourneyValidator({ logger: noOpLogger });
            const journey = await validator.validateCompleteUserJourney(
                { platform: 'twitch', rawWebSocketData: { subscription_type: 'chat', event: {} } },
                { obsDisplay: true, ttsOutput: true, logOutput: true }
            );

            expect(journey.success).toBe(true);
            expect(journey.stages).toHaveLength(5);
            expect(validator.getJourneyHistory()).toHaveLength(1);
        });

        it('flags content quality failures for missing content and malicious links', async () => {
            const validator = new UserJourneyValidator({ logger: noOpLogger });
            const result = await validator.validateContentQualityInFlow({ message: 'visit https://malicious-site.example.invalid' });

            expect(result.passed).toBe(false);
            expect(result.blockedElements).toContain('https://malicious-site.example.invalid');
            expect(result.checks.some(c => c.name === 'malicious_link_detection' && !c.passed)).toBe(true);
        });
    });
});
