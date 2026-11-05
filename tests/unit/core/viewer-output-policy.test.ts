import { expect, test } from 'bun:test';
import { ViewerOutputPolicy } from '../../../src/core/viewer-output-policy';
import { NOTIFICATION_CONFIGS } from '../../../src/core/constants';
import { buildConfig } from '../../../src/core/config-builders';
import { ConfigValidator } from '../../../src/utils/config-validator';
import type { OperatorControlKey } from '../../../src/core/operator-control-contract';

const platforms = ['tiktok', 'twitch', 'youtube'] as const;
const types = ['chat', ...Object.keys(NOTIFICATION_CONFIGS)];

for (const type of types) {
    const key = type === 'chat' ? 'messagesEnabled' : NOTIFICATION_CONFIGS[type as keyof typeof NOTIFICATION_CONFIGS].settingKey;
    for (const inherited of [true, false]) {
        test(`${type}: resolved platform differences, inherited ${inherited}, global on/off and reset`, () => {
            const config = buildConfig(ConfigValidator.normalize({ general: { [key]: inherited }, twitch: { [key]: !inherited } }));
            const overrides = new Map<OperatorControlKey, boolean>();
            const policy = new ViewerOutputPolicy(config, key => overrides.get(key));
            const supported = platforms.filter(platform => typeof (config[platform] as Record<string, unknown>)[key] === 'boolean');
            expect(supported.length).toBeGreaterThan(0);
            for (const platform of supported) expect(policy.isEnabled(type, platform)).toBe(config[platform][key as keyof typeof config[typeof platform]] as boolean);
            expect(policy.configStates[key]).toBe(supported.includes('twitch') ? 'mixed' : inherited ? 'on' : 'off');
            for (const enabled of [true, false]) {
                overrides.set(key, enabled);
                for (const platform of supported) expect(policy.isEnabled(type, platform)).toBe(enabled);
            }
            overrides.clear();
            for (const platform of supported) expect(policy.isEnabled(type, platform)).toBe(config[platform][key as keyof typeof config[typeof platform]] as boolean);
        });
    }
}

test('captures baselines, ignores unknown display types and rejects unsupported categories', () => {
    const config = buildConfig(ConfigValidator.normalize({}));
    const policy = new ViewerOutputPolicy(config, () => undefined);
    config.tiktok.messagesEnabled = false;
    expect(policy.isEnabled('chat', 'TIKTOK')).toBe(true);
    expect(policy.isEnabled('synthetic-unknown', 'tiktok')).toBe(true);
    expect(policy.isEnabled('platform:repost', 'twitch')).toBe(false);
    expect(policy.isEnabled('platform:share', 'youtube')).toBe(false);
    expect(policy.isEnabled('chat', 'synthetic-unknown')).toBe(false);
});

for (const enabled of [true, false]) {
    test(`uniform resolved config summary ${enabled}`, () => {
        const config = buildConfig(ConfigValidator.normalize({ general: { messagesEnabled: enabled } }));
        const policy = new ViewerOutputPolicy(config, () => undefined);
        expect(policy.configStates.messagesEnabled).toBe(enabled ? 'on' : 'off');
        for (const platform of platforms) expect(policy.isEnabled('chat', platform)).toBe(enabled);
    });
}

test('empty platform sections report general config summary without enabling unsupported output', () => {
    const policy = new ViewerOutputPolicy({ general: { messagesEnabled: false } }, () => undefined);
    expect(policy.configStates.messagesEnabled).toBe('off');
    expect(policy.configStates.commandsEnabled).toBe('on');
    expect(policy.isEnabled('chat', 'tiktok')).toBe(false);
});
