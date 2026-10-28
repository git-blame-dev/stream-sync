import { describe, expect, it } from 'bun:test';
import { buildSyntheticGuiConfig } from '../../../scripts/local/gui-synthetic-config';
import { buildPreviewConfig } from '../../../scripts/local/gui-preview';
import { buildGuiDemoConfig } from '../../../scripts/local/gui-demo';
import { DEFAULTS } from '../../../src/core/config-schema';

describe('synthetic GUI configuration', () => {
    it('uses schema defaults and builder conversions without credentials or enabled providers', () => {
        const config = buildSyntheticGuiConfig();
        expect(config.gui.overlayMaxMessages).toBe(6);
        expect(config.gui.overlayMaxMessages).toBe(DEFAULTS.gui.overlayMaxMessages);
        expect(config.general.viewerCountPollingIntervalMs).toBe(Number(DEFAULTS.general.viewerCountPollingInterval) * 1000);
        expect(config.cooldowns.defaultCooldownMs).toBe(Number(DEFAULTS.cooldowns.defaultCooldown) * 1000);
        expect(config.twitch.clientId).toBe('');
        for (const platform of [config.twitch, config.youtube, config.tiktok]) {
            expect(platform.enabled).toBe(false);
            expect(platform.dataLoggingEnabled).toBe(false);
        }
        expect(config.general.envFileReadEnabled).toBe(false);
        expect(config.general.envFileWriteEnabled).toBe(false);
        expect(config.logging.file.enabled).toBe(false);
        expect(config.vfx.filePath).toBe('');
    });

    it('returns fresh config and preserves preview and independent demo modes', () => {
        const first = buildSyntheticGuiConfig();
        first.gui.overlayMaxMessages = 99;
        expect(buildSyntheticGuiConfig().gui.overlayMaxMessages).toBe(6);
        const overrides = { gui: { compactRows: false, overlayMaxMessages: 8 }, commands: { preview: '!synthetic,Media,1000' } };
        const before = structuredClone(overrides);
        const preview = buildPreviewConfig(overrides);
        expect(overrides).toEqual(before);
        expect(preview.gui).toMatchObject({ overlayMaxMessages: 8, compactRows: false, enableOperator: true, dockFeedMode: 'all', overlayFeedMode: 'chat' });
        expect(preview.commands).toMatchObject({ preview: '!synthetic,Media,1000' });
        expect(preview.profiles).toMatchObject({ 'synthetic-member': { greetingCommand: '!preview', rowTheme: 'red', rowEffects: ['particles'] } });
        expect(buildGuiDemoConfig(buildSyntheticGuiConfig()).gui).toMatchObject({ overlayMaxMessages: 6, enableOperator: false });
    });
});
