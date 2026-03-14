const { describe, it, expect } = require('bun:test');

const {
    PREVIEW_DURATION_MS,
    PREVIEW_INTERVAL_MS,
    buildPreviewConfig,
    buildPreviewScenarioEvents,
    createPreviewPipeline,
    runGuiPreview
} = require('../../../scripts/local/gui-preview');

describe('GUI local preview command behavior', () => {
    it('uses 30s duration and 2s message cadence constants', () => {
        expect(PREVIEW_DURATION_MS).toBe(30000);
        expect(PREVIEW_INTERVAL_MS).toBe(2000);
    });

    it('builds deterministic ingest events for the full preview window', () => {
        const events = buildPreviewScenarioEvents();

        expect(events.length).toBe(15);
        expect(events[0]).toEqual(expect.objectContaining({
            type: 'platform:chat-message',
            platform: 'twitch'
        }));
        expect(events[1]).toEqual(expect.objectContaining({
            type: 'platform:follow',
            platform: 'youtube'
        }));
        expect(events[2]).toEqual(expect.objectContaining({
            type: 'command',
            platform: 'tiktok'
        }));
    });

    it('forces preview gate keys and gui toggles in preview config', () => {
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
        expect(config.gui.showMessages).toBe(true);
        expect(config.gui.showCommands).toBe(true);
        expect(config.gui.showGreetings).toBe(true);
        expect(config.gui.showFarewells).toBe(true);
        expect(config.gui.showFollows).toBe(true);
        expect(config.gui.showShares).toBe(true);
        expect(config.gui.showRaids).toBe(true);
        expect(config.gui.showGifts).toBe(true);
        expect(config.gui.showPaypiggies).toBe(true);
        expect(config.gui.showGiftPaypiggies).toBe(true);
        expect(config.gui.showEnvelopes).toBe(true);

        expect(config.twitch.messagesEnabled).toBe(true);
        expect(config.twitch.commandsEnabled).toBe(true);
        expect(config.twitch.greetingsEnabled).toBe(true);
        expect(config.twitch.farewellsEnabled).toBe(true);
        expect(config.twitch.followsEnabled).toBe(true);
        expect(config.twitch.giftsEnabled).toBe(true);
        expect(config.twitch.raidsEnabled).toBe(true);
        expect(config.twitch.paypiggiesEnabled).toBe(true);

        expect(config.tiktok.messagesEnabled).toBe(true);
        expect(config.tiktok.commandsEnabled).toBe(true);
        expect(config.tiktok.greetingsEnabled).toBe(true);
        expect(config.tiktok.farewellsEnabled).toBe(true);
        expect(config.tiktok.followsEnabled).toBe(true);
        expect(config.tiktok.giftsEnabled).toBe(true);
        expect(config.tiktok.sharesEnabled).toBe(true);
        expect(config.tiktok.raidsEnabled).toBe(true);
        expect(config.tiktok.paypiggiesEnabled).toBe(true);

        expect(config.youtube.messagesEnabled).toBe(true);
        expect(config.youtube.commandsEnabled).toBe(true);
        expect(config.youtube.greetingsEnabled).toBe(true);
        expect(config.youtube.farewellsEnabled).toBe(true);
        expect(config.youtube.followsEnabled).toBe(true);
        expect(config.youtube.giftsEnabled).toBe(true);
        expect(config.youtube.raidsEnabled).toBe(true);
        expect(config.youtube.paypiggiesEnabled).toBe(true);

        expect(typeof config.farewell.timeout).toBe('number');
        expect(typeof config.cooldowns.cmdCooldownMs).toBe('number');
        expect(typeof config.cooldowns.globalCmdCooldownMs).toBe('number');
        expect(typeof config.cooldowns.heavyCommandCooldownMs).toBe('number');
    });

    it('runs preview via ingest pipeline and stops cleanly', async () => {
        const writes = [];
        const emittedEvents = [];
        let started = false;
        let stopped = false;
        let disposed = false;
        let intervalTick = null;
        const createdPipelineArgs = [];
        const createdTransportArgs = [];

        const fakeEventBus = {
            subscribe() {
                return () => {};
            },
            emit(eventName, payload) {
                emittedEvents.push({ eventName, payload });
            }
        };

        const fakePipeline = {
            eventBus: fakeEventBus,
            emitIngestEvent(event) {
                fakeEventBus.emit('platform:event', event);
            },
            async dispose() {
                disposed = true;
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
            createPreviewPipelineImpl: (args) => {
                createdPipelineArgs.push(args);
                return fakePipeline;
            },
            createGuiTransportServiceImpl: (args) => {
                createdTransportArgs.push(args);
                return fakeService;
            },
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
        expect(disposed).toBe(true);
        expect(createdPipelineArgs.length).toBe(1);
        expect(createdTransportArgs.length).toBe(1);
        expect(createdTransportArgs[0].eventBus).toBe(fakeEventBus);
        expect(emittedEvents.length).toBe(2);
        expect(emittedEvents[0].eventName).toBe('platform:event');
        expect(emittedEvents.some((entry) => entry.eventName === 'display:row')).toBe(false);
        expect(writes.some((line) => line.includes('Dock URL'))).toBe(true);
        expect(writes.some((line) => line.includes('GUI preview finished'))).toBe(true);
    });

    it('routes ingest events through the preview pipeline boundaries', async () => {
        const routedNotifications = [];
        const routedChats = [];
        let disposedCooldown = false;

        const config = buildPreviewConfig();
        const pipeline = createPreviewPipeline({
            config,
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {}
            },
            displayQueue: {
                addItem(item) {
                    routedChats.push(item);
                }
            },
            notificationManager: {
                async handleNotification(type, platform, data) {
                    routedNotifications.push({ type, platform, data });
                    return { success: true };
                }
            },
            commandCooldownService: {
                dispose() {
                    disposedCooldown = true;
                },
                checkUserCooldown() {
                    return true;
                },
                checkGlobalCooldown() {
                    return true;
                },
                updateUserCooldown() {},
                updateGlobalCooldown() {}
            },
            userTrackingService: {
                isFirstMessage() {
                    return false;
                }
            },
            vfxCommandService: {
                async selectVFXCommand() {
                    return null;
                },
                matchFarewell() {
                    return null;
                },
                async getVFXConfig() {
                    return null;
                }
            },
            platformLifecycleService: {
                getPlatformConnectionTime() {
                    return null;
                }
            }
        });

        const timestamp = new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString();

        pipeline.emitIngestEvent({
            type: 'platform:chat-message',
            platform: 'twitch',
            data: {
                username: 'test-user',
                userId: 'test-user-id',
                avatarUrl: 'https://example.com/avatar.png',
                timestamp,
                message: { text: 'hello' }
            }
        });

        pipeline.emitIngestEvent({
            type: 'platform:follow',
            platform: 'youtube',
            data: {
                username: 'test-follower',
                userId: 'test-follower-id',
                avatarUrl: 'https://example.com/avatar.png',
                timestamp
            }
        });

        for (let attempt = 0; attempt < 20; attempt += 1) {
            if (routedChats.length > 0 && routedNotifications.length > 0) {
                break;
            }
            await Promise.resolve();
        }

        expect(routedChats.length).toBe(1);
        expect(routedChats[0].type).toBe('chat');
        expect(routedNotifications.length).toBe(1);
        expect(routedNotifications[0].type).toBe('platform:follow');

        await pipeline.dispose();
        expect(disposedCooldown).toBe(true);
    });

    it('fails fast when injected preview pipeline is invalid', async () => {
        await expect(runGuiPreview({
            createPreviewPipelineImpl: () => ({ eventBus: {} }),
            createGuiTransportServiceImpl: () => ({
                async start() {},
                async stop() {}
            })
        })).rejects.toThrow('Preview pipeline requires eventBus and emitIngestEvent');
    });

    it('disposes pipeline when transport stop throws', async () => {
        let disposed = false;
        let intervalTick = null;

        const fakeEventBus = {
            subscribe() {
                return () => {};
            },
            emit() {}
        };

        const fakePipeline = {
            eventBus: fakeEventBus,
            emitIngestEvent() {},
            async dispose() {
                disposed = true;
            }
        };

        await runGuiPreview({
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {}
            },
            durationMs: 4,
            intervalMs: 2,
            createPreviewPipelineImpl: () => fakePipeline,
            createGuiTransportServiceImpl: () => ({
                async start() {},
                async stop() {
                    throw new Error('stop failed');
                }
            }),
            safeSetIntervalImpl: (callback) => {
                intervalTick = callback;
                return 1;
            },
            safeSetTimeoutImpl: (resolve) => {
                intervalTick();
                resolve();
            },
            stdout: {
                write() {}
            }
        });

        expect(disposed).toBe(true);
    });
});
