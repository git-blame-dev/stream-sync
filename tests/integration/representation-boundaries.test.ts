import { describe, expect, test } from 'bun:test';
import { resolveTikTokTimestampISO, resolveTikTokTimestampMs } from '../../src/utils/platform-timestamp';
import { normalizeTikTokMessage } from '../../src/utils/message-normalization';
import { normalizeTikTokGiftEvent } from '../../src/platforms/tiktok/events/event-normalizer';
import { GoalTracker } from '../../src/utils/goal-tracker';
import { NotificationBuilder } from '../../src/utils/notification-builder';
import { createYouTubeMonetizationParser } from '../../src/platforms/youtube/monetization/monetization-parser';
import { createEventToGuiContractMapper } from '../../src/services/gui/event-to-gui-contract-mapper';
import { createGuiFeedStore } from '../../gui/src/shared/feed-store';
import { createOBSGoalsManager } from '../../src/obs/goals';
import { createOBSSourcesManager } from '../../src/obs/sources';
import { DisplayQueueEffects } from '../../src/obs/display-queue-effects';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';

const timestamp = '2023-11-14T22:13:20.000Z';
const mapper = (limit: number) => createEventToGuiContractMapper({
    config: { gui: { messageCharacterLimit: limit, showMessages: true, showFollows: true, showGifts: true, showPaypiggies: true } },
    fallbackAvatarUrl: 'https://example.invalid/synthetic-avatar.png'
});
const build = (username: string, type = 'platform:follow') => {
    const result = NotificationBuilder.build({ type, platform: 'tiktok', username, userId: 'synthetic-viewer',
        amount: 1, currency: 'coins', giftCount: 1, giftType: 'Synthetic Rose' });
    if (!result || typeof result.displayMessage !== 'string') throw new Error('Expected synthetic notification');
    return { ...result, displayMessage: result.displayMessage };
};

