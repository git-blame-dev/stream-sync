import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import testClock from './test-clock';
import {
    createMockNotificationDispatcher,
    createMockNotificationBuilder,
    createMockNotificationManager,
    createMockYouTubeServices,
    createMockTikTokServices,
    createMockTwitchServices,
    createMockPlatformConnection,
    createMockDisplayQueue,
    createMockOBSManager,
    createMockSourcesManager,
    createMockRetrySystem,
    createMockFileSystem,
    noOpLogger,
    createTestApp,
    createMockOBSConnection,
    createMockSpamDetector,
    createMockAuthManager,
    createMockTikTokPlatformDependencies,
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

    it('preserves cleared OBS text and explicitly supplied zero style values', () => {
        const connection = createMockOBSConnection();
        expect(connection.processSourceEvent({ eventData: { inputSettings: { text: '', font_size: 0 } } })).toMatchObject({ newText: '', fontSize: 0 });
        expect(connection.displayNotification({ displayMessage: '', message: 'synthetic fallback' }).finalText).toBe('');
    });

    it('reports explicitly configured zero queue capacity without inventing capacity behavior', () => {
        expect(createMockDisplayQueue({ maxSize: 0 }).getMaxQueueSize()).toBe(0);
        expect(createMockDisplayQueue().getMaxQueueSize()).toBe(100);
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

    it('creates notification manager workflows with validation and normalization', async () => {
        const manager = createMockNotificationManager();

        expect(() => manager.createNotification()).toThrow('type is required');
        const notification = manager.createNotification({
            type: 'platform:follow',
            platform: 'twitch',
            username: 'test-user'
        });
        expect(notification.type).toBe('platform:follow');

        const giftResult = await manager.processGift({
            platform: 'tiktok',
            username: 'test-user',
            giftType: 'Rose',
            giftCount: 3,
            amount: 3,
            currency: 'coins'
        });
        expect(giftResult.processed).toBe(true);
        expect(giftResult.notification.type).toBe('platform:gift');

        const normalized = manager.normalizeMessage({
            displayMessage: 'Pokémon '.repeat(80)
        });
        expect(normalized.preservesUnicode).toBe(true);
        expect(normalized.displayMessage.endsWith('...')).toBe(true);

        await expect(manager.processSubscription({ platform: 'twitch', username: 'test-user' })).rejects.toThrow('tier is required');
    });

    it('supports display queue, obs manager, retry system, and lifecycle reset helpers', async () => {
        const queue = createMockDisplayQueue({ shouldThrowError: true, errorMessage: 'queue-failure' });
        expect(() => queue.addItem({ type: "chat", platform: "twitch", data: {} })).toThrow('queue-failure');

        const healthyQueue = createMockDisplayQueue();
        const item = { type: 'chat', platform: 'twitch', data: { id: 'synthetic-item-1' } };
        expect(healthyQueue.addItem(item)).toEqual([item]);

        const obsManager = createMockOBSManager('disconnected');
        expect(obsManager.isConnected()).toBe(false);
        await expect(obsManager.setTextSource('source', 'message')).resolves.toBe(true);

        const retrySystem = createMockRetrySystem({ successRate: 0 });
        await expect(retrySystem.executeWithRetry('youtube', async () => 'ok')).rejects.toThrow('Simulated failure');
        expect(retrySystem.incrementRetryCount()).toBeGreaterThan(0);

        const lifecycleTarget = createMockDisplayQueue();
        lifecycleTarget.addToQueue('first');
        clearMockCalls(lifecycleTarget);
        expect(lifecycleTarget.addToQueue.mock.calls.length).toBe(0);

        lifecycleTarget.addToQueue('second');
        resetMock(lifecycleTarget);
        expect(lifecycleTarget.addToQueue.mock.calls.length).toBe(0);

        expect(validateMockAPI(lifecycleTarget, ['addItem', 'clearQueue'])).toBe(true);
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

    it('provides active auth-manager fixture contracts', async () => {
        const authReady = createMockAuthManager('READY');
        expect(authReady.getUserId()).toBe('test-broadcaster-id');
        await expect(authReady.getAccessToken()).resolves.toBe('test-access-token');
        await expect(authReady.getScopes()).resolves.toContain('chat:edit');

        const authError = createMockAuthManager('ERROR');
        expect(() => authError.getUserId()).toThrow('Authentication not initialized');
        await expect(authError.initialize()).rejects.toThrow('initialization failed');


    });

    it('builds TikTok dependency bundle for connection/event tests', async () => {
        const deps = createMockTikTokPlatformDependencies();
        const connection = deps.TikTokWebSocketClient();
        await expect(connection.connect()).resolves.toBe(true);
        expect(deps.constants.GRACE_PERIODS.TIKTOK).toBe(5000);
    });

    it('executes broad factory surfaces used across platform test suites', async () => {
        const dispatcher = createMockNotificationDispatcher();
        await dispatcher.dispatchMessage('event', {});
        await dispatcher.dispatchSuperChat({});

        const youtubeServices = createMockYouTubeServices();
        const ytConn = youtubeServices.ConnectionService();
        await ytConn.connect();
        await ytConn.getActiveChatId();
        await youtubeServices.StreamManager().detectActiveStreams();

        const tiktokServices = createMockTikTokServices();
        const ttClient = tiktokServices.TikTokWebSocketClient();
        await ttClient.connect();
        await ttClient.getRoomInfo();
        await tiktokServices.mockConnection.connect();

        const twitchServices = createMockTwitchServices();
        await twitchServices.TwitchEventSub().initialize();
        await twitchServices.ApiClient().users.getUserByName();

        const sources = createMockSourcesManager();
        await sources.updateTextSource('source', 'text');
        await sources.hideAllDisplays();

        const fileSystemSuccess = createMockFileSystem();
        await fileSystemSuccess.readFile('path');
        await fileSystemSuccess.writeFile('path', '{}');
        expect(fileSystemSuccess.existsSync('path')).toBe(true);

        const fileSystemFailure = createMockFileSystem({ writeSucceeds: false, fileExists: false });
        await expect(fileSystemFailure.writeFile('path', '{}')).rejects.toThrow('Write failed');
        expect(() => fileSystemFailure.writeFileSync('path', '{}')).toThrow('Write failed');
        await expect(fileSystemFailure.access('path')).rejects.toThrow('File not found');

        const app = createTestApp({ logger: noOpLogger });
        await app.handlePlatformConnection('youtube');

        const obsConnection = createMockOBSConnection('connected');
        await obsConnection.connect();
        await obsConnection.processSourceEvent({ eventData: { sourceName: 'Chat Display', inputSettings: { text: 'hello', font: { size: 20 } } } });
        await obsConnection.processSceneEvent({ eventData: { toSceneName: 'BRB Scene' } });

        const spamDetector = createMockSpamDetector({ shouldShow: false, isLowValue: true });
        expect(spamDetector.handleDonationSpam().shouldShow).toBe(false);
        expect(spamDetector.isLowValueDonation()).toBe(true);

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

    it('covers platform connection and auth HTTP helper variants', async () => {
        const platformConnection = createMockPlatformConnection();
        await platformConnection.processChatMessage({ id: 'chat-1' });
        await platformConnection.sendChatMessage('hello');
        await platformConnection.processGiftNotification({ id: 'gift-1' });
        await platformConnection.processFollowNotification({ id: 'follow-1' });
        await platformConnection.processSubscriptionNotification({ id: 'sub-1' });
        await platformConnection.getViewerCount();
        await platformConnection.updateViewerCount(100);
        await platformConnection.connect();
        await platformConnection.disconnect();
        expect(platformConnection.isConnected()).toBe(true);
        expect(platformConnection.getConnectionState()).toBe('connected');
        await platformConnection.handleTikTokMessage({});
        await platformConnection.handleTwitchMessage({});
        await platformConnection.handleYouTubeMessage({});
        expect(platformConnection.checkPermissions()).toBe(true);
        expect(platformConnection.validateMessage({})).toBe(true);
        expect(platformConnection.normalizeMessage({ text: 'ok' }).text).toBe('ok');
        await platformConnection.handleRapidMessages([]);
        await platformConnection.handleConcurrentOperations([]);
        expect(platformConnection._validHandlers).toContain('connect');
    });
});
