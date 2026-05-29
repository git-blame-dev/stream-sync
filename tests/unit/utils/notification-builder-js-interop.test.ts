import { describe, expect, it } from 'bun:test';
import { NotificationPayloadBuilder } from '../../../src/notifications/notification-payload-builder';
import { NotificationBuilder } from '../../../src/utils/notification-builder';
import MessageTTSHandler from '../../../src/utils/message-tts-handler';

describe('notification-builder JS interop', () => {
it('exposes NotificationBuilder as a named export from the JS wrapper', () => {
expect(typeof NotificationBuilder?.build).toBe('function');
expect(typeof NotificationBuilder?.sanitizeUsernameForTts).toBe('function');
});

it('constructs NotificationPayloadBuilder from the named NotificationBuilder export', () => {
    const notificationBuilderAdapter = {
        build(input: Record<string, unknown>): Record<string, unknown> {
            const notification = NotificationBuilder.build(input);
            if (notification === null) {
                throw new Error('NotificationBuilder.build returned null');
            }
            return notification;
        },
    };

    expect(() => new NotificationPayloadBuilder(notificationBuilderAdapter)).not.toThrow();
});

    it('supports message TTS generation through the wrapper-backed NotificationBuilder', () => {
        expect(MessageTTSHandler.createMessageTTS('test-user', 'hello world')).toBe('test-user says hello world');
    });
});
