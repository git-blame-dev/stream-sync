import { expect, test } from 'bun:test';
import { createTwitchEventSubEventRouter } from '../../src/platforms/twitch/events/event-router';
import { createTwitchEventFactory } from '../../src/platforms/twitch/events/event-factory';
import { TwitchPlatform } from '../../src/platforms/twitch';
import { TwitchApiClient } from '../../src/utils/api-clients/twitch-api-client';
import { DEFAULT_AVATAR_URL } from '../../src/constants/avatar';
import { noOpLogger } from '../helpers/mock-factories';

const timestamp = '2026-01-01T00:00:00.000Z';
for (const kind of ['bits', 'subscription'] as const) {
    for (const identity of [{}, { user_name: 'Synthetic Donor', user_id: 'synthetic-donor' }, { user_id: 'synthetic-partial-donor' }]) {
        test(`anonymous ${kind} suppresses donor fields for ${Object.keys(identity).length} supplied identity fields`, () => {
            const emitted: Record<string, unknown>[] = [];
            const factory = createTwitchEventFactory();
            const router = createTwitchEventSubEventRouter({ logger: noOpLogger, emit: (_name, payload) => {
                const data = payload as Record<string, unknown>;
                expect(data).not.toHaveProperty('username');
                expect(data).not.toHaveProperty('userId');
                emitted.push(kind === 'bits' ? factory.createGiftEvent(data) : factory.createGiftPaypiggyEvent(data));
            } });
            const event = { ...identity, is_anonymous: true, timestamp };
            if (kind === 'bits') router.handleBitsUseEvent({ ...event, id: 'synthetic-bits', bits: 100, type: 'power_up', power_up: { type: 'message_effect' } });
            else router.handlePaypiggyGiftEvent({ ...event, tier: '1000', total: 2 });
            expect(emitted).toHaveLength(1);
            expect(emitted[0]).toMatchObject({ isAnonymous: true, avatarUrl: DEFAULT_AVATAR_URL });
            expect(emitted[0]).not.toHaveProperty('username');
            expect(emitted[0]).not.toHaveProperty('userId');
        });
    }
    test(`anonymous ${kind} factory suppresses supplied identity and avatar`, () => {
        const factory = createTwitchEventFactory();
        const data = { isAnonymous: true, username: 'Synthetic Donor', userId: 'synthetic-donor', avatarUrl: 'https://example.invalid/synthetic-donor.png', timestamp,
            id: 'synthetic-bits', giftType: 'bits', giftCount: 2, amount: 100, currency: 'bits', tier: '1000' };
        const result = kind === 'bits' ? factory.createGiftEvent(data) : factory.createGiftPaypiggyEvent(data);
        expect(result).not.toHaveProperty('username');
        expect(result).not.toHaveProperty('userId');
        expect(result.avatarUrl).toBe(DEFAULT_AVATAR_URL);
    });
}

for (const kind of ['bits', 'subscription'] as const) {
    test(`anonymous ${kind} platform ingress avoids donor avatar lookup and publication`, async () => {
        const auth = { isReady: () => true, refreshTokens: async () => false };
        let lookups = 0;
        const platform = new TwitchPlatform({ enabled: false, dataLoggingEnabled: false }, { logger: noOpLogger, twitchAuth: auth });
        platform.apiClient = new TwitchApiClient(auth, { clientId: 'synthetic-client' }, noOpLogger, {
            enhancedHttpClient: { get: async () => {
                lookups++;
                return { data: { data: [{ id: 'synthetic-donor', profile_image_url: 'https://example.invalid/synthetic-avatar.png' }] } };
            } }
        });
        const delivered: Record<string, unknown>[] = [];
        platform.on('platform:event', event => { delivered.push(event.data); });
        try {
            const data = { isAnonymous: true, username: 'Synthetic Donor', userId: 'synthetic-donor', avatarUrl: 'https://example.invalid/synthetic-donor.png', timestamp,
                id: 'synthetic-bits', giftType: 'bits', giftCount: 2, amount: 100, currency: 'bits', tier: '1000' };
            if (kind === 'bits') await platform.handleGiftEvent(data);
            else await platform.handlePaypiggyGiftEvent(data);
            expect(delivered).toHaveLength(1);
            expect(delivered[0]).toMatchObject({ isAnonymous: true, avatarUrl: DEFAULT_AVATAR_URL });
            expect(delivered[0]).not.toHaveProperty('username');
            expect(delivered[0]).not.toHaveProperty('userId');
            expect(lookups).toBe(0);
            // Normalization must not mutate the caller's input.
            expect(data.userId).toBe('synthetic-donor');
        } finally { await platform.cleanup(); }
    });
}
