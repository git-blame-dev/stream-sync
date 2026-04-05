const { describe, it, expect, beforeEach, afterEach } = require('bun:test');

const testClock = require('./test-clock');
const {
    WebSocketMessageSimulator,
    CrossPlatformIntegrationTester,
    UserJourneyValidator
} = require('./e2e-testing-infrastructure');

const createNoOpLogger = () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
});

const createPlatform = (options = {}) => {
    const {
        connected = true,
        active = true,
        shouldThrow = false,
        resultFactory = (message) => ({ handled: true, message })
    } = options;

    return {
        notificationDispatcher: {},
        isConnected: () => connected,
        isActive: () => active,
        handleWebSocketMessage: async (message) => {
            if (shouldThrow) {
                throw new Error('platform handler failed');
            }
            return resultFactory(message);
        }
    };
};

describe('e2e-testing-infrastructure behavior', () => {
    beforeEach(() => {
        testClock.reset();
    });

    afterEach(() => {
        testClock.useRealTime();
    });

    it('injects websocket messages and emits processed payloads for object and string inputs', async () => {
        const simulator = new WebSocketMessageSimulator({
            platform: 'twitch',
            logger: createNoOpLogger(),
            processingDelay: 1
        });
        const platform = createPlatform();
        const events = [];

        simulator.on('messageProcessed', (payload) => events.push(payload));

        const objectResult = await simulator.injectRawWebSocketMessage({ type: 'object' }, platform);
        const stringResult = await simulator.injectRawWebSocketMessage('{"type":"string"}', platform);

        expect(objectResult.handled).toBe(true);
        expect(stringResult.message).toEqual({ type: 'string' });
        expect(events.length).toBe(2);
        expect(events[0].platform).toBe('twitch');
        expect(events[1].result.handled).toBe(true);
    });

    it('rejects injection when platform is missing or unsupported and emits processing errors', async () => {
        const simulator = new WebSocketMessageSimulator({
            platform: 'youtube',
            logger: createNoOpLogger(),
            processingDelay: 1
        });
        const errorEvents = [];

        simulator.on('messageProcessingError', (payload) => errorEvents.push(payload));

        await expect(simulator.injectRawWebSocketMessage({ type: 'missing' })).rejects.toThrow('Platform instance required');
        await expect(simulator.injectRawWebSocketMessage({ type: 'unsupported' }, {})).rejects.toThrow('does not support WebSocket message injection');

        expect(errorEvents.length).toBe(1);
        expect(errorEvents[0].platform).toBe('youtube');
        expect(errorEvents[0].error).toBeInstanceOf(Error);
    });

    it('collects success and failure entries when processing message sequences', async () => {
        const simulator = new WebSocketMessageSimulator({ platform: 'tiktok', logger: createNoOpLogger(), processingDelay: 1 });
        const platform = {
            handleWebSocketMessage: async (message) => {
                if (message.fail) {
                    throw new Error('sequence failure');
                }
                return { ok: true, message };
            }
        };

        const sequence = await simulator.processMessageSequence([
            { id: 'a' },
            { id: 'b', fail: true },
            { id: 'c' }
        ], platform);

        expect(sequence).toHaveLength(3);
        expect(sequence.filter((item) => item.success)).toHaveLength(2);
        expect(sequence.filter((item) => !item.success)).toHaveLength(1);
    });

    it('reports throughput metrics for sequential and concurrent high-frequency processing', async () => {
        const simulator = new WebSocketMessageSimulator({ platform: 'generic', logger: createNoOpLogger(), processingDelay: 1 });
        const platform = createPlatform();
        const messages = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

        const sequential = await simulator.simulateHighFrequencyProcessing(messages, platform, { concurrent: false });
        const concurrent = await simulator.simulateHighFrequencyProcessing(messages, platform, {
            concurrent: true,
            maxConcurrency: 2
        });

        expect(sequential.totalMessages).toBe(4);
        expect(sequential.concurrent).toBe(false);
        expect(concurrent.totalMessages).toBe(4);
        expect(concurrent.concurrent).toBe(true);
        expect(concurrent.maxConcurrency).toBe(2);
        expect(sequential.messagesPerSecond).toBeGreaterThan(0);
    });

    it('processes simultaneous events and captures system history and notifications', async () => {
        const tester = new CrossPlatformIntegrationTester({
            twitch: createPlatform(),
            youtube: createPlatform({ shouldThrow: true })
        }, {
            logger: createNoOpLogger()
        });

        tester.captureNotification({ content: 'n1' });
        const result = await tester.processSimultaneousEvents({
            twitch: { message: 'ok' },
            youtube: { message: 'boom' }
        });

        expect(result.processing.platformCount).toBe(2);
        expect(result.processing.successCount).toBe(1);
        expect(result.processing.errorCount).toBe(1);
        expect(result.systemState.history).toHaveLength(2);
        expect(result.notifications).toHaveLength(1);

        expect(result.systemState.initial.platformStates.twitch.connected).toBe(true);
        expect(typeof result.systemState.initial.memoryUsage.rss).toBe('number');

        expect(tester.getCapturedNotifications()).toHaveLength(1);
        tester.clearCapture();
        expect(tester.getCapturedNotifications()).toHaveLength(0);
    });

    it('throws when simultaneous events include an unknown platform', async () => {
        const tester = new CrossPlatformIntegrationTester({}, { logger: createNoOpLogger() });

        await expect(tester.processSimultaneousEvents({ twitch: { message: 'missing' } })).rejects.toThrow('Platform twitch not available');
    });

    it('resolves competing notifications by priority, value, and time window', async () => {
        const tester = new CrossPlatformIntegrationTester({}, { logger: createNoOpLogger() });

        const outcome = await tester.resolvePriorityConflicts([
            { id: 'low', priority: 'low', amount: 1 },
            { id: 'high', priority: 'high', amount: 2 },
            { id: 'ultra', priority: 'ultra_high', amount: 1 },
            { id: 'med', priority: 'medium', amount: 10 }
        ], {
            algorithm: 'weighted_value',
            timeWindow: 15
        });

        expect(outcome.totalNotifications).toBe(4);
        expect(outcome.processedNotifications[0].id).toBe('ultra');
        expect(outcome.processedNotifications).toHaveLength(2);
        expect(outcome.droppedCount).toBe(2);
    });

    it('handles connection-state routing with processed, queued, dropped, and missing-state outcomes', async () => {
        const tester = new CrossPlatformIntegrationTester({}, { logger: createNoOpLogger() });
        const now = testClock.now();

        const processed = await tester.processEventWithConnectionStates(
            { platform: 'twitch', id: 'ok' },
            { twitch: { connected: true, stable: true, lastMessage: now } },
            { fallbackBehavior: 'queue', maxStaleTime: 10000 }
        );

        const queued = await tester.processEventWithConnectionStates(
            { platform: 'youtube', id: 'queued' },
            { youtube: { connected: false, stable: true, lastMessage: now } },
            { fallbackBehavior: 'queue', maxStaleTime: 10000 }
        );

        const dropped = await tester.processEventWithConnectionStates(
            { platform: 'tiktok', id: 'dropped' },
            { tiktok: { connected: true, stable: false, lastMessage: now } },
            { fallbackBehavior: 'drop', maxStaleTime: 10000 }
        );

        await expect(tester.processEventWithConnectionStates(
            { platform: 'kick', id: 'missing' },
            {},
            { fallbackBehavior: 'queue' }
        )).rejects.toThrow('No connection state provided');

        expect(processed.processed).toBe(true);
        expect(queued.queued).toBe(true);
        expect(dropped.dropped).toBe(true);
        expect(dropped.result.reason).toBe('unstable');
    });

    it('validates full user journeys and tracks journey history', async () => {
        const validator = new UserJourneyValidator({ logger: createNoOpLogger() });

        const successJourney = await validator.validateCompleteUserJourney(
            { platform: 'twitch', rawWebSocketData: { subscription_type: 'chat', event: { text: 'hi' } } },
            { obsDisplay: true, ttsOutput: true, logOutput: true }
        );

        const incompleteJourney = await validator.validateCompleteUserJourney(
            { platform: 'twitch' },
            { obsDisplay: true, ttsOutput: true, logOutput: true }
        );

        expect(successJourney.success).toBe(true);
        expect(successJourney.stages).toHaveLength(5);
        expect(incompleteJourney.success).toBe(false);
        expect(validator.getJourneyHistory()).toHaveLength(2);

        validator.clearHistory();
        expect(validator.getJourneyHistory()).toHaveLength(0);
    });

    it('validates content quality checks for empty content and unsafe content', async () => {
        const validator = new UserJourneyValidator({ logger: createNoOpLogger() });

        const empty = await validator.validateContentQualityInFlow({});
        expect(empty.passed).toBe(false);
        expect(empty.checks[0].name).toBe('content_exists');

        const unsafe = await validator.validateContentQualityInFlow({
            message: '<script>alert(1)</script> test visit https://malicious-site.example.invalid'
        });
        expect(unsafe.passed).toBe(false);
        expect(unsafe.sanitizedContent).toBe(' test visit https://malicious-site.example.invalid');
        expect(unsafe.blockedElements).toContain('https://malicious-site.example.invalid');
        expect(unsafe.checks.some((check) => check.name === 'html_sanitization' && !check.passed)).toBe(true);
    });
});
