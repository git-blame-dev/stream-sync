const { describe, it, expect } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createGuiTransportService } = require('../../src/services/gui/gui-transport-service');
const { safeSetTimeout } = require('../../src/utils/timeout-validator');
const { TestEventBus } = require('../helpers/gui-transport-test-utils');
const { createConfigFixture } = require('../helpers/config-fixture');

function buildConfig(guiOverrides = {}) {
    return createConfigFixture({
        gui: {
            enableDock: false,
            enableOverlay: false,
            host: '127.0.0.1',
            port: 3399,
            messageCharacterLimit: 0,
            ...guiOverrides
        }
    });
}

function createSseReader(response: any) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const readWithTimeout = async (timeoutMs = 2000) => {
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        return await Promise.race([
            reader.read(),
            new Promise((_, reject) => {
                timeoutHandle = safeSetTimeout(() => reject(new Error('Timed out waiting for SSE event')), timeoutMs);
            })
        ]).finally(() => {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        });
    };

    return {
        async readEvent() {
            while (true) {
                const separatorIndex = buffer.indexOf('\n\n');
                if (separatorIndex === -1) {
                    const { value, done } = await readWithTimeout();
                    if (done) {
                        throw new Error('SSE stream ended before receiving an event');
                    }

                    buffer += decoder.decode(value, { stream: true });
                    continue;
                }

                const chunk = buffer.slice(0, separatorIndex);
                buffer = buffer.slice(separatorIndex + 2);
                const dataLine = chunk
                    .split('\n')
                    .map((line) => line.trim())
                    .find((line) => line.startsWith('data:'));

                if (!dataLine) {
                    continue;
                }

                const dataText = dataLine.slice('data:'.length).trim();
                return JSON.parse(dataText);
            }
        }
    };
}

function getBaseUrl(service: any) {
    const address = service.getAddress();
    if (!address || typeof address !== 'object' || typeof address.port !== 'number') {
        throw new Error('Expected GUI transport service to expose a bound address');
    }
    return `http://127.0.0.1:${address.port}`;
}

