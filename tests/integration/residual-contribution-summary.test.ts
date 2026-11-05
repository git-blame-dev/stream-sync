import { afterEach, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import NotificationManager, { type NotificationPreparationResult } from '../../src/notifications/NotificationManager';
import { createDonationSpamDetection, createSpamDetectionConfig } from '../../src/utils/spam-detection';
import { createDisplayQueue } from '../../src/obs/display-queue';
import { createOperatorControlService } from '../../src/services/operator/operator-control-service';
import { createFundingGoalService } from '../../src/services/funding-goal-service';
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
        displayQueue: { addItem: item => { queued.push(item); return [item]; }, getQueueLength: () => queued.length },
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

function createMemoryFs() {
    const files = new Map<string, string>();
    return {
        readFile: async (path: string) => {
            const value = files.get(path);
            if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            return value;
        },
        mkdir: async () => undefined,
        writeFile: async (path: string, data: string) => { files.set(path, data); },
        rename: async (from: string, to: string) => {
            const value = files.get(from);
            if (value !== undefined) {
                files.set(to, value);
                files.delete(from);
            }
        },
        unlink: async (path: string) => { files.delete(path); }
    };
}

async function createRealOwnerHarness(options: {
    maxQueueSize?: number;
    maxIndividualNotifications?: number;
    getVFXConfig?: (commandKey: string, message: string | null) => Promise<unknown> | unknown;
} = {}) {
    useFakeTimers();
    const fs = createMemoryFs();
    const config = createConfigFixture({
        general: { giftsEnabled: true, paypiggiesEnabled: true },
        youtube: { giftsEnabled: true },
        twitch: { giftsEnabled: true },
        tiktok: { giftsEnabled: true },
        obs: { enabled: false, ttsChatEnabled: false, ttsNotificationsEnabled: false },
        displayQueue: { autoProcess: false, maxQueueSize: options.maxQueueSize ?? 100, rowIntervalMs: 0 },
        fundingGoal: { enabled: true, id: 'test-funding', label: 'Test Funding', targetUsd: 100 },
        monetizationValues: {
            tiktokGiftUnitUsd: 0.01,
            twitchBitUsd: 0.01,
            youtubeJewelUsd: 0.01,
            tiktokMembershipUsd: 5,
            twitchMembershipUsd: 5,
            youtubeMembershipUsd: 5
        }
    });
    const operatorControlService = await createOperatorControlService({
        defaults: {
            messagesEnabled: true, commandsEnabled: true, greetingsEnabled: true, farewellsEnabled: true,
            followsEnabled: true, giftsEnabled: true, paypiggiesEnabled: true, raidsEnabled: true, sharesEnabled: true, repostsEnabled: true
        },
        fs
    });
    const funding = await createFundingGoalService({
        config: config.fundingGoal,
        monetizationValuesConfig: config.monetizationValues,
        fiatToUsd: (amount, currency) => currency.trim().toUpperCase() === 'USD' ? amount : null,
        fs
    });
    const eventBus = new EventEmitter();
    const rows: Record<string, unknown>[] = [];
    eventBus.on('display:row', row => { rows.push(row as Record<string, unknown>); });
    const queue = createDisplayQueue(
        { isReady: async () => false, call: async () => ({}) },
        {
            autoProcess: false,
            maxQueueSize: options.maxQueueSize ?? 100,
            rowIntervalMs: 0,
            obs: config.obs,
            ttsChatEnabled: false,
            ttsNotificationsEnabled: false
        },
        { PRIORITY_LEVELS },
        eventBus,
        {
            operatorControls: operatorControlService,
            sourcesManager: { updateTextSource: async () => undefined, clearTextSource: async () => undefined },
            goalsManager: { processDonationGoal: async () => ({ success: true }), processPaypiggyGoal: async () => ({ success: true }), initializeGoalDisplay: async () => undefined } as never,
            delay: async () => undefined,
            notificationDelay: async () => undefined,
            onPresentationStarted: async (item) => {
                if (Array.isArray(item.data.contributions)) {
                    await funding.processPresentedContributions(item.data.contributions);
                }
            }
        }
    );
    const summaries: Promise<NotificationPreparationResult>[] = [];
    const detector = createDonationSpamDetection(createSpamDetectionConfig({
        enabled: true,
        lowValueThreshold: 5,
        detectionWindow: 1,
        maxIndividualNotifications: options.maxIndividualNotifications ?? 1
    }, { logger: noOpLogger }), {
        logger: noOpLogger,
        autoCleanup: false,
        onAggregatedDonation: summary => { summaries.push(manager.handleAggregatedDonation(summary)); }
    });
    detectors.push(detector);
    const manager = new NotificationManager({
        logger: noOpLogger,
        constants: { NOTIFICATION_CONFIGS, PRIORITY_LEVELS },
        eventBus,
        config,
        displayQueue: queue,
        donationSpamDetector: detector,
        ...(options.getVFXConfig ? { vfxCommandService: { getVFXConfig: options.getVFXConfig } } : {})
    });
    const sendGift = (id: string, overrides: Record<string, unknown> = {}, platform = 'youtube') =>
        manager.handleNotification('platform:gift', platform, {
            id,
            timestamp: '2026-01-01T00:00:00.000Z',
            userId: 'test-donor',
            username: 'Test Donor',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 5,
            currency: 'USD',
            ...overrides
        });
    const drain = async () => { await queue.processQueue(); };
    return {
        detector,
        manager,
        queue,
        operatorControlService,
        funding,
        summaries,
        rows,
        sendGift,
        drain
    };
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
        displayQueue: { addItem: item => { queued.push(item); return [item]; }, getQueueLength: () => queued.length },
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

it('admits residual summary through real queue and credits funding only upon presentation without double-crediting replays', async () => {
    const { queue, funding, summaries, rows, sendGift, drain } = await createRealOwnerHarness();
    try {
        expect((await sendGift('test-gift-1')).success).toBe(true);
        expect((await sendGift('test-gift-2')).suppressed).toBe(true);
        expect((await sendGift('test-gift-3')).suppressed).toBe(true);

        advanceTimersByTime(1000);
        const results = await Promise.all(summaries);
        expect(results).toHaveLength(1);
        expect(results[0]).toMatchObject({
            success: true,
            notificationType: 'platform:gift',
            platform: 'youtube'
        });
        expect(queue.getQueueLength()).toBe(2);
        expect(funding.snapshot.currentUsd).toBe(0);

        await drain();
        expect(rows).toHaveLength(2);
        const aggregatedContributions = (rows[1]?.data as Record<string, unknown>)?.contributions as NotificationContribution[];
        expect(aggregatedContributions.map(c => c.data.id)).toEqual(['test-gift-2', 'test-gift-3']);
        expect(funding.snapshot.currentUsd).toBe(15);

        await funding.processPresentedContributions([
            ...(rows[0]?.data as { contributions: NotificationContribution[] }).contributions,
            ...aggregatedContributions
        ]);
        expect(funding.snapshot.currentUsd).toBe(15);
    } finally {
        await queue.stop();
        await funding.dispose();
    }
});

it('declines aggregated summaries on muted, full, and stopped queues without retrying or crediting funding', async () => {
    const muted = await createRealOwnerHarness();
    try {
        expect((await muted.sendGift('test-gift-1')).success).toBe(true);
        expect((await muted.sendGift('test-gift-2')).suppressed).toBe(true);
        await muted.drain();
        expect(muted.funding.snapshot.currentUsd).toBe(5);

        await muted.operatorControlService.setEnabled('giftsEnabled', false);
        advanceTimersByTime(1000);
        const [mutedResult] = await Promise.all(muted.summaries);
        expect(mutedResult).toMatchObject({
            success: false,
            disabled: true,
            reason: 'Display queue declined notification',
            notificationType: 'platform:gift',
            platform: 'youtube'
        });
        expect(Object.values(muted.detector.donationSpamTracker)[0]?.pending).toEqual([]);

        await muted.operatorControlService.setEnabled('giftsEnabled', true);
        advanceTimersByTime(2000);
        await muted.drain();
        expect(muted.rows).toHaveLength(1);
        expect(muted.funding.snapshot.currentUsd).toBe(5);
    } finally {
        await muted.queue.stop();
        await muted.funding.dispose();
    }

    const full = await createRealOwnerHarness({ maxQueueSize: 1 });
    try {
        expect((await full.sendGift('test-gift-1')).success).toBe(true);
        expect((await full.sendGift('test-gift-2')).suppressed).toBe(true);
        expect(full.queue.getQueueLength()).toBe(1);

        advanceTimersByTime(1000);
        const [fullResult] = await Promise.all(full.summaries);
        expect(fullResult).toMatchObject({
            success: false,
            error: 'Display queue error'
        });
        expect(Object.values(full.detector.donationSpamTracker)[0]?.pending).toEqual([]);

        await full.drain();
        expect(full.rows).toHaveLength(1);
        expect(full.funding.snapshot.currentUsd).toBe(5);
    } finally {
        await full.queue.stop();
        await full.funding.dispose();
    }

    const stopped = await createRealOwnerHarness();
    try {
        expect((await stopped.sendGift('test-gift-1')).success).toBe(true);
        expect((await stopped.sendGift('test-gift-2')).suppressed).toBe(true);

        await stopped.queue.stop();
        advanceTimersByTime(1000);
        const [stoppedResult] = await Promise.all(stopped.summaries);
        expect(stoppedResult).toMatchObject({
            success: false,
            error: 'Display queue error'
        });
        expect(Object.values(stopped.detector.donationSpamTracker)[0]?.pending).toEqual([]);
        expect(stopped.funding.snapshot.currentUsd).toBe(0);
    } finally {
        await stopped.funding.dispose();
    }
});

it('isolates concurrent arrivals while aggregated summary preparation is held and queue mutes, fills, or stops before admission', async () => {
    for (const mode of ['muted', 'full', 'stopped'] as const) {
        const vfxEntered = Promise.withResolvers<void>();
        const vfxRelease = Promise.withResolvers<void>();
        let holdNextVfx = false;
        const h = await createRealOwnerHarness({
            maxQueueSize: mode === 'full' ? 1 : 100,
            getVFXConfig: async () => {
                if (holdNextVfx) {
                    holdNextVfx = false;
                    vfxEntered.resolve();
                    await vfxRelease.promise;
                }
                return null;
            }
        });
        try {
            expect((await h.sendGift('test-gift-1')).success).toBe(true);
            expect((await h.sendGift('test-gift-2')).suppressed).toBe(true);
            await h.drain();
            expect(h.funding.snapshot.currentUsd).toBe(5);

            holdNextVfx = true;
            advanceTimersByTime(1000);
            await vfxEntered.promise;
            expect(h.summaries).toHaveLength(1);

            const lateArrival = await h.sendGift('test-gift-late');
            expect(lateArrival.suppressed).toBe(true);

            if (mode === 'muted') {
                await h.operatorControlService.setEnabled('giftsEnabled', false);
            } else if (mode === 'full') {
                expect((await h.sendGift('test-gift-filler', { amount: 10 })).success).toBe(true);
            } else {
                await h.queue.stop();
            }

            vfxRelease.resolve();
            const [firstSummary] = await Promise.all(h.summaries);
            if (mode === 'muted') {
                expect(firstSummary).toMatchObject({
                    success: false,
                    disabled: true,
                    reason: 'Display queue declined notification',
                    notificationType: 'platform:gift',
                    platform: 'youtube'
                });
            } else {
                expect(firstSummary).toMatchObject({
                    success: false,
                    error: 'Display queue error'
                });
            }
            expect(h.funding.snapshot.currentUsd).toBe(5);

            const tracker = Object.values(h.detector.donationSpamTracker)[0];
            expect(tracker?.pending?.map(item => item.contribution?.data.id)).toEqual(['test-gift-late']);

            if (mode === 'muted') {
                await h.operatorControlService.setEnabled('giftsEnabled', true);
                advanceTimersByTime(1000);
                const allSummaries = await Promise.all(h.summaries);
                expect(allSummaries).toHaveLength(2);
                expect(allSummaries[1]).toMatchObject({
                    success: true,
                    notificationType: 'platform:gift',
                    platform: 'youtube'
                });

                await h.drain();
                expect(h.rows).toHaveLength(2);
                const secondContributions = (h.rows[1]?.data as Record<string, unknown>)?.contributions as NotificationContribution[];
                expect(secondContributions.map(c => c.data.id)).toEqual(['test-gift-late']);
                expect(h.funding.snapshot.currentUsd).toBe(10);
            } else if (mode === 'full') {
                await h.drain();
                expect(h.funding.snapshot.currentUsd).toBe(15);
                advanceTimersByTime(1000);
                const allSummaries = await Promise.all(h.summaries);
                expect(allSummaries).toHaveLength(2);
                expect(allSummaries[1]).toMatchObject({
                    success: true,
                    notificationType: 'platform:gift',
                    platform: 'youtube'
                });
                await h.drain();
                expect(h.funding.snapshot.currentUsd).toBe(20);
            }
        } finally {
            await h.queue.stop();
            await h.funding.dispose();
        }
    }
});

it('returns structured failure disposition when aggregated donation transformation throws', async () => {
    const { manager } = harness();
    const invalidSummary = {
        platform: 'tiktok',
        userId: 'test-donor',
        username: 'Test Donor',
        giftTypes: [],
        totalGifts: 0,
        totalCoins: 0,
        message: ''
    };
    const result = await manager.handleAggregatedDonation(invalidSummary);
    expect(result).toMatchObject({
        success: false,
        notificationType: 'platform:gift',
        platform: 'tiktok'
    });
    expect(typeof result.error).toBe('string');
});
