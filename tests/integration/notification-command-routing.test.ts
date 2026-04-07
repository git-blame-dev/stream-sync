import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const { NOTIFICATION_CONFIGS } = load('../../src/core/constants');
const { ConfigValidator } = load('../../src/utils/config-validator');

type NotificationConfigContract = {
    commandKey: string;
    settingKey: string;
};

const notificationConfigs = NOTIFICATION_CONFIGS as Record<string, NotificationConfigContract>;

describe('notification command routing integration', () => {
    const EXPECTED_COMMAND_KEYS = {
        'platform:follow': 'follows',
        'platform:gift': 'gifts',
        'platform:envelope': 'envelopes',
        'platform:paypiggy': 'paypiggies',
        'platform:giftpaypiggy': 'gifts',
        'platform:raid': 'raids',
        'platform:share': 'shares',
        command: 'commands',
        greeting: 'greetings',
        farewell: 'farewell',
        'platform:chat-message': 'chat'
    };

    const EXPECTED_SETTING_KEYS = {
        'platform:follow': 'followsEnabled',
        'platform:gift': 'giftsEnabled',
        'platform:envelope': 'giftsEnabled',
        'platform:paypiggy': 'paypiggiesEnabled',
        'platform:giftpaypiggy': 'giftsEnabled',
        'platform:raid': 'raidsEnabled',
        'platform:share': 'sharesEnabled',
        command: 'commandsEnabled',
        greeting: 'greetingsEnabled',
        farewell: 'farewellsEnabled',
        'platform:chat-message': 'messagesEnabled'
    };

    it('all notification types have valid command keys', () => {
        for (const [, config] of Object.entries(notificationConfigs)) {
            expect(config.commandKey).toBeDefined();
            expect(typeof config.commandKey).toBe('string');
            expect(config.commandKey.length).toBeGreaterThan(0);
        }
    });

    it('all notification types have valid setting keys', () => {
        for (const [, config] of Object.entries(notificationConfigs)) {
            expect(config.settingKey).toBeDefined();
            expect(typeof config.settingKey).toBe('string');
            expect(config.settingKey.length).toBeGreaterThan(0);
        }
    });

    it('notification types route to expected command keys', () => {
        for (const [notificationType, expectedCommandKey] of Object.entries(EXPECTED_COMMAND_KEYS)) {
            const config = notificationConfigs[notificationType];
            expect(config).toBeDefined();
            expect(config.commandKey).toBe(expectedCommandKey);
        }
    });

    it('notification types route to expected setting keys', () => {
        for (const [notificationType, expectedSettingKey] of Object.entries(EXPECTED_SETTING_KEYS)) {
            const config = notificationConfigs[notificationType];
            expect(config).toBeDefined();
            expect(config.settingKey).toBe(expectedSettingKey);
        }
    });

    it('VFX-related notification setting keys exist in normalized general config', () => {
        const vfxNotificationTypes = [
            'platform:follow',
            'platform:gift',
            'platform:paypiggy',
            'platform:raid',
            'platform:share',
            'greeting',
            'farewell'
        ];

        const normalized = ConfigValidator.normalize({ general: {}, obs: {}, commands: {} });

        for (const notificationType of vfxNotificationTypes) {
            const settingKey = notificationConfigs[notificationType].settingKey;
            expect(normalized.general[settingKey]).toBeDefined();
        }
    });

    it('command-based notification types have matching config sections in normalizer', () => {
        const commandBasedTypes = {
            'platform:follow': 'follows',
            'platform:gift': 'gifts',
            'platform:envelope': 'envelopes',
            'platform:raid': 'raids',
            'platform:paypiggy': 'paypiggies',
            greeting: 'greetings',
            farewell: 'farewell'
        };

        const normalized = ConfigValidator.normalize({
            general: {},
            obs: {},
            commands: {},
            follows: { command: '!test-follow' },
            gifts: {},
            envelopes: { command: '!test-envelope' },
            raids: { command: '!test-raid' },
            paypiggies: { command: '!test-paypiggy' },
            greetings: { command: '!test-greeting' },
            farewell: { command: '!test-farewell' }
        });

        for (const [typeName, sectionName] of Object.entries(commandBasedTypes)) {
            expect(normalized[sectionName]).toBeDefined();
            if (typeName !== 'platform:gift') {
                expect(normalized[sectionName].command).toBeDefined();
            }
        }
    });
});
