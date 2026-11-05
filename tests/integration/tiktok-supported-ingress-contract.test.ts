import { expect, test } from 'bun:test';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { createTikTokLifetimeFixture, flushConnectorSetup } from '../helpers/tiktok-connector-fixture';
import testClock from '../helpers/test-clock';
import { UNKNOWN_CHAT_MESSAGE } from '../../src/constants/degraded-chat';

function payload(id: string) {
    return {
        user: { id: '9000000000000000091', displayId: 'synthetic-ingress-viewer', nickname: 'Synthetic Ingress Viewer' },
        common: { msgId: id, createTime: testClock.now() },
    };
}

test('malformed emotes degrade safely, unsupported questions stay excluded, and valid emote chat recovers', async () => {
    const h = await createMainPresentationFixture();
    h.config.general.greetingsEnabled = false;
    h.config.tiktok.greetingsEnabled = false;
    const fixture = createTikTokLifetimeFixture({
        envFileReadEnabled: false, envFileWriteEnabled: false, greetingsEnabled: false,
    });
    const routed: Promise<unknown>[] = [];
    const chats: Record<string, unknown>[] = [];
    try {
        await h.start();
        fixture.platform.on('platform:event', event => {
            if (event.type === 'platform:chat-message') {
                chats.push(event.data);
                routed.push(h.runtime.platformEventRouter.routeEvent(event));
            }
        });
        const connecting = fixture.platform.initialize();
        await flushConnectorSetup();
        const sdk = fixture.connectors[0]!;
        sdk.open(); sdk.enter(); await connecting;

        const invalidEmotes = [[], [null], [{ emoteId: 'synthetic-invalid', image: { urlList: ['javascript:synthetic'] } }]];
        for (const [index, emoteList] of invalidEmotes.entries()) {
            sdk.emit('emote', { ...payload(`synthetic-invalid-emote-${index}`), emoteList });
            await flushConnectorSetup();
        }
        sdk.emit('questionNew', { ...payload('synthetic-unsupported-question'), content: 'Synthetic unsupported question' });
        await flushConnectorSetup();
        await Promise.all(routed);
        expect(chats).toHaveLength(3);
        for (const chat of chats) {
            expect(chat).toMatchObject({ message: { text: UNKNOWN_CHAT_MESSAGE }, metadata: { missingFields: ['message'] } });
            expect(chat.message).not.toHaveProperty('parts');
        }
        await h.drain();
        expect(h.rows).toHaveLength(3);

        const valid = { ...payload('synthetic-recovery-emote'), emoteList: [{
            emoteId: 'synthetic-recovery', image: { urlList: ['https://example.invalid/synthetic-recovery.png'] },
        }] };
        sdk.emit('emote', valid);
        await flushConnectorSetup();
        sdk.emit('emote', valid);
        await flushConnectorSetup();
        await Promise.all(routed);
        expect(chats).toHaveLength(4);
        await h.drain();
        expect(h.rows).toHaveLength(4);
        expect(h.rows[3]?.data).toMatchObject({
            userId: 'synthetic-ingress-viewer',
            message: { text: '', parts: [{ type: 'emote', platform: 'tiktok', emoteId: 'synthetic-recovery',
                imageUrl: 'https://example.invalid/synthetic-recovery.png' }] },
        });
        expect(h.funding.snapshot.currentUsd).toBe(0);
    } finally {
        try { await fixture.cleanup(); await Promise.allSettled(routed); }
        finally { await h.dispose(); }
    }
});

test('SDK stream end retires delivery before late membership, share and emote packets', async () => {
    const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
    const events: { type: string; data: Record<string, unknown> }[] = [];
    fixture.platform.on('platform:event', event => { events.push(event); });
    try {
        const connecting = fixture.platform.initialize();
        await flushConnectorSetup();
        const sdk = fixture.connectors[0]!;
        sdk.open(); sdk.enter(); await connecting;
        events.length = 0;

        sdk.emit('streamEnd');
        sdk.emit('streamEnd');
        sdk.emit('subNotify', { ...payload('synthetic-late-subscription'), subMonth: 1 });
        sdk.emit('superFan', { ...payload('synthetic-late-superfan'), msgType: 4 });
        sdk.emit('share', payload('synthetic-late-share'));
        sdk.emit('emote', { ...payload('synthetic-late-emote'), emoteList: [{
            emoteId: 'synthetic-late', image: { urlList: ['https://example.invalid/synthetic-late.png'] },
        }] });
        await flushConnectorSetup();

        const statuses = events.filter(event => event.type === 'platform:stream-status');
        expect(statuses).toHaveLength(1);
        expect(statuses[0]?.data).toMatchObject({ isLive: false, status: 'stream-ended', willReconnect: true });
        expect(events.filter(event => ['platform:paypiggy', 'platform:share', 'platform:chat-message'].includes(event.type))).toHaveLength(0);
        expect(fixture.platform.connectionStatus).toBe(false);
        expect(sdk.isConnected).toBe(false);
    } finally { await fixture.cleanup(); }
});
