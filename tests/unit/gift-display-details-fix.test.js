const { describe, test, expect } = require('bun:test');
const NotificationBuilder = require('../../src/utils/notification-builder');
const { generateLogMessage } = require('../helpers/notification-test-utils');

describe('Gift Display Details', () => {
    const buildGift = (overrides = {}) => NotificationBuilder.build({
        type: 'platform:gift',
        platform: overrides.platform || 'tiktok',
        username: overrides.username || 'GiftUser',
        giftType: overrides.giftType || 'Rose',
        giftCount: overrides.giftCount,
        amount: overrides.amount,
        currency: overrides.currency || 'coins',
        repeatCount: overrides.repeatCount
    });

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

        const logMessage = generateLogMessage('platform:gift', notification);
        expect(logMessage).toContain('SuperChatFan');
        expect(logMessage).toContain('Super Chat');
        expect(logMessage).toContain('25');
    });
});
