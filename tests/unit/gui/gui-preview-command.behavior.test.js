const { describe, it, expect } = require('bun:test');

const {
    PREVIEW_DURATION_MS,
    PREVIEW_INTERVAL_MS,
    buildPreviewRows,
    buildPreviewConfig,
    runGuiPreview
} = require('../../../scripts/local/gui-preview');

describe('GUI local preview command behavior', () => {
    it('uses 30s duration and 2s message cadence constants', () => {
        expect(PREVIEW_DURATION_MS).toBe(30000);
        expect(PREVIEW_INTERVAL_MS).toBe(2000);
    });

    it('builds deterministic preview rows for the full preview window', () => {
        const rows = buildPreviewRows();

        expect(rows.length).toBe(15);
        expect(rows[0]).toEqual(expect.objectContaining({
            type: 'chat',
            platform: 'twitch'
        }));
        expect(rows[0].data.username).toBe('test-twitch-account');
        expect(rows[1]).toEqual(expect.objectContaining({
            type: 'platform:follow',
            platform: 'youtube'
        }));
        expect(rows[1].data.username).toBe('test-youtube-account');
        expect(rows[2]).toEqual(expect.objectContaining({
            type: 'command',
            platform: 'tiktok'
        }));
        expect(rows[2].data.username).toBe('test-tiktok-account');
        expect(rows[3]).toEqual(expect.objectContaining({
            type: 'greeting',
            platform: 'twitch'
        }));
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
