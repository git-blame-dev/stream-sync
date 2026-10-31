import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import type { createOBSGoalsManager } from '../../src/obs/goals';
import { flushConnectorSetup } from '../helpers/tiktok-connector-fixture';
import { createTikTokLifetimeFixture } from '../helpers/tiktok-connector-fixture';
import * as testClock from '../helpers/test-clock';

const fixtures: ReturnType<typeof createTikTokLifetimeFixture>[] = [];
const epoch = 1700000000000;
beforeEach(() => { testClock.set(epoch); });
afterEach(async () => {
    while (fixtures.length) await fixtures.pop()!.cleanup();
    testClock.useRealTime();
});

function setup() {
    let elapsed = 0;
    const fixture = createTikTokLifetimeFixture({ dataLoggingPath: "/synthetic", envFileReadEnabled: false, envFileWriteEnabled: false }, () => elapsed);
    fixtures.push(fixture);
    const { platform } = fixture;
    const connection = fixture.createConnection();
    platform.connection = connection;
    platform.connectionTime = epoch;
    platform.setupEventListeners();
    const events: { type: string; data: Record<string, unknown> }[] = [];
    platform.on('platform:event', event => events.push(event));
    const deliver = async (type: string, data: Record<string, unknown>) => {
        const handlers = connection.listeners(type);
        expect(handlers).toHaveLength(1);
        await Promise.all(handlers.map(handler => handler(data)));
    };
    return { platform, connection, events, deliver, advance(ms: number) { elapsed += ms; testClock.advance(ms); } };
}
function membership(id: string, user = 'synthetic-member', time = epoch): Record<string, unknown> {
    return { user: { uniqueId: user, nickname: 'Synthetic Member' }, common: { msgId: id, createTime: time } };
}

test.each([
    { msgType: 8 }, { msgType: '9' }, { msgType: 10 }, { msgType: 11 },
    { subType: 'SUPER_FAN_UPGRADE' }, { subType: 'fans_entrance' },
    { content: { key: 'ttlive_superFan_commentNotif_superFanJoined' } },
    { commonBarrageContent: { displayType: 'ttlive_superfan_fans_upgrade' } },
    { displayText: { defaultPattern: 'Super Fan {0:user} joined' } },
])('ignores non-purchase Super Fan barrage %j', async fields => {
    const { events, deliver } = setup();
    await deliver('superfan', { ...membership('synthetic-entry'), ...fields });
    expect(events).toHaveLength(0);
});

test.each(['subscribe', 'superfan', 'envelope'])('%s drops stale and duplicate message deliveries', async type => {
    const { events, deliver, advance } = setup();
    const data = { ...membership('synthetic-current'), amount: 1, currency: 'coins' };
    await deliver(type, { ...data, common: { msgId: 'synthetic-stale', createTime: epoch - 1000 } });
    expect(events).toHaveLength(0);
    await Promise.all([deliver(type, data), deliver(type, data)]);
    expect(events).toHaveLength(1);
    advance(60_000);
    await deliver(type, { ...data, common: { msgId: 'synthetic-next', createTime: epoch + 60_000 } });
    expect(events).toHaveLength(2);
});

test.each([['subscribe', 'superfan'], ['superfan', 'subscribe']])('collapses concurrent %s and %s aliases for one actor', async (first, second) => {
    const { events, deliver, advance } = setup();
    await Promise.all([deliver(first, membership('synthetic-one')), deliver(second, membership('synthetic-two'))]);
    expect(events).toHaveLength(1);
    await deliver(second, membership('synthetic-other', 'synthetic-other-member'));
    expect(events).toHaveLength(2);
    advance(60_000);
    await deliver(second, membership('synthetic-renewal', 'synthetic-member', epoch + 60_000));
    expect(events).toHaveLength(3);
});

