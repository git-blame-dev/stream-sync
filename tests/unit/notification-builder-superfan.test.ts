import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

type NotificationPayload = Record<string, unknown> & {
    type?: string;
    platform?: string;
    username?: string;
};

type BuiltNotification = NotificationPayload & {
    displayMessage: string;
    ttsMessage: string;
    type: string;
};

const { NotificationBuilder } = nodeRequire('../../src/utils/notification-builder.js') as {
    NotificationBuilder: {
        build: (input: NotificationPayload) => BuiltNotification | null;
    };
};

describe('NotificationBuilder SuperFan notifications', () => {
    it('formats SuperFan display and TTS strings with SuperFan wording', () => {
        const notification = NotificationBuilder.build({
            type: 'platform:paypiggy',
            platform: 'tiktok',
            username: 'SuperFanUser',
            userId: 'superfan_1',
            tier: 'superfan'
        });

        if (!notification) {
            throw new Error('Expected superfan notification payload');
        }

        expect(notification.displayMessage).toMatch(/SuperFan/);
        expect(notification.ttsMessage).toMatch(/SuperFan/);
        expect(notification.type).toBe('platform:paypiggy');
    });
});
