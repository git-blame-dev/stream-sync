import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import testClock from './test-clock';
import {
    createMockNotificationBuilder,
    createMockFileSystem,
    createMockWebSocketMessage,
    createTwitchWebSocketMessage,
    createYouTubeWebSocketMessage,
    createTikTokWebSocketMessage,
    createWebSocketMessageSimulator,
    createUserGiftScenario,
    createPerformanceTracker,
    createBulkGiftEvents,
    createTikTokGiftBuilder,
    createInvalidEventBuilder,
    resetMock,
    clearMockCalls,
    validateMockAPI
} from './mock-factories';

describe('mock-factories helper behavior', () => {
    beforeEach(() => {
        testClock.reset();
    });

    afterEach(() => {
        testClock.useRealTime();
    });

    it('preserves zero counts and explicit user levels in raw TikTok fixtures', () => {
        expect(createTikTokWebSocketMessage('gift', { giftCount: 0, diamonds: 0, totalCost: 0 })).toMatchObject({ giftCount: 0, totalCost: 0, gift: { diamonds: 0 } });
        expect(createTikTokWebSocketMessage('chat', { gifterLevel: 0, teamMemberLevel: 0, isSubscriber: false, message: '' })).toMatchObject({ user: { gifterLevel: 0, teamMemberLevel: 0, isSubscriber: false }, comment: '' });
        expect(createTikTokWebSocketMessage('roomUser', { viewerCount: 0 }).viewerCount).toBe(0);
        expect(createTwitchWebSocketMessage('channel.raid', { viewerCount: 0 }).payload.event.viewers).toBe(0);
        expect(createTwitchWebSocketMessage('channel.bits.use', { bits: 0 }).payload.event.bits).toBe(0);
    });

    it('generates concurrent messages with each supported raw event type and user identity', () => {
        const messages = createWebSocketMessageSimulator().generateConcurrentPlatformMessages();
        expect(messages.twitch).toMatchObject({ metadata: { subscription_type: 'channel.chat.message' }, payload: { event: { chatter_user_name: 'TestUser_twitch', chatter_user_id: 'synthetic-concurrent-twitch' } } });
        expect(messages.youtube).toMatchObject({ snippet: { type: 'textMessageEvent' }, authorDetails: { displayName: 'TestUser_youtube', channelId: 'synthetic-concurrent-youtube' } });
        expect(messages.tiktok).toMatchObject({ type: 'chat', user: { uniqueId: 'TestUser_tiktok', userId: 'synthetic-concurrent-tiktok' } });
    });

    it('preserves explicit empty raw chat text and epoch timestamps', () => {
        expect(createTwitchWebSocketMessage('channel.chat.message', { message: '', timestamp: 0 })).toMatchObject({ metadata: { message_timestamp: '1970-01-01T00:00:00.000Z' }, payload: { event: { message: { text: '' } } } });
        expect(createYouTubeWebSocketMessage('textMessageEvent', { message: '', timestamp: 0 })).toMatchObject({ snippet: { publishedAt: '1970-01-01T00:00:00.000Z', displayMessage: '', textMessageDetails: { messageText: '' } } });
        expect(createTikTokWebSocketMessage('chat', { message: '', timestamp: 0 })).toMatchObject({ comment: '', timestamp: 0 });
    });

    it('builds notification data with required field validation', () => {
        const builder = createMockNotificationBuilder();
        expect(() => builder.build()).toThrow('type is required');

        const gift = builder.build({
            type: 'platform:gift',
            platform: 'youtube',
            username: 'test-user',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 5,
            currency: 'USD'
        });
        expect(gift.type).toBe('platform:gift');
        expect(gift.platform).toBe('youtube');
        expect(gift.username).toBe('test-user');
        expect(gift.id).toContain('test-notification');
    });

    it('supports mock-call reset helpers', async () => {
        const lifecycleTarget = createMockFileSystem();
        await lifecycleTarget.readFile('synthetic-fixture-path');
        clearMockCalls(lifecycleTarget);
        expect(lifecycleTarget.readFile.mock.calls.length).toBe(0);

        await lifecycleTarget.readFile('synthetic-fixture-path');
        resetMock(lifecycleTarget);
        expect(lifecycleTarget.readFile.mock.calls.length).toBe(0);

        expect(validateMockAPI(lifecycleTarget, ['readFile', 'writeFile'])).toBe(true);
    });

    it('creates websocket payloads and simulators across supported platforms', () => {
        const twitch = createMockWebSocketMessage('twitch', 'channel.chat.message', {
            userId: 'u1',
            username: 'test-user',
            message: 'hello'
        });
        expect(twitch.metadata.subscription_type).toBe('channel.chat.message');

        const youtube = createMockWebSocketMessage('youtube', 'textMessageEvent', {
            userId: 'channel-1',
            username: 'test-user',
            message: 'hi'
        });
        expect(youtube.snippet.type).toBe('textMessageEvent');

        const tiktok = createMockWebSocketMessage('tiktok', 'gift', {
            userId: 'u2',
            username: 'test-user'
        });
        expect(tiktok.type).toBe('gift');

        expect(() => createMockWebSocketMessage('unknown', 'chat')).toThrow('Unsupported platform');

        const simulator = createWebSocketMessageSimulator({ platform: 'twitch' });
        const rapid = simulator.generateRapidMessages(3, 'channel.chat.message');
        expect(rapid.length).toBe(3);
        const malformed = simulator.generateMalformedMessage('tiktok');
        expect('type' in malformed ? malformed.type : undefined).toBeUndefined();

        const highValue = simulator.generateHighValueEvents('tiktok');
        expect('type' in highValue ? highValue.type : undefined).toBe('gift');
    });

    it('builds scenario helpers for gift workflows and invalid events', () => {
        const scenario = createUserGiftScenario()
            .fromPlatform('youtube')
            .withUser('test-user', 'user-1')
            .withAmount(10)
            .withCurrency('USD')
            .withMessage('great stream')
            .build();

        expect(scenario.type).toBe('platform:gift');
        expect(scenario.platform).toBe('youtube');
        expect(scenario.username).toBe('test-user');

        const tiktokGift = createTikTokGiftBuilder()
            .withUser('test-user', 'tt-user')
            .withGift('Lion', 2)
            .withAmount(500)
            .build();

        expect(tiktokGift.platform).toBe('tiktok');
        expect(tiktokGift.giftType).toBe('Lion');
        expect(tiktokGift.amount).toBe(5);

        const invalid = createInvalidEventBuilder().build();
        expect(invalid.type).toBe('invalid');
        expect(invalid.malformedData).toBe(true);
    });

    it('exercises filesystem doubles, raw event fixtures and elapsed-time data', async () => {
        const fileSystemSuccess = createMockFileSystem();
        await fileSystemSuccess.readFile('path');
        await fileSystemSuccess.writeFile('path', '{}');
        expect(fileSystemSuccess.existsSync('path')).toBe(true);

        const fileSystemFailure = createMockFileSystem({ writeSucceeds: false, fileExists: false });
        await expect(fileSystemFailure.writeFile('path', '{}')).rejects.toThrow('Write failed');
        expect(() => fileSystemFailure.writeFileSync('path', '{}')).toThrow('Write failed');
        await expect(fileSystemFailure.access('path')).rejects.toThrow('File not found');

        const websocketChat = createTwitchWebSocketMessage('channel.chat.message', { userId: 'u1', username: 'name', message: 'hello' });
        expect(websocketChat.metadata.message_type).toBe('notification');
        const youtubeChat = createYouTubeWebSocketMessage('textMessageEvent', { userId: 'u2', username: 'name', message: 'hello' });
        expect(youtubeChat.snippet.type).toBe('textMessageEvent');
        const tiktokGift = createTikTokWebSocketMessage('gift', { userId: 'u3', username: 'name' });
        expect(tiktokGift.type).toBe('gift');

        let elapsed = 100;
        const perf = createPerformanceTracker(() => elapsed);
        createYouTubeWebSocketMessage('textMessageEvent');
        expect(perf.getElapsedTime()).toBe(0);
        elapsed += 25;
        expect(perf.getElapsedTime()).toBe(25);
        perf.reset();
        expect(perf.getElapsedTime()).toBe(0);
        elapsed += 10;
        expect(perf.getElapsedTime()).toBe(10);

        const bulkGifts = createBulkGiftEvents(2, { platform: 'twitch', username: 'test-user' });
        expect(bulkGifts.at(0)?.platform).toBe('twitch');
        expect(bulkGifts.at(1)?.id).toBe('gift-1');
    });

    it('builds supported raw transport event samples', () => {
        const twitchFollowMessage = createTwitchWebSocketMessage('channel.follow', { userId: 'u-follow', username: 'follow-user' });
        expect(twitchFollowMessage.payload.event.user_name).toBe('follow-user');
        const twitchBitsMessage = createTwitchWebSocketMessage('channel.bits.use', { userId: 'u-bits', username: 'bits-user', bits: 500 });
        expect(twitchBitsMessage.payload.event.bits).toBe(500);
        const twitchRaidMessage = createTwitchWebSocketMessage('channel.raid', { userId: 'u-raid', username: 'raid-user', viewerCount: 44 });
        expect(twitchRaidMessage.payload.event.viewers).toBe(44);
        const twitchSubMessage = createTwitchWebSocketMessage('channel.subscribe', { userId: 'u-sub', username: 'sub-user', tier: '2000' });
        expect(twitchSubMessage.payload.event.tier).toBe('2000');

        const youtubeSuperChatMessage = createYouTubeWebSocketMessage('superChatEvent', { amount: 25, message: 'amazing' });
        expect(youtubeSuperChatMessage.snippet.superChatDetails?.amountMicros).toBe(25000000);
        const youtubeSponsorMessage = createYouTubeWebSocketMessage('newSponsorEvent', { username: 'new-member' });
        expect(youtubeSponsorMessage.snippet.type).toBe('newSponsorEvent');
        const youtubeMilestoneMessage = createYouTubeWebSocketMessage('memberMilestoneChatEvent', { memberMonth: 9 });
        expect(youtubeMilestoneMessage.snippet.memberMilestoneChatDetails?.memberMonth).toBe(9);

        const tiktokSocialMessage = createTikTokWebSocketMessage('social', { userId: 'u-social', username: 'social-user' });
        expect(tiktokSocialMessage.type).toBe('social');
        const tiktokRoomUserMessage = createTikTokWebSocketMessage('roomUser', { viewerCount: 321 });
        expect(tiktokRoomUserMessage.viewerCount).toBe(321);
    });

});
