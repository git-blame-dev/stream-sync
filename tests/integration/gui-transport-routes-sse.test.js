const { describe, it, expect } = require('bun:test');

const { createGuiTransportService } = require('../../src/services/gui/gui-transport-service');
const { safeSetTimeout } = require('../../src/utils/timeout-validator');
const { TestEventBus, getAvailablePort } = require('../helpers/gui-transport-test-utils');
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

function createSseReader(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const readWithTimeout = async (timeoutMs = 2000) => {
        let timeoutHandle;
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
                const { value, done } = await readWithTimeout();
                if (done) {
                    throw new Error('SSE stream ended before receiving an event');
                }

                buffer += decoder.decode(value, { stream: true });
                const separatorIndex = buffer.indexOf('\n\n');
                if (separatorIndex === -1) {
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

describe('GUI transport routes and SSE integration', () => {
    it('fails to start when host is missing', async () => {
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            host: '   ',
            port: await getAvailablePort()
        });
        const service = createGuiTransportService({
            config,
            eventBus: new TestEventBus(),
            logger: null
        });

        await expect(service.start()).rejects.toThrow('GUI transport requires non-empty host');
    });

    it('delivers mapped rows over SSE and supports reconnect delivery', async () => {
        const port = await getAvailablePort();
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port,
            messageCharacterLimit: 5
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = `http://127.0.0.1:${port}`;
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
            } finally {
                secondAbort.abort();
            }
        } finally {
            await service.stop();
        }
    });

    it('returns disabled dock shell and enabled overlay shell', async () => {
        const port = await getAvailablePort();
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: false,
            enableOverlay: true,
            port
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = `http://127.0.0.1:${port}`;
        try {
            const dockResponse = await fetch(`${baseUrl}/dock`);
            const dockHtml = await dockResponse.text();
            expect(dockResponse.status).toBe(200);
            expect(dockHtml).toContain('Dock disabled');
            expect(dockHtml).not.toContain('/gui/events');

            const overlayResponse = await fetch(`${baseUrl}/overlay`);
            const overlayHtml = await overlayResponse.text();
            expect(overlayResponse.status).toBe(200);
            expect(overlayHtml).toContain('/gui/events');
        } finally {
            await service.stop();
        }
    });

    it('returns enabled dock shell and disabled overlay shell', async () => {
        const port = await getAvailablePort();
        const eventBus = new TestEventBus();
        const config = buildConfig({
            enableDock: true,
            enableOverlay: false,
            port
        });
        const service = createGuiTransportService({ config, eventBus, logger: null });
        await service.start();

        const baseUrl = `http://127.0.0.1:${port}`;
        try {
            const dockResponse = await fetch(`${baseUrl}/dock`);
            const dockHtml = await dockResponse.text();
            expect(dockResponse.status).toBe(200);
            expect(dockHtml).toContain('/gui/events');

            const overlayResponse = await fetch(`${baseUrl}/overlay`);
            const overlayHtml = await overlayResponse.text();
            expect(overlayResponse.status).toBe(200);
            expect(overlayHtml).toContain('Overlay disabled');
            expect(overlayHtml).not.toContain('/gui/events');
        } finally {
            await service.stop();
        }
    });

    it('activates only when dock or overlay is enabled', async () => {
        const inactiveConfig = buildConfig({ enableDock: false, enableOverlay: false, port: await getAvailablePort() });
        const inactiveService = createGuiTransportService({ config: inactiveConfig, eventBus: new TestEventBus(), logger: null });
        await inactiveService.start();
        try {
            expect(inactiveService.isActive()).toBe(false);
            expect(inactiveService.getAddress()).toBe(null);
        } finally {
            await inactiveService.stop();
        }

        const dockConfig = buildConfig({ enableDock: true, enableOverlay: false, port: await getAvailablePort() });
        const dockService = createGuiTransportService({ config: dockConfig, eventBus: new TestEventBus(), logger: null });
        await dockService.start();
        try {
            expect(dockService.isActive()).toBe(true);
            expect(dockService.getAddress()).not.toBe(null);
        } finally {
            await dockService.stop();
        }

        const overlayConfig = buildConfig({ enableDock: false, enableOverlay: true, port: await getAvailablePort() });
        const overlayService = createGuiTransportService({ config: overlayConfig, eventBus: new TestEventBus(), logger: null });
        await overlayService.start();
        try {
            expect(overlayService.isActive()).toBe(true);
            expect(overlayService.getAddress()).not.toBe(null);
        } finally {
            await overlayService.stop();
        }
    });
});
