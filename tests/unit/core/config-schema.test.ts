import { describe, expect, it } from 'bun:test';
import { CONFIG_SCHEMA, getFieldsRequiredWhenEnabled, buildDefaultsFromSchema, DEFAULTS } from '../../../src/core/config-schema.ts';
import type { ConfigDefaultSectionName, ConfigDefaults, ConfigSchema } from '../../../src/core/types/config-types';
import { ConfigValidator } from '../../../src/utils/config-validator';

describe('HTTP schema numeric policy', () => {
    it('applies the same positive integer policy through schema and runtime normalization', () => {
        for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, 1, 2345, '6789']) {
            const raw = {
                defaultTimeoutMs: value,
                reachabilityTimeoutMs: value,
                enhancedTimeoutMs: value,
                enhancedReachabilityTimeoutMs: value
            };
            const schemaResult = ConfigValidator.normalizeFromSchema('http', raw);
            const runtimeResult = ConfigValidator.normalize({ http: raw }, {}).http;
            for (const field of Object.keys(raw)) {
                expect(Reflect.get(runtimeResult, field)).toBe(Reflect.get(schemaResult, field));
            }
        }
    });
});

function expectConfigSection<K extends ConfigDefaultSectionName>(
    defaults: Partial<ConfigDefaults>,
    sectionName: K,
): asserts defaults is Partial<ConfigDefaults> & Pick<ConfigDefaults, K> {
    expect(defaults[sectionName]).toBeDefined();
}

describe('GUI notification and feed mode schema', () => {
    it('defines activation and backward-compatible feed mode defaults', () => {
        const guiSchema = CONFIG_SCHEMA.gui;
        if (!guiSchema) throw new Error('expected GUI config schema');

        expect(guiSchema.enableNotifications).toEqual({ type: 'boolean', default: false });
        expect(guiSchema.dockFeedMode).toEqual({ type: 'string', default: 'all', enum: ['all', 'chat', 'non-chat'] });
        expect(guiSchema.dockMaxMessages).toEqual({ type: 'number', default: 200, min: 1, max: 2000, integer: true });
        expect(guiSchema.overlayFeedMode).toEqual({ type: 'string', default: 'all', enum: ['all', 'chat', 'non-chat'] });
        expect(guiSchema.overlayMaxMessages).toEqual({ type: 'number', default: 6, min: 1, integer: true });
        expect(guiSchema.overlayMaxLinesPerMessage).toEqual({ type: 'number', default: 3, min: 1, integer: true });
    });
});

describe('funding goal schema', () => {
    it('defines a disabled generic goal with safe valuation defaults', () => {
        const fundingGoal = CONFIG_SCHEMA.fundingGoal;
        if (!fundingGoal) throw new Error('expected funding goal config schema');

        expect(fundingGoal.enabled).toEqual({ type: 'boolean', default: false });
        expect(fundingGoal.label).toEqual({ type: 'string', default: 'Support Goal' });
        expect(fundingGoal.targetUsd).toEqual({ type: 'number', default: 100, min: 0, allowZero: false });
        expect(CONFIG_SCHEMA.monetizationValues?.youtubeJewelUsd).toEqual({ type: 'number', default: 0.005, min: 0 });
    });
});

describe('speech output schema', () => {
    it('defaults to the unchanged OBS text method and defines local neural TTS settings', () => {
        expect(CONFIG_SCHEMA.obs?.ttsMethod).toEqual({
            type: 'string', default: 'obs-text', enum: ['obs-text', 'neural-tts']
        });
        expect(DEFAULTS.obs.ttsMethod).toBe('obs-text');
        expect(DEFAULTS.obs.neuralTtsEndpoint).toBe('http://127.0.0.1:8765');
        expect(CONFIG_SCHEMA.obs?.neuralTtsVoice).toEqual({ type: 'string', userDefined: true });
        expect(CONFIG_SCHEMA.obs?.neuralTtsCommand).toEqual({ type: 'string', userDefined: true });
    });
});

describe('monetization values schema', () => {
    it('contains exactly the approved nonnegative fields and defaults', () => {
        expect(CONFIG_SCHEMA.monetizationValues).toEqual({
            tiktokGiftUnitUsd: { type: 'number', default: 0.005, min: 0 },
            twitchBitUsd: { type: 'number', default: 0.01, min: 0 },
            youtubeJewelUsd: { type: 'number', default: 0.005, min: 0 },
            tiktokMembershipUsd: { type: 'number', default: 2.10, min: 0 },
            twitchMembershipUsd: { type: 'number', default: 3.50, min: 0 },
            youtubeMembershipUsd: { type: 'number', default: 3.89, min: 0 },
        });
        expect(CONFIG_SCHEMA.monetizationValues).not.toHaveProperty('paypiggyUsd');
        expect(CONFIG_SCHEMA.monetizationValues).not.toHaveProperty('fundingValuationUsd');
    });
});

