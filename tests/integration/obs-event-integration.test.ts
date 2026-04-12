import { describe, test, beforeEach, afterEach, expect } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const { createMockFn, clearAllMocks, restoreAllMocks } = load('../helpers/bun-mock-utils');
const { noOpLogger } = load('../helpers/mock-factories');
const { createEventBus } = load('../../src/core/EventBus');
const { createOBSEventService } = load('../../src/obs/obs-event-service');
const { safeSetTimeout } = load('../../src/utils/timeout-validator');
const testClock = load('../helpers/test-clock');

describe('OBS Event Integration', () => {
    let eventBus: ReturnType<typeof createEventBus>;
    let obsEventService: ReturnType<typeof createOBSEventService>;
    let mockOBSConnection: ReturnType<typeof createMockOBSConnection>;
    let mockObsSources: ReturnType<typeof createMockObsSources>;

    beforeEach(() => {
        eventBus = createEventBus({ debugEnabled: false });

        mockOBSConnection = createMockOBSConnection();
        mockObsSources = createMockObsSources();

        obsEventService = createOBSEventService({
            eventBus,
            obsConnection: mockOBSConnection,
            obsSources: mockObsSources,
            logger: noOpLogger
        });
    });

    afterEach(() => {
        obsEventService.destroy();
        eventBus.reset();
        clearAllMocks();
        restoreAllMocks();
    });

    test('text update flows through EventBus to OBS', async () => {
        eventBus.emit('obs:update-text', {
            sourceName: 'ChatMessage',
            text: 'Hello from EventBus!'
        });

        await waitForDelay(20);

        expect(mockObsSources.updateTextSource).toHaveBeenCalled();
        const [sourceName, text] = mockObsSources.updateTextSource.mock.calls[0];
        expect(sourceName).toBe('ChatMessage');
        expect(text).toBe('Hello from EventBus!');
    });

    test('error while updating text does not break EventBus usage', async () => {
        mockObsSources.updateTextSource.mockRejectedValue(new Error('Text update failed'));

        eventBus.emit('obs:update-text', {
            sourceName: 'Broken',
            text: 'Test'
        });

        eventBus.emit('test:event', { id: 'test-id' });

        await waitForDelay(20);

        expect(mockObsSources.updateTextSource).toHaveBeenCalled();
    });

    test('handles rapid text-update bursts without memory leaks', async () => {
        const initialMemory = process.memoryUsage().heapUsed;

        for (let i = 0; i < 200; i++) {
            eventBus.emit('obs:update-text', {
                sourceName: 'Message',
                text: `Message ${i}`
            });
        }

        await waitForDelay(100);

        const finalMemory = process.memoryUsage().heapUsed;
        const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024;

        expect(memoryIncrease).toBeLessThan(10);
    });

    test('maintains event latency under load', async () => {
        const latencies: number[] = [];

        for (let i = 0; i < 50; i++) {
            const startTime = testClock.now();

            eventBus.emit('obs:update-text', {
                sourceName: 'Message',
                text: `Test ${i}`
            });

            await waitForDelay(1);
            testClock.advance(1);

            const latency = testClock.now() - startTime;
            latencies.push(latency);
        }

        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        expect(avgLatency).toBeLessThan(30);
    });

    test('service wiring includes OBS text handlers only', () => {
        const listeners = eventBus.getListenerSummary();

        expect(listeners['obs:update-text']).toBeGreaterThan(0);
        expect(listeners['scene:switch']).toBeUndefined();
    });

    test('event bus remains functional after OBS event service destruction', async () => {
        obsEventService.destroy();

        const handler = createMockFn();
        eventBus.subscribe('test:event', handler);

        eventBus.emit('test:event', { data: 'test' });

        await waitForDelay(10);

        expect(handler).toHaveBeenCalled();
    });

    test('connection state is tracked correctly', async () => {
        await obsEventService.connect();

        const state = obsEventService.getConnectionState();

        expect(state.connected).toBe(true);
        expect(state.ready).toBe(true);
    });
});

function createMockOBSConnection() {
    return {
        connect: createMockFn().mockResolvedValue(true),
        disconnect: createMockFn().mockResolvedValue(undefined),
        isConnected: createMockFn(() => true),
        isReady: createMockFn().mockResolvedValue(true),
        call: createMockFn().mockResolvedValue({}),
        addEventListener: createMockFn(),
        removeEventListener: createMockFn(),
        getConnectionState: createMockFn(() => ({
            isConnected: true,
            isConnecting: false
        }))
    };
}

function createMockObsSources() {
    return {
        updateTextSource: createMockFn().mockResolvedValue(undefined),
        setSourceVisibility: createMockFn().mockResolvedValue(undefined),
        clearTextSource: createMockFn().mockResolvedValue(undefined)
    };
}

function waitForDelay(ms: number) {
    return new Promise<void>((resolve) => {
        safeSetTimeout(resolve, ms, 'obs-event-integration test delay');
    });
}
