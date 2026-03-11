const http = require('http');
const fs = require('fs');
const path = require('path');

const { createPlatformErrorHandler } = require('../../utils/platform-error-handler');
const { createEventToGuiContractMapper } = require('./event-to-gui-contract-mapper');

function isGuiActive(config = {}) {
    const gui = config.gui || {};
    return gui.enableDock === true || gui.enableOverlay === true;
}

function createGuiTransportErrorHandler(logger) {
    return createPlatformErrorHandler(logger, 'gui-transport');
}

function createGuiTransportService(options = {}) {
    const config = options.config || {};
    const guiConfig = config.gui || {};
    const logger = options.logger;
    const eventBus = options.eventBus;
    const mapper = options.mapper || createEventToGuiContractMapper({ config });
    const errorHandler = createGuiTransportErrorHandler(logger);
    const assetsRoot = typeof options.assetsRoot === 'string' && options.assetsRoot.trim()
        ? options.assetsRoot
        : path.resolve(__dirname, '../../../gui/dist');

    let server = null;
    let active = false;
    let unsubscribeDisplayRows = null;
    const clients = new Set();

    const getAssetContentType = (filePath) => {
        if (filePath.endsWith('.js')) {
            return 'application/javascript; charset=utf-8';
        }
        if (filePath.endsWith('.css')) {
            return 'text/css; charset=utf-8';
        }
        if (filePath.endsWith('.map')) {
            return 'application/json; charset=utf-8';
        }
        if (filePath.endsWith('.png')) {
            return 'image/png';
        }
        return 'application/octet-stream';
    };

    const resolveAssetFilePath = (url) => {
        if (!url.startsWith('/gui/assets/')) {
            return null;
        }

        let requestedPath;
        try {
            requestedPath = decodeURIComponent(url.replace('/gui/', ''));
        } catch {
            return null;
        }

        const normalizedPath = path.normalize(requestedPath);
        if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
            return null;
        }

        const absolutePath = path.resolve(assetsRoot, normalizedPath);
        const assetsDirectory = path.resolve(assetsRoot, 'assets');
        const relativePath = path.relative(assetsDirectory, absolutePath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return null;
        }

        return absolutePath;
    };

    const renderDisabledPage = (title, message, transparent = false) => {
        const bodyStyle = transparent
            ? 'margin:0;background:transparent;color:#ffffff;font-family:Georgia,serif;'
            : 'margin:0;background:#101317;color:#ffffff;font-family:Georgia,serif;';
        return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="${bodyStyle}"><div data-gui-disabled="true" style="padding:12px;opacity:0.9">${message}</div></body></html>`;
    };

    const renderActivePage = (title, kind, transparent = false) => {
        const assetVersion = Date.now().toString(36);
        const bodyStyle = transparent
            ? 'margin:0;background:transparent;color:#ffffff;font-family:Georgia,serif;'
            : 'margin:0;background:#101317;color:#ffffff;font-family:Georgia,serif;';
        const runtimeGuiConfig = {
            overlayMaxMessages: guiConfig.overlayMaxMessages,
            overlayMaxLinesPerMessage: guiConfig.overlayMaxLinesPerMessage
        };
        return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/gui/assets/styles.css?v=${assetVersion}"></head><body style="${bodyStyle}"><div id="app" data-kind="${kind}"></div><script>window.__STREAM_SYNC_GUI_KIND__=${JSON.stringify(kind)};window.__STREAM_SYNC_GUI_EVENTS__='/gui/events';window.__STREAM_SYNC_GUI_CONFIG__=${JSON.stringify(runtimeGuiConfig)};</script><script type="module" src="/gui/assets/${kind}.js?v=${assetVersion}"></script></body></html>`;
    };

    const sendSse = (payload) => {
        const packet = `data: ${JSON.stringify(payload)}\n\n`;
        for (const client of clients) {
            try {
                client.write(packet);
            } catch (error) {
                errorHandler.handleEventProcessingError(
                    error,
                    'sse-write',
                    { payloadType: payload?.type },
                    'Failed writing GUI SSE event'
                );
            }
        }
    };

    const subscribeToDisplayRows = () => {
        if (!eventBus || typeof eventBus.subscribe !== 'function') {
            return;
        }

        unsubscribeDisplayRows = eventBus.subscribe('display:row', async (row) => {
            try {
                const mapped = await mapper.mapDisplayRow(row);
                if (!mapped) {
                    return;
                }
                sendSse(mapped);
            } catch (error) {
                errorHandler.handleEventProcessingError(
                    error,
                    'display-row-map',
                    { rowType: row?.type },
                    'Failed mapping display row for GUI transport'
                );
            }
        });
    };

    const unsubscribeFromDisplayRows = () => {
        if (typeof unsubscribeDisplayRows === 'function') {
            unsubscribeDisplayRows();
        }
        unsubscribeDisplayRows = null;
    };

    const requestHandler = (req, res) => {
        const rawUrl = req.url || '/';
        let url = rawUrl;
        try {
            url = new URL(rawUrl, 'http://localhost').pathname;
        } catch {
            url = rawUrl;
        }

        if (url === '/gui/events') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no'
            });
            res.write(': connected\n\n');
            clients.add(res);

            req.on('close', () => {
                clients.delete(res);
            });
            return;
        }

        if (url.startsWith('/gui/assets/')) {
            const assetPath = resolveAssetFilePath(url);
            if (!assetPath || !fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not Found');
                return;
            }

            res.writeHead(200, {
                'Content-Type': getAssetContentType(assetPath),
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            res.end(fs.readFileSync(assetPath));
            return;
        }

        if (url === '/dock') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            if (guiConfig.enableDock === true) {
                res.end(renderActivePage('Stream Sync Dock', 'dock', false));
                return;
            }
            res.end(renderDisabledPage('Stream Sync Dock', 'Dock disabled', false));
            return;
        }

        if (url === '/overlay') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            if (guiConfig.enableOverlay === true) {
                res.end(renderActivePage('Stream Sync Overlay', 'overlay', true));
                return;
            }
            res.end(renderDisabledPage('Stream Sync Overlay', 'Overlay disabled', true));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
    };

    const start = async () => {
        if (active && server) {
            return;
        }

        if (!isGuiActive(config)) {
            active = false;
            return;
        }

        const host = typeof guiConfig.host === 'string' ? guiConfig.host.trim() : '';
        if (!host) {
            throw new Error('GUI transport requires non-empty host');
        }
        const port = Number(guiConfig.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error('GUI transport requires integer port between 1 and 65535');
        }

        subscribeToDisplayRows();

        try {
            await new Promise((resolve, reject) => {
                server = http.createServer(requestHandler);
                server.once('error', reject);
                server.listen(port, host, () => {
                    active = true;
                    resolve();
                });
            });
        } catch (error) {
            unsubscribeFromDisplayRows();
            if (server) {
                try {
                    server.close();
                } catch (closeError) {
                    errorHandler.logOperationalError('Failed closing GUI server after start error', 'gui-transport', {
                        error: closeError.message
                    });
                }
                server = null;
            }
            active = false;
            throw error;
        }
    };

    const stop = async () => {
        unsubscribeFromDisplayRows();
        for (const client of clients) {
            try {
                client.end();
            } catch (error) {
                errorHandler.logOperationalError('Failed closing GUI SSE client', 'gui-transport', {
                    error: error.message
                });
            }
        }
        clients.clear();

        if (!server) {
            active = false;
            return;
        }

        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });

        server = null;
        active = false;
    };

    const getAddress = () => {
        if (!server || !active) {
            return null;
        }
        return server.address();
    };

    const isActive = () => active;

    return {
        start,
        stop,
        getAddress,
        isActive
    };
}

module.exports = {
    createGuiTransportService,
    isGuiActive
};
