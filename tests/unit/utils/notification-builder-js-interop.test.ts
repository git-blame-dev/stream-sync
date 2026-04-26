import { describe, expect, it } from 'bun:test';

const notificationBuilderModule = require('../../../src/utils/notification-builder.ts');
const { NotificationPayloadBuilder } = require('../../../src/notifications/notification-payload-builder.ts');
const MessageTTSHandlerModule = require('../../../src/utils/message-tts-handler.ts');
const MessageTTSHandler = MessageTTSHandlerModule.default || MessageTTSHandlerModule.MessageTTSHandler;

describe('notification-builder JS interop', () => {
    it('exposes NotificationBuilder as a named export from the JS wrapper', () => {
        expect(typeof notificationBuilderModule.NotificationBuilder?.build).toBe('function');
        expect(typeof notificationBuilderModule.NotificationBuilder?.sanitizeUsernameForTts).toBe('function');
    });

    it('constructs NotificationPayloadBuilder from the named NotificationBuilder export', () => {
        expect(() => new NotificationPayloadBuilder(notificationBuilderModule.NotificationBuilder)).not.toThrow();
    });

    it('supports message TTS generation through the wrapper-backed NotificationBuilder', () => {
        expect(MessageTTSHandler.createMessageTTS('test-user', 'hello world')).toBe('test-user says hello world');
    });
});