describe('representation boundaries through productive owners', () => {
    test('skips unrepresentable TikTok candidates before precedence selection in real normalizers', () => {
        for (const primary of [Number.MAX_VALUE, String(Number.MAX_VALUE), Infinity, NaN, 0, 'malformed']) {
            const payload = { common: { msgId: 'synthetic-gift-id', createTime: primary, clientSendTime: 1_700_000_000 },
                timestamp: '2024-01-01T00:00:00.000Z', comment: 'synthetic chat',
                user: { userId: 'synthetic-id', uniqueId: 'synthetic-viewer', nickname: 'Synthetic Viewer' },
                giftDetails: { giftName: 'Synthetic Rose', diamondCount: 1, giftType: 0 }, repeatCount: 1 };
            expect(resolveTikTokTimestampMs(payload)).toBe(1_700_000_000_000);
            expect(resolveTikTokTimestampISO(payload)).toBe(timestamp);
            expect(normalizeTikTokMessage(payload).timestamp).toBe(timestamp);
            expect(normalizeTikTokGiftEvent(payload).timestamp).toBe(timestamp);
        }
        expect(resolveTikTokTimestampISO({ common: { createTime: Number.MAX_VALUE, clientSendTime: Number.MAX_VALUE }, timestamp })).toBe(timestamp);
        const invalid = { common: { createTime: Number.MAX_VALUE, clientSendTime: String(Number.MAX_VALUE) }, timestamp: Number.MAX_VALUE };
        expect(resolveTikTokTimestampMs(invalid)).toBeNull();
        expect(resolveTikTokTimestampISO(invalid)).toBeNull();
    });

    test('rejects overflowing cumulative native totals atomically while allowing later contributions', () => {
        const tracker = new GoalTracker({ config: { goals: {} } });
        expect(tracker.addDonationToGoal('youtube', 1e308, 'USD').success).toBe(true);
        expect(tracker.addDonationToGoal('youtube', 1e308, 'USD').success).toBe(false);
        expect(tracker.getGoalState('youtube')?.current).toBe(1e308);
        expect(tracker.addDonationToGoal('youtube', 1e307, 'USD').success).toBe(true);
        expect(tracker.getGoalState('youtube')?.current).toBe(1.1e308);
    });

    test('real native accounting rejection reaches effects once, retaining fractional and over-target credit', async () => {
        const goalsConfig = { enabled: true, youtubeGoalEnabled: true, youtubeGoalTarget: 10,
            youtubeGoalCurrency: 'USD', youtubeGoalSource: 'synthetic-goal', tiktokGoalEnabled: true };
        const tracker = new GoalTracker({ config: { goals: goalsConfig, monetizationValues: {
            tiktokMembershipUsd: 1, tiktokGiftUnitUsd: 0.3, twitchBitUsd: 0.01,
            youtubeJewelUsd: 0.01, twitchMembershipUsd: 3.5, youtubeMembershipUsd: 3.89
        } }, usdConverter: amount => amount / 2 });
        const obs = { isConnected: () => false, isReady: async () => false,
            ensureConnected: async () => {}, call: async () => ({}) };
        const sources = createOBSSourcesManager(obs);
        const goals = createOBSGoalsManager(obs, {
            config: { goals: goalsConfig }, goalTracker: tracker, updateTextSource: sources.updateTextSource
        });
        await goals.initializeGoalDisplay();
        expect(tracker.addPaypiggyToGoal('tiktok').newTotal).toBe(1 / 0.3);
        expect((await goals.processDonationGoal('youtube', 50, 'EUR')).newTotal).toBe(25);
        expect(tracker.addDonationToGoal('youtube', 1e308, 'USD').success).toBe(true);
        const effects = new DisplayQueueEffects({
            obsManager: obs,
            sourcesManager: sources,
            goalsManager: goals, config: { obs: {} }, delay: async () => {},
            handleDisplayQueueError: () => {}, extractUsername: () => 'Synthetic Viewer'
        });
        try {
            const item: DisplayQueueItem = { type: 'platform:gift', platform: 'youtube', data: {
                username: 'Synthetic Viewer', amount: 1e308, currency: 'USD', giftCount: 1
            } };
            await effects.processMonetizationGoal(item);
            expect(item.data.goalOutcome).toBe('not-applied');
            expect(item.data.goalProcessed).toBeUndefined();
            expect(tracker.getGoalState('youtube')?.current).toBe(1e308);
            tracker.initializeGoalTracker();
            await effects.processMonetizationGoal(item);
            expect(tracker.getGoalState('youtube')?.current).toBe(0);
            const ordinary: DisplayQueueItem = { type: 'platform:gift', platform: 'youtube', data: {
                amount: 0.25, currency: 'USD', giftCount: 1
            } };
            await effects.processMonetizationGoal(ordinary);
            expect(ordinary.data.goalOutcome).toBe('applied');
            expect(tracker.getGoalState('youtube')?.current).toBe(0.25);
        } finally {
            await effects.dispose();
        }
    });

    test('carries speech hundredths before choosing singular names and keeps parser/display precision', () => {
        const expected = new Map([[0.994, '0 US dollars 99'], [0.995, '1 US dollar'], [0.999, '1 US dollar'],
            [1.999, '2 US dollars'], [1.99, '1 US dollars 99'], [1, '1 US dollar']]);
        for (const [amount, speech] of expected) {
            expect(NotificationBuilder.formatCurrencyForTts(amount, 'USD')).toBe(speech);
        }
        expect(NotificationBuilder.formatCurrencyForTts(Number.MAX_VALUE, 'USD')).not.toContain('Infinity');
        for (const amount of [NaN, Infinity, '1.999']) expect(() => NotificationBuilder.formatCurrencyForTts(amount, 'USD')).toThrow();
        const parsed = createYouTubeMonetizationParser().parseSuperChat({ item: {
            id: 'synthetic-chat', timestamp, purchase_amount: 1.999, purchase_currency: 'USD', message: 'synthetic thanks'
        } });
        expect(parsed.amount).toBe(1.999);
        const result = NotificationBuilder.build({ ...parsed, platform: 'youtube', type: 'platform:gift',
            username: 'Synthetic Viewer', userId: 'synthetic-viewer' });
        expect(result?.displayMessage).toBe('Synthetic Viewer sent a $2.00 Super Chat');
        expect(result?.ttsMessage).toBe('Synthetic Viewer sent a 2 US dollars Super Chat');
    });

    test('keeps UTF16 GUI budgets without splitting pairs, preserving rich parts and unlimited mode', async () => {
        for (const type of ['chat', 'platform:follow']) {
            for (const [limit, text] of [[0, 'A😀B'], [1, 'A'], [2, 'A'], [3, 'A😀'], [4, 'A😀B']] as const) {
                const row = await mapper(limit).mapDisplayRow({ type, platform: 'tiktok',
                    data: { username: 'Synthetic Viewer', message: '  A😀B  ', displayMessage: '  A😀B  ' } });
                expect(row?.text).toBe(text);
                const feed = createGuiFeedStore();
                expect(feed.pushEvent(row)?.text).toBe(text);
            }
        }
        const parts = [{ type: 'text' as const, text: 'A😀B' }];
        const rich = await mapper(2).mapDisplayRow({ type: 'chat', platform: 'youtube',
            data: { username: 'Synthetic Viewer', message: { text: 'A😀B', parts } } });
        expect(rich?.text).toBe('A');
        expect(rich?.parts).toEqual(parts);
        expect((await mapper(1).mapDisplayRow({ type: 'chat', platform: 'tiktok', data: { message: '😀B' } }))?.text).toBe('');
    });

    test('safe username prefixes propagate through real follow, membership and gift builders into the feed', async () => {
        const username = 'a'.repeat(36) + '😀' + 'bbbb';
        for (const type of ['platform:follow', 'platform:paypiggy', 'platform:gift']) {
            const notification = build(username, type);
            expect(notification.displayMessage).toContain('a'.repeat(36) + '...');
            expect(notification.displayMessage).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
            const row = await mapper(0).mapDisplayRow({ type, platform: 'tiktok', data: notification });
            expect(createGuiFeedStore().pushEvent(row)?.text).toEqual(notification.displayMessage);
        }
        for (const marker of ['测试', 'テスト', '🌸']) {
            const prefix = marker + 'a'.repeat(66 - marker.length);
            expect(NotificationBuilder.getTruncatedUsername(prefix + '😀bbbb')).toBe(prefix + '...');
            const exact = marker + 'a'.repeat(70 - marker.length);
            expect(NotificationBuilder.getTruncatedUsername(exact)).toBe(exact);
            expect(NotificationBuilder.getTruncatedUsername(exact + 'b')).toBe(exact.substring(0, 67) + '...');
        }
        expect(NotificationBuilder.getTruncatedUsername('a'.repeat(40))).toBe('a'.repeat(40));
        expect(NotificationBuilder.getTruncatedUsername('a'.repeat(41))).toBe('a'.repeat(37) + '...');
        for (const limit of [-1, 0, 1, 2, 3]) expect(NotificationBuilder.getTruncatedUsername('abcdef', limit)).toBe('...');
        expect(NotificationBuilder.getTruncatedUsername('abc😀tail', 8)).toBe('abc😀...');
        expect(NotificationBuilder.getTruncatedUsername('abc😀tail', 7)).toBe('abc...');
        expect(NotificationBuilder.getTruncatedUsername('ab测试', 1)).toBe('ab测试');
    });
});
