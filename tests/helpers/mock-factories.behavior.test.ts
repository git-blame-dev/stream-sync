const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
export {};

const testClock = require('./test-clock');
const {
    createMockNotificationDispatcher,
    createMockNotificationBuilder,
    createMockNotificationManager,
    createMockYouTubeServices,
    createMockTikTokServices,
    createMockTwitchServices,
    createMockPlatform,
    createMockPlatformConnection,
    createMockDisplayQueue,
    createMockOBSManager,
    createMockSourcesManager,
    createMockRetrySystem,
    createMockFileSystem,
    noOpLogger,
    createTestApp,
    createMockOBSConnection,
    createMockYouTubePlatform,
    createMockTwitchPlatform,
    createMockTikTokPlatform,
    createMockSpamDetector,
    createMockAuthManager,
    createMockAuthService,
    createMockTokenRefresh,
    createMockAuthInitializer,
    createMockOAuthHandler,
    createMockHttpClient,
    createMockTikTokPlatformDependencies,
    createMockWebSocketMessage,
    createTwitchWebSocketMessage,
    createYouTubeWebSocketMessage,
    createTikTokWebSocketMessage,
    createWebSocketMessageSimulator,
    createUserGiftScenario,
    getUserExperienceState,
    getDisplayedNotifications,
    getSystemState,
    createPerformanceTracker,
    createBulkGiftEvents,
    waitForRecoveryAttempt,
    createTikTokGiftBuilder,
    createInvalidEventBuilder,
    resetMock,
    clearMockCalls,
    validateMockAPI
} = require('./mock-factories');

type UnknownRecord = Record<string, unknown>;

type PlatformMock = {
    connectToChat: () => Promise<unknown>;
    processMessage: (message: unknown) => UnknownRecord;
    processGift: (giftData: UnknownRecord) => UnknownRecord;
    processEvent: (event: UnknownRecord) => UnknownRecord;
    processFollow: (followData: UnknownRecord) => UnknownRecord;
    processEventSubMessage?: (messageData: UnknownRecord) => UnknownRecord;
    processEventSubFollow?: (followData: UnknownRecord) => UnknownRecord;
    processEventSubRaid?: (raidData: UnknownRecord) => UnknownRecord;
    processEventSubBits?: (bitsData: UnknownRecord) => UnknownRecord;
    processSuperSticker?: (stickerData: UnknownRecord) => UnknownRecord;
    processViewerJoin?: (viewerData: UnknownRecord) => UnknownRecord;
    processViewerLeave?: (viewerData: UnknownRecord) => UnknownRecord;
    processFollowWebhook?: (followData: UnknownRecord) => UnknownRecord;
    processSubscriberWebhook?: (subData: UnknownRecord) => UnknownRecord;
    processWebhook?: (webhookData: UnknownRecord) => UnknownRecord;
    processSceneTransition?: (sceneData: UnknownRecord) => UnknownRecord;
    processSourceUpdate?: (sourceData: UnknownRecord) => UnknownRecord;
    processConnectionEvent?: (connectionData: UnknownRecord) => UnknownRecord;
    processSceneEvent?: (sceneData: UnknownRecord) => UnknownRecord;
    processSourceEvent?: (sourceData: UnknownRecord) => UnknownRecord;
    processViewerEvent?: (viewerData: UnknownRecord) => UnknownRecord;
    handleWebSocketMessage?: (message: UnknownRecord) => Promise<UnknownRecord>;
    handleNotificationEvent?: (subscriptionType: string, event: UnknownRecord) => UnknownRecord;
    handleNotificationEventWithDispatcher?: (subscriptionType: string, event: UnknownRecord) => Promise<UnknownRecord>;
    handleChatMessage?: (message: UnknownRecord) => Promise<UnknownRecord>;
    handleSuperChat?: (message: UnknownRecord) => Promise<UnknownRecord>;
    handleMembershipGift?: (message: UnknownRecord) => Promise<UnknownRecord>;
    handleNewSponsor?: (message: UnknownRecord) => Promise<UnknownRecord>;
    handleGift?: (event: UnknownRecord) => Promise<UnknownRecord>;
    handleWebcastEvent?: (event: UnknownRecord) => Promise<UnknownRecord>;
    isConnected: () => boolean;
    isActive: () => boolean;
    getViewerCount: () => number;
    connectionStatus: boolean;
    processSuperChat?: (superChatData: UnknownRecord) => UnknownRecord;
    searchLiveStreams?: () => Promise<unknown[]>;
    connectToStream?: () => Promise<boolean>;
    getInnertubeInstanceCount?: () => number;
    innertubeInstanceManager?: {
        getInstance: () => Promise<UnknownRecord>;
        cleanup: () => Promise<boolean>;
    };
    getCachedViewerCount?: () => number;
    processRoomUser?: (roomUserData: UnknownRecord) => UnknownRecord;
    processMemberJoin?: (memberData: UnknownRecord) => UnknownRecord;
    processLike?: (likeData: UnknownRecord) => UnknownRecord;
    processSocial?: (socialData: UnknownRecord) => UnknownRecord;
    processEmote?: (emoteData: UnknownRecord) => UnknownRecord;
    processViewerCount?: (viewerData: UnknownRecord) => UnknownRecord;
};