test('logs routed chat and membership payloads once per incoming delivery', async () => {
    const { platform, deliver } = setup();
    const writes: unknown[][] = [];
    platform.config.dataLoggingEnabled = true;
    platform.rawPlatformDataLoggingService.rawEventLogWriter = {
        resolveLogFileName: () => 'synthetic-events.ndjson',
        writeRawEvent: async (...args: unknown[]) => {
            writes.push(args);
            return { fileName: 'synthetic-events.ndjson', filePath: '/synthetic/synthetic-events.ndjson' };
        },
    };
    await deliver('subscribe', membership('synthetic-sub'));
    await deliver('chat', { ...membership('synthetic-chat'), comment: 'synthetic hello' });
    expect(writes).toHaveLength(2);
});

test('SDK room entries create no speech row or goal credit; a purchase and its alias create one', async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    Object.assign(h.config.goals, { tiktokGoalEnabled: true, tiktokGoalSource: 'synthetic-member-goal',
        tiktokGoalTarget: 1000, tiktokGoalCurrency: 'coins' });
    Object.assign(h.config.monetizationValues, { tiktokMembershipUsd: 4.2, tiktokGiftUnitUsd: 0.01 });
    const { platform, connection: client } = setup();
    const fixture = fixtures.at(-1)!;
    const routed: Promise<unknown>[] = [];
    try {
        await h.start();
        platform.on('platform:event', event => { routed.push(h.runtime.platformEventRouter.routeEvent(event)); });
        const pending = client.connect();
        await flushConnectorSetup();
        const sdk = fixture.connectors[0]!;
        sdk.open();
        sdk.enter();
        await pending;
        const entrance = { user: { displayId: 'synthetic-member', nickname: 'Synthetic Member' },
            common: { msgId: 'synthetic-entry-one', createTime: epoch }, msgType: 11,
            content: { key: 'ttlive_superFan_commentNotif_superFanJoined' } };
        sdk.emit('superFanJoin', entrance);
        sdk.emit('superFanJoin', { ...entrance, common: { msgId: 'synthetic-entry-two', createTime: epoch } });
        sdk.emit('superFan', entrance);
        await flushConnectorSetup();
        await Promise.all(routed);
        await h.drain();
        const goals = h.runtime.dependencies.obs?.goalsManager as ReturnType<typeof createOBSGoalsManager>;
        expect(h.rows).toHaveLength(0);
        expect(goals.getCurrentGoalStatus('tiktok')?.current).toBe(0);
        sdk.emit('superFan', { user: entrance.user, common: { msgId: 'synthetic-purchase', createTime: epoch }, msgType: 4 });
        sdk.emit('subNotify', { user: entrance.user, common: { msgId: 'synthetic-alias', createTime: epoch }, subMonth: 1 });
        await flushConnectorSetup();
        await Promise.all(routed);
        await h.drain();
        expect(h.rows).toHaveLength(1);
        const row = h.rows[0]!;
        expect('data' in row && row.data.ttsMessage).toBe('Synthetic Member became a SuperFan');
        expect(goals.getCurrentGoalStatus('tiktok')?.current).toBe(420);
    } finally {
        await h.dispose();
    }
});

test('membership actor protection survives listener replacement and expires without sliding', async () => {
    const { platform, events, deliver, advance } = setup();
    await deliver('superfan', membership('synthetic-original'));
    advance(30_000);
    platform.cleanupEventListeners();
    platform.connectionTime = epoch + 30_000;
    platform.setupEventListeners();
    await deliver('subscribe', membership('synthetic-reconnect-alias', 'synthetic-member', epoch + 30_000));
    expect(events).toHaveLength(1);
    advance(30_000);
    await deliver('superfan', membership('synthetic-next-purchase', 'synthetic-member', epoch + 60_000));
    expect(events).toHaveLength(2);
});

test('invalid membership timestamp does not consume the cooldown for a valid alias', async () => {
    const { events, deliver } = setup();
    await deliver('subscribe', { ...membership('synthetic-invalid-time'), common: { msgId: 'synthetic-invalid-time', createTime: 'invalid' } });
    await deliver('superfan', membership('synthetic-valid-alias'));
    expect(events.filter(event => event.data.timestamp === new Date(epoch).toISOString())).toHaveLength(1);
});
