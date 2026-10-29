import { expect, test, spyOn } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { WebcastEnvelopeMessage, CommonMessageData, MessageRedEnvelopInfo, EnvelopeBusinessType, ImageModel } from 'tiktok-live-proto/v3';
import { TikTokWebSocketClient } from '../../src/platforms/tiktok-websocket-client';
import { TikTokPlatform } from '../../src/platforms/tiktok';
import type { createOBSGoalsManager } from '../../src/obs/goals';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { createEventToGuiContractMapper } from '../../src/services/gui/event-to-gui-contract-mapper';
import { createGuiFeedStore } from '../../gui/src/shared/feed-store';
import type { DisplayQueue } from '../../src/obs/display-queue';
import { withTimeout } from '../../src/utils/timeout-wrapper';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';
import { adaptTikTokEvent } from '../../src/platforms/tiktok/tiktok-event-adapter';
import { noOpLogger as logger } from '../helpers/mock-factories';

const empty = new Uint8Array();
function encodedEnvelope(businessType: EnvelopeBusinessType, overrides = {}) {
    return WebcastEnvelopeMessage.decode(WebcastEnvelopeMessage.encode({
        ...WebcastEnvelopeMessage.decode(empty),
        common: { ...CommonMessageData.decode(empty), msgId: '9000000000000000011', createTime: '1700000000' },
        envelopeInfo: { ...MessageRedEnvelopInfo.decode(empty), businessType, envelopeId: '9000000000000000012',
            sendUserName: 'Synthetic Sender', sendUserId: '9000000000000000013',
            sendUserAvatar: { ...ImageModel.decode(empty), urlList: ['https://example.invalid/synthetic-envelope-avatar.png'] }, diamondCount: 50, peopleCount: 2, ...overrides },
    }).finish());
}
class SyntheticSDK extends EventEmitter {
    isConnected = false;
    roomId = '9000000000000000010';
    async connect() { this.isConnected = true; this.emit('enterRoom'); }
    async disconnect() { this.isConnected = false; }
}
function sdkPlatform(sdk: SyntheticSDK) {
    let client: TikTokWebSocketClient | undefined;
    // Preserve the real connection factory/client; only connector acquisition is synthetic.
    class Client extends TikTokWebSocketClient {
        constructor(username: string, options: ConstructorParameters<typeof TikTokWebSocketClient>[1]) {
            super(username, { ...options, connectorFactory: async () => sdk });
            client = this;
        }
    }
    const platform = new TikTokPlatform({ enabled: true, username: 'synthetic-streamer', dataLoggingEnabled: false }, {
        logger, TikTokWebSocketClient: Client,
        WebcastEvent: { CHAT: 'chat', GIFT: 'gift', FOLLOW: 'follow', SOCIAL: 'social', ROOM_USER: 'roomUser', ERROR: 'error', DISCONNECT: 'disconnected', ENVELOPE: 'envelope' },
        ControlEvent: { CONNECTED: 'connected', DISCONNECTED: 'disconnected', ERROR: 'error' },
    });
    return { platform, get client() { if (!client) throw new Error('Expected actual client acquisition'); return client; } };
}
function firstNotification(queue: DisplayQueue): DisplayQueueItem {
    const entry = queue.queue[0];
    if (!entry || !('data' in entry)) throw new Error('Expected a synthetic envelope notification item');
    return entry;
}
async function presentation() {
    const h = await createMainPresentationFixture();
    h.config.general.logChatMessages = false;
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    Object.assign(h.config.goals, { tiktokGoalEnabled: true, tiktokGoalSource: 'synthetic-envelope-goal',
        tiktokGoalTarget: 1000, tiktokGoalCurrency: 'coins' });
    Object.assign(h.config.gui, { showEnvelopes: true, messageCharacterLimit: 0 });
    let unsubscribe: (() => void) | undefined;
    let info: ReturnType<typeof spyOn> | undefined;
    const mapped: Promise<unknown>[] = [];
    try {
        await h.start();
        const diagnosticSpy = spyOn(h.runtime.logger, 'info');
        info = diagnosticSpy;
        const feed = createGuiFeedStore();
        const mapper = createEventToGuiContractMapper({ config: h.config });
        unsubscribe = h.bus.subscribe('display:row', item => {
            mapped.push(mapper.mapDisplayRow(item as DisplayQueueItem).then(row => feed.pushEvent(row)));
        });
        const goals = h.runtime.dependencies.obs?.goalsManager as ReturnType<typeof createOBSGoalsManager>;
        return { runtime: h.runtime, queue: h.queue, feed, presented: h.rows, goals,
            funding: h.funding, fundingFile: h.fundingPath, tracking: h.runtime.userTrackingService,
            get diagnostics() { return diagnosticSpy.mock.calls.map(call => call[0]); },
            present: async () => { await h.drain(); await Promise.all(mapped); },
            cleanup: async () => {
                try { unsubscribe?.(); await Promise.allSettled(mapped); await h.dispose(); }
                finally { info?.mockRestore(); }
            } };
    } catch (error) {
        try { unsubscribe?.(); await Promise.allSettled(mapped); await h.dispose(); }
        finally { info?.mockRestore(); }
        throw error;
    }
}
for (const sender of ['complete', 'name-only', 'absent'] as const) {
    for (const businessType of [EnvelopeBusinessType.BUSINESS_TYPE_USER_DIAMOND, EnvelopeBusinessType.BUSINESS_TYPE_UNKNOWN, EnvelopeBusinessType.SUPER_FAN_BOX]) {
        test(`encoded envelope type ${businessType}, sender ${sender}, retains descriptive metadata without invented credit through enabled listener/router`, async () => {
            const h = await presentation();
            let platform: TikTokPlatform | undefined;
            const pending: Promise<void>[] = [];
            try {
                const sdk = new SyntheticSDK();
                const transport = sdkPlatform(sdk);
                platform = transport.platform;
                const output: Record<string, unknown>[] = [];
                let observed!: () => void;
                const envelopeObserved = new Promise<void>(resolve => { observed = resolve; });
                platform.on('platform:event', event => {
                    if (event.type === 'platform:envelope') {
                        output.push(event.data);
                        pending.push(h.runtime.platformEventRouter.routeEvent(event));
                        observed();
                    }
                });
                await platform.initialize();
                const data = encodedEnvelope(businessType, {
                    ...(sender !== 'complete' ? { sendUserId: '' } : {}),
                    ...(sender === 'absent' ? { sendUserName: '' } : {}),
                });
                sdk.emit('envelope', data);
                sdk.emit('superFanBox', data); // The connector emits both; the box alias must not add credit/output.
                await withTimeout(envelopeObserved, 2000);
                await Promise.all(pending);
                expect(output).toHaveLength(1);
                expect(output[0]).toMatchObject({ isError: true, ...(sender === 'absent' ? {} : { username: 'Synthetic Sender' }), id: '9000000000000000011',
                    timestamp: '2023-11-14T22:13:20.000Z', avatarUrl: 'https://example.invalid/synthetic-envelope-avatar.png', giftType: businessType === EnvelopeBusinessType.SUPER_FAN_BOX ? 'Super Fan Box' : 'Envelope',
                    metadata: { envelope: { ...(sender === 'complete' ? { senderId: '9000000000000000013' } : {}), ...(sender === 'absent' ? {} : { senderName: 'Synthetic Sender' }), diamondCount: 50, peopleCount: 2, businessType } } });
                const queued = firstNotification(h.queue);
                expect(queued).toBeDefined();
                const label = businessType === EnvelopeBusinessType.SUPER_FAN_BOX ? 'super fan box' : 'envelope';
                const expected = `Error processing ${label}${sender === 'absent' ? '' : ' from Synthetic Sender'}`;
                expect(queued.data.displayMessage).toBe(expected);
                expect(queued.data.ttsMessage).toBe(expected);
                expect(queued.data.logMessage).toBe(expected);
                expect(queued.data.isError).toBe(true);
                await h.present();
                expect(h.presented).toHaveLength(1);
                expect(h.feed.getRows()).toHaveLength(1);
                expect(h.feed.getRows()[0]?.text).toBe(expected);
                expect(h.goals.getCurrentGoalStatus('tiktok')?.current).toBe(0);
                expect(h.funding.snapshot.currentUsd).toBe(0);
                await expect(readFile(h.fundingFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
                expect(h.tracking.isStreamSupporter?.('tiktok', '9000000000000000013')).toBe(false);
                expect(h.diagnostics).toContain('[Envelope] Envelope event on tiktok');
                if (sender === 'absent') expect(output[0]).not.toHaveProperty('username');
                expect(output[0]).not.toHaveProperty('userId');
                expect(output[0]).not.toHaveProperty('amount');
                expect(output[0]).not.toHaveProperty('currency');
                await platform.cleanup();
                expect(transport.client.isConnected).toBe(false);
                expect(sdk.isConnected).toBe(false);
                sdk.emit('envelope', data);
                await Promise.all(pending);
                expect(output).toHaveLength(1);
                expect(h.queue.getQueueLength()).toBe(0);
            } finally {
                try { await platform?.cleanup(); }
                finally { await Promise.allSettled(pending); await h.cleanup(); }
            }
        });
    }
}
test('partial envelope metadata validates counts and avatars without fabricating handles', () => {
    for (const diamondCount of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, false]) {
        const adapted = adaptTikTokEvent('envelope', { envelopeInfo: { sendUserName: ' Synthetic Sender ', sendUserId: '9000000000000000013', diamondCount,
            sendUserAvatar: { urlList: ['javascript:synthetic'] } } });
        expect(adapted).not.toHaveProperty('user');
        expect(adapted.metadata).toMatchObject({ envelope: { senderName: 'Synthetic Sender', senderId: '9000000000000000013' } });
        expect((adapted.metadata as { envelope: object }).envelope).not.toHaveProperty('diamondCount');
        expect(adapted.avatarUrl).toBeUndefined();
    }
    const adapted = adaptTikTokEvent('envelope', encodedEnvelope(EnvelopeBusinessType.BUSINESS_TYPE_UNKNOWN, { sendUserName: '', diamondCount: 0 }));
    expect((adapted.metadata as { envelope: object }).envelope).not.toHaveProperty('senderName');
    expect((adapted.metadata as { envelope: object }).envelope).toMatchObject({ diamondCount: 0 });
});

test('the connector display-key superfan classification is retained without priced fields', () => {
    const adapted = adaptTikTokEvent('envelope', {
        common: { displayText: { key: 'synthetic_ttlive_superfanbox_message' } },
        envelopeInfo: { businessType: 0, sendUserName: 'Synthetic Box Sender' },
    });
    expect(adapted.metadata).toMatchObject({ envelope: { isSuperFanBox: true } });
    expect(adapted).not.toHaveProperty('amount');
    expect(adapted).not.toHaveProperty('currency');
});

for (const [giftType, label] of [
    ['Treasure Chest', 'treasure chest'], ['Super Fan Box', 'super fan box'], ['Envelope', 'envelope'],
    ['  SUPER FAN BOX  ', 'super fan box'], ['Synthetic untrusted label', 'envelope'], ['', 'envelope'], [undefined, 'envelope'],
] as const) {
    test(`degraded envelope validates label ${String(giftType)} through actual presentation`, async () => {
        const h = await presentation();
        try {
            const result = await h.runtime.handleEnvelopeNotification('tiktok', {
                isError: true, giftType, timestamp: '2023-11-14T22:13:20.000Z', id: 'synthetic-error-envelope',
            });
            expect(result).toMatchObject({ success: true });
            const queued = firstNotification(h.queue);
            for (const field of ['displayMessage', 'ttsMessage', 'logMessage']) {
                expect(queued.data[field]).toBe(`Error processing ${label}`);
            }
            await h.present();
            expect(h.feed.getRows()[0]?.text).toBe(`Error processing ${label}`);
            expect(h.goals.getCurrentGoalStatus('tiktok')?.current).toBe(0);
            expect(h.funding.snapshot.currentUsd).toBe(0);
            await expect(readFile(h.fundingFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        } finally { await h.cleanup(); }
    });
}
test('canonical legacy chest wording and incomplete non-error guards remain intact', async () => {
    const h = await presentation();
    const data = { username: 'SynthLegacy', userId: 'synthetic-legacy-viewer', giftType: 'Treasure Chest',
        giftCount: 1, amount: 25, currency: 'coins', id: 'synthetic-legacy-envelope', timestamp: '2023-11-14T22:13:20.000Z' };
    try {
        const rejected = await h.runtime.handleEnvelopeNotification('tiktok', { ...data, userId: undefined });
        expect(rejected).toMatchObject({ success: false });
        expect(h.queue.getQueueLength()).toBe(0);
        const accepted = await h.runtime.handleEnvelopeNotification('tiktok', data);
        expect(accepted).toMatchObject({ success: true });
        const queued = firstNotification(h.queue);
        expect(queued.data).toMatchObject({ giftType: 'Treasure Chest', amount: 25, currency: 'coins', isError: false,
            displayMessage: 'SynthLegacy sent a treasure chest!', ttsMessage: 'SynthLegacy sent a treasure chest',
            logMessage: 'Treasure chest from SynthLegacy' });
        await h.present();
        expect(h.feed.getRows()[0]?.text).toBe('SynthLegacy sent a treasure chest!');
    } finally { await h.cleanup(); }
});
