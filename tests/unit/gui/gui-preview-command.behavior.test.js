const { describe, it, expect } = require('bun:test');

const {
    PREVIEW_DURATION_MS,
    PREVIEW_INTERVAL_MS,
    buildPreviewRows,
    buildPreviewConfig,
    runGuiPreview
} = require('../../../scripts/local/gui-preview');

const EMOTE_MESSAGE_TEXT = 'test message hello world this is a message to everyone how are we today?';
const TWITCH_EMOTE_ID = 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7';
const TIKTOK_EMOTE_ID = '0123456789012345678';
const TWITCH_TIKTOK_EMOTE_URL = 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0';
const YOUTUBE_EMOTE_ID = 'UCtestchannelid000000000/TESTEMOTEID0123456789ABCDEF';
const YOUTUBE_EMOTE_URL = 'https://yt3.ggpht.example.invalid/test-youtube-emote-token-0123456789abcdef=w48-h48-c-k-nd';

function buildExpectedPreviewEmoteMessage(platform, emoteId, imageUrl) {
    return {
        text: EMOTE_MESSAGE_TEXT,
        parts: [
            {
                type: 'emote',
                platform,
                emoteId,
                imageUrl
            },
            {
                type: 'text',
                text: ' test message '
            },
            {
                type: 'emote',
                platform,
                emoteId,
                imageUrl
            },
            {
                type: 'text',
                text: ' hello world this is a message to everyone '
            },
            {
                type: 'emote',
                platform,
                emoteId,
                imageUrl
            },
            {
                type: 'text',
                text: ' how are we today?'
            }
        ]
    };
}

function expectPreviewEmoteChatRow(rows, index, platform, username, emoteId, imageUrl) {
    expect(rows[index]).toEqual(expect.objectContaining({
        type: 'chat',
        platform
    }));
    expect(rows[index].data.username).toBe(username);
    expect(rows[index].data.message).toEqual(buildExpectedPreviewEmoteMessage(platform, emoteId, imageUrl));
}

describe('GUI local preview command behavior', () => {
    it('uses 30s duration and 2s message cadence constants', () => {
        expect(PREVIEW_DURATION_MS).toBe(30000);
        expect(PREVIEW_INTERVAL_MS).toBe(2000);
    });

    it('builds deterministic preview rows for the full preview window', () => {
        const rows = buildPreviewRows();

        expect(rows.length).toBe(15);
        expectPreviewEmoteChatRow(rows, 0, 'twitch', 'test-twitch-account', TWITCH_EMOTE_ID, TWITCH_TIKTOK_EMOTE_URL);
        expect(rows[0].data.isPaypiggy).toBe(true);
        expectPreviewEmoteChatRow(rows, 1, 'youtube', 'test-youtube-account', YOUTUBE_EMOTE_ID, YOUTUBE_EMOTE_URL);
        expectPreviewEmoteChatRow(rows, 2, 'tiktok', 'test-tiktok-account', TIKTOK_EMOTE_ID, TWITCH_TIKTOK_EMOTE_URL);
        expect(rows[3]).toEqual(expect.objectContaining({
            type: 'greeting',
            platform: 'twitch'
        }));
        expect(rows[11]).toEqual(expect.objectContaining({
            type: 'chat',
            platform: 'tiktok'
        }));
        expect(rows[11].data.message).toBe('preview message 11');
    });

    it('forces dock and overlay on for preview config', () => {
        const config = buildPreviewConfig({
            gui: {
                enableDock: false,
                enableOverlay: false,
                host: '127.0.0.1',
                port: 3399
            }
        });

        expect(config.gui.enableDock).toBe(true);
        expect(config.gui.enableOverlay).toBe(true);
    });

    it('runs preview with injected dependencies and stops cleanly', async () => {
        const writes = [];
        const emittedRows = [];
        let started = false;
        let stopped = false;
        let intervalTick = null;

        const fakeEventBus = {
            subscribe() {
                return () => {};
            },
            emit(eventName, payload) {
                if (eventName === 'display:row') {
                    emittedRows.push(payload);
                }
            }
        };

        const fakeService = {
            async start() {
                started = true;
            },
            async stop() {
                stopped = true;
            }
        };

        await runGuiPreview({
            baseConfig: {
                gui: {
                    enableDock: false,
                    enableOverlay: false,
                    host: '127.0.0.1',
                    port: 3399
                }
            },
            durationMs: 4,
            intervalMs: 2,
            eventBus: fakeEventBus,
            createGuiTransportServiceImpl: () => fakeService,
            safeSetIntervalImpl: (callback) => {
                intervalTick = callback;
                return 1;
            },
            safeSetTimeoutImpl: (resolve, duration) => {
                expect(duration).toBe(4);
                intervalTick();
                intervalTick();
                resolve();
            },
            stdout: {
                write: (text) => writes.push(text)
            }
        });

        expect(started).toBe(true);
        expect(stopped).toBe(true);
        expect(emittedRows.length).toBe(2);
        expect(writes.some((line) => line.includes('Dock URL'))).toBe(true);
        expect(writes.some((line) => line.includes('GUI preview finished'))).toBe(true);
    });
});