describe('GUI transport routes and SSE integration', () => {
    it('fails to start when host is missing', async () => {
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            host: '   ',
            port: 0
        });
        const service = createGuiTransportService({
            config,
            eventBus: new TestEventBus(),
            logger: null
        });

        await expect(service.start()).rejects.toThrow('GUI transport requires non-empty host');
    });

    it('remains restartable after stop sees server close errors', async () => {
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port: 0
        });

        let createServerCalls = 0;
        const fakeCreateServer = () => {
            createServerCalls += 1;
            return {
                once: () => undefined,
                listen: (_port: number, _host: string, callback: () => void) => callback(),
                address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 45678 }),
                close: (callback: (error: Error) => void) => callback(new Error('forced-close-failure'))
            };
        };

        const service = createGuiTransportService({
            config,
            eventBus,
            logger: null,
            createServer: fakeCreateServer
        });

        await service.start();
        await expect(service.stop()).resolves.toBeUndefined();
        await service.start();
        await expect(service.stop()).resolves.toBeUndefined();
        expect(createServerCalls).toBe(2);
        expect(service.isActive()).toBe(false);
    });

    it('shares one in-flight startup across concurrent start calls', async () => {
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port: 0
        });

        let subscribeCalls = 0;
        let unsubscribeCalls = 0;
        const eventBus = {
            subscribe: () => {
                subscribeCalls += 1;
                return () => {
                    unsubscribeCalls += 1;
                };
            }
        };

        let createServerCalls = 0;
        const fakeCreateServer = () => {
            createServerCalls += 1;
            return {
                once: () => undefined,
                on: () => undefined,
                removeListener: () => undefined,
                listen: (_port: number, _host: string, callback: () => void) => {
                    safeSetTimeout(callback, 15);
                },
                address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 45679 }),
                close: (callback: (error?: Error) => void) => callback()
            };
        };

        const service = createGuiTransportService({
            config,
            eventBus,
            logger: null,
            createServer: fakeCreateServer
        });

        await Promise.all([service.start(), service.start()]);
        expect(createServerCalls).toBe(1);
        expect(subscribeCalls).toBe(2);
        expect(service.isActive()).toBe(true);

        await service.stop();
        expect(unsubscribeCalls).toBe(2);
    });

    it('marks transport inactive when server emits runtime error after start', async () => {
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port: 0
        });

        const eventBus = new TestEventBus();
        let runtimeErrorListener: ((error: Error) => void) | null = null;
        const fakeCreateServer = () => {
            return {
                once: () => undefined,
                on: (eventName: string, listener: (error: Error) => void) => {
                    if (eventName === 'error') {
                        runtimeErrorListener = listener;
                    }
                },
                removeListener: (eventName: string, listener: (error: Error) => void) => {
                    if (eventName === 'error' && runtimeErrorListener === listener) {
                        runtimeErrorListener = null;
                    }
                },
                listen: (_port: number, _host: string, callback: () => void) => callback(),
                address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 45680 }),
                close: (callback: (error?: Error) => void) => callback()
            };
        };

        const service = createGuiTransportService({
            config,
            eventBus,
            logger: null,
            createServer: fakeCreateServer
        });

        await service.start();
        expect(service.isActive()).toBe(true);
        if (!runtimeErrorListener) {
            throw new Error('Expected runtime server error listener to be registered');
        }

        runtimeErrorListener(new Error('runtime transport error'));
        expect(service.isActive()).toBe(false);
        expect(service.getAddress()).toBe(null);

        await service.start();
        expect(service.isActive()).toBe(true);
        await service.stop();
    });

    it('delivers mapped rows over SSE and supports reconnect delivery', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port,
            messageCharacterLimit: 5
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = getBaseUrl(service);
        const firstAbort = new AbortController();

        try {
            const firstResponse = await fetch(`${baseUrl}/gui/events`, {
                signal: firstAbort.signal
            });
            expect(firstResponse.status).toBe(200);
            expect(firstResponse.headers.get('content-type')).toContain('text/event-stream');

            const firstReader = createSseReader(firstResponse);

            eventBus.emit('display:row', {
                type: 'chat',
                platform: 'twitch',
                data: {
                    username: 'test-user',
                    userId: 'test-user-id',
                    message: 'hello world',
                    avatarUrl: 'https://example.invalid/test-avatar.png',
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            });

            const firstEvent = await firstReader.readEvent();
            expect(firstEvent.type).toBe('chat');
            expect(firstEvent.text).toBe('hello');
            expect(firstEvent).not.toHaveProperty('toggleKey');
            expect(firstEvent).not.toHaveProperty('userId');

            firstAbort.abort();

            const secondAbort = new AbortController();
            try {
                const secondResponse = await fetch(`${baseUrl}/gui/events`, {
                    signal: secondAbort.signal
                });
                expect(secondResponse.status).toBe(200);
                const secondReader = createSseReader(secondResponse);

                eventBus.emit('display:row', {
                    type: 'platform:follow',
                    platform: 'twitch',
                    data: {
                        username: 'test-follower',
                        userId: 'test-follower-id',
                        displayMessage: 'test-follower followed',
                        avatarUrl: 'https://example.invalid/test-follow-avatar.png',
                        timestamp: '2024-01-01T00:00:01.000Z'
                    }
                });

                const secondEvent = await secondReader.readEvent();
                expect(secondEvent.type).toBe('platform:follow');
                expect(secondEvent.kind).toBe('notification');
                expect(secondEvent.username).toBe('test-follower');
                expect(secondEvent).not.toHaveProperty('toggleKey');
                expect(secondEvent).not.toHaveProperty('userId');
            } finally {
                secondAbort.abort();
            }
        } finally {
            await service.stop();
        }
    });

    it('keeps real avatar resolution when notification rows arrive before chat rows', async () => {
        const eventBus = new TestEventBus();
        const service = createGuiTransportService({
            config: buildConfig({
                enableDock: true,
                enableOverlay: false,
                port: 0,
                messageCharacterLimit: 0
            }),
            eventBus,
            logger: null
        });

        await service.start();
        const baseUrl = getBaseUrl(service);
        const abort = new AbortController();

        try {
            const response = await fetch(`${baseUrl}/gui/events`, {
                signal: abort.signal
            });
            expect(response.status).toBe(200);
            const reader = createSseReader(response);

            eventBus.emit('display:row', {
                type: 'platform:follow',
                platform: 'twitch',
                data: {
                    username: 'avatar-seed-user',
                    userId: 'avatar-seed-user-id',
                    displayMessage: 'avatar-seed-user followed',
                    avatarUrl: 'https://example.invalid/notification-avatar.png',
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            });

            const notificationRow = await reader.readEvent();
            expect(notificationRow.type).toBe('platform:follow');
            expect(notificationRow.avatarUrl).toBe('https://example.invalid/notification-avatar.png');

            eventBus.emit('display:row', {
                type: 'chat',
                platform: 'twitch',
                data: {
                    username: 'avatar-seed-user',
                    userId: 'avatar-seed-user-id',
                    message: 'hello from cache',
                    timestamp: '2024-01-01T00:00:01.000Z'
                }
            });

            const chatRow = await reader.readEvent();
            expect(chatRow.type).toBe('chat');
            expect(chatRow.avatarUrl).toBe('https://example.invalid/notification-avatar.png');
        } finally {
            abort.abort();
            await service.stop();
        }
    });

    it('delivers gift animation effect envelopes after display rows and serves runtime media', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            showGifts: true,
            port,
            messageCharacterLimit: 0
        });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-transport-gift-animation-'));
        const mediaPath = path.join(tempDirectory, 'gift.mp4');
        fs.writeFileSync(mediaPath, Buffer.from('test-mp4-content'));
        const service = createGuiTransportService({
            config,
            eventBus,
            logger: null,
            runtimeAssetRoots: [tempDirectory]
        });
        await service.start();

        const baseUrl = getBaseUrl(service);
        const abort = new AbortController();

        try {
            const response = await fetch(`${baseUrl}/gui/events`, {
                signal: abort.signal
            });
            expect(response.status).toBe(200);
            const reader = createSseReader(response);

            eventBus.emit('display:row', {
                type: 'platform:gift',
                platform: 'tiktok',
                data: {
                    username: 'test-user',
                    userId: 'test-user-id',
                    displayMessage: 'test-user sent Corgi',
                    avatarUrl: 'https://example.invalid/test-avatar.png',
                    giftType: 'Corgi',
                    giftCount: 1,
                    amount: 299,
                    currency: 'coins',
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            });

            eventBus.emit('display:gift-animation', {
                playbackId: 'test-playback-id',
                durationMs: 4000,
                mediaFilePath: mediaPath,
                mediaContentType: 'video/mp4',
                animationConfig: {
                    profileName: 'portrait',
                    sourceWidth: 960,
                    sourceHeight: 864,
                    renderWidth: 480,
                    renderHeight: 854,
                    rgbFrame: [0, 0, 480, 854],
                    aFrame: [480, 0, 480, 854]
                }
            });

            const rowEvent = await reader.readEvent();
            const effectEvent = await reader.readEvent();

            expect(rowEvent.type).toBe('platform:gift');
            expect(effectEvent.__guiEvent).toBe('effect');
            expect(effectEvent.effectType).toBe('tiktok-gift-animation');
            expect(effectEvent.playbackId).toBe('test-playback-id');
            expect(effectEvent.assetUrl).toMatch(/^\/gui\/runtime\/[a-f0-9]+\.mp4$/);
            expect(effectEvent.config).toBeDefined();

            const mediaResponse = await fetch(`${baseUrl}${effectEvent.assetUrl}`);
            expect(mediaResponse.status).toBe(200);
            expect(mediaResponse.headers.get('x-content-type-options')).toBe('nosniff');
            expect(mediaResponse.headers.get('content-type')).toContain('video/mp4');
            expect(mediaResponse.headers.get('accept-ranges')).toBe('bytes');

            const rangeResponse = await fetch(`${baseUrl}${effectEvent.assetUrl}`, {
                headers: {
                    Range: 'bytes=0-3'
                }
            });
            expect(rangeResponse.status).toBe(206);
            expect(rangeResponse.headers.get('content-range')).toMatch(/^bytes 0-3\//);
            const chunk = Buffer.from(await rangeResponse.arrayBuffer()).toString('utf8');
            expect(chunk).toBe('test');
        } finally {
            abort.abort();
            await service.stop();
            fs.rmSync(tempDirectory, { recursive: true, force: true });
        }
    });

    it('returns 416 for malformed or unsatisfiable runtime asset ranges', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            showGifts: true,
            port,
            messageCharacterLimit: 0
        });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-transport-gift-animation-range-'));
        const mediaPath = path.join(tempDirectory, 'gift.mp4');
        fs.writeFileSync(mediaPath, Buffer.from('test-mp4-content'));
        const service = createGuiTransportService({
            config,
            eventBus,
            logger: null,
            runtimeAssetRoots: [tempDirectory]
        });
        await service.start();

        const baseUrl = getBaseUrl(service);
        const abort = new AbortController();
        try {
            const response = await fetch(`${baseUrl}/gui/events`, { signal: abort.signal });
            expect(response.status).toBe(200);
            const reader = createSseReader(response);

            eventBus.emit('display:gift-animation', {
                playbackId: 'test-range-playback-id',
                durationMs: 4000,
                mediaFilePath: mediaPath,
                mediaContentType: 'video/mp4',
                animationConfig: {
                    profileName: 'portrait',
                    sourceWidth: 960,
                    sourceHeight: 864,
                    renderWidth: 480,
                    renderHeight: 854,
                    rgbFrame: [0, 0, 480, 854],
                    aFrame: [480, 0, 480, 854]
                }
            });

            const effectEvent = await reader.readEvent();

            const malformedRangeResponse = await fetch(`${baseUrl}${effectEvent.assetUrl}`, {
                headers: { Range: 'bytes=abc-def' }
            });
            expect(malformedRangeResponse.status).toBe(416);
            expect(malformedRangeResponse.headers.get('content-range')).toMatch(/^bytes \*\/\d+$/);

            const emptyRangeResponse = await fetch(`${baseUrl}${effectEvent.assetUrl}`, {
                headers: { Range: 'bytes=-' }
            });
            expect(emptyRangeResponse.status).toBe(416);
            expect(emptyRangeResponse.headers.get('content-range')).toMatch(/^bytes \*\/\d+$/);

            const unsatisfiableRangeResponse = await fetch(`${baseUrl}${effectEvent.assetUrl}`, {
                headers: { Range: 'bytes=999999-' }
            });
            expect(unsatisfiableRangeResponse.status).toBe(416);
            expect(unsatisfiableRangeResponse.headers.get('content-range')).toMatch(/^bytes \*\/\d+$/);
        } finally {
            abort.abort();
            await service.stop();
            fs.rmSync(tempDirectory, { recursive: true, force: true });
        }
    });

    it('serves zero-byte runtime assets with correct headers and rejects ranged reads', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            showGifts: true,
            port,
            messageCharacterLimit: 0
        });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-transport-gift-animation-empty-'));
        const mediaPath = path.join(tempDirectory, 'gift-empty.mp4');
        fs.writeFileSync(mediaPath, Buffer.alloc(0));
        const service = createGuiTransportService({
            config,
            eventBus,
            logger: null,
            runtimeAssetRoots: [tempDirectory]
        });
        await service.start();

        const baseUrl = getBaseUrl(service);
        const abort = new AbortController();
        try {
            const response = await fetch(`${baseUrl}/gui/events`, { signal: abort.signal });
            expect(response.status).toBe(200);
            const reader = createSseReader(response);

            eventBus.emit('display:gift-animation', {
                playbackId: 'test-empty-playback-id',
                durationMs: 4000,
                mediaFilePath: mediaPath,
                mediaContentType: 'video/mp4',
                animationConfig: {
                    profileName: 'portrait',
                    sourceWidth: 960,
                    sourceHeight: 864,
                    renderWidth: 480,
                    renderHeight: 854,
                    rgbFrame: [0, 0, 480, 854],
                    aFrame: [480, 0, 480, 854]
                }
            });

            const effectEvent = await reader.readEvent();

            const mediaResponse = await fetch(`${baseUrl}${effectEvent.assetUrl}`);
            expect(mediaResponse.status).toBe(200);
            expect(mediaResponse.headers.get('content-length')).toBe('0');
            const mediaBody = await mediaResponse.arrayBuffer();
            expect(mediaBody.byteLength).toBe(0);

            const rangedResponse = await fetch(`${baseUrl}${effectEvent.assetUrl}`, {
                headers: { Range: 'bytes=0-0' }
            });
            expect(rangedResponse.status).toBe(416);
            expect(rangedResponse.headers.get('content-range')).toBe('bytes */0');
        } finally {
            abort.abort();
            await service.stop();
            fs.rmSync(tempDirectory, { recursive: true, force: true });
        }
    });

    it('rejects runtime assets that resolve outside allowed roots', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const allowedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-transport-allowed-'));
        const blockedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-transport-blocked-'));
        const blockedMediaPath = path.join(blockedRoot, 'gift.mp4');
        fs.writeFileSync(blockedMediaPath, Buffer.from('blocked-mp4-content'));

        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            showGifts: true,
            port,
            messageCharacterLimit: 0
        });
        const service = createGuiTransportService({
            config,
            eventBus,
            logger: null,
            runtimeAssetRoots: [allowedRoot]
        });
        await service.start();

        const baseUrl = getBaseUrl(service);
        const abort = new AbortController();

        try {
            const response = await fetch(`${baseUrl}/gui/events`, {
                signal: abort.signal
            });
            expect(response.status).toBe(200);
            const reader = createSseReader(response);

            eventBus.emit('display:gift-animation', {
                playbackId: 'blocked-playback-id',
                durationMs: 4000,
                mediaFilePath: blockedMediaPath,
                mediaContentType: 'video/mp4',
                animationConfig: {
                    profileName: 'portrait',
                    sourceWidth: 960,
                    sourceHeight: 864,
                    renderWidth: 480,
                    renderHeight: 854,
                    rgbFrame: [0, 0, 480, 854],
                    aFrame: [480, 0, 480, 854]
                }
            });

            let receivedEvent = false;
            reader.readEvent()
                .then(() => {
                    receivedEvent = true;
                })
                .catch(() => {});

            await new Promise((resolve) => {
                safeSetTimeout(resolve, 300);
            });

            expect(receivedEvent).toBe(false);
        } finally {
            abort.abort();
            await service.stop();
            fs.rmSync(allowedRoot, { recursive: true, force: true });
            fs.rmSync(blockedRoot, { recursive: true, force: true });
        }
    });

    it('enforces runtime asset max entries without exceeding cap', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            showGifts: true,
            port,
            messageCharacterLimit: 0
        });
        const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-transport-runtime-cap-'));
        const mediaPath = path.join(tempDirectory, 'gift.mp4');
        fs.writeFileSync(mediaPath, Buffer.from('test-mp4-content'));
        const service = createGuiTransportService({
            config,
            eventBus,
            logger: null,
            runtimeAssetRoots: [tempDirectory]
        });
        await service.start();

        const baseUrl = getBaseUrl(service);
        const abort = new AbortController();

        try {
            const response = await fetch(`${baseUrl}/gui/events`, {
                signal: abort.signal
            });
            expect(response.status).toBe(200);
            const reader = createSseReader(response);

            const assetUrls = [];
            for (let index = 0; index < 65; index += 1) {
                eventBus.emit('display:gift-animation', {
                    playbackId: `cap-playback-${index}`,
                    durationMs: 4000,
                    mediaFilePath: mediaPath,
                    mediaContentType: 'video/mp4',
                    animationConfig: {
                        profileName: 'portrait',
                        sourceWidth: 960,
                        sourceHeight: 864,
                        renderWidth: 480,
                        renderHeight: 854,
                        rgbFrame: [0, 0, 480, 854],
                        aFrame: [480, 0, 480, 854]
                    }
                });

                const effectEvent = await reader.readEvent();
                expect(effectEvent.__guiEvent).toBe('effect');
                assetUrls.push(effectEvent.assetUrl);
            }

            const oldestAssetResponse = await fetch(`${baseUrl}${assetUrls[0]}`);
            expect(oldestAssetResponse.status).toBe(404);

            const newestAssetResponse = await fetch(`${baseUrl}${assetUrls[64]}`);
            expect(newestAssetResponse.status).toBe(200);
        } finally {
            abort.abort();
            await service.stop();
            fs.rmSync(tempDirectory, { recursive: true, force: true });
        }
    });

    it('delivers chat parts over SSE when canonical message.parts is provided', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port,
            messageCharacterLimit: 0
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = getBaseUrl(service);
        const abort = new AbortController();
        try {
            const response = await fetch(`${baseUrl}/gui/events`, {
                signal: abort.signal
            });
            expect(response.status).toBe(200);

            const reader = createSseReader(response);
            eventBus.emit('display:row', {
                type: 'platform:chat-message',
                platform: 'tiktok',
                data: {
                    username: 'test-user',
                    userId: 'test-user-id',
                    avatarUrl: 'https://example.invalid/test-avatar.png',
                    message: {
                        text: '',
                        parts: [
                            {
                                type: 'emote',
                                platform: 'tiktok',
                                emoteId: '1234512345',
                                imageUrl: 'https://example.invalid/tiktok-emote.webp'
                            }
                        ]
                    },
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            });

            const event = await reader.readEvent();
            expect(event.type).toBe('platform:chat-message');
            expect(event.parts).toEqual([
                {
                    type: 'emote',
                    platform: 'tiktok',
                    emoteId: '1234512345',
                    imageUrl: 'https://example.invalid/tiktok-emote.webp'
                }
            ]);
        } finally {
            abort.abort();
            await service.stop();
        }
    });

    it('delivers notification parts over SSE for Twitch gift rows', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port,
            messageCharacterLimit: 0
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = getBaseUrl(service);
        const abort = new AbortController();
        try {
            const response = await fetch(`${baseUrl}/gui/events`, {
                signal: abort.signal
            });
            expect(response.status).toBe(200);

            const reader = createSseReader(response);
            eventBus.emit('display:row', {
                type: 'platform:gift',
                platform: 'twitch',
                data: {
                    username: 'test-twitch-user',
                    userId: 'test-twitch-user-id',
                    avatarUrl: 'https://example.invalid/twitch-avatar.png',
                    displayMessage: 'test-twitch-user sent 100 bits',
                    parts: [
                        { type: 'text', text: 'sent 100 ' },
                        {
                            type: 'emote',
                            platform: 'twitch',
                            emoteId: 'Cheer-100',
                            imageUrl: 'https://example.invalid/twitch/cheer-100-dark-animated-3.gif'
                        }
                    ],
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            });

            const event = await reader.readEvent();
            expect(event.type).toBe('platform:gift');
            expect(event.parts).toEqual([
                { type: 'text', text: 'sent 100 ' },
                {
                    type: 'emote',
                    platform: 'twitch',
                    emoteId: 'Cheer-100',
                    imageUrl: 'https://example.invalid/twitch/cheer-100-dark-animated-3.gif'
                }
            ]);
        } finally {
            abort.abort();
            await service.stop();
        }
    });

    it('delivers notification parts over SSE for YouTube Super Sticker rows', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port,
            messageCharacterLimit: 0
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = getBaseUrl(service);
        const abort = new AbortController();
        try {
            const response = await fetch(`${baseUrl}/gui/events`, {
                signal: abort.signal
            });
            expect(response.status).toBe(200);

            const reader = createSseReader(response);
            eventBus.emit('display:row', {
                type: 'platform:gift',
                platform: 'youtube',
                data: {
                    username: 'test-youtube-user',
                    userId: 'test-youtube-user-id',
                    avatarUrl: 'https://example.invalid/youtube-avatar.png',
                    displayMessage: 'test-youtube-user sent a A$7.99 Super Sticker',
                    parts: [
                        {
                            type: 'emote',
                            platform: 'youtube',
                            emoteId: 'supersticker',
                            imageUrl: 'https://lh3.googleusercontent.com/test-supersticker=s176-rwa'
                        },
                        { type: 'text', text: ' Test sticker description' }
                    ],
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            });

            const event = await reader.readEvent();
            expect(event.type).toBe('platform:gift');
            expect(event.parts).toEqual([
                {
                    type: 'emote',
                    platform: 'youtube',
                    emoteId: 'supersticker',
                    imageUrl: 'https://lh3.googleusercontent.com/test-supersticker=s176-rwa'
                },
                { type: 'text', text: ' Test sticker description' }
            ]);
        } finally {
            abort.abort();
            await service.stop();
        }
    });

    it('delivers canonical badgeImages over SSE for chat rows', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port,
            messageCharacterLimit: 0
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = getBaseUrl(service);
        const abort = new AbortController();
        try {
            const response = await fetch(`${baseUrl}/gui/events`, {
                signal: abort.signal
            });
            expect(response.status).toBe(200);

            const reader = createSseReader(response);
            eventBus.emit('display:row', {
                type: 'platform:chat-message',
                platform: 'youtube',
                data: {
                    username: 'test-user',
                    userId: 'test-user-id',
                    avatarUrl: 'https://example.invalid/test-avatar.png',
                    message: { text: 'hello' },
                    badgeImages: [
                        { imageUrl: 'https://example.invalid/badge-1.png', source: 'youtube', label: 'member' },
                        { imageUrl: 'https://example.invalid/badge-1.png', source: 'youtube', label: 'dupe' }
                    ],
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            });

            const event = await reader.readEvent();
            expect(event.badgeImages).toEqual([
                { imageUrl: 'https://example.invalid/badge-1.png', source: 'youtube', label: 'member' }
            ]);
        } finally {
            abort.abort();
            await service.stop();
        }
    });

    it('returns disabled dock shell and enabled overlay shell', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: false,
            enableOverlay: true,
            port
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = getBaseUrl(service);
        try {
            const dockResponse = await fetch(`${baseUrl}/dock`);
            const dockHtml = await dockResponse.text();
            expect(dockResponse.status).toBe(200);
            expect(dockResponse.headers.get('cache-control')).toContain('no-cache');
            expect(dockHtml).toContain('Dock disabled');
            expect(dockHtml).toContain('data-gui-disabled="true"');
            expect(dockHtml).not.toContain('/gui/events');

            const overlayResponse = await fetch(`${baseUrl}/overlay`);
            const overlayHtml = await overlayResponse.text();
            expect(overlayResponse.status).toBe(200);
            expect(overlayResponse.headers.get('cache-control')).toContain('no-cache');
            expect(overlayHtml).toContain('/gui/events');

            const tiktokAnimationsResponse = await fetch(`${baseUrl}/tiktok-animations`);
            const tiktokAnimationsHtml = await tiktokAnimationsResponse.text();
            expect(tiktokAnimationsResponse.status).toBe(200);
            expect(tiktokAnimationsResponse.headers.get('cache-control')).toContain('no-cache');
            expect(tiktokAnimationsHtml).toContain('/gui/events');
            expect(tiktokAnimationsHtml).toContain('/gui/assets/dock.js');
            expect(tiktokAnimationsHtml).toContain('data-kind="tiktok-animations"');
            expect(tiktokAnimationsHtml).toContain('background:transparent');
        } finally {
            await service.stop();
        }
    });

    it('returns enabled dock shell and disabled overlay shell', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = getBaseUrl(service);
        try {
            const dockResponse = await fetch(`${baseUrl}/dock`);
            const dockHtml = await dockResponse.text();
            expect(dockResponse.status).toBe(200);
            expect(dockResponse.headers.get('cache-control')).toContain('no-cache');
            expect(dockHtml).toContain('/gui/events');

            const overlayResponse = await fetch(`${baseUrl}/overlay`);
            const overlayHtml = await overlayResponse.text();
            expect(overlayResponse.status).toBe(200);
            expect(overlayResponse.headers.get('cache-control')).toContain('no-cache');
            expect(overlayHtml).toContain('Overlay disabled');
            expect(overlayHtml).toContain('data-gui-disabled="true"');
            expect(overlayHtml).not.toContain('/gui/events');

            const tiktokAnimationsResponse = await fetch(`${baseUrl}/tiktok-animations`);
            const tiktokAnimationsHtml = await tiktokAnimationsResponse.text();
            expect(tiktokAnimationsResponse.status).toBe(200);
            expect(tiktokAnimationsResponse.headers.get('cache-control')).toContain('no-cache');
            expect(tiktokAnimationsHtml).toContain('/gui/events');
            expect(tiktokAnimationsHtml).toContain('/gui/assets/dock.js');
            expect(tiktokAnimationsHtml).toContain('data-kind="tiktok-animations"');
            expect(tiktokAnimationsHtml).toContain('background:transparent');
        } finally {
            await service.stop();
        }
    });

    it('embeds overlay queue and line-clamp config into enabled overlay page', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: false,
            enableOverlay: true,
            overlayMaxMessages: 7,
            overlayMaxLinesPerMessage: 4,
            port
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = getBaseUrl(service);
        try {
            const response = await fetch(`${baseUrl}/overlay`);
            const html = await response.text();

            expect(response.status).toBe(200);
            expect(html).toContain('"overlayMaxMessages":7');
            expect(html).toContain('"overlayMaxLinesPerMessage":4');
            expect(html).toContain('"uiCompareMode":false');
        } finally {
            await service.stop();
        }
    });

    it('embeds ui compare mode into dock runtime config when enabled', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            uiCompareMode: true,
            port
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = getBaseUrl(service);
        try {
            const response = await fetch(`${baseUrl}/dock`);
            const html = await response.text();

            expect(response.status).toBe(200);
            expect(html).toContain('"uiCompareMode":true');
        } finally {
            await service.stop();
        }
    });

    it('serves enabled dock, overlay, and tiktok animations pages with built GUI asset entry paths', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: true,
            overlayMaxMessages: 7,
            overlayMaxLinesPerMessage: 4,
            port
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = getBaseUrl(service);
        try {
            const dockResponse = await fetch(`${baseUrl}/dock`);
            const dockHtml = await dockResponse.text();
            expect(dockResponse.status).toBe(200);
            expect(dockResponse.headers.get('cache-control')).toContain('no-cache');
            expect(dockHtml).toContain('/gui/assets/dock.js');
            expect(dockHtml).toContain('/gui/assets/styles.css');

            const overlayResponse = await fetch(`${baseUrl}/overlay`);
            const overlayHtml = await overlayResponse.text();
            expect(overlayResponse.status).toBe(200);
            expect(overlayResponse.headers.get('cache-control')).toContain('no-cache');
            expect(overlayHtml).toContain('/gui/assets/overlay.js');
            expect(overlayHtml).toContain('/gui/assets/styles.css');

            const tiktokAnimationsResponse = await fetch(`${baseUrl}/tiktok-animations`);
            const tiktokAnimationsHtml = await tiktokAnimationsResponse.text();
            expect(tiktokAnimationsResponse.status).toBe(200);
            expect(tiktokAnimationsResponse.headers.get('cache-control')).toContain('no-cache');
            expect(tiktokAnimationsHtml).toContain('/gui/assets/dock.js');
            expect(tiktokAnimationsHtml).toContain('/gui/assets/styles.css');
            expect(tiktokAnimationsHtml).toContain('data-kind="tiktok-animations"');
            expect(tiktokAnimationsHtml).toContain('background:transparent');
        } finally {
            await service.stop();
        }
    });

    it('serves built GUI assets and returns 404 for missing assets', async () => {
        const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-assets-'));
        const assetsDir = path.join(assetsRoot, 'assets');
        const platformIconsDir = path.join(assetsDir, 'platform-icons');
        const siblingDir = path.join(assetsRoot, 'assets2');
        fs.mkdirSync(assetsDir, { recursive: true });
        fs.mkdirSync(platformIconsDir, { recursive: true });
        fs.mkdirSync(siblingDir, { recursive: true });
        fs.writeFileSync(path.join(assetsDir, 'dock.js'), 'console.log("dock");');
        fs.writeFileSync(path.join(assetsDir, 'styles.css'), '.gui-row__avatar{width:24px;height:24px}');
        fs.writeFileSync(path.join(platformIconsDir, 'youtube-icon.png'), 'test-youtube-icon');
        fs.writeFileSync(path.join(siblingDir, 'secret.js'), 'console.log("secret");');

        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port
        });
        const service = createGuiTransportService({
            config,
            eventBus,
            logger: null,
            assetsRoot
        });

        await service.start();

        const baseUrl = getBaseUrl(service);
        try {
            const presentResponse = await fetch(`${baseUrl}/gui/assets/dock.js`);
            const presentBody = await presentResponse.text();
            expect(presentResponse.status).toBe(200);
            expect(presentBody).toContain('console.log("dock")');

            const queryResponse = await fetch(`${baseUrl}/gui/assets/dock.js?v=1`);
            const queryBody = await queryResponse.text();
            expect(queryResponse.status).toBe(200);
            expect(queryBody).toContain('console.log("dock")');

            const stylesResponse = await fetch(`${baseUrl}/gui/assets/styles.css`);
            const stylesBody = await stylesResponse.text();
            expect(stylesResponse.status).toBe(200);
            expect(stylesResponse.headers.get('content-type')).toContain('text/css');
            expect(stylesResponse.headers.get('cache-control')).toContain('no-cache');
            expect(stylesBody).toContain('.gui-row__avatar');

            const platformIconResponse = await fetch(`${baseUrl}/gui/assets/platform-icons/youtube-icon.png`);
            const platformIconBody = await platformIconResponse.text();
            expect(platformIconResponse.status).toBe(200);
            expect(platformIconResponse.headers.get('content-type')).toContain('image/png');
            expect(platformIconBody).toContain('test-youtube-icon');

            const missingResponse = await fetch(`${baseUrl}/gui/assets/missing.js`);
            const missingBody = await missingResponse.text();
            expect(missingResponse.status).toBe(404);
            expect(missingBody).toContain('Not Found');

            const encodedTraversalResponse = await fetch(`${baseUrl}/gui/assets/%2e%2e/assets2/secret.js`);
            const encodedTraversalBody = await encodedTraversalResponse.text();
            expect(encodedTraversalResponse.status).toBe(404);
            expect(encodedTraversalBody).toContain('Not Found');

            const malformedResponse = await fetch(`${baseUrl}/gui/assets/%E0%A4%A.js`);
            const malformedBody = await malformedResponse.text();
            expect(malformedResponse.status).toBe(404);
            expect(malformedBody).toContain('Not Found');
        } finally {
            await service.stop();
            fs.rmSync(assetsRoot, { recursive: true, force: true });
        }
    });

    it('does not deliver stale queued row dispatches after stop/start', async () => {
        const port = 0;
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port
        });
        const mapper = {
            async mapDisplayRow(row: any) {
                await new Promise((resolve) => {
                    safeSetTimeout(resolve, 30);
                });
                return {
                    type: row.type,
                    text: row.data.message,
                    username: row.data.username,
                    avatarUrl: row.data.avatarUrl,
                    timestamp: row.data.timestamp
                };
            }
        };

        const service = createGuiTransportService({ config, eventBus, mapper, logger: null });

        try {
            await service.start();
            eventBus.emit('display:row', {
                type: 'chat',
                platform: 'twitch',
                data: {
                    username: 'test-user-stale',
                    userId: 'test-user-stale-id',
                    message: 'stale-message',
                    avatarUrl: 'https://example.invalid/stale-avatar.png',
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            });

            await service.stop();
            await service.start();

            const baseUrl = getBaseUrl(service);
            const abortController = new AbortController();
            try {
                const response = await fetch(`${baseUrl}/gui/events`, { signal: abortController.signal });
                expect(response.status).toBe(200);
                const reader = createSseReader(response);

                eventBus.emit('display:row', {
                    type: 'chat',
                    platform: 'twitch',
                    data: {
                        username: 'test-user-fresh',
                        userId: 'test-user-fresh-id',
                        message: 'fresh-message',
                        avatarUrl: 'https://example.invalid/fresh-avatar.png',
                        timestamp: '2024-01-01T00:00:01.000Z'
                    }
                });

                const freshEvent = await reader.readEvent();
                expect(freshEvent.username).toBe('test-user-fresh');
                expect(freshEvent.text).toBe('fresh-message');
            } finally {
                abortController.abort();
            }
        } finally {
            await service.stop();
        }
    });

    it('activates only when dock or overlay is enabled', async () => {
        const inactiveConfig = buildConfig({ enableDock: false, enableOverlay: false, port: 0 });
        const inactiveService = createGuiTransportService({ config: inactiveConfig, eventBus: new TestEventBus(), logger: null });
        await inactiveService.start();
        try {
            expect(inactiveService.isActive()).toBe(false);
            expect(inactiveService.getAddress()).toBe(null);
        } finally {
            await inactiveService.stop();
        }

        const dockConfig = buildConfig({ enableDock: true, enableOverlay: false, port: 0 });
        const dockService = createGuiTransportService({ config: dockConfig, eventBus: new TestEventBus(), logger: null });
        await dockService.start();
        try {
            expect(dockService.isActive()).toBe(true);
            expect(dockService.getAddress()).not.toBe(null);
        } finally {
            await dockService.stop();
        }

        const overlayConfig = buildConfig({ enableDock: false, enableOverlay: true, port: 0 });
        const overlayService = createGuiTransportService({ config: overlayConfig, eventBus: new TestEventBus(), logger: null });
        await overlayService.start();
        try {
            expect(overlayService.isActive()).toBe(true);
            expect(overlayService.getAddress()).not.toBe(null);
        } finally {
            await overlayService.stop();
        }
    });

    it('applies each show* toggle independently without suppressing other event types', async () => {
        const toggleCases = [
            { toggleKey: 'showMessages', blockedType: 'chat' },
            { toggleKey: 'showCommands', blockedType: 'command' },
            { toggleKey: 'showGreetings', blockedType: 'greeting' },
            { toggleKey: 'showFarewells', blockedType: 'farewell' },
            { toggleKey: 'showFollows', blockedType: 'platform:follow' },
            { toggleKey: 'showShares', blockedType: 'platform:share' },
            { toggleKey: 'showRaids', blockedType: 'platform:raid' },
            { toggleKey: 'showGifts', blockedType: 'platform:gift' },
            { toggleKey: 'showPaypiggies', blockedType: 'platform:paypiggy' },
            { toggleKey: 'showGiftPaypiggies', blockedType: 'platform:giftpaypiggy' },
            { toggleKey: 'showEnvelopes', blockedType: 'platform:envelope' }
        ];

        const createRow = (type: string, suffix: number) => {
            const base: any = {
                type,
                platform: 'twitch',
                data: {
                    username: `test-user-${suffix}`,
                    userId: `test-user-id-${suffix}`,
                    avatarUrl: `https://example.invalid/avatar-${suffix}.png`,
                    timestamp: `2024-01-01T00:00:${String(suffix).padStart(2, '0')}.000Z`
                }
            };

            if (type === 'chat' || type === 'platform:chat-message') {
                base.data.message = `message-${suffix}`;
                return base;
            }

            base.data.displayMessage = `display-${suffix}`;
            return base;
        };

        for (let index = 0; index < toggleCases.length; index += 1) {
            const toggleCase = toggleCases[index];
            const controlType = toggleCase.blockedType === 'platform:follow' ? 'platform:share' : 'platform:follow';
            const port = 0;
            const eventBus = new TestEventBus();
            const config = buildConfig({
                enableDock: true,
                enableOverlay: false,
                port,
                [toggleCase.toggleKey]: false
            });
            const service = createGuiTransportService({ config, eventBus, logger: null });
            await service.start();

            const baseUrl = getBaseUrl(service);
            const abortController = new AbortController();
            try {
                const response = await fetch(`${baseUrl}/gui/events`, { signal: abortController.signal });
                expect(response.status).toBe(200);
                const reader = createSseReader(response);

                eventBus.emit('display:row', createRow(toggleCase.blockedType, index));
                eventBus.emit('display:row', createRow(controlType, index + 100));

                const event = await reader.readEvent();
                expect(event.type).toBe(controlType);
                expect(event.text).toContain(`display-${index + 100}`);
            } finally {
                abortController.abort();
                await service.stop();
            }
        }
    });
});
