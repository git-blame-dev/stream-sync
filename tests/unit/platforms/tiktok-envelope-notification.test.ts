import { expect, test } from 'bun:test';
import { createTikTokEventFactory } from '../../../src/platforms/tiktok/events/event-factory';

const factory = createTikTokEventFactory();
const timestamp = '2024-01-01T00:00:00.000Z';
const legacy = () => ({
    user: { uniqueId: 'synthetic-envelope-handle', nickname: 'Synthetic Envelope', userId: 'synthetic-provider-id' },
    amount: 500, currency: 'coins', id: 'synthetic-envelope-id', timestamp,
});

// The factory owns nested provider identity. AppRuntime consumes its canonical output.
for (const amount of [500, 250, 300, 600, 800, 400, 700, 350, 1000, '250']) {
    test(`legacy envelope factory retains nested identity and amount ${typeof amount}:${amount}`, () => {
        const input = { ...legacy(), amount, eventId: 'synthetic-extra-id', platformSpecificField: 'synthetic-extra', additionalData: 'synthetic-rich' };
        expect(factory.createEnvelope(input)).toMatchObject({
            type: 'platform:envelope', platform: 'tiktok', username: 'Synthetic Envelope',
            userId: 'synthetic-envelope-handle', amount: Number(amount), currency: 'coins',
            giftType: 'Treasure Chest', giftCount: 1, repeatCount: 1, id: input.id, timestamp,
        });
        expect(input.user.userId).toBe('synthetic-provider-id');
        expect(input.amount).toBe(amount);
    });
}

for (const [label, user, amount] of [
    ['no nickname', { uniqueId: 'synthetic-handle', userId: 'synthetic-id' }, 750],
    ['no uniqueId', { nickname: 'Synthetic Name', userId: 'synthetic-id' }, 100],
    ['provider id only', { userId: 'synthetic-id' }, 100],
    ['absent user', undefined, 200],
    ['empty identity', { uniqueId: '', nickname: '', userId: '' }, 350],
    ['null identity', { uniqueId: null, nickname: undefined, userId: null }, 450],
] as const) {
    test(`legacy envelope factory rejects ${label} without inventing identity`, () => {
        expect(() => factory.createEnvelope({ ...legacy(), user, amount })).toThrow('TikTok user payload requires');
        expect(factory.createEnvelope(legacy()).username).toBe('Synthetic Envelope');
    });
}

for (const [label, overrides, error] of [
    ['missing amount', { amount: undefined }, 'Missing TikTok envelope gift amount'],
    ['nonnumeric amount', { amount: 'not_a_number' }, 'Missing TikTok envelope gift amount'],
    ['missing currency', { currency: '' }, 'TikTok envelope requires currency'],
    ['missing id', { id: undefined }, 'Missing TikTok envelope message id'],
] as const) {
    test(`legacy envelope factory rejects ${label} then accepts a valid input`, () => {
        expect(() => factory.createEnvelope({ ...legacy(), ...overrides })).toThrow(error);
        expect(factory.createEnvelope(legacy()).amount).toBe(500);
    });
}
