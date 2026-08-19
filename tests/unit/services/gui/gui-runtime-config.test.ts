import { describe, expect, it } from 'bun:test';
import { buildGuiRuntimeConfig, isGuiActive } from '../../../../src/services/gui/gui-runtime-config';

describe('GUI runtime config', () => {
    it('serializes validated feed modes and falls back for invalid values', () => {
        expect(buildGuiRuntimeConfig({ dockFeedMode: 'chat', overlayFeedMode: 'non-chat' })).toMatchObject({
            dockFeedMode: 'chat',
            overlayFeedMode: 'non-chat'
        });
        expect(buildGuiRuntimeConfig({ dockFeedMode: 'invalid', overlayFeedMode: 3 })).toMatchObject({
            dockFeedMode: 'all',
            overlayFeedMode: 'all'
        });
    });

    it('bounds dock message retention', () => {
        expect(buildGuiRuntimeConfig({}).dockMaxMessages).toBe(200);
        expect(buildGuiRuntimeConfig({ dockMaxMessages: 350 }).dockMaxMessages).toBe(350);
        expect(buildGuiRuntimeConfig({ dockMaxMessages: 2001 }).dockMaxMessages).toBe(200);
    });

    it('treats notifications as GUI activation', () => {
        expect(isGuiActive({ gui: { enableNotifications: true } })).toBe(true);
    });

    it('serializes lifecycle timings and falls back for invalid browser input', () => {
        expect(buildGuiRuntimeConfig({
            notificationIdleHoldMs: 6000,
            monetizationIdleHoldMs: 31000,
            notificationTransitionMs: 750
        })).toMatchObject({
            notificationIdleHoldMs: 6000,
            monetizationIdleHoldMs: 31000,
            notificationTransitionMs: 750
        });
        expect(buildGuiRuntimeConfig({
            notificationIdleHoldMs: -1,
            monetizationIdleHoldMs: 1.5,
            notificationTransitionMs: '750'
        })).toMatchObject({
            notificationIdleHoldMs: 5000,
            monetizationIdleHoldMs: 30000,
            notificationTransitionMs: 1000
        });
    });

    it('defaults displayable badges to three while honoring an explicit lower value', () => {
        expect(buildGuiRuntimeConfig({}).appearance.settings.maxDisplayableBadges).toBe(3);
        expect(buildGuiRuntimeConfig({ minimalMaxDisplayableBadges: 1 }).appearance.settings.maxDisplayableBadges).toBe(1);
    });

    it('defaults stream supporter chat effects to enabled', () => {
        expect(buildGuiRuntimeConfig({}).appearance.settings.streamSupporterChatEffectsEnabled).toBe(true);
        expect(buildGuiRuntimeConfig({ streamSupporterChatEffectsEnabled: false }).appearance.settings.streamSupporterChatEffectsEnabled).toBe(false);
    });
});
