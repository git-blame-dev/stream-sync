import { describe, expect, it } from 'bun:test';

import * as platformData from './platform-test-data';
import * as tiktokData from './tiktok-test-data';
import * as twitchData from './twitch-test-data';
import * as youtubeData from './youtube-test-data';

describe('platform fixture helper behavior', () => {
    it('builds TikTok gift events with configured gift metadata and deep override merging', () => {
        const event = tiktokData.createTikTokGiftEvent('TikTok Universe', 2, {
            user: { uniqueId: 'custom-user' },
            gift: { describe: 'custom description' }
        });

        expect(event.gift.giftName).toBe('TikTok Universe');
        expect(event.gift.repeatCount).toBe(2);
        expect(event.gift.diamondCount).toBe(34999);
        expect(event.user.uniqueId).toBe('custom-user');
        expect(event.gift.describe).toBe('custom description');
    });

    it('builds TikTok follow, chat, share, viewer-count, and connection events', () => {
        const follow = tiktokData.createTikTokFollowEvent();
        const chat = tiktokData.createTikTokChatEvent('hello tiktok');
        const share = tiktokData.createTikTokShareEvent();
        const viewers = tiktokData.createTikTokViewerCountEvent(321);
        const connected = tiktokData.createTikTokConnectionEvent('connected');
        const disconnected = tiktokData.createTikTokConnectionEvent('disconnected');

        expect(follow.label).toContain('followed');
        expect(chat.comment).toBe('hello tiktok');
        expect(share.label).toContain('shared');
        expect(viewers.viewerCount).toBe(321);
        expect(connected.roomInfo.roomId.length).toBeGreaterThan(0);
        expect(disconnected.roomInfo).toBeUndefined();
    });

    it('builds TikTok batch, spam, and conversation scenarios', () => {
        const batch = tiktokData.createTikTokGiftEventBatch(3, { userId: 'batch-user' });
        const spam = tiktokData.createTikTokSpamGiftScenario(6, 'Rose', 2400);
        const conversation = tiktokData.createTikTokChatConversation(['a', 'b', 'c'], ['u1', 'u2']);

        expect(batch).toHaveLength(3);
        expect(batch.every((entry) => entry.user.userId === 'batch-user')).toBe(true);
        expect(spam.events).toHaveLength(6);
        expect(spam.metadata.giftCount).toBe(6);
        expect(spam.metadata.averageInterval).toBe(400);
        expect(conversation).toHaveLength(3);
        expect(conversation[1].user.uniqueId).toBe('u2');
    });

    it('builds Twitch event envelopes and message fixtures for follow, subscription, and raids', () => {
        const chat = twitchData.createTwitchChatEvent('Hello Twitch!', 'Viewer');
        const follow = twitchData.createTwitchFollowEvent();
        const giftedSub = twitchData.createTwitchSubscriptionEvent('2000', true);
        const raid = twitchData.createTwitchRaidEvent(77);
        const chatMessage = twitchData.createTwitchEventSubChatMessageEvent({ color: '#FFFFFF' });

        expect(chat.message).toBe('Hello Twitch!');
        expect(chat.userInfo.displayName).toBe('Viewer');
        expect(follow.subscription.type).toBe('channel.follow');
        expect(giftedSub.event.is_gift).toBe(true);
        expect(giftedSub.event.gifter_user_name.length).toBeGreaterThan(0);
        expect(raid.event.viewers).toBe(77);
        expect(chatMessage.color).toBe('#FFFFFF');
        expect(chatMessage.message.fragments.length).toBeGreaterThan(1);
    });

    it('provides deterministic Twitch helper utilities when seeds are provided', () => {
        expect(twitchData.generateRandomHexColor(12345)).toBe(twitchData.generateRandomHexColor(12345));
        expect(twitchData.generateUUID(99)).toBe('00000000-0000-4000-8000-000000000063');

        const merged = twitchData.mergeDeep({ a: { b: 1 }, c: 1 }, { a: { d: 2 }, e: 3 });
        expect(merged).toEqual({ a: { b: 1, d: 2 }, c: 1, e: 3 });
    });

    it('builds YouTube chat events for both call signatures with flattened convenience fields', () => {
        const fromType = youtubeData.createYouTubeChatEvent('emoji', { username: 'ViewerA' });
        const fromOverrides = youtubeData.createYouTubeChatEvent({ messageType: 'text', message: 'custom', userId: 'user-1' });

        expect(fromType.item.type).toBe('LiveChatTextMessage');
        expect(fromType.message).toContain('🎉');
        expect(fromType.username).toBe('ViewerA');

        expect(fromOverrides.message).toBe('custom');
        expect(fromOverrides.userId).toBe('user-1');
        expect(typeof fromOverrides.timestamp).toBe('number');
    });

    it('builds YouTube super chat events for numeric and object call signatures', () => {
        const numeric = youtubeData.createYouTubeSuperChatEvent(5, 'USD');
        const object = youtubeData.createYouTubeSuperChatEvent({ amount: 0, currency: 'JPY' });

        expect(numeric.item.type).toBe('LiveChatPaidMessage');
        expect(numeric.item.purchase_amount).toContain('$5.00');
        expect(object.item.liveChatPaidMessageRenderer.purchaseAmountText.simpleText).toContain('JPY0.00');
    });

    it('builds YouTube runs-message fixtures and deep merge utility behavior', () => {
        const runsMessage = youtubeData.createYouTubeRunsMessageChatItem({
            item: {
                message: {
                    runs: [{ text: 'custom run' }]
                }
            }
        });
        expect(runsMessage.item.message.runs[0].text).toBe('custom run');

        const merged = youtubeData.mergeDeep({ a: { b: 1 }, c: 3 }, { a: { d: 2 }, e: 4 });
        expect(merged).toEqual({ a: { b: 1, d: 2 }, c: 3, e: 4 });
    });

    it('exposes platform synthetic fixtures as cloned values and throws on invalid lookups', () => {
        const fixtureA = platformData.getSyntheticFixture('youtube', 'superchat');
        const fixtureB = platformData.getSyntheticFixture('youtube', 'superchat');

        expect(fixtureA).toEqual(fixtureB);
        fixtureA.item.id = 'mutated-id';
        expect(fixtureB.item.id).not.toBe('mutated-id');

        expect(() => platformData.getSyntheticFixture()).toThrow('Platform and eventType are required');
        expect(() => platformData.getSyntheticFixture('unknown', 'missing')).toThrow('No synthetic fixture found');
    });

    it('provides fixture sets and load alias for common platform events', () => {
        const fixtureSet = platformData.getSyntheticFixtureSet();
        const alias = platformData.loadPlatformFixture('tiktok', 'gift-event');

        expect(fixtureSet.twitch.chatMessage.message.text).toContain('Test Twitch chat');
        expect(fixtureSet.youtube.superchat.item.type).toBe('LiveChatPaidMessage');
        expect(alias.giftDetails.giftName.length).toBeGreaterThan(0);
    });

    it('builds multi-platform, spam, raid, and error scenarios with stable metadata contracts', () => {
        const multiPlatform = platformData.createMultiPlatformEventScenario(['youtube', 'twitch', 'tiktok'], 6);
        const spam = platformData.createGiftSpamScenario(5, 'Rose', 2000);
        const raid = platformData.createRaidScenario(200, 'target-channel');
        const malformed = platformData.createErrorScenario('malformed_data', 'youtube');
        const fallback = platformData.createErrorScenario('unknown', 'twitch');

        expect(multiPlatform.events).toHaveLength(6);
        expect(multiPlatform.metadata.platformDistribution.youtube).toBe(2);
        expect(spam.metadata.detectionTrigger).toBe(true);
        expect(raid.metadata.maxViewers).toBe(200);
        expect(malformed.testData).toContain('LiveChat');
        expect(fallback.errorType).toBe('unknown');
        expect(fallback.expectedBehavior).toContain('Retry');
    });

    it('builds international and boundary test suites and exposes script-language detectors', () => {
        const international = platformData.createInternationalUserScenario(6);
        const boundary = platformData.createBoundaryTestSuite('youtube');

        expect(international.users).toHaveLength(6);
        expect(international.events).toHaveLength(6);
        expect(boundary.platform).toBe('youtube');
        expect(boundary.testCases.length).toBeGreaterThan(5);

        expect(platformData.detectLanguage('用户名中文测试')).toBe('zh');
        expect(platformData.detectLanguage('اسم المستخدم العربي')).toBe('ar');
        expect(platformData.detectLanguage('plain-user')).toBe('en');

        expect(platformData.detectScript('ユーザーテスト')).toBe('Hiragana/Katakana');
        expect(platformData.detectScript('имя пользователя')).toBe('Cyrillic');
        expect(platformData.detectScript('🔥')).toBe('Emoji');

        expect(platformData.isRightToLeft('שם משתמש עברי')).toBe(true);
        expect(platformData.isRightToLeft('normal text')).toBe(false);
    });
});
