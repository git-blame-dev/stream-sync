import type { DisplayQueue } from '../../src/obs/display-queue';
import { createTestAppRuntime } from './runtime-test-harness';
import type { createConfigFixture } from './config-fixture';

type FixtureOverrides = NonNullable<Parameters<typeof createConfigFixture>[0]>;
type Overrides = Omit<FixtureOverrides, 'farewell'> & { farewell?: { command?: string; timeout?: number } };

function createFarewellRoutingHarness(overrides: Overrides = {}) {
    const { runtime } = createTestAppRuntime({
        ...overrides,
        general: { messagesEnabled: false, logChatMessages: false, filterOldMessages: false, ...overrides.general },
        commands: {
            'bye-bye-bye': '!bye, vfx bottom green',
            'bye-bye-bye2': '!bye2, vfx bottom green',
            'bye-bye-bye3': '!bye3, vfx bottom green',
            ...overrides.commands,
        },
        farewell: { command: '!bye|!bye2|!bye3, bye|goodbye|cya', timeout: 300, ...overrides.farewell } as unknown as NonNullable<FixtureOverrides['farewell']>,
        twitch: { enabled: false, messagesEnabled: false, farewellsEnabled: true, ...overrides.twitch },
        tiktok: { enabled: false, messagesEnabled: false, farewellsEnabled: true, ...overrides.tiktok },
    });
    const queue = runtime.displayQueue as DisplayQueue;
    return {
        platformEventRouter: runtime.platformEventRouter,
        get queuedItems() { return queue.queue.flatMap(entry => queue.state.isSequence(entry) ? entry.children : [entry]); },
        get queuedSequences() { return queue.queue.flatMap(entry => queue.state.isSequence(entry) ? [entry.children] : []); },
        cleanup: () => runtime.shutdown(),
    };
}

export { createFarewellRoutingHarness };
