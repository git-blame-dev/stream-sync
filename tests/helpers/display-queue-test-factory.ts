import { vi, type Mock } from 'bun:test';
import { createOBSSourcesManager } from '../../src/obs/sources';
import { createOBSGoalsManager } from '../../src/obs/goals';
import { createGoalTracker } from '../../src/utils/goal-tracker';
import { logger as coreLogger } from '../../src/core/logging';


import { createSourcesConfigFixture } from './config-fixture';
import { noOpLogger } from './mock-factories';

type MockOBSForTesting = Parameters<typeof createOBSSourcesManager>[0] & {
    call: Mock<(...args: [requestType: string, payload?: Record<string, unknown>]) => Promise<unknown>>;
    isReady: Mock<(...args: []) => Promise<boolean>>;
    ensureConnected: Mock<(...args: []) => Promise<void>>;
};

type TestGoalConfig = NonNullable<Parameters<typeof createGoalTracker>[0]['config']>;
type TestSourcesManager = ReturnType<typeof createOBSSourcesManager>;
type TestGoalTracker = ReturnType<typeof createGoalTracker>;

const noOpUnifiedLogger: typeof coreLogger = {
    config: {},
    outputs: {
        console: { write: () => {} },
        file: { config: {}, fileAppender: null, write: () => {} }
    },
    reconfigure: () => {},
    log: () => {},
    shouldOutput: () => false,
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    console: () => {},
    emergency: () => {}
};

function createMockOBSForTesting(): MockOBSForTesting {
    return {
        call: vi.fn<(...args: [requestType: string, payload?: Record<string, unknown>]) => Promise<unknown>>().mockResolvedValue({}),
        isConnected: () => true,
        isReady: vi.fn<(...args: []) => Promise<boolean>>().mockResolvedValue(true),
        ensureConnected: vi.fn<(...args: []) => Promise<void>>().mockResolvedValue()
    };
}

function createTestConfig(): TestGoalConfig {
    return {
        goals: {
            tiktokGoalEnabled: true,
            tiktokGoalTarget: 1000,
            youtubeGoalEnabled: true,
            youtubeGoalTarget: 100,
            twitchGoalEnabled: true,
            twitchGoalTarget: 500
        }
    };
}

function createRealSourcesManager(mockOBS: MockOBSForTesting): TestSourcesManager {
    return createOBSSourcesManager(mockOBS, {
        ...createSourcesConfigFixture(),
        logger: noOpLogger,
        ensureOBSConnected: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        obsCall: mockOBS.call
    });
}

function createRealGoalTracker(config: TestGoalConfig = createTestConfig()): TestGoalTracker {
    return createGoalTracker({
        logger: noOpUnifiedLogger,
        config
    });
}

function createRealGoalsManager(
    mockOBS: MockOBSForTesting,
    realSourcesManager: TestSourcesManager,
    realGoalTracker: TestGoalTracker
): ReturnType<typeof createOBSGoalsManager> {
    const config = createTestConfig();

    return createOBSGoalsManager(mockOBS, {
        logger: noOpUnifiedLogger,
        config,
        updateTextSource: realSourcesManager.updateTextSource,
        goalTracker: realGoalTracker
    });
}

function createDisplayQueueDependencies() {
    const mockOBS = createMockOBSForTesting();
    const realSourcesManager = createRealSourcesManager(mockOBS);
    const realGoalTracker = createRealGoalTracker();
    const realGoalsManager = createRealGoalsManager(mockOBS, realSourcesManager, realGoalTracker);

    return {
        mockOBS,
        sourcesManager: realSourcesManager,
        goalsManager: realGoalsManager,
        goalTracker: realGoalTracker
    };
}

export {
    createMockOBSForTesting,
    createTestConfig,
    createRealSourcesManager,
    createRealGoalTracker,
    createRealGoalsManager,
    createDisplayQueueDependencies
};
