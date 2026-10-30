import { expect, test, setSystemTime } from 'bun:test';
import { CommonMessageData, User, ImageModel, BadgeStruct, ImageBadge, EmoteModel,
    WebcastChatMessage, WebcastEmoteChatMessage, WebcastGiftMessage, Gift } from 'tiktok-live-proto/v3';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { createTikTokLifetimeFixture, flushConnectorSetup } from '../helpers/tiktok-connector-fixture';
import { createEventToGuiContractMapper } from '../../src/services/gui/event-to-gui-contract-mapper';
import { createGuiFeedStore } from '../../gui/src/shared/feed-store';
import { withTimeout } from '../../src/utils/timeout-wrapper';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';

const empty = new Uint8Array();
const epoch = 1800000000000;
const image = (name: string) => ({ ...ImageModel.decode(empty), urlList: [`https://example.invalid/synthetic-${name}.png`] });
const common = (msgId: string) => ({ ...CommonMessageData.decode(empty), msgId, createTime: '1800000000' });
const user = { ...User.decode(empty), id: '9000000000000000003', displayId: 'synthetic-viewer', nickname: 'Synthetic Viewer',
    avatarThumb: image('avatar'), badgeList: [{ ...BadgeStruct.decode(empty), displayType: 1,
        image: { ...ImageBadge.decode(empty), image: image('badge') } }] };
const emote = { ...EmoteModel.decode(empty), emoteId: 'synthetic-emote', image: image('emote') };

async function presentation(aggregate = false) {
    const h = await createMainPresentationFixture();
    const fixture = createTikTokLifetimeFixture({ messagesEnabled: true, giftsEnabled: true, greetingsEnabled: false,
        giftAggregationEnabled: aggregate, envFileReadEnabled: false, envFileWriteEnabled: false });
    const { platform } = fixture;
    Object.assign(h.config.general, { messagesEnabled: true, giftsEnabled: true, greetingsEnabled: false });
    Object.assign(h.config.tiktok, { messagesEnabled: true, giftsEnabled: true, greetingsEnabled: false });
    const routed: Promise<unknown>[] = [];
    const mapped: Promise<unknown>[] = [];
    const feed = createGuiFeedStore();
    const mapper = createEventToGuiContractMapper({ config: h.config });
    let unsubscribe: (() => void) | undefined;
    const cleanup = async () => {
        try {
            await fixture.cleanup();
            await Promise.allSettled(routed);
            unsubscribe?.();
            await Promise.allSettled(mapped);
        } finally {
            try { await h.dispose(); } finally { setSystemTime(); }
        }
    };
    try {
        setSystemTime(new Date(epoch));
        await h.start();
        platform.on('platform:event', event => {
            if (event.type === 'platform:chat-message' || event.type === 'platform:gift') {
                routed.push(h.runtime.platformEventRouter.routeEvent(event));
            }
        });
        unsubscribe = h.bus.subscribe('display:row', row => {
            mapped.push(mapper.mapDisplayRow(row as DisplayQueueItem).then(result => feed.pushEvent(result)));
        });
        const connecting = platform.initialize();
        await flushConnectorSetup();
        const sdk = fixture.connectors[0]!;
        sdk.open(); sdk.enter(); await connecting;
        return { platform, sdk, feed, cleanup,
            async send(source: string, payload: unknown, expectedType: string) {
                let listener: ((event: { type: string }) => void) | undefined;
                const observed = new Promise<void>(resolve => {
                    listener = event => { if (event.type === expectedType) resolve(); };
                    platform.on('platform:event', listener);
                });
                try { sdk.emit(source, payload); await withTimeout(observed, 2000); await Promise.all(routed); }
                finally { if (listener) platform.off('platform:event', listener); }
            },
            async drain() { await h.drain(); await Promise.all(mapped); },
        };
    } catch (error) { await cleanup(); throw error; }
}

test('v3 thumbnail avatars, badges and standalone emotes reach final GUI rows once across replay', async () => {
    const h = await presentation();
    try {
        const chat = WebcastChatMessage.decode(WebcastChatMessage.encode({ ...WebcastChatMessage.decode(empty),
            common: common('9000000000000000010'), user, content: 'synthetic hello', emotes: [{ index: 0, emote }] }).finish());
        await h.send('chat', chat, 'platform:chat-message');
        h.sdk.emit('chat', chat); // Replayed packet must not create another row.
        const standalone = WebcastEmoteChatMessage.decode(WebcastEmoteChatMessage.encode({ ...WebcastEmoteChatMessage.decode(empty),
            common: common('9000000000000000011'), user, emoteList: [emote, { ...emote, emoteId: 'synthetic-second' }] }).finish());
        await h.send('emote', standalone, 'platform:chat-message');
        await h.drain();
        const rows = h.feed.getRows();
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row).toMatchObject({ platform: 'tiktok', username: 'Synthetic Viewer', avatarUrl: 'https://example.invalid/synthetic-avatar.png',
                badgeImages: [{ imageUrl: 'https://example.invalid/synthetic-badge.png', source: 'tiktok', label: '' }] });
        }
        expect(rows[0]?.text).toBe('synthetic hello');
        expect(rows[0]?.parts?.[0]).toEqual({ type: 'emote', platform: 'tiktok', emoteId: 'synthetic-emote', imageUrl: 'https://example.invalid/synthetic-emote.png' });
        expect(rows[1]?.text).toBe('');
        expect(rows[1]?.parts?.map(part => part.type === 'emote' && part.emoteId)).toEqual(['synthetic-emote', 'synthetic-second']);
    } finally { await h.cleanup(); }
});

test.each([false, true])('v3 gift media and cumulative counts survive to the GUI (aggregation=%s)', async aggregate => {
    const h = await presentation(aggregate);
    const gift = (id: string, repeatCount: number, repeatEnd: number) => WebcastGiftMessage.decode(WebcastGiftMessage.encode({
        ...WebcastGiftMessage.decode(empty), common: common(id), user, repeatCount, repeatEnd, groupId: '9000000000000000020',
        gift: { ...Gift.decode(empty), name: 'Synthetic Rose', type: 1, diamondCount: 5, icon: image('gift') },
    }).finish());
    try {
        h.sdk.emit('gift', gift('9000000000000000021', 1, 0));
        h.sdk.emit('gift', gift('9000000000000000022', 2, 0));
        const completed = gift('9000000000000000023', 3, 1);
        if (aggregate) {
            h.sdk.emit('gift', completed);
            h.sdk.emit('gift', completed);
            await flushConnectorSetup();
            await h.platform.cleanupGiftAggregation();
        } else {
            await h.send('gift', completed, 'platform:gift');
            h.sdk.emit('gift', completed);
        }
        await h.drain();
        const rows = h.feed.getRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ platform: 'tiktok', username: 'Synthetic Viewer', avatarUrl: 'https://example.invalid/synthetic-avatar.png' });
        expect(rows[0]?.parts).toEqual([
            { type: 'text', text: 'sent 3x ' },
            { type: 'emote', platform: 'tiktok', emoteId: 'Synthetic Rose', imageUrl: 'https://example.invalid/synthetic-gift.png' },
            { type: 'text', text: ' (15 coins)' },
        ]);
    } finally { await h.cleanup(); }
});
