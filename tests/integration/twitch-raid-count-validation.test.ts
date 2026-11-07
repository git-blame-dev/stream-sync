import { expect, test } from 'bun:test';
import { createTwitchEventFactory } from '../../src/platforms/twitch/events/event-factory';
import { createTwitchEventSubEventRouter } from '../../src/platforms/twitch/events/event-router';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { noOpLogger } from '../helpers/mock-factories';

const identity = {
    username: 'SyntheticRaider',
    userId: 'synthetic-raid-user',
    timestamp: '2026-01-01T00:00:00.000Z',
};
const invalidCounts = [-3, 1.5, Infinity, -Infinity, NaN, '3', '0', '', null, undefined];

for (const viewerCount of invalidCounts) {
    test(`Twitch raid factory rejects invalid count ${String(viewerCount)} and recovers`, () => {
        const factory = createTwitchEventFactory();
        expect(() => factory.createRaidEvent({ ...identity, viewerCount }))
            .toThrow('Twitch raid payload requires non-negative integer viewerCount');
        for (const validCount of [0, 1, 12]) {
            expect(factory.createRaidEvent({ ...identity, viewerCount: validCount }))
                .toMatchObject({ type: 'platform:raid', ...identity, viewerCount: validCount });
        }
    });
}

test('raw Twitch raid normalization rejects malformed counts before real root admission and recovers', async () => {
    const h = await createMainPresentationFixture();
    h.config.logging.file.enabled = false;
    h.config.general.raidsEnabled = true;
    const factory = createTwitchEventFactory();
    const routing: Promise<void>[] = [];
    const normalized: Record<string, unknown>[] = [];
    const router = createTwitchEventSubEventRouter({
        logger: noOpLogger,
        emit(type, payload) {
            expect(type).toBe('raid');
            const event = factory.createRaidEvent(payload as Record<string, unknown>);
            normalized.push(event);
            routing.push(h.runtime.platformEventRouter.routeEvent({ platform: 'twitch', type: event.type, data: event }));
        },
    });
    const send = (viewers: unknown) => router.handleNotificationEvent('channel.raid', {
        from_broadcaster_user_name: identity.username,
        from_broadcaster_user_id: identity.userId,
        viewers,
    }, { message_timestamp: identity.timestamp });

    try {
        await h.start();
        for (const count of invalidCounts) send(count);
        await Promise.all(routing);
        expect(normalized).toHaveLength(0);
        expect(h.queue.getQueueLength()).toBe(0);

        for (const count of [0, 1, 12]) send(count);
        await Promise.all(routing);
        expect(normalized.map(event => event.viewerCount)).toEqual([0, 1, 12]);
        expect(h.queue.getQueueLength()).toBe(3);
        await h.drain();
        expect(h.rows.map(row => row.data.displayMessage)).toEqual([
            'Incoming raid from SyntheticRaider with 0 viewers!',
            'Incoming raid from SyntheticRaider with 1 viewer!',
            'Incoming raid from SyntheticRaider with 12 viewers!',
        ]);
    } finally {
        await h.dispose();
    }
});
