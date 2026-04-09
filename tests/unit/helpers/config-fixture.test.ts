import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

type SourcesConfigFixture = {
    chatGroupName: string;
    notificationGroupName: string;
    fadeDelay: number;
};

type StreamElementsConfigFixture = {
    enabled: boolean;
    dataLoggingEnabled: boolean;
    dataLoggingPath: string;
};

type HandcamConfigFixture = {
    sourceName: string;
    maxSize: number;
    glowFilterName: string;
};

type TikTokConfigFixture = {
    enabled: boolean;
    username: string;
    messagesEnabled?: boolean;
};

type TwitchConfigFixture = {
    channel: string;
};

type YouTubeConfigFixture = {
    username: string;
    chatMode: string;
};

type ConfigFixture = {
    general: {
        messagesEnabled: boolean;
        viewerCountPollingIntervalMs: number;
    };
    tiktok: {
        messagesEnabled: boolean;
        enabled?: boolean;
        username?: string;
    };
    gui: {
        enableDock: boolean;
        enableOverlay: boolean;
        port: number;
    };
};

type RawConfigFixture = {
    general: Record<string, unknown>;
    obs: {
        chatMsgGroup: string;
    };
    cooldowns: Record<string, unknown>;
    gui: Record<string, unknown>;
};

const {
    createSourcesConfigFixture,
    createStreamElementsConfigFixture,
    createHandcamConfigFixture,
    createTikTokConfigFixture,
    createTwitchConfigFixture,
    createYouTubeConfigFixture,
    createConfigFixture,
    getRawTestConfig
} = nodeRequire('../../helpers/config-fixture') as {
    createSourcesConfigFixture: (overrides?: Record<string, unknown>) => SourcesConfigFixture;
    createStreamElementsConfigFixture: (overrides?: Record<string, unknown>) => StreamElementsConfigFixture;
    createHandcamConfigFixture: (overrides?: Record<string, unknown>) => HandcamConfigFixture;
    createTikTokConfigFixture: (overrides?: Record<string, unknown>) => TikTokConfigFixture;
    createTwitchConfigFixture: (overrides?: Record<string, unknown>) => TwitchConfigFixture;
    createYouTubeConfigFixture: (overrides?: Record<string, unknown>) => YouTubeConfigFixture;
    createConfigFixture: (overrides?: Record<string, unknown>) => ConfigFixture;
    getRawTestConfig: () => RawConfigFixture;
};

describe('config fixtures', () => {
    it('returns raw test config sections', () => {
        const raw = getRawTestConfig();

        expect(raw.general).toBeDefined();
        expect(raw.obs).toBeDefined();
        expect(raw.cooldowns).toBeDefined();
        expect(raw.gui).toBeDefined();
        expect(raw.obs.chatMsgGroup).toBe('test-chat-grp');
    });

    it('merges overrides for source config fixtures', () => {
        const sources = createSourcesConfigFixture({
            chatGroupName: 'test-chat-group-override'
        });

        expect(sources.chatGroupName).toBe('test-chat-group-override');
        expect(sources.notificationGroupName).toBe('test-notification-group');
        expect(sources.fadeDelay).toBe(750);
    });

    it('merges overrides for StreamElements config fixture', () => {
        const streamElements = createStreamElementsConfigFixture({
            enabled: false,
            dataLoggingPath: './test-logs'
        });

        expect(streamElements.enabled).toBe(false);
        expect(streamElements.dataLoggingEnabled).toBe(false);
        expect(streamElements.dataLoggingPath).toBe('./test-logs');
    });

    it('merges overrides for handcam config fixture', () => {
        const handcam = createHandcamConfigFixture({
            sourceName: 'test-handcam-override',
            maxSize: 75
        });

        expect(handcam.sourceName).toBe('test-handcam-override');
        expect(handcam.maxSize).toBe(75);
        expect(handcam.glowFilterName).toBe('test-glow-filter');
    });

    it('creates platform config fixtures with overrides', () => {
        const tiktok = createTikTokConfigFixture({ username: 'test-tiktok-override' });
        const twitch = createTwitchConfigFixture({ channel: 'test-twitch-override' });
        const youtube = createYouTubeConfigFixture({ username: 'test-youtube-override' });

        expect(tiktok.enabled).toBe(true);
        expect(tiktok.username).toBe('test-tiktok-override');
        expect(twitch.channel).toBe('test-twitch-override');
        expect(youtube.username).toBe('test-youtube-override');
        expect(youtube.chatMode).toBe('live');
    });

    it('builds config fixtures with inherited flags and derived timing', () => {
        const config = createConfigFixture({
            general: { messagesEnabled: false },
            tiktok: { enabled: true }
        });

        expect(config.general.messagesEnabled).toBe(false);
        expect(config.tiktok.messagesEnabled).toBe(false);
        expect(config.general.viewerCountPollingIntervalMs).toBe(60000);
        expect(config.gui).toBeDefined();
        expect(config.gui.enableDock).toBe(false);
    });

    it('merges gui overrides without dropping default gui fields', () => {
        const config = createConfigFixture({
            gui: { enableDock: true }
        });

        expect(config.gui.enableDock).toBe(true);
        expect(config.gui.enableOverlay).toBe(false);
        expect(config.gui.port).toBe(3399);
    });
});
