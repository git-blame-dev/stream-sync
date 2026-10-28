import { afterEach, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import NotificationManager from '../../src/notifications/NotificationManager';
import { createDonationSpamDetection, createSpamDetectionConfig } from '../../src/utils/spam-detection';
import { noOpLogger } from '../helpers/mock-factories';
import { createConfigFixture } from '../helpers/config-fixture';
import { useFakeTimers, useRealTimers, advanceTimersByTime } from '../helpers/bun-timers';
import { NOTIFICATION_CONFIGS, PRIORITY_LEVELS } from '../../src/core/constants';
import type { NotificationContribution } from '../../src/notifications/notification-contribution';

const detectors: ReturnType<typeof createDonationSpamDetection>[] = [];
afterEach(() => {
    for (const detector of detectors.splice(0)) detector.destroy();
    useRealTimers();
});

function harness(limit = 2, enabled = true) {
    useFakeTimers();
    const queued: Record<string, unknown>[] = [];
    const summaries: Promise<unknown>[] = [];
    const detector = createDonationSpamDetection(createSpamDetectionConfig({
        enabled, lowValueThreshold: 5, detectionWindow: 1, maxIndividualNotifications: limit
    }, { logger: noOpLogger }), {
        logger: noOpLogger, autoCleanup: false,
        onAggregatedDonation: summary => { summaries.push(manager.handleAggregatedDonation(summary)); }
    });
    detectors.push(detector);
    const manager = new NotificationManager({
        logger: noOpLogger, constants: { NOTIFICATION_CONFIGS, PRIORITY_LEVELS }, eventBus: new EventEmitter(),
        config: createConfigFixture({ general: { giftsEnabled: true, paypiggiesEnabled: true } }),
        obsGoals: { processDonationGoal: () => undefined },
        displayQueue: { addItem: item => { queued.push(item); }, getQueueLength: () => queued.length },
        donationSpamDetector: detector
    });
    let sequence = 0;
    const send = (overrides: Record<string, unknown> = {}, platform = 'tiktok', type = 'platform:gift') => manager.handleNotification(type, platform, {
        id: `test-source-${++sequence}`, timestamp: '2026-01-01T00:00:00.000Z',
        userId: 'test-donor', username: 'Test Donor', giftType: 'Rose', giftCount: 1,
        amount: 5, currency: 'coins', ...overrides
    });
    const flush = async (milliseconds = 1000) => {
        advanceTimersByTime(milliseconds);
        await Promise.all(summaries);
    };
    const payloads = () => queued.map(item => item.data as Record<string, unknown>);
    return { detector, manager, send, flush, queued, payloads };
}

it('admits first two gifts and only their suppressed residual with original replay inputs', async () => {
    useFakeTimers();
    const queued: Record<string, unknown>[] = [];
    const summaries: Promise<unknown>[] = [];
    const detector = createDonationSpamDetection(createSpamDetectionConfig({
        enabled: true, lowValueThreshold: 5, detectionWindow: 1, maxIndividualNotifications: 2
    }, { logger: noOpLogger }), {
        logger: noOpLogger, autoCleanup: false,
        onAggregatedDonation: summary => { summaries.push(manager.handleAggregatedDonation(summary)); }
    });
    const manager = new NotificationManager({
        logger: noOpLogger, constants: { NOTIFICATION_CONFIGS, PRIORITY_LEVELS },
        eventBus: new EventEmitter(),
        config: createConfigFixture({ general: { giftsEnabled: true } }),
        obsGoals: { processDonationGoal: () => undefined },
        displayQueue: { addItem: item => { queued.push(item); }, getQueueLength: () => queued.length },
        donationSpamDetector: detector
    });
    try {
        for (let index = 1; index <= 3; index++) {
            await manager.handleNotification('platform:gift', 'tiktok', {
                id: `test-gift-${index}`, timestamp: '2026-01-01T00:00:00.000Z',
                userId: 'test-donor', username: 'Test Donor', giftType: 'Rose', giftCount: 1,
                amount: 5, currency: 'coins', rawData: { secret: 'test-only-not-retained' }
            });
        }
        advanceTimersByTime(1000);
        await Promise.all(summaries);
        expect(queued.map(item => (item.data as Record<string, unknown>).amount)).toEqual([5, 5, 5]);
        const data = queued[2]?.data as Record<string, unknown>;
        expect(data.contributions).toEqual([{ platform: 'tiktok', type: 'platform:gift', data: {
            id: 'test-gift-3', timestamp: '2026-01-01T00:00:00.000Z', userId: 'test-donor',
            giftType: 'Rose', giftCount: 1, amount: 5, currency: 'coins'
        } }]);
        expect(Object.isFrozen(data.contributions)).toBe(true);
    } finally { detector.destroy(); }
});

it('uses authoritative totals for unequal multi-count sources, threshold and limit+1', async () => {
    const { send, flush, payloads } = harness(1);
    await send({ amount: 10, giftCount: 2 }); // unit threshold inclusive; first admitted
    await send({ amount: 12, giftCount: 3 });
    await send({ amount: 8, giftCount: 2 });
    await send({ amount: 6, giftCount: 1 }); // high value bypass
    await flush();
    expect(payloads().map(data => [data.amount, data.giftCount])).toEqual([[10, 2], [6, 1], [20, 5]]);
    const contributions = payloads()[2]?.contributions as { data: Record<string, unknown> }[];
    expect(contributions.map(source => source.data.amount)).toEqual([12, 8]);
});

it('keeps first-N per donor/platform but emits separate incompatible-currency residuals', async () => {
    const { send, flush, payloads } = harness(1);
    await send({ currency: 'USD', amount: 1 }, 'youtube');
    await send({ currency: 'EUR', amount: 2 }, 'youtube');
    await send({ currency: 'USD', amount: 3 }, 'youtube');
    await send({ currency: 'bits', amount: 4 }, 'twitch');
    await send({ currency: 'bits', amount: 5 }, 'twitch');
    await flush();
    expect(payloads().map(data => [data.amount, data.currency])).toEqual([
        [1, 'USD'], [4, 'bits'], [2, 'EUR'], [3, 'USD'], [5, 'bits']
    ]);
});

it('flush does not clear still-relevant rolling admission history at the inclusive window boundary', async () => {
    const { send, flush, payloads } = harness(1);
    await send();
    await send();
    await flush();
    const boundary = await send({ amount: 4 });
    expect(boundary.suppressed).toBe(true);
    await flush(1001);
    expect((await send({ amount: 3 })).success).toBe(true);
    await flush(999);
    expect(payloads().map(data => data.amount)).toEqual([5, 5, 4, 3]);
});

it('pruning and forced cleanup retain pending residuals until their timer, not stale history', async () => {
    const { detector, send, flush, payloads } = harness(1);
    await send();
    await flush(900);
    await send({ amount: 4 });
    await flush(101);
    expect((await send({ amount: 3 })).suppressed).toBe(true); // only first arrival expired
    detector.cleanupSpamDetection(true);
    await flush(899);
    expect(payloads().map(data => data.amount)).toEqual([5, 7]);
    detector.cleanupSpamDetection(true);
    expect(detector.getStatistics().trackedUsers).toBe(0);
});

it('destroy discards pending unshown summaries, does not publish or reopen admission', async () => {
    const { detector, send, flush, queued } = harness(0);
    await send();
    detector.destroy();
    detector.destroy();
    await flush(5000);
    expect(queued).toHaveLength(0);
    expect((await send()).suppressed).toBe(true);
});

it('preserves upstream aggregate, anonymous, unstable, error and disabled bypasses', async () => {
    const { send, flush, payloads } = harness(0);
    await send({ isAggregated: true, giftCount: 3, amount: 15 });
    await send({ isAnonymous: true });
    await send({ userId: undefined });
    await send({ isError: true });
    await flush();
    expect(payloads()).toHaveLength(4);
    expect(payloads()[0]?.amount).toBe(15);
});

it('does not track sources while spam detection is disabled', async () => {
    const { detector, send, flush, payloads } = harness(0, false);
    await send();
    await send();
    await flush();
    expect(payloads()).toHaveLength(2);
    expect(detector.getStatistics().trackedUsers).toBe(0);
});

it('captures ordinary membership and no-id replay inputs exactly without generated fallback keys or raw payloads', async () => {
    const { send, payloads } = harness();
    await send({ id: undefined, userId: 123, tier: 'test-tier', months: 2, membershipLevel: 'test-level',
        isRenewal: true, rawData: { omitted: true }, message: 'test message not needed' }, 'twitch', 'platform:paypiggy');
    const sources = payloads()[0]?.contributions as NotificationContribution[];
    expect(sources).toEqual([{ platform: 'twitch', type: 'platform:paypiggy', data: {
        timestamp: '2026-01-01T00:00:00.000Z', userId: 123, tier: 'test-tier', months: 2,
        membershipLevel: 'test-level', isRenewal: true, giftType: 'Rose', giftCount: 1, amount: 5, currency: 'coins'
    } }]);
    expect(Object.isFrozen(sources[0]?.data)).toBe(true);
});
