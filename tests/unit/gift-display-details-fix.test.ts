import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

type NotificationPayload = Record<string, unknown> & {
    platform?: string;
    username?: string;
};

const { NotificationBuilder } = nodeRequire('../../src/utils/notification-builder.ts') as {
    NotificationBuilder: {
        build: (input: NotificationPayload) => (NotificationPayload & { logMessage?: string }) | null;
    };
};
const { generateLogMessage } = nodeRequire('../helpers/notification-test-utils') as {
    generateLogMessage: (type: string, data: NotificationPayload) => string;
};

type GiftOverrides = {
    platform?: string;
    username?: string;
    giftType?: string;
    giftCount?: number;
    amount?: number;
    currency?: string;
    repeatCount?: number;
};

describe('Gift Display Details', () => {
    const buildGift = (overrides: GiftOverrides = {}) => {
        const notification = NotificationBuilder.build({
            type: 'platform:gift',
            platform: overrides.platform || 'tiktok',
            username: overrides.username || 'GiftUser',
            giftType: overrides.giftType || 'Rose',
            giftCount: overrides.giftCount,
            amount: overrides.amount,
            currency: overrides.currency || 'coins',
            repeatCount: overrides.repeatCount
        });

        if (!notification) {
            throw new Error('Expected gift notification payload');
        }

        return notification;
    };

    test('logs username, gift count, and coins for traditional gifts', () => {
        const notification = buildGift({
            giftType: 'Rose',
            giftCount: 4,
            amount: 4,
            repeatCount: 4
        });

        const logMessage = generateLogMessage('platform:gift', notification);

        expect(logMessage).toContain('GiftUser');
        expect(logMessage).toContain('4x Rose');
        expect(logMessage).toContain('coin');
    });

    test('formats SuperChat gifts with currency/amount information', () => {
        const notification = NotificationBuilder.build({
            type: 'platform:gift',
            platform: 'youtube',
            username: 'SuperChatFan',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 25,
            currency: 'USD',
            message: 'Great stream!'
        });

        if (!notification) {
            throw new Error('Expected super chat notification payload');
        }

        const logMessage = generateLogMessage('platform:gift', notification);
        expect(logMessage).toContain('SuperChatFan');
        expect(logMessage).toContain('Super Chat');
        expect(logMessage).toContain('25');
    });
});
