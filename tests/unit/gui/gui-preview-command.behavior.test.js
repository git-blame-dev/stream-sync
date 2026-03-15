const { describe, it, expect } = require('bun:test');

const {
    PREVIEW_DURATION_MS,
    PREVIEW_INTERVAL_MS,
    PREVIEW_MEDIA_CATALOG,
    buildPreviewConfig,
    buildPreviewScenarioEvents,
    createPreviewPipeline,
    createPreviewIngestAdapters,
    runPreviewScenario,
    runGuiPreview
} = require('../../../scripts/local/gui-preview');

describe('GUI local preview command behavior', () => {
    it('uses 32s duration and 2s message cadence constants', () => {
        expect(PREVIEW_DURATION_MS).toBe(32000);
        expect(PREVIEW_INTERVAL_MS).toBe(2000);
    });

    it('builds deterministic ingest events for the full preview window', () => {
        const events = buildPreviewScenarioEvents();

        expect(events.length).toBe(16);
        expect(events[0]).toEqual(expect.objectContaining({
            platform: 'twitch'
        }));
        expect(events[1]).toEqual(expect.objectContaining({
            platform: 'youtube'
        }));
        expect(events[2]).toEqual(expect.objectContaining({
            platform: 'twitch'
        }));
        expect(events[0].adapter).toBe('twitch');
        expect(events[1].adapter).toBe('youtube');
        expect(events[2].adapter).toBe('twitch');
        expect(events[0].rawEvent).toBeDefined();
    });

    it('inserts youtube member hi chat immediately after raid notification', () => {
        const events = buildPreviewScenarioEvents();
        const raidIndex = events.findIndex((event) =>
            event.adapter === 'twitch' && event.rawEvent?.subscriptionType === 'channel.raid'
        );

        expect(raidIndex).toBeGreaterThan(-1);

        const memberHiEvent = events[raidIndex + 1];
        expect(memberHiEvent.adapter).toBe('youtube');
        expect(memberHiEvent.rawEvent.eventType).toBe('LiveChatTextMessage');
        expect(memberHiEvent.rawEvent.chatItem.testData.message).toBe('Hi!');
        expect(memberHiEvent.rawEvent.chatItem.testData.isPaypiggy).toBe(true);
    });

    it('builds scenario steps that include all adapter families', () => {
        const events = buildPreviewScenarioEvents(20000, 2000);
        const adapters = new Set(events.map((event) => event.adapter));

        expect(adapters.has('twitch')).toBe(true);
        expect(adapters.has('youtube')).toBe(true);
        expect(adapters.has('tiktok')).toBe(true);
    });

    it('injects deterministic media URLs into raw ingest payloads', () => {
        const events = buildPreviewScenarioEvents(20000, 2000);

        const twitchChat = events.find((event) =>
            event.adapter === 'twitch'
            && event.rawEvent?.subscriptionType === 'channel.chat.message'
            && Array.isArray(event.rawEvent?.event?.message?.fragments)
            && event.rawEvent.event.message.fragments.some((fragment) => fragment.type === 'emote')
        );
        const youtubeStep = events.find((event) => event.adapter === 'youtube');
        const tiktokStep = events.find((event) => event.adapter === 'tiktok');

        expect(twitchChat.rawEvent.event.message.fragments[0].emote.id).toContain(PREVIEW_MEDIA_CATALOG.twitch.emote.id);
        expect(youtubeStep.rawEvent.chatItem.testData.avatarUrl).toBe(PREVIEW_MEDIA_CATALOG.youtube.avatarUrl);
        expect(tiktokStep.rawEvent.data.user.profilePictureUrl).toBe(PREVIEW_MEDIA_CATALOG.tiktok.avatarUrl);
    });

    it('uses explicit stable media catalog values without test-only URLs', () => {
        const events = buildPreviewScenarioEvents(20000, 2000);
        const serialized = JSON.stringify(events);

        expect(serialized.includes(PREVIEW_MEDIA_CATALOG.twitch.emote.id)).toBe(true);
        expect(serialized.includes(PREVIEW_MEDIA_CATALOG.youtube.avatarUrl)).toBe(true);
        expect(serialized.includes(PREVIEW_MEDIA_CATALOG.tiktok.avatarUrl)).toBe(true);
        expect(serialized.includes(PREVIEW_MEDIA_CATALOG.youtube.emote.id)).toBe(true);
        expect(serialized.includes(PREVIEW_MEDIA_CATALOG.tiktok.emote.id)).toBe(true);
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
        expect(config.twitch.sharesEnabled).toBe(true);
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
        expect(config.youtube.sharesEnabled).toBe(true);
        expect(config.youtube.paypiggiesEnabled).toBe(true);

        expect(typeof config.farewell.timeout).toBe('number');
        expect(typeof config.farewell.command).toBe('string');
        expect(config.commands.preview).toBeDefined();
        expect(config.cooldowns.cmdCooldown).toBe(0);
        expect(config.cooldowns.cmdCooldownMs).toBe(0);
        expect(config.cooldowns.globalCmdCooldown).toBe(0);
        expect(config.cooldowns.globalCmdCooldownMs).toBe(0);
        expect(config.cooldowns.heavyCommandCooldown).toBe(0);
        expect(config.cooldowns.heavyCommandCooldownMs).toBe(0);
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
        expect(emittedEvents.length).toBeGreaterThanOrEqual(1);
        expect(emittedEvents[0].eventName).toBe('platform:event');
        expect(emittedEvents.some((entry) => entry.eventName === 'display:row')).toBe(false);
        expect(writes.some((line) => line.includes('Dock URL'))).toBe(true);
        expect(writes.some((line) => line.includes('GUI preview finished'))).toBe(true);
    });

    it('ingests all default scenario events and ends on envelope within preview duration', async () => {
        const scenarioEvents = buildPreviewScenarioEvents(32000, 2000);
        const ingested = [];
        let intervalTick = null;

        const adapters = {
            twitch: {
                async ingest(rawEvent) {
                    ingested.push({ adapter: 'twitch', rawEvent });
                }
            },
            youtube: {
                async ingest(rawEvent) {
                    ingested.push({ adapter: 'youtube', rawEvent });
                }
            },
            tiktok: {
                async ingest(rawEvent) {
                    ingested.push({ adapter: 'tiktok', rawEvent });
                }
            }
        };

        await runPreviewScenario({
            adapters,
            scenarioEvents,
            intervalMs: 2000,
            durationMs: 32000,
            safeSetIntervalImpl: (callback) => {
                intervalTick = callback;
                return 1;
            },
            safeSetTimeoutImpl: (resolve, duration) => {
                expect(duration).toBe(32000);
                for (let index = 0; index < 15; index += 1) {
                    intervalTick();
                }
                resolve();
            },
            errorHandler: {
                handleEventProcessingError() {}
            }
        });

        expect(ingested).toHaveLength(16);
        expect(ingested[15].adapter).toBe('tiktok');
        expect(ingested[15].rawEvent.eventType).toBe('ENVELOPE');
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

    it('creates raw ingest adapters that emit canonical platform events', async () => {
        const emitted = [];
        const adapters = createPreviewIngestAdapters({
            config: buildPreviewConfig(),
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {}
            },
            emitPlatformEvent: (event) => emitted.push(event)
        });

        await adapters.twitch.ingest({
            subscriptionType: 'channel.follow',
            event: {
                user_name: 'test-user',
                user_login: 'test-user-id',
                followed_at: new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString(),
                timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString()
            }
        });

        await adapters.youtube.ingest({
            eventType: 'LiveChatTextMessage',
            chatItem: {
                testData: {
                    username: 'test-youtube-user',
                    userId: 'test-youtube-user-id',
                    timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, 1)).toISOString(),
                    message: 'hello'
                }
            }
        });

        await adapters.tiktok.ingest({
            eventType: 'SOCIAL',
            data: {
                user: {
                    uniqueId: 'test-tiktok-user-id',
                    nickname: 'test-tiktok-user',
                    userId: 'test-tiktok-user-id',
                    profilePictureUrl: 'https://example.com/avatar.png',
                    followRole: 0,
                    userBadges: []
                },
                timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, 2)).toISOString(),
                displayType: 'share',
                msgId: 'test-msg-id'
            }
        });

        expect(emitted.some((event) => event.type === 'platform:follow' && event.platform === 'twitch')).toBe(true);
        expect(emitted.some((event) => event.type === 'platform:chat-message' && event.platform === 'youtube')).toBe(true);
        expect(emitted.some((event) => event.type === 'platform:share' && event.platform === 'tiktok')).toBe(true);
    });

    it('falls back to default avatar when ingest payload omits avatarUrl', async () => {
        const emitted = [];
        const adapters = createPreviewIngestAdapters({
            config: buildPreviewConfig(),
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {}
            },
            emitPlatformEvent: (event) => emitted.push(event)
        });

        await adapters.youtube.ingest({
            eventType: 'LiveChatTextMessage',
            chatItem: {
                testData: {
                    username: 'test-youtube-user',
                    userId: 'test-youtube-user-id',
                    timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, 1)).toISOString(),
                    message: 'hello'
                }
            }
        });

        const chatEvent = emitted.find((event) => event.type === 'platform:chat-message' && event.platform === 'youtube');
        expect(chatEvent).toBeDefined();
        expect(typeof chatEvent.data.avatarUrl).toBe('string');
        expect(chatEvent.data.avatarUrl.length).toBeGreaterThan(0);
    });

    it('maps additional twitch and youtube ingest events', async () => {
        const emitted = [];
        const adapters = createPreviewIngestAdapters({
            config: buildPreviewConfig(),
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {}
            },
            emitPlatformEvent: (event) => emitted.push(event)
        });

        const timestamp = new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString();

        await adapters.twitch.ingest({
            subscriptionType: 'channel.raid',
            event: {
                from_broadcaster_user_name: 'test-raider',
                from_broadcaster_user_login: 'test-raider-id',
                viewers: 10,
                timestamp
            }
        });

        await adapters.twitch.ingest({
            subscriptionType: 'channel.subscription.gift',
            event: {
                user_name: 'test-gifter',
                user_login: 'test-gifter-id',
                tier: '1000',
                total: 2,
                is_anonymous: false,
                timestamp
            }
        });

        await adapters.youtube.ingest({
            eventType: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
            chatItem: {
                testData: {
                    username: 'test-youtube-user',
                    userId: 'test-youtube-user-id',
                    timestamp,
                    giftCount: 4,
                    tier: '1'
                }
            }
        });

        expect(emitted.some((event) => event.type === 'platform:raid' && event.platform === 'twitch')).toBe(true);
        expect(emitted.some((event) => event.type === 'platform:giftpaypiggy' && event.platform === 'twitch')).toBe(true);
        expect(emitted.some((event) => event.type === 'platform:giftpaypiggy' && event.platform === 'youtube')).toBe(true);
    });

    it('maps additional tiktok ingest events', async () => {
        const emitted = [];
        const adapters = createPreviewIngestAdapters({
            config: buildPreviewConfig(),
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {}
            },
            emitPlatformEvent: (event) => emitted.push(event)
        });

        const timestamp = new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString();

        await adapters.tiktok.ingest({
            eventType: 'GIFT',
            data: {
                user: {
                    uniqueId: 'test-tiktok-user-id',
                    nickname: 'test-tiktok-user',
                    userId: 'test-tiktok-user-id',
                    profilePictureUrl: 'https://example.com/avatar.png',
                    followRole: 0,
                    userBadges: []
                },
                timestamp,
                msgId: 'gift-id',
                giftName: 'Rose',
                repeatCount: 2,
                diamondCount: 20
            }
        });

        await adapters.tiktok.ingest({
            eventType: 'ENVELOPE',
            data: {
                user: {
                    uniqueId: 'test-tiktok-user-id',
                    nickname: 'test-tiktok-user',
                    userId: 'test-tiktok-user-id',
                    profilePictureUrl: 'https://example.com/avatar.png',
                    followRole: 0,
                    userBadges: []
                },
                timestamp,
                msgId: 'envelope-id',
                giftName: 'Rose',
                repeatCount: 1,
                diamondCount: 10
            }
        });

        expect(emitted.some((event) => event.type === 'platform:gift' && event.platform === 'tiktok')).toBe(true);
        expect(emitted.some((event) => event.type === 'platform:envelope' && event.platform === 'tiktok')).toBe(true);
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

    it('disposes pipeline when transport start fails', async () => {
        let disposed = false;

        const fakePipeline = {
            eventBus: {
                subscribe() {
                    return () => {};
                },
                emit() {}
            },
            emitIngestEvent() {},
            async dispose() {
                disposed = true;
            }
        };

        await expect(runGuiPreview({
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
                async start() {
                    throw new Error('start failed');
                },
                async stop() {}
            }),
            stdout: {
                write() {}
            }
        })).rejects.toThrow('start failed');

        expect(disposed).toBe(true);
    });

    it('clears active interval handle during cleanup', async () => {
        const handles = [];
        const originalClearInterval = global.clearInterval;
        global.clearInterval = (handle) => {
            handles.push(handle);
        };

        let intervalTick = null;

        try {
            await runGuiPreview({
                logger: {
                    debug: () => {},
                    info: () => {},
                    warn: () => {},
                    error: () => {},
                    console: () => {}
                },
                durationMs: 4,
                intervalMs: 2,
                createPreviewPipelineImpl: () => ({
                    eventBus: {
                        subscribe() {
                            return () => {};
                        },
                        emit() {}
                    },
                    emitIngestEvent() {},
                    async dispose() {}
                }),
                createPreviewIngestAdaptersImpl: () => ({
                    twitch: { async ingest() {} },
                    youtube: { async ingest() {} },
                    tiktok: { async ingest() {} }
                }),
                createGuiTransportServiceImpl: () => ({
                    async start() {},
                    async stop() {}
                }),
                safeSetIntervalImpl: (callback) => {
                    intervalTick = callback;
                    return 77;
                },
                safeSetTimeoutImpl: (resolve) => {
                    intervalTick();
                    resolve();
                },
                stdout: {
                    write() {}
                }
            });
        } finally {
            global.clearInterval = originalClearInterval;
        }

        expect(handles.includes(77)).toBe(true);
    });

    it('runs raw ingest adapters end-to-end through scenario schedule', async () => {
        const routed = [];
        let intervalTick = null;

        await runGuiPreview({
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {},
                console: () => {}
            },
            durationMs: 20,
            intervalMs: 2,
            createPreviewPipelineImpl: () => ({
                eventBus: {
                    subscribe() {
                        return () => {};
                    },
                    emit() {}
                },
                emitIngestEvent(event) {
                    routed.push(event);
                },
                async dispose() {}
            }),
            createGuiTransportServiceImpl: () => ({
                async start() {},
                async stop() {}
            }),
            safeSetIntervalImpl: (callback) => {
                intervalTick = callback;
                return 1;
            },
            safeSetTimeoutImpl: (resolve) => {
                for (let i = 0; i < 10; i += 1) {
                    intervalTick();
                }
                resolve();
            },
            stdout: {
                write() {}
            }
        });

        expect(routed.length).toBeGreaterThan(3);
        expect(routed.some((event) => event.type === 'platform:chat-message')).toBe(true);
        expect(routed.some((event) => event.type === 'platform:follow')).toBe(true);
        expect(routed.some((event) => event.type === 'platform:gift')).toBe(true);
    });

    it('continues preview schedule when one ingest step fails', async () => {
        const routed = [];
        let intervalTick = null;
        let failedOnce = false;
        const errors = [];

        await runGuiPreview({
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                console: () => {},
                error: (...args) => errors.push(args)
            },
            durationMs: 6,
            intervalMs: 2,
            createPreviewPipelineImpl: () => ({
                eventBus: {
                    subscribe() {
                        return () => {};
                    },
                    emit() {}
                },
                emitIngestEvent(event) {
                    routed.push(event);
                },
                async dispose() {}
            }),
            createPreviewIngestAdaptersImpl: () => ({
                twitch: {
                    async ingest() {
                        if (!failedOnce) {
                            failedOnce = true;
                            throw new Error('ingest failed');
                        }
                        routed.push({ type: 'platform:follow', platform: 'twitch' });
                    }
                },
                youtube: {
                    async ingest() {
                        routed.push({ type: 'platform:chat-message', platform: 'youtube' });
                    }
                },
                tiktok: {
                    async ingest() {
                        routed.push({ type: 'platform:gift', platform: 'tiktok' });
                    }
                }
            }),
            createGuiTransportServiceImpl: () => ({
                async start() {},
                async stop() {}
            }),
            safeSetIntervalImpl: (callback) => {
                intervalTick = callback;
                return 1;
            },
            safeSetTimeoutImpl: (resolve) => {
                intervalTick();
                intervalTick();
                intervalTick();
                resolve();
            },
            stdout: {
                write() {}
            }
        });

        expect(routed.length).toBeGreaterThan(0);
        expect(errors.length).toBeGreaterThan(0);
    });

    it('emits all required row types through full preview pipeline', async () => {
        const config = buildPreviewConfig();
        const rows = [];

        const pipeline = createPreviewPipeline({
            config,
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {},
                console: () => {}
            }
        });

        const unsubscribe = pipeline.eventBus.subscribe('display:row', (row) => {
            rows.push(row);
        });

        const adapters = createPreviewIngestAdapters({
            config,
            logger: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {},
                console: () => {}
            },
            emitPlatformEvent: (event) => pipeline.emitIngestEvent(event)
        });

        const scenarioEvents = buildPreviewScenarioEvents(32000, 2000);
        for (const event of scenarioEvents) {
            await adapters[event.adapter].ingest(event.rawEvent);
        }

        for (let attempt = 0; attempt < 200; attempt += 1) {
            const emittedTypes = new Set(rows.map((row) => row.type));
            if (emittedTypes.has('farewell') && emittedTypes.has('command') && emittedTypes.has('platform:envelope')) {
                break;
            }
            await Promise.resolve();
        }

        const emittedTypes = new Set(rows.map((row) => row.type));
        expect(emittedTypes.has('chat')).toBe(true);
        expect(emittedTypes.has('command')).toBe(true);
        expect(emittedTypes.has('greeting')).toBe(true);
        expect(emittedTypes.has('farewell')).toBe(true);
        expect(emittedTypes.has('platform:follow')).toBe(true);
        expect(emittedTypes.has('platform:gift')).toBe(true);
        expect(emittedTypes.has('platform:raid')).toBe(true);
        expect(emittedTypes.has('platform:share')).toBe(true);
        expect(emittedTypes.has('platform:paypiggy')).toBe(true);
        expect(emittedTypes.has('platform:giftpaypiggy')).toBe(true);
        expect(emittedTypes.has('platform:envelope')).toBe(true);

        unsubscribe();
        await pipeline.dispose();
    });
});
