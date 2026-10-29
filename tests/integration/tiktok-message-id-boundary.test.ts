import { afterEach, describe, expect, it } from 'bun:test';

import { createTikTokGiftNotificationFixture } from '../helpers/avatar-source-matrix-fixtures';
import { createTikTokLifetimeFixture } from '../helpers/tiktok-connector-fixture';

type TikTokLifetimeFixture = ReturnType<typeof createTikTokLifetimeFixture>;

const activeFixtures: TikTokLifetimeFixture[] = [];

function createPlatform() {
    const fixture = createTikTokLifetimeFixture({
        enabled: true,
        username: 'test-id-boundary-channel',
        giftAggregationEnabled: false,
        dataLoggingEnabled: false,
        dataLoggingPath: '',
        envFileReadEnabled: false,
        envFileWriteEnabled: false
    });
    activeFixtures.push(fixture);
    const { platform } = fixture;
    const gifts: Array<Record<string, unknown>> = [];
    platform.on('platform:event', (event) => {
        if (event.type === 'platform:gift') gifts.push(event.data);
    });
    return { platform, gifts };
}

describe('TikTok root message-ID boundary', () => {
    afterEach(async () => {
        while (activeFixtures.length > 0) {
            const fixture = activeFixtures.pop();
            if (fixture) {
                await fixture.cleanup();
            }
        }
    });

    it('does not coerce invalid common IDs or insert them into the duplicate bucket', () => {
        const { platform } = createPlatform();
        const invalidIds: unknown[] = [{}, true, false, '   ', [], NaN, Infinity, null, undefined,
            { toString() { throw new Error('synthetic object ID must not be coerced'); } }];
        for (const msgId of invalidIds) {
            const payload = { common: { msgId } };
            expect(platform._getPlatformMessageId(payload)).toBeNull();
            expect(platform._shouldSkipDuplicatePlatformMessage(payload).isDuplicate).toBe(false);
            expect(platform._shouldSkipDuplicatePlatformMessage(payload).isDuplicate).toBe(false);
        }
        expect(platform.recentPlatformMessageIds.size).toBe(0);
    });

    it('lets the real gift factory fall back to canonical IDs when injected common IDs are invalid', async () => {
        const { platform, gifts } = createPlatform();
        for (const msgId of [{}, true, '   ']) {
            const id = `test-canonical-gift-${gifts.length}`;
            await platform._handleGift({
                common: { msgId }, id, userId: 'test-gift-id', username: 'test-gift-viewer',
                giftType: 'Test Rose', giftCount: 1, amount: 1, unitAmount: 1, currency: 'coins',
                timestamp: '2024-01-01T00:00:00.000Z'
            });
            expect(gifts.at(-1)?.id).toBe(id);
            expect(gifts.at(-1)?.isError).not.toBe(true);
        }
        expect(gifts).toHaveLength(3);
    });

    it('lets real raw-gift normalization fall back to a native scalar ID', async () => {
        const { platform, gifts } = createPlatform();
        for (const msgId of [{}, false, '   ']) {
            const raw = createTikTokGiftNotificationFixture();
            const nativeId = `test-native-gift-${gifts.length}`;
            await platform.handleTikTokGift({ ...raw, msgId: nativeId, common: { ...raw.common, msgId } });
            expect(gifts.at(-1)?.id).toBe(nativeId);
            expect(gifts.at(-1)?.isError).not.toBe(true);
        }
        expect(gifts).toHaveLength(3);
    });

    it('preserves valid injected common-ID precedence for string and finite numeric IDs', async () => {
        const { platform, gifts } = createPlatform();
        for (const msgId of ['  test-injected-id  ', 42, 0]) {
            const expected = String(msgId).trim();
            const raw = createTikTokGiftNotificationFixture();
            await platform.handleTikTokGift({
                ...raw, id: 'test-other-canonical-id', msgId: 'test-other-native-id', common: { ...raw.common, msgId }
            });
            expect(gifts.at(-1)?.id).toBe(expected);
            expect(gifts.at(-1)?.isError).not.toBe(true);
        }
        expect(gifts).toHaveLength(3);
    });
});
