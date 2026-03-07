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
    it('maps every supported source row to stable GUI kind/toggle contracts', async () => {
        const mapper = createMapper();

        const cases = [
            { type: 'chat', expectedKind: 'chat', expectedToggle: 'showMessages', data: { message: 'hi' } },
            { type: 'command', expectedKind: 'command', expectedToggle: 'showCommands', data: { displayMessage: 'user used command !test' } },
            { type: 'greeting', expectedKind: 'greeting', expectedToggle: 'showGreetings', data: { displayMessage: 'welcome' } },
            { type: 'farewell', expectedKind: 'farewell', expectedToggle: 'showFarewells', data: { displayMessage: 'bye' } },
            { type: 'platform:follow', expectedKind: 'notification', expectedToggle: 'showFollows', data: { displayMessage: 'followed' } },
            { type: 'platform:share', expectedKind: 'notification', expectedToggle: 'showShares', data: { displayMessage: 'shared' } },
            { type: 'platform:raid', expectedKind: 'notification', expectedToggle: 'showRaids', data: { displayMessage: 'raided' } },
            { type: 'platform:gift', expectedKind: 'notification', expectedToggle: 'showGifts', data: { displayMessage: 'gifted' } },
            { type: 'platform:paypiggy', expectedKind: 'notification', expectedToggle: 'showPaypiggies', data: { displayMessage: 'subscribed' } },
            { type: 'platform:giftpaypiggy', expectedKind: 'notification', expectedToggle: 'showGiftPaypiggies', data: { displayMessage: 'gifted memberships' } },
            { type: 'platform:envelope', expectedKind: 'notification', expectedToggle: 'showEnvelopes', data: { displayMessage: 'treasure chest' } }
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
                toggleKey: testCase.expectedToggle,
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
