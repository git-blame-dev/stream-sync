import { initializeLoggingConfig } from '../../src/core/logging';

type TestRecord = Record<string, unknown>;
type TestUser = TestRecord & {
    username: string;
    displayName: string;
    userId: string;
    isMod: boolean;
    isSubscriber: boolean;
    isBroadcaster: boolean;
};

type TestNotification = TestRecord & {
    id: string;
    type: string;
    username: string;
    platform: string;
    displayMessage: string;
    ttsMessage: string;
    logMessage: string;
    processedAt: number;
    timestamp: string;
};

const BASE_TIMESTAMP_MS = Date.parse('2024-01-01T00:00:00.000Z');
let sequence = 0;
const nextSequence = () => {
    sequence += 1;
    return sequence;
};
const resetTestSetupSequence = () => {
    sequence = 0;
};
const nextTimestampMs = () => BASE_TIMESTAMP_MS + (nextSequence() * 1000);
const nextTestId = (prefix: string) => `${prefix}-${nextSequence().toString(36).padStart(6, '0')}`;

const initializeTestLogging = () => {
    initializeLoggingConfig({
        logging: { console: { enabled: false }, file: { enabled: false } }
    }, { operatorCaptureEnabled: false });
};

const createTestUser = <Overrides extends TestRecord = Record<string, never>>(overrides?: Overrides): TestUser & Overrides => ({
    username: 'TestUser',
    displayName: 'TestUser',
    userId: 'test-user-id',
    isMod: false,
    isSubscriber: false,
    isBroadcaster: false,
    ...overrides
} as TestUser & Overrides);

const createTestNotification = <Overrides extends TestRecord = Record<string, never>>(
    type = 'platform:gift',
    overrides?: Overrides
): TestNotification & Overrides => {
    const timestampMs = nextTimestampMs();
    const timestampIso = new Date(timestampMs).toISOString();

    return {
        id: nextTestId(`test-${type}`),
        type,
        username: 'TestUser',
        platform: 'tiktok',
        displayMessage: `TestUser ${type}`,
        ttsMessage: `TestUser ${type}`,
        logMessage: `${type} from TestUser`,
        processedAt: timestampMs,
        timestamp: timestampIso,
        ...overrides
    } as TestNotification & Overrides;
};

const TEST_TIMEOUTS = {
    FAST: 1000,
    MEDIUM: 5000,
    SLOW: 10000,
    PERFORMANCE: 15000
};

export {
    resetTestSetupSequence,
    initializeTestLogging,
    createTestUser,
    createTestNotification,
    TEST_TIMEOUTS
};
