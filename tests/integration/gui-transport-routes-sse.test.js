const { describe, it, expect } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
            expect(dockHtml).toContain('data-gui-disabled="true"');
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
            expect(overlayHtml).toContain('data-gui-disabled="true"');
            expect(overlayHtml).not.toContain('/gui/events');
        } finally {
            await service.stop();
        }
    });

    it('embeds overlay queue and line-clamp config into enabled overlay page', async () => {
        const port = await getAvailablePort();
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

        const baseUrl = `http://127.0.0.1:${port}`;
        try {
            const response = await fetch(`${baseUrl}/overlay`);
            const html = await response.text();

            expect(response.status).toBe(200);
            expect(html).toContain('"overlayMaxMessages":7');
            expect(html).toContain('"overlayMaxLinesPerMessage":4');
        } finally {
            await service.stop();
        }
    });

    it('serves enabled dock and overlay pages with built GUI asset entry paths', async () => {
        const port = await getAvailablePort();
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

        const baseUrl = `http://127.0.0.1:${port}`;
        try {
            const dockResponse = await fetch(`${baseUrl}/dock`);
            const dockHtml = await dockResponse.text();
            expect(dockResponse.status).toBe(200);
            expect(dockHtml).toContain('/gui/assets/dock.js');

            const overlayResponse = await fetch(`${baseUrl}/overlay`);
            const overlayHtml = await overlayResponse.text();
            expect(overlayResponse.status).toBe(200);
            expect(overlayHtml).toContain('/gui/assets/overlay.js');
        } finally {
            await service.stop();
        }
    });

    it('serves built GUI assets and returns 404 for missing assets', async () => {
        const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-assets-'));
        const assetsDir = path.join(assetsRoot, 'assets');
        const siblingDir = path.join(assetsRoot, 'assets2');
        fs.mkdirSync(assetsDir, { recursive: true });
        fs.mkdirSync(siblingDir, { recursive: true });
        fs.writeFileSync(path.join(assetsDir, 'dock.js'), 'console.log("dock");');
        fs.writeFileSync(path.join(siblingDir, 'secret.js'), 'console.log("secret");');

        const port = await getAvailablePort();
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

        const baseUrl = `http://127.0.0.1:${port}`;
        try {
            const presentResponse = await fetch(`${baseUrl}/gui/assets/dock.js`);
            const presentBody = await presentResponse.text();
            expect(presentResponse.status).toBe(200);
            expect(presentBody).toContain('console.log("dock")');

            const queryResponse = await fetch(`${baseUrl}/gui/assets/dock.js?v=1`);
            const queryBody = await queryResponse.text();
            expect(queryResponse.status).toBe(200);
            expect(queryBody).toContain('console.log("dock")');

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
