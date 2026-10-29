import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createTikTokEventFactory } from '../../src/platforms/tiktok/events/event-factory';
import type { DisplayQueueItem } from '../../src/interfaces/DisplayQueue';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';

const timestamp = '2024-01-01T00:00:00.000Z';
const canonical = () => ({ username: 'Synthetic Envelope', userId: 'synthetic-envelope-handle',
    giftType: 'Treasure Chest', giftCount: 1, amount: 50, currency: 'coins',
    id: 'synthetic-envelope-id', timestamp });

async function fixture() {
    const h = await createMainPresentationFixture();
    h.config.general.logChatMessages = false;
    h.config.logging.file.enabled = false;
    h.config.logging.chat.enabled = false;
    try { await h.start(); return h; }
    catch (error) { await h.dispose(); throw error; }
}

for (const [label, overrides] of [
    ['missing amount', { amount: undefined }], ['zero amount', { amount: 0 }], ['negative amount', { amount: -1 }],
    ['nonnumeric amount', { amount: 'not_a_number' }], ['missing currency', { currency: '' }],
    ['missing timestamp', { timestamp: undefined }], ['invalid timestamp', { timestamp: 'synthetic-invalid' }],
    ['missing id', { id: undefined }], ['zero count', { giftCount: 0 }], ['negative count', { giftCount: -1 }],
    ['missing username', { username: undefined }], ['missing userId', { userId: undefined }],
    ['empty identity', { username: '', userId: '' }], ['null identity', { username: null, userId: null }],
    ['nested identity at canonical boundary', { username: undefined, userId: undefined, user: { uniqueId: 'synthetic-handle', nickname: 'Synthetic Name' } }],
] as const) {
    test(`real envelope runtime rejects ${label}, then presents valid recovery`, async () => {
        const h = await fixture();
        try {
            const rejected = await h.runtime.handleEnvelopeNotification('tiktok', { ...canonical(), ...overrides });
            expect(rejected).toMatchObject({ success: false });
            expect(h.queue.getQueueLength()).toBe(0);
            expect(await h.runtime.handleEnvelopeNotification('tiktok', canonical())).toMatchObject({ success: true });
            const item = h.queue.queue[0] as DisplayQueueItem;
            expect(item.type).toBe('platform:envelope');
            expect(item.data).toMatchObject({ username: 'Synthetic Envelope', userId: 'synthetic-envelope-handle', amount: 50,
                displayMessage: 'Synthetic Envelope sent a treasure chest!', ttsMessage: 'Synthetic En sent a treasure chest',
                logMessage: 'Treasure chest from Synthetic Envelope' });
            await h.drain();
            expect(h.rows).toHaveLength(1);
            expect(h.rows[0]?.data.displayMessage).toBe('Synthetic Envelope sent a treasure chest!');
        } finally { await h.dispose(); }
    });
}

for (const data of [null, {}]) {
    test(`real envelope runtime returns a failure for ${data === null ? 'null' : 'empty'} data`, async () => {
        const h = await fixture();
        try {
            expect(await h.runtime.handleEnvelopeNotification('tiktok', data as unknown as Parameters<typeof h.runtime.handleEnvelopeNotification>[1])).toMatchObject({ success: false });
            expect(h.queue.getQueueLength()).toBe(0);
            expect(await h.runtime.handleEnvelopeNotification('tiktok', canonical())).toMatchObject({ success: true });
            await h.drain();
            expect(h.rows).toHaveLength(1);
        } finally { await h.dispose(); }
    });
}

test('real canonical envelope keeps original metadata and contribution provenance through presentation', async () => {
    const h = await fixture();
    const data = { ...canonical(), amount: '250', eventId: 'synthetic-extra-id', platformSpecificField: 'synthetic-custom', additionalData: 'synthetic-rich' };
    try {
        expect(await h.runtime.handleEnvelopeNotification('tiktok', data)).toMatchObject({ success: true });
        const item = h.queue.queue[0] as DisplayQueueItem;
        expect(item.data.originalEnvelopeData).toEqual(data);
        expect(item.data.contributions).toEqual([{ platform: 'tiktok', type: 'platform:envelope', data: {
            id: data.id, timestamp, userId: data.userId, giftType: 'Treasure Chest', giftCount: 1, amount: 250, currency: 'coins', isError: false,
        } }]);
        await h.drain();
        expect(h.rows[0]?.data.contributions).toEqual(item.data.contributions);
        expect(h.rows[0]?.data.originalEnvelopeData).toEqual(data);
        expect(data.amount).toBe('250');
    } finally { await h.dispose(); }
});

for (const identity of [{ username: 'SynthError', userId: 'synthetic-error-handle' }, {}]) {
    test(`actual legacy error envelope without id preserves ${'username' in identity ? 'canonical' : 'absent'} identity without credit`, async () => {
        const h = await fixture();
        const data = { ...identity, giftType: 'Treasure Chest', giftCount: 0, amount: 0,
            currency: 'coins', timestamp, isError: true };
        const expected = `Error processing treasure chest${'username' in identity ? ' from SynthError' : ''}`;
        try {
            expect(await h.runtime.handleEnvelopeNotification('tiktok', data)).toMatchObject({ success: true });
            const item = h.queue.queue[0] as DisplayQueueItem;
            expect(item.data).toMatchObject({ ...identity, isError: true, amount: 0, giftCount: 0,
                displayMessage: expected, ttsMessage: expected, logMessage: expected, originalEnvelopeData: data });
            expect(item.data.contributions).toEqual([{ platform: 'tiktok', type: 'platform:envelope', data: {
                ...('userId' in identity ? { userId: identity.userId } : {}),
                timestamp, giftType: 'Treasure Chest', giftCount: 0, amount: 0, currency: 'coins', isError: true,
            } }]);
            await h.drain();
            expect(h.rows).toHaveLength(1);
            expect(h.rows[0]?.data.displayMessage).toBe(expected);
            expect(h.funding.snapshot.currentUsd).toBe(0);
            await expect(readFile(h.fundingPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
            expect(h.runtime.userTrackingService.isStreamSupporter?.('tiktok', 'synthetic-error-handle')).toBe(false);
        } finally { await h.dispose(); }
    });
}

test('actual legacy factory output routes through the real root with canonical identity and exact presentation', async () => {
    const h = await fixture();
    const event = createTikTokEventFactory().createEnvelope({
        user: { uniqueId: 'synthetic-legacy-handle', nickname: 'SynthChest', userId: 'synthetic-provider-id' },
        amount: 50, currency: 'coins', id: 'synthetic-legacy-id', timestamp,
    });
    try {
        await h.runtime.platformEventRouter.routeEvent({ type: 'platform:envelope', platform: 'tiktok', data: event });
        const item = h.queue.queue[0] as DisplayQueueItem;
        expect(item.data).toMatchObject({ username: 'SynthChest', userId: 'synthetic-legacy-handle', amount: 50,
            displayMessage: 'SynthChest sent a treasure chest!', ttsMessage: 'SynthChest sent a treasure chest',
            logMessage: 'Treasure chest from SynthChest' });
        expect(item.data.originalEnvelopeData).toMatchObject(event);
        await h.drain();
        expect(h.rows).toHaveLength(1);
        expect(h.rows[0]?.data.displayMessage).toBe('SynthChest sent a treasure chest!');
        expect(h.rows[0]?.data.contributions).toEqual(item.data.contributions);
    } finally { await h.dispose(); }
});