describe('buildDefaultsFromSchema()', () => {
    it('returns object with all sections from schema except dynamic', () => {
        const defaults = buildDefaultsFromSchema();
        const schemaSections = (Object.keys(CONFIG_SCHEMA) as Array<keyof ConfigSchema>).filter(
            name => !Reflect.get(CONFIG_SCHEMA, name)?._dynamic
        );

        for (const sectionName of schemaSections) {
            expect(defaults).toHaveProperty(sectionName);
        }
        expect(defaults).not.toHaveProperty('commands');
    });

    it('extracts default values from field specs', () => {
        const defaults = buildDefaultsFromSchema();
        expectConfigSection(defaults, 'general');
        expectConfigSection(defaults, 'cooldowns');

        expect(defaults.general.debugEnabled).toBe(false);
        expect(defaults.general.messagesEnabled).toBe(true);
        expect(defaults.cooldowns.cmdCooldown).toBe(60);
        expect(defaults.general.fallbackUsername).toBe('Unknown User');
    });

    it('skips fields without default (userDefined, inheritFrom)', () => {
        const defaults = buildDefaultsFromSchema();
        expectConfigSection(defaults, 'youtube');
        expectConfigSection(defaults, 'twitch');
        expectConfigSection(defaults, 'tiktok');

        expect(defaults.youtube).not.toHaveProperty('viewerCountSource');
        expect(defaults.twitch).not.toHaveProperty('pollInterval');
        expect(defaults.tiktok).not.toHaveProperty('messagesEnabled');
    });

    it('includes all platform defaults', () => {
        const defaults = buildDefaultsFromSchema();
        expectConfigSection(defaults, 'tiktok');
        expectConfigSection(defaults, 'twitch');
        expectConfigSection(defaults, 'youtube');

        expect(defaults.tiktok.enabled).toBe(false);
        expect(defaults.tiktok.viewerCountEnabled).toBe(true);
        expect(defaults.twitch.enabled).toBe(false);
        expect(defaults.twitch.tokenStorePath).toBe('./data/twitch-tokens.json');
        expect(defaults.youtube.enabled).toBe(false);
        expect(defaults.youtube.streamDetectionMethod).toBe('youtubei');
        expect(defaults.youtube.chatMode).toBe('live');
    });

    it('includes display queue and handcam defaults', () => {
        const defaults = buildDefaultsFromSchema();
        expectConfigSection(defaults, 'displayQueue');
        expectConfigSection(defaults, 'handcam');

        expect(defaults.displayQueue.rowIntervalMs).toBe(1000);
        expect(defaults.handcam.enabled).toBe(false);
        expect(defaults.handcam.maxSize).toBe(50);
    });

    it('includes gui defaults for route toggles, limits, and per-type visibility', () => {
        const defaults = buildDefaultsFromSchema();

        expect(defaults.gui).toEqual({
            enableChatFeed: false,
            enableDock: false,
            enableNotifications: false,
            enableOperator: false,
            enableOverlay: false,
            dockFeedMode: 'all',
            dockMaxMessages: 200,
            overlayFeedMode: 'all',
            host: '127.0.0.1',
            port: 3399,
            messageCharacterLimit: 0,
            notificationIdleHoldMs: 5000,
            monetizationIdleHoldMs: 30000,
            notificationTransitionMs: 1000,
            overlayMaxMessages: 6,
            overlayMaxLinesPerMessage: 3,
            minimalOverlayMaxMessages: 6,
            minimalCompactRows: true,
            minimalRowBackgroundsEnabled: false,
            minimalMaxDisplayableBadges: 3,
            streamSupporterChatEffectsEnabled: true,
            memberRowTheme: 'green',
            memberRowEffects: ['sheen'],
            showMessages: true,
            showCommands: true,
            showGreetings: true,
            showFarewells: true,
            showFollows: true,
            showShares: true,
            showRaids: true,
            showGifts: true,
            showPaypiggies: true,
            showGiftPaypiggies: true,
            showEnvelopes: true
        });
    });
});

describe('DEFAULTS constant', () => {
    it('has LOG_DIRECTORY set to ./logs', () => {
        expect(DEFAULTS.LOG_DIRECTORY).toBe('./logs');
    });

    it('includes all schema-derived defaults', () => {
        expect(DEFAULTS.general.debugEnabled).toBe(false);
        expect(DEFAULTS.obs.enabled).toBe(false);
        expect(DEFAULTS.spam.enabled).toBe(true);
    });

    it('matches buildDefaultsFromSchema() for all sections', () => {
        const generated = buildDefaultsFromSchema();

        for (const [sectionName, sectionDefaults] of Object.entries(generated) as Array<[ConfigDefaultSectionName, ConfigDefaults[ConfigDefaultSectionName]]>) {
            expect<unknown>(DEFAULTS[sectionName]).toEqual(sectionDefaults);
        }
    });
});

describe('getFieldsRequiredWhenEnabled()', () => {
    it('returns username for tiktok', () => {
        const fields = getFieldsRequiredWhenEnabled('tiktok');
        expect(fields).toContain('username');
    });

    it('returns username and channel for twitch', () => {
        const fields = getFieldsRequiredWhenEnabled('twitch');
        expect(fields).toContain('username');
        expect(fields).toContain('channel');
        expect(fields).not.toContain('clientId');
    });

    it('returns username for youtube', () => {
        const fields = getFieldsRequiredWhenEnabled('youtube');
        expect(fields).toContain('username');
    });

    it('returns empty array for unknown section', () => {
        const fields = getFieldsRequiredWhenEnabled('nonexistent');
        expect(fields).toEqual([]);
    });
});