const createPlatform = (platformName: string, behaviorConfig: UnknownRecord = {}): PlatformMock => {
    return (createMockPlatform as unknown as (platform: string, behavior?: UnknownRecord) => PlatformMock)(platformName, behaviorConfig);
};

describe('mock-factories helper behavior', () => {
    beforeEach(() => {
        testClock.reset();
    });

    afterEach(() => {
        testClock.useRealTime();
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

    it('handles platform behavior methods for unstable connections and event processing', async () => {
        const unstablePlatform = createPlatform('tiktok', { connectsBehavior: 'unstable', errorRate: 1 });
        await expect(unstablePlatform.connectToChat()).rejects.toThrow('Connection unstable');

        expect(() => unstablePlatform.processMessage(null)).toThrow('Message data is missing');

        const gift = unstablePlatform.processGift({
            platform: 'tiktok',
            user: { uniqueId: 'test-user', userId: 'test-id' },
            giftCount: 2,
            giftType: 'Rose',
            currency: 'coins',
            amount: 2
        });
        expect(gift.type).toBe('platform:gift');
        expect(gift.giftCount).toBe(2);

        const genericEvent = unstablePlatform.processEvent({ type: 'custom-event' });
        expect(genericEvent.platform).toBe('tiktok');
        expect(genericEvent.type).toBe('custom-event');

        const follow = unstablePlatform.processFollow({ user: { uniqueId: 'test-follower', userId: 'f-1' } });
        expect(follow.type).toBe('platform:follow');
        expect(follow.platform).toBe('tiktok');
    });

    it('supports display queue, obs manager, retry system, and lifecycle reset helpers', async () => {
        const queue = createMockDisplayQueue({ shouldThrowError: true, errorMessage: 'queue-failure' });
        expect(() => queue.addItem({})).toThrow('queue-failure');

        const healthyQueue = createMockDisplayQueue();
        await expect(healthyQueue.addItem({ id: 'item-1' })).resolves.toBe(true);

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
        expect(malformed.type).toBeUndefined();

        const highValue = simulator.generateHighValueEvents('tiktok');
        expect(highValue.type).toBe('gift');
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

    it('provides auth and HTTP mock contracts used by auth workflows', async () => {
        const authReady = createMockAuthManager('READY');
        expect(authReady.getUserId()).toBe('test-broadcaster-id');
        await expect(authReady.getAccessToken()).resolves.toBe('test-access-token');
        await expect(authReady.getScopes()).resolves.toContain('chat:edit');

        const authError = createMockAuthManager('ERROR');
        expect(() => authError.getUserId()).toThrow('Authentication not initialized');
        await expect(authError.initialize()).rejects.toThrow('initialization failed');

        const tokenRefresh = createMockTokenRefresh({
            config: {
                accessToken: 'test-access-token',
                refreshToken: 'test-refresh-token',
                clientId: 'test-client-id'
            }
        });
        const headers = await tokenRefresh.getRequestHeaders('/foo', 'token_validation');
        expect(headers.combined.Authorization).toContain('Bearer');
        const lifecycle = await tokenRefresh.handleLifecycleEvent('request_start');
        expect(lifecycle.actions).toContain('log_start');

        const oauthHandler = createMockOAuthHandler();
        const configResult = await oauthHandler.updateConfiguration();
        expect(configResult.implementationType).toBe('delegated_to_central');

        const httpClient = createMockHttpClient();
        const builtRequest = await httpClient.buildRequest({ endpoint: '/users', authentication: true, retryable: true });
        expect(builtRequest.builderSource).toBe('centralized_request_builder');
        expect(builtRequest.builtRequest.url).toContain('api.twitch.tv');
    });

    it('builds TikTok dependency bundle for connection/event tests', async () => {
        const deps = createMockTikTokPlatformDependencies();
        const connection = deps.TikTokWebSocketClient();
        await expect(connection.connect()).resolves.toBe(true);
        expect(deps.WebcastEvent.GIFT).toBe('WebcastGiftMessage');
        expect(deps.ControlEvent.CONNECTED).toBe('connected');
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

        const youtubePlatform = createMockYouTubePlatform();
        await youtubePlatform.processSuperChat({ username: 'test-user', amount: 5, currency: 'USD' });
        await youtubePlatform.handleMembership({ username: 'test-user' });

        const twitchPlatform = createMockTwitchPlatform();
        await twitchPlatform.processSubscription({ username: 'test-user', tier: '1000' });
        await twitchPlatform.handleRaid({ username: 'test-user', viewerCount: 10 });

        const tiktokPlatform = createMockTikTokPlatform({ giftAggregation: 'enabled' });
        const aggregated = await tiktokPlatform.aggregateGifts([
            { username: 'test-user', giftType: 'Rose', giftCount: 1 },
            { username: 'test-user', giftType: 'Rose', giftCount: 2 }
        ]);
        expect(aggregated[0].giftCount).toBe(3);

        const spamDetector = createMockSpamDetector({ shouldShow: false, isLowValue: true });
        expect(spamDetector.handleDonationSpam().shouldShow).toBe(false);
        expect(spamDetector.isLowValueDonation()).toBe(true);

        const authService = createMockAuthService();
        expect(await authService.validateToken()).toBe(true);
        const authInitializer = createMockAuthInitializer();
        const initTimeout = await authInitializer.getTimeoutConfig('token_validation');
        expect(initTimeout.requestTimeout).toBe(10000);

        const websocketChat = createTwitchWebSocketMessage('channel.chat.message', { userId: 'u1', username: 'name', message: 'hello' });
        expect(websocketChat.metadata.message_type).toBe('notification');
        const youtubeChat = createYouTubeWebSocketMessage('textMessageEvent', { userId: 'u2', username: 'name', message: 'hello' });
        expect(youtubeChat.snippet.type).toBe('textMessageEvent');
        const tiktokGift = createTikTokWebSocketMessage('gift', { userId: 'u3', username: 'name' });
        expect(tiktokGift.type).toBe('gift');

        const recoveryDelay = await waitForRecoveryAttempt(0);
        expect(recoveryDelay).toBeUndefined();

        const experienceState = getUserExperienceState();
        expect(experienceState.isStable).toBe(true);
        expect(getDisplayedNotifications([{ displayMessage: 'test-message' }]).length).toBe(1);
        expect(getSystemState({ status: 'degraded' }).status).toBe('degraded');

        const perf = createPerformanceTracker();
        perf.markMemoryLeak();
        expect(perf.getMemoryLeak()).toBe(true);
        perf.reset();
        expect(perf.getMemoryLeak()).toBe(false);
        expect(perf.getElapsedTime()).toBeGreaterThanOrEqual(0);

        const bulkGifts = createBulkGiftEvents(2, { platform: 'twitch', username: 'test-user' });
        expect(bulkGifts[0].platform).toBe('twitch');
        expect(bulkGifts[1].id).toBe('gift-1');
    });

    it('covers platform event processors and transport branch surfaces', async () => {
        const generic = createPlatform('generic', { processingSpeed: 'slow' });
        expect(() => generic.processMessage(undefined)).toThrow('Message data is not available');
        expect(() => generic.processMessage('bad')).toThrow('Message format is invalid');

        const genericMessage = generic.processMessage({ username: 'test-generic', message: 'hello' });
        expect(genericMessage.displayMessage).toContain('test-generic');

        const twitch = createPlatform('twitch');
        const twitchChat = twitch.processEventSubMessage!({ chatter_user_name: 'test-chatter', message: { text: 'hi', fragments: [] } });
        expect(twitchChat.messageType).toBe('chat');

        const twitchFollow = twitch.processEventSubFollow!({ user_name: 'test-follower', user_id: 'f-1' });
        expect(twitchFollow.type).toBe('platform:follow');

        const twitchRaid = twitch.processEventSubRaid!({ from_broadcaster_user_name: 'test-raider', viewerCount: 27 });
        expect(twitchRaid.viewerCount).toBe(27);

        const twitchBits = twitch.processEventSubBits!({
            user_name: 'test-bits',
            bits: 100,
            message: { fragments: [{ type: 'text', text: 'great stream' }] }
        });
        expect(twitchBits.bits).toBe(100);
        expect(twitchBits.messageContent).toBe('great stream');

        const sticker = twitch.processSuperSticker!({ item: { author: { name: 'test-sticker', id: 'channel-id' }, purchase_amount: '$4.99' } });
        expect(sticker.type).toBe('SuperSticker');

        expect(twitch.processViewerJoin!({ user: { name: 'joiner', id: 'j-1' } }).messageType).toBe('viewerJoin');
        expect(twitch.processViewerLeave!({ user: { name: 'leaver', id: 'l-1' } }).messageType).toBe('viewerLeave');

        expect(twitch.processFollowWebhook!({ data: { provider: 'twitch', displayName: 'web-follow' } }).platform).toBe('twitch');
        expect(twitch.processSubscriberWebhook!({ data: { provider: 'youtube', displayName: 'web-sub' } }).messageType).toBe('subscription');

        const webhookFollow = twitch.processWebhook!({ platform: 'youtube', username: 'test-follow', eventId: 'follow_1' });
        expect(webhookFollow.type).toBe('platform:follow');

        const webhookSubscriber = twitch.processWebhook!({ platform: 'youtube', eventId: 'subscriber_2', username: 'test-sub' });
        expect(webhookSubscriber.type).toBe('platform:paypiggy');

        expect(twitch.processSceneTransition!({ eventData: { sceneName: 'Main' } }).messageType).toBe('sceneChange');
        expect(twitch.processSourceUpdate!({ eventData: { sourceName: 'Chat Display' } }).messageType).toBe('sourceUpdate');
        expect(twitch.processConnectionEvent!({ eventType: 'ConnectionClosed', state: 'closed' }).messageType).toBe('connection');
        expect(twitch.processSceneEvent!({ eventData: { toSceneName: 'BRB' } }).toScene).toBe('BRB');
        expect(twitch.processSourceEvent!({ eventData: { inputName: 'Chat Display', inputSettings: { text: 'new' } } }).inputName).toBe('Chat Display');
        expect(twitch.processViewerEvent!({ type: 'ViewerLeave', username: 'viewer' }).eventType).toBe('viewer_leave');

        await expect(twitch.handleWebSocketMessage!({ metadata: { message_type: 'notification' } })).resolves.toEqual(expect.objectContaining({ success: true }));
        expect(twitch.handleNotificationEvent!('channel.chat.message', { id: 'e1' }).success).toBe(true);
        await expect(twitch.handleNotificationEventWithDispatcher!('channel.chat.message', { id: 'e2' })).resolves.toEqual(expect.objectContaining({ dispatcher: true }));
        await expect(twitch.handleChatMessage!({ id: 'm1' })).resolves.toEqual(expect.objectContaining({ type: 'chat' }));
        await expect(twitch.handleSuperChat!({ id: 'm2' })).resolves.toEqual(expect.objectContaining({ type: 'platform:gift' }));
        await expect(twitch.handleMembershipGift!({ id: 'm3' })).resolves.toEqual(expect.objectContaining({ type: 'membership_gift' }));
        await expect(twitch.handleNewSponsor!({ id: 'm4' })).resolves.toEqual(expect.objectContaining({ type: 'new_sponsor' }));
        await expect(twitch.handleGift!({ gift: { name: 'Rose' } })).resolves.toEqual(expect.objectContaining({ eventType: 'gift' }));
        await expect(twitch.handleWebcastEvent!({ type: 'chat' })).resolves.toEqual(expect.objectContaining({ eventType: 'chat' }));

        expect(twitch.isConnected()).toBe(true);
        expect(twitch.isActive()).toBe(true);
        expect(twitch.getViewerCount()).toBe(1000);
        expect(twitch.connectionStatus).toBe(true);

        const youtube = createPlatform('youtube');
        const superChat = youtube.processSuperChat!({ item: { author: { name: 'yt-user', id: 'yt-1' }, purchase_amount: '$9.99', message: { text: 'nice!' } } });
        expect(superChat.platform).toBe('youtube');
        await expect(youtube.searchLiveStreams!()).resolves.toHaveLength(2);
        await expect(youtube.connectToStream!()).resolves.toBe(true);
        expect(youtube.getInnertubeInstanceCount!()).toBe(1);
        await expect(youtube.innertubeInstanceManager!.getInstance()).resolves.toEqual({});
        await expect(youtube.innertubeInstanceManager!.cleanup()).resolves.toBe(true);

        const tiktok = createPlatform('tiktok');
        expect(tiktok.getCachedViewerCount!()).toBe(100);
        const roomUser = tiktok.processRoomUser!({ viewerCount: 77, totalUsers: 120 });
        expect(roomUser.viewerCount).toBe(77);
        expect(tiktok.getCachedViewerCount!()).toBe(77);

        const tiktokGift = tiktok.processGift({
            user: { uniqueId: 'gift-user', userId: 'g-1' },
            repeatCount: 2,
            giftDetails: { giftName: 'Rose', diamondCount: 3, id: 'gift-1' }
        });
        expect(tiktokGift.amount).toBe(6);
        expect(tiktokGift.repeatCount).toBe(2);

        expect(() => tiktok.processMessage({ user: { uniqueId: null, username: 'tok-user', userId: 'tok-err' }, type: 'chat', comment: 'hi' })).toThrow('TikTok user identifier is missing');
        const tiktokChat = tiktok.processMessage({ user: { uniqueId: 'tok-user', userId: 'tok-1' }, type: 'test', comment: null });
        expect(tiktokChat.messageContent).toBe('Empty message');

        const memberJoin = tiktok.processMemberJoin!({ user: { uniqueId: 'member-user', userId: 'm-1', teamMemberLevel: 2 } });
        expect(memberJoin.messageType).toBe('member');
        expect(tiktok.processLike!({ user: { uniqueId: 'liker', userId: 'l-1' }, likeCount: 9 }).messageType).toBe('like');
        expect(tiktok.processSocial!({ user: { uniqueId: 'social', userId: 's-1' }, action: 'share' }).socialType).toBe('share');
        expect(tiktok.processEmote!({ user: { uniqueId: 'emoter', userId: 'e-1' }, emote: { name: 'Fire', id: 'f-1' } }).eventType).toBe('emote');
        expect(tiktok.processViewerCount!({ viewerCount: 101 }).viewerCount).toBe(101);

        const twitchFollowMessage = createTwitchWebSocketMessage('channel.follow', { userId: 'u-follow', username: 'follow-user' });
        expect(twitchFollowMessage.payload.event.user_name).toBe('follow-user');
        const twitchBitsMessage = createTwitchWebSocketMessage('channel.bits.use', { userId: 'u-bits', username: 'bits-user', bits: 500 });
        expect(twitchBitsMessage.payload.event.bits).toBe(500);
        const twitchRaidMessage = createTwitchWebSocketMessage('channel.raid', { userId: 'u-raid', username: 'raid-user', viewerCount: 44 });
        expect(twitchRaidMessage.payload.event.viewers).toBe(44);
        const twitchSubMessage = createTwitchWebSocketMessage('channel.subscribe', { userId: 'u-sub', username: 'sub-user', tier: '2000' });
        expect(twitchSubMessage.payload.event.tier).toBe('2000');

        const youtubeSuperChatMessage = createYouTubeWebSocketMessage('superChatEvent', { amount: 25, message: 'amazing' });
        expect(youtubeSuperChatMessage.snippet.superChatDetails.amountMicros).toBe(25000000);
        const youtubeSponsorMessage = createYouTubeWebSocketMessage('newSponsorEvent', { username: 'new-member' });
        expect(youtubeSponsorMessage.snippet.type).toBe('newSponsorEvent');
        const youtubeMilestoneMessage = createYouTubeWebSocketMessage('memberMilestoneChatEvent', { memberMonth: 9 });
        expect(youtubeMilestoneMessage.snippet.memberMilestoneChatDetails.memberMonth).toBe(9);

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

        const deps = createMockTikTokPlatformDependencies();
        const pushConnection = deps.WebcastPushConnection();
        await expect(pushConnection.connect()).resolves.toBe(true);
        expect(pushConnection.getState()).toBe('CONNECTED');
        await expect(pushConnection.disconnect()).resolves.toBe(true);

        const tokenRefresh = createMockTokenRefresh({
            config: {
                accessToken: 'test-access-token',
                refreshToken: 'test-refresh-token',
                clientId: 'test-client-id'
            }
        });
        await expect(tokenRefresh.getRetryConfig('network_timeout')).resolves.toEqual(expect.objectContaining({ maxRetries: 3 }));
        await expect(tokenRefresh.getRetryConfig('rate_limit')).resolves.toEqual(expect.objectContaining({ maxRetries: 5 }));
        await expect(tokenRefresh.getRetryConfig('server_error')).resolves.toEqual(expect.objectContaining({ maxRetries: 2 }));
        await expect(tokenRefresh.getRetryConfig('other')).resolves.toEqual(expect.objectContaining({ maxRetries: 3 }));

        await expect(tokenRefresh.handleResponseStatus({ status: 503 })).resolves.toEqual(expect.objectContaining({ shouldRetry: true }));
        await expect(tokenRefresh.parseResponseData({ data: { access_token: 'a', expires_in: 10 } }, 'token_response')).resolves.toEqual(expect.objectContaining({ parsedFields: ['access_token', 'expires_in'] }));
        await expect(tokenRefresh.parseResponseData({ data: { data: [{ id: 'u1', login: 'login1' }] } }, 'user_response')).resolves.toEqual(expect.objectContaining({ parsedFields: ['id', 'login'] }));
        await expect(tokenRefresh.parseResponseData({ data: { error: 'bad', error_description: 'failed' } }, 'error_response')).resolves.toEqual(expect.objectContaining({ parsedFields: ['error', 'error_description'] }));
        await expect(tokenRefresh.parseResponseData({ data: {} }, 'unknown')).resolves.toEqual(expect.objectContaining({ parsedFields: [] }));

        await expect(tokenRefresh.handleNetworkError({ code: 'ECONNREFUSED' })).resolves.toEqual(expect.objectContaining({ category: 'connection_refused' }));
        await expect(tokenRefresh.handleNetworkError({ code: 'ETIMEDOUT' })).resolves.toEqual(expect.objectContaining({ category: 'request_timeout' }));
        await expect(tokenRefresh.handleNetworkError({ code: 'ENOTFOUND' })).resolves.toEqual(expect.objectContaining({ category: 'dns_error' }));
        await expect(tokenRefresh.handleNetworkError({ code: 'X' })).resolves.toEqual(expect.objectContaining({ category: 'unknown_error' }));

        await expect(tokenRefresh.handleRequestCancellation('user_initiated')).resolves.toEqual(expect.objectContaining({ handled: true }));
        await expect(tokenRefresh.handleRequestCancellation('timeout_exceeded')).resolves.toEqual(expect.objectContaining({ handled: true }));
        await expect(tokenRefresh.handleRequestCancellation('auth_change')).resolves.toEqual(expect.objectContaining({ handled: true }));
        await expect(tokenRefresh.handleRequestCancellation('other')).resolves.toEqual(expect.objectContaining({ handled: true }));

        await expect(tokenRefresh.handleLifecycleEvent('request_start')).resolves.toEqual(expect.objectContaining({ actions: ['log_start', 'set_timeout', 'track_request'] }));
        await expect(tokenRefresh.handleLifecycleEvent('request_progress')).resolves.toEqual(expect.objectContaining({ actions: ['update_progress', 'check_cancellation'] }));
        await expect(tokenRefresh.handleLifecycleEvent('request_complete')).resolves.toEqual(expect.objectContaining({ actions: ['log_completion', 'cleanup_resources', 'update_metrics'] }));
        await expect(tokenRefresh.handleLifecycleEvent('other')).resolves.toEqual(expect.objectContaining({ actions: [] }));

        await expect(tokenRefresh.queueRequest('token_validation')).resolves.toEqual(expect.objectContaining({ priority: 'high' }));
        await expect(tokenRefresh.queueRequest('user_data_fetch')).resolves.toEqual(expect.objectContaining({ priority: 'medium' }));
        await expect(tokenRefresh.queueRequest('optional_metadata')).resolves.toEqual(expect.objectContaining({ priority: 'low' }));
        await expect(tokenRefresh.queueRequest('unknown')).resolves.toEqual(expect.objectContaining({ priority: 'medium' }));
        await expect(tokenRefresh.performHttpOperation({ op: 'validate' })).resolves.toEqual(expect.objectContaining({ operationSource: 'centralized_http_client' }));

        const requestWithoutAuth = await tokenRefresh.buildRequest({ endpoint: '/users', authentication: false, retryable: false });
        expect(requestWithoutAuth.builtRequest.headers.Authorization).toBeUndefined();
        expect(requestWithoutAuth.builtRequest.retryConfig.maxRetries).toBe(0);

        await expect(tokenRefresh.getTimeoutConfig('token_refresh')).resolves.toEqual(expect.objectContaining({ requestTimeout: 30000 }));
        await expect(tokenRefresh.getTimeoutConfig('user_data_fetch')).resolves.toEqual(expect.objectContaining({ requestTimeout: 15000 }));
        await expect(tokenRefresh.getTimeoutConfig('other')).resolves.toEqual(expect.objectContaining({ requestTimeout: 10000 }));

        const authInitializer = createMockAuthInitializer({
            config: {
                accessToken: 'test-access-token',
                refreshToken: 'test-refresh-token',
                clientId: 'test-client-id'
            }
        });
        await expect(authInitializer.getRequestHeaders('/users', 'token_validation')).resolves.toEqual(expect.objectContaining({ combined: expect.objectContaining({ Authorization: 'Bearer test-access-token' }) }));

        const oauthHandler = createMockOAuthHandler({
            config: {
                accessToken: 'test-access-token',
                refreshToken: 'test-refresh-token',
                clientId: 'test-client-id'
            }
        });
        await expect(oauthHandler.getRequestHeaders('/users', 'token_validation')).resolves.toEqual(expect.objectContaining({ combined: expect.objectContaining({ Authorization: 'Bearer test-access-token' }) }));
        expect(oauthHandler.categorizeError()).toEqual({ category: 'recoverable' });

        const httpClient = createMockHttpClient({
            config: {
                accessToken: 'test-access-token',
                refreshToken: 'test-refresh-token',
                clientId: 'test-client-id'
            }
        });
        await expect(httpClient.getRequestHeaders('/users', 'token_validation')).resolves.toEqual(expect.objectContaining({ combined: expect.objectContaining({ Authorization: 'Bearer test-access-token' }) }));
        await expect(httpClient.buildRequest({ endpoint: '/users', authentication: true, retryable: true })).resolves.toEqual(expect.objectContaining({ builderSource: 'centralized_request_builder' }));
    });
});
