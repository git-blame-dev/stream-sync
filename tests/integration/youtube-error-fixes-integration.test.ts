import { describe, expect, it } from 'bun:test';
import { YouTubePlatform } from '../../src/platforms/youtube';
import { noOpLogger } from '../helpers/mock-factories';
import { InnertubeService } from '../../src/services/innertube-service';
import { YouTubeStreamDetectionService } from '../../src/services/youtube-stream-detection-service';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';

function fixture() {
    const owner = new InnertubeService({ createWithTimeout: async () => ({ getInfo: async () => {
        throw new Error('Unexpected synthetic metadata request');
    } }) }, { logger: noOpLogger });
    const platform = new YouTubePlatform({ enableAPI: false, dataLoggingEnabled: false,
        envFileReadEnabled: false, envFileWriteEnabled: false }, {
        logger: noOpLogger, innertubeService: owner, streamDetectionService: new YouTubeStreamDetectionService(owner, { logger: noOpLogger })
    });
    return { platform, async close() { await platform.cleanup(); await owner.dispose(); } };
}

const paid = (id: string, purchase_amount: string, message?: string) => ({ item: {
    type: 'LiveChatPaidMessage', id, purchase_amount, timestamp_usec: '1704067200000000',
    author: { id: 'UC_SYNTHETIC_DONOR', name: 'Synthetic Donor', thumbnails: [], badges: [] },
    ...(message === undefined ? {} : { message: { text: message } })
} });

describe('YouTube Super Chat platform conversion', () => {
    it('converts supported amounts and the full or absent message through the actual platform handler', async () => {
        const f = fixture();
        const { platform } = f;
        const events: Array<Record<string, unknown>> = [];
        platform.on('platform:event', event => { if (event.type === 'platform:gift') events.push(event.data); });
        try {
            for (const [id, amount, message] of [
                ['synthetic_ca', 'CA$2.00', undefined],
                ['synthetic_ars', 'ARS$500.00', 'Synthetic complete message'],
                ['synthetic_us', '$19.99', 'Synthetic USD message'],
                ['synthetic_eu', '€10.50', 'Synthetic EUR message']
            ] as const) await platform.handleSuperChat(paid(id, amount, message));
            expect(events.map(({ id, amount, currency, message }) => ({ id, amount, currency, message }))).toEqual([
                { id: 'synthetic_ca', amount: 2, currency: 'CAD', message: undefined },
                { id: 'synthetic_ars', amount: 500, currency: 'ARS', message: 'Synthetic complete message' },
                { id: 'synthetic_us', amount: 19.99, currency: 'USD', message: 'Synthetic USD message' },
                { id: 'synthetic_eu', amount: 10.5, currency: 'EUR', message: 'Synthetic EUR message' }
            ]);
            expect(events.every(event => event.username === 'Synthetic Donor' && event.userId === 'UC_SYNTHETIC_DONOR')).toBe(true);
            expect(platform.connectionManager.isApiEnabled()).toBe(false);
        } finally { await f.close(); }
    });

    it('emits a gift error for malformed money and processes the next valid gift', async () => {
        const f = fixture();
        const { platform } = f;
        const events: Array<Record<string, unknown>> = [];
        platform.on('platform:event', event => { if (event.type === 'platform:gift') events.push(event.data); });
        try {
            await platform.handleSuperChat(paid('synthetic_invalid', '$1.2.3', 'Synthetic invalid'));
            await platform.handleSuperChat(paid('synthetic_valid', '$19.99', 'Synthetic recovery'));
            expect(events).toHaveLength(2);
            expect(events[0]).toMatchObject({ isError: true, giftType: 'Super Chat' });
            expect(events[1]).toMatchObject({ id: 'synthetic_valid', amount: 19.99, currency: 'USD', message: 'Synthetic recovery' });
        } finally { await f.close(); }
    });

    it('presents a converted Super Chat through the real main runtime and display queue', async () => {
        const f = fixture();
        const h = await createMainPresentationFixture();
        h.config.logging.file.enabled = false;
        h.config.logging.chat.enabled = false;
        const events: Array<{ type: string; data: Record<string, unknown> }> = [];
        f.platform.on('platform:event', event => { if (event.type === 'platform:gift') events.push(event); });
        try {
            await h.start();
            await f.platform.handleSuperChat(paid('synthetic_row', '$19.99', 'Synthetic full message'));
            expect(events).toHaveLength(1);
            await h.runtime.platformEventRouter.routeEvent({ platform: 'youtube', ...events[0]! });
            await h.drain();
            expect(h.rows).toHaveLength(1);
            expect(h.rows[0]).toMatchObject({ type: 'platform:gift', platform: 'youtube', data: {
                username: 'Synthetic Donor', amount: 19.99, currency: 'USD', giftType: 'Super Chat',
                displayMessage: 'Synthetic Donor sent a $19.99 Super Chat: Synthetic full message'
            } });
        } finally { await f.close(); await h.dispose(); }
    });
});
