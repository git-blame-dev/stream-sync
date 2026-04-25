const { describe, it, expect } = require('bun:test');
const { DEFAULT_AVATAR_URL } = require('../../../../src/constants/avatar');

const FALLBACK_AVATAR_URL = DEFAULT_AVATAR_URL;

function createMapper(configOverrides = {}, optionsOverrides = {}) {
    const { createEventToGuiContractMapper } = require('../../../../src/services/gui/event-to-gui-contract-mapper');

    return createEventToGuiContractMapper({
        config: {
            gui: {
                messageCharacterLimit: 0,
                showMessages: true,
                showCommands: true,
                showGreetings: true,
                showFarewells: true,
                showFollows: true,
                showShares: true,
                showRaids: true,
                showGifts: true,
                showPaypiggies: true,
                showGiftPaypiggies: true,
                showEnvelopes: true,
                ...configOverrides
            }
        },
        fallbackAvatarUrl: FALLBACK_AVATAR_URL,
        ...optionsOverrides
    });
}

describe('Event-to-GUI contract mapper behavior', () => {
    it('maps every supported source row to stable GUI kind contracts', async () => {
        const mapper = createMapper();

        const cases = [
            { type: 'chat', expectedKind: 'chat', data: { message: 'hi' } },
            { type: 'command', expectedKind: 'command', data: { displayMessage: 'user used command !test' } },
            { type: 'greeting', expectedKind: 'greeting', data: { displayMessage: 'welcome' } },
            { type: 'farewell', expectedKind: 'farewell', data: { displayMessage: 'bye' } },
            { type: 'platform:follow', expectedKind: 'notification', data: { displayMessage: 'followed' } },
            { type: 'platform:share', expectedKind: 'notification', data: { displayMessage: 'shared' } },
            { type: 'platform:raid', expectedKind: 'notification', data: { displayMessage: 'raided' } },
            { type: 'platform:gift', expectedKind: 'notification', data: { displayMessage: 'gifted' } },
            { type: 'platform:paypiggy', expectedKind: 'notification', data: { displayMessage: 'subscribed' } },
            { type: 'platform:giftpaypiggy', expectedKind: 'notification', data: { displayMessage: 'gifted memberships' } },
            { type: 'platform:envelope', expectedKind: 'notification', data: { displayMessage: 'treasure chest' } }
        ];

        for (const testCase of cases) {
            const mapped = await mapper.mapDisplayRow({
                type: testCase.type,
                platform: 'twitch',
                data: {
                    username: 'test-user',
                    userId: 'test-user-id',
                    avatarUrl: 'https://example.invalid/source-avatar.png',
                    ...testCase.data
                }
            });

            expect(mapped).toEqual(expect.objectContaining({
                kind: testCase.expectedKind,
                type: testCase.type
            }));
        }
    });

    it('applies gui show* toggle gating for mapped rows', async () => {
        const mapper = createMapper({ showCommands: false });

        const hidden = await mapper.mapDisplayRow({
            type: 'command',
            platform: 'twitch',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                command: '!test'
            }
        });

        expect(hidden).toBeNull();
    });

    it('applies messageCharacterLimit in correct order for chat and notifications', async () => {
        const mapper = createMapper({ messageCharacterLimit: 5 });

        const chatRow = await mapper.mapDisplayRow({
            type: 'chat',
            platform: 'youtube',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                avatarUrl: 'https://example.invalid/avatar.png',
                message: 'abcdefghi'
            }
        });

        const notificationRow = await mapper.mapDisplayRow({
            type: 'platform:gift',
            platform: 'youtube',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                avatarUrl: 'https://example.invalid/avatar.png',
                displayMessage: '123456789'
            }
        });

        expect(chatRow.text).toBe('abcde');
        expect(notificationRow.text).toBe('12345');
    });

    it('maps canonical platform chat rows from message.text object shape', async () => {
        const mapper = createMapper({ messageCharacterLimit: 6 });

        const mapped = await mapper.mapDisplayRow({
            type: 'platform:chat-message',
            platform: 'youtube',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                avatarUrl: 'https://example.invalid/avatar.png',
                message: {
                    text: 'abcdefghi'
                }
            }
        });

        expect(mapped).toEqual(expect.objectContaining({
            type: 'platform:chat-message',
            kind: 'chat',
            text: 'abcdef',
            avatarUrl: 'https://example.invalid/avatar.png'
        }));
    });

    it('maps isPaypiggy flag for chat rows', async () => {
        const mapper = createMapper({ messageCharacterLimit: 0 });

        const mapped = await mapper.mapDisplayRow({
            type: 'platform:chat-message',
            platform: 'twitch',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                avatarUrl: 'https://example.invalid/avatar.png',
                message: { text: 'hello' },
                isPaypiggy: true
            }
        });

        expect(mapped.isPaypiggy).toBe(true);
    });

    it('maps canonical message.parts for chat rows', async () => {
        const mapper = createMapper({ messageCharacterLimit: 0 });

        const mapped = await mapper.mapDisplayRow({
            type: 'platform:chat-message',
            platform: 'tiktok',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                avatarUrl: 'https://example.invalid/avatar.png',
                message: {
                    text: '',
                    parts: [
                        {
                            type: 'emote',
                            platform: 'tiktok',
                            emoteId: '1234512345',
                            imageUrl: 'https://example.invalid/tiktok-emote.webp'
                        },
                        {
                            type: 'text',
                            text: ' hi'
                        }
                    ]
                }
            }
        });

        expect(mapped.parts).toEqual([
            {
                type: 'emote',
                platform: 'tiktok',
                emoteId: '1234512345',
                imageUrl: 'https://example.invalid/tiktok-emote.webp'
            },
            {
                type: 'text',
                text: ' hi'
            }
        ]);
    });

    it('maps canonical badgeImages for chat rows only', async () => {
        const mapper = createMapper({ messageCharacterLimit: 0 });

        const chatMapped = await mapper.mapDisplayRow({
            type: 'platform:chat-message',
            platform: 'twitch',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                avatarUrl: 'https://example.invalid/avatar.png',
                message: { text: 'hello' },
                badgeImages: [
                    { imageUrl: 'https://example.invalid/badge-1.png', source: 'twitch', label: 'mod' },
                    { imageUrl: 'https://example.invalid/badge-1.png', source: 'twitch', label: 'dupe' },
                    { imageUrl: 'https://example.invalid/badge-2.png', source: 'twitch', label: 'founder' }
                ]
            }
        });

        const notificationMapped = await mapper.mapDisplayRow({
            type: 'platform:follow',
            platform: 'twitch',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                displayMessage: 'followed',
                badgeImages: [{ imageUrl: 'https://example.invalid/badge-1.png', source: 'twitch', label: 'mod' }]
            }
        });

        expect(chatMapped.badgeImages).toEqual([
            { imageUrl: 'https://example.invalid/badge-1.png', source: 'twitch', label: 'mod' },
            { imageUrl: 'https://example.invalid/badge-2.png', source: 'twitch', label: 'founder' }
        ]);
        expect(notificationMapped.badgeImages).toBeUndefined();
    });

    it('maps notification-level parts for gift rows', async () => {
        const mapper = createMapper({ messageCharacterLimit: 0 });

        const mapped = await mapper.mapDisplayRow({
            type: 'platform:gift',
            platform: 'tiktok',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                avatarUrl: 'https://example.invalid/avatar.png',
                displayMessage: 'test-user sent 5x Rose gift (10 coins)',
                parts: [
                    { type: 'text', text: 'sent 5x ' },
                    {
                        type: 'emote',
                        platform: 'tiktok',
                        emoteId: 'Rose',
                        imageUrl: 'https://example.invalid/tiktok/gifts/rose.webp'
                    },
                    { type: 'text', text: ' (10 coins)' }
                ]
            }
        });

        expect(mapped.parts).toEqual([
            { type: 'text', text: 'sent 5x ' },
            {
                type: 'emote',
                platform: 'tiktok',
                emoteId: 'Rose',
                imageUrl: 'https://example.invalid/tiktok/gifts/rose.webp'
            },
            { type: 'text', text: ' (10 coins)' }
        ]);
    });

    it('maps Twitch gift notification-level parts without platform-specific mutation', async () => {
        const mapper = createMapper({ messageCharacterLimit: 0 });

        const mapped = await mapper.mapDisplayRow({
            type: 'platform:gift',
            platform: 'twitch',
            data: {
                username: 'test-twitch-user',
                userId: 'test-twitch-user-id',
                avatarUrl: 'https://example.invalid/twitch-avatar.png',
                displayMessage: 'test-twitch-user sent 100 bits',
                parts: [
                    { type: 'text', text: 'sent 100 ' },
                    {
                        type: 'emote',
                        platform: 'twitch',
                        emoteId: 'Cheer-100',
                        imageUrl: 'https://example.invalid/twitch/cheer-100-dark-animated-3.gif'
                    }
                ]
            }
        });

        expect(mapped.parts).toEqual([
            { type: 'text', text: 'sent 100 ' },
            {
                type: 'emote',
                platform: 'twitch',
                emoteId: 'Cheer-100',
                imageUrl: 'https://example.invalid/twitch/cheer-100-dark-animated-3.gif'
            }
        ]);
    });

    it('maps YouTube gift notification-level parts with image before text', async () => {
        const mapper = createMapper({ messageCharacterLimit: 0 });

        const mapped = await mapper.mapDisplayRow({
            type: 'platform:gift',
            platform: 'youtube',
            data: {
                username: 'test-youtube-user',
                userId: 'test-youtube-user-id',
                avatarUrl: 'https://example.invalid/youtube-avatar.png',
                displayMessage: 'test-youtube-user sent a A$7.99 Super Sticker',
                parts: [
                    {
                        type: 'emote',
                        platform: 'youtube',
                        emoteId: 'supersticker',
                        imageUrl: 'https://lh3.googleusercontent.com/test-supersticker=s176-rwa'
                    },
                    { type: 'text', text: ' Test sticker description' }
                ]
            }
        });

        expect(mapped.parts).toEqual([
            {
                type: 'emote',
                platform: 'youtube',
                emoteId: 'supersticker',
                imageUrl: 'https://lh3.googleusercontent.com/test-supersticker=s176-rwa'
            },
            { type: 'text', text: ' Test sticker description' }
        ]);
    });

    it('derives TikTok gift parts from giftImageUrl when notification parts are missing', async () => {
        const mapper = createMapper({ messageCharacterLimit: 0 });

        const mapped = await mapper.mapDisplayRow({
            type: 'platform:gift',
            platform: 'tiktok',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                avatarUrl: 'https://example.invalid/avatar.png',
                displayMessage: 'test-user sent 5x Rose gift (10 coins)',
                giftType: 'Rose',
                giftCount: 5,
                amount: 10,
                currency: 'coins',
                giftImageUrl: 'https://example.invalid/tiktok/gifts/rose.webp'
            }
        });

        expect(mapped.parts).toEqual([
            { type: 'text', text: 'sent 5x ' },
            {
                type: 'emote',
                platform: 'tiktok',
                emoteId: 'Rose',
                imageUrl: 'https://example.invalid/tiktok/gifts/rose.webp'
            },
            { type: 'text', text: ' (10 coins)' }
        ]);
    });

    it('preserves YouTube canonical message.parts while truncating text by messageCharacterLimit', async () => {
        const mapper = createMapper({ messageCharacterLimit: 5 });

        const mapped = await mapper.mapDisplayRow({
            type: 'platform:chat-message',
            platform: 'youtube',
            data: {
                username: 'test-youtube-user',
                userId: 'test-youtube-user-id',
                avatarUrl: 'https://example.invalid/youtube-avatar.png',
                message: {
                    text: 'abcdefghi',
                    parts: [
                        { type: 'text', text: 'abc' },
                        {
                            type: 'emote',
                            platform: 'youtube',
                            emoteId: 'UC_TEST_EMOTE_600/TEST_EMOTE_600',
                            imageUrl: 'https://yt3.ggpht.example.invalid/test-600=w48-h48-c-k-nd'
                        },
                        { type: 'text', text: 'defghi' }
                    ]
                }
            }
        });

        expect(mapped.text).toBe('abcde');
        expect(mapped.parts).toEqual([
            { type: 'text', text: 'abc' },
            {
                type: 'emote',
                platform: 'youtube',
                emoteId: 'UC_TEST_EMOTE_600/TEST_EMOTE_600',
                imageUrl: 'https://yt3.ggpht.example.invalid/test-600=w48-h48-c-k-nd'
            },
            { type: 'text', text: 'defghi' }
        ]);
    });

    it('omits parts when canonical message.parts is missing', async () => {
        const mapper = createMapper({ messageCharacterLimit: 0 });

        const mapped = await mapper.mapDisplayRow({
            type: 'chat',
            platform: 'tiktok',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                avatarUrl: 'https://example.invalid/avatar.png',
                message: {
                    text: ''
                }
            }
        });

        expect(mapped.parts).toBeUndefined();
    });

    it('resolves avatar by payload then cache then fallback', async () => {
        const mapper = createMapper();

        const payloadAvatar = await mapper.mapDisplayRow({
            type: 'chat',
            platform: 'twitch',
            data: {
                username: 'payload-user',
                userId: 'payload-user-id',
                avatarUrl: 'https://example.invalid/payload-avatar.png',
                message: 'hello'
            }
        });

        const cachedAvatar = await mapper.mapDisplayRow({
            type: 'platform:follow',
            platform: 'twitch',
            data: {
                username: 'payload-user',
                userId: 'payload-user-id',
                displayMessage: 'follow'
            }
        });

        const fallbackAvatar = await mapper.mapDisplayRow({
            type: 'platform:gift',
            platform: 'twitch',
            data: {
                username: 'unknown-user',
                userId: 'unknown-user-id',
                displayMessage: 'gift'
            }
        });

        expect(payloadAvatar.avatarUrl).toBe('https://example.invalid/payload-avatar.png');
        expect(cachedAvatar.avatarUrl).toBe('https://example.invalid/payload-avatar.png');
        expect(fallbackAvatar.avatarUrl).toBe(FALLBACK_AVATAR_URL);
    });

    it('does not overwrite cached real avatar with fallback payload for the same platform user', async () => {
        const mapper = createMapper();

        await mapper.mapDisplayRow({
            type: 'platform:follow',
            platform: 'twitch',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                avatarUrl: 'https://example.invalid/real-avatar.png',
                displayMessage: 'followed'
            }
        });

        const fallbackPayloadRow = await mapper.mapDisplayRow({
            type: 'platform:share',
            platform: 'twitch',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                avatarUrl: FALLBACK_AVATAR_URL,
                displayMessage: 'shared'
            }
        });

        const cachedAfterFallbackPayload = await mapper.mapDisplayRow({
            type: 'chat',
            platform: 'twitch',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                message: 'hello'
            }
        });

        expect(fallbackPayloadRow.avatarUrl).toBe('https://example.invalid/real-avatar.png');
        expect(cachedAfterFallbackPayload.avatarUrl).toBe('https://example.invalid/real-avatar.png');
    });

    it('does not cache fallback payload avatars as canonical cache entries', async () => {
        const mapper = createMapper({}, { avatarCacheMaxSize: 1 });

        await mapper.mapDisplayRow({
            type: 'chat',
            platform: 'twitch',
            data: {
                username: 'retained-user',
                userId: 'retained-user-id',
                avatarUrl: 'https://example.invalid/retained-avatar.png',
                message: 'hello'
            }
        });

        await mapper.mapDisplayRow({
            type: 'platform:follow',
            platform: 'twitch',
            data: {
                username: 'fallback-only-user',
                userId: 'fallback-only-user-id',
                avatarUrl: FALLBACK_AVATAR_URL,
                displayMessage: 'followed'
            }
        });

        const retained = await mapper.mapDisplayRow({
            type: 'platform:follow',
            platform: 'twitch',
            data: {
                username: 'retained-user',
                userId: 'retained-user-id',
                displayMessage: 'followed'
            }
        });

        expect(retained.avatarUrl).toBe('https://example.invalid/retained-avatar.png');
    });

    it('evicts oldest cached avatar entries when cache exceeds configured size', async () => {
        const mapper = createMapper({}, { avatarCacheMaxSize: 2 });

        await mapper.mapDisplayRow({
            type: 'chat',
            platform: 'twitch',
            data: {
                username: 'user-1',
                userId: 'user-1',
                avatarUrl: 'https://example.invalid/avatar-1.png',
                message: 'one'
            }
        });

        await mapper.mapDisplayRow({
            type: 'chat',
            platform: 'twitch',
            data: {
                username: 'user-2',
                userId: 'user-2',
                avatarUrl: 'https://example.invalid/avatar-2.png',
                message: 'two'
            }
        });

        await mapper.mapDisplayRow({
            type: 'chat',
            platform: 'twitch',
            data: {
                username: 'user-3',
                userId: 'user-3',
                avatarUrl: 'https://example.invalid/avatar-3.png',
                message: 'three'
            }
        });

        const evicted = await mapper.mapDisplayRow({
            type: 'platform:follow',
            platform: 'twitch',
            data: {
                username: 'user-1',
                userId: 'user-1',
                displayMessage: 'follow'
            }
        });

        const retained = await mapper.mapDisplayRow({
            type: 'platform:follow',
            platform: 'twitch',
            data: {
                username: 'user-2',
                userId: 'user-2',
                displayMessage: 'follow'
            }
        });

        expect(evicted.avatarUrl).toBe(FALLBACK_AVATAR_URL);
        expect(retained.avatarUrl).toBe('https://example.invalid/avatar-2.png');
    });

    it('keeps degraded anonymous monetization rows routable with fallback avatar', async () => {
        const mapper = createMapper();

        const mapped = await mapper.mapDisplayRow({
            type: 'platform:gift',
            platform: 'twitch',
            data: {
                isError: true,
                isAnonymous: true,
                giftType: 'bits',
                giftCount: 1,
                amount: 1,
                currency: 'bits',
                id: 'gift-err-1',
                timestamp: '2026-03-07T12:00:00.000Z',
                displayMessage: 'Error processing gift'
            }
        });

        expect(mapped).toEqual(expect.objectContaining({
            type: 'platform:gift',
            kind: 'notification',
            avatarUrl: FALLBACK_AVATAR_URL,
            text: 'Error processing gift'
        }));
    });

    it('uses the canonical fallback avatar when fallbackAvatarUrl option is omitted', async () => {
        const { createEventToGuiContractMapper } = require('../../../../src/services/gui/event-to-gui-contract-mapper');
        const mapper = createEventToGuiContractMapper({
            config: {
                gui: {
                    showFollows: true
                }
            }
        });

        const mapped = await mapper.mapDisplayRow({
            type: 'platform:follow',
            platform: 'twitch',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                displayMessage: 'followed'
            }
        });

        expect(mapped.avatarUrl).toBe(FALLBACK_AVATAR_URL);
    });
});
