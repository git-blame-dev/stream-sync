const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { createPlatformErrorHandler } = require('../../utils/platform-error-handler');
const { createEventToGuiContractMapper } = require('./event-to-gui-contract-mapper');
const { GIFT_ANIMATION_CACHE_DIR } = require('../tiktok-gift-animation/resolver');

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
    const runtimeAssetRoots = Array.isArray(options.runtimeAssetRoots) && options.runtimeAssetRoots.length > 0
        ? options.runtimeAssetRoots
        : [GIFT_ANIMATION_CACHE_DIR];
    const normalizedRuntimeAssetRoots = runtimeAssetRoots
        .map((root) => (typeof root === 'string' ? root.trim() : ''))
        .filter((root) => root.length > 0)
        .map((root) => path.resolve(root));

    let server = null;
    let active = false;
    let unsubscribeDisplayRows = null;
    let unsubscribeDisplayEffects = null;
    const clients = new Set();
    const runtimeAssetRegistry = new Map();
    let dispatchChain = Promise.resolve();
    let dispatchEpoch = 0;

    const RUNTIME_ASSET_MAX_ENTRIES = 64;
    const RUNTIME_ASSET_TTL_MS = 5 * 60 * 1000;

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

    const normalizeRuntimeAssetRecord = (record) => {
        if (!record || typeof record !== 'object') {
            return null;
        }

        const filePath = typeof record.filePath === 'string' ? record.filePath.trim() : '';
        if (!filePath) {
            return null;
        }

        const contentType = typeof record.contentType === 'string' && record.contentType.trim()
            ? record.contentType
            : 'video/mp4';

        const expiresAt = Date.now() + RUNTIME_ASSET_TTL_MS;
        return {
            filePath,
            contentType,
            expiresAt
        };
    };

    const pruneRuntimeAssets = () => {
        const now = Date.now();
        for (const [assetId, record] of runtimeAssetRegistry) {
            if (!record || record.expiresAt <= now) {
                runtimeAssetRegistry.delete(assetId);
            }
        }

        if (runtimeAssetRegistry.size <= RUNTIME_ASSET_MAX_ENTRIES) {
            return;
        }

        const ordered = Array.from(runtimeAssetRegistry.entries())
            .sort((left, right) => left[1].expiresAt - right[1].expiresAt);
        while (ordered.length > RUNTIME_ASSET_MAX_ENTRIES) {
            const oldest = ordered.shift();
            if (!oldest) {
                break;
            }
            runtimeAssetRegistry.delete(oldest[0]);
        }
    };

    const registerRuntimeAsset = (record) => {
        const normalizedRecord = normalizeRuntimeAssetRecord(record);
        if (!normalizedRecord) {
            throw new Error('Runtime asset registration requires filePath');
        }

        const realFilePath = fs.realpathSync(normalizedRecord.filePath);
        const extension = path.extname(realFilePath).toLowerCase();
        if (extension !== '.mp4') {
            throw new Error('Runtime asset registration only supports .mp4 files');
        }

        const stat = fs.existsSync(realFilePath) ? fs.statSync(realFilePath) : null;
        if (!stat || !stat.isFile()) {
            throw new Error('Runtime asset file does not exist');
        }

        const isAllowedPath = normalizedRuntimeAssetRoots.some((rootPath) => {
            const relativePath = path.relative(rootPath, realFilePath);
            return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
        });
        if (!isAllowedPath) {
            throw new Error('Runtime asset path is outside allowed roots');
        }

        pruneRuntimeAssets();
        const assetId = crypto.randomBytes(12).toString('hex');
        runtimeAssetRegistry.set(assetId, {
            ...normalizedRecord,
            filePath: realFilePath
        });
        pruneRuntimeAssets();
        return assetId;
    };

    const resolveRuntimeAsset = (assetId) => {
        pruneRuntimeAssets();
        const record = runtimeAssetRegistry.get(assetId);
        if (!record) {
            return null;
        }
        record.expiresAt = Date.now() + RUNTIME_ASSET_TTL_MS;
        runtimeAssetRegistry.set(assetId, record);
        return record;
    };

    const enqueueDispatch = (operation) => {
        const enqueueEpoch = dispatchEpoch;
        dispatchChain = dispatchChain
            .then(() => {
                if (enqueueEpoch !== dispatchEpoch) {
                    return;
                }

                return Promise.resolve().then(operation);
            })
            .catch((error) => {
                errorHandler.handleEventProcessingError(
                    error,
                    'gui-dispatch',
                    null,
                    'GUI transport dispatch failed'
                );
            });
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

    const renderActivePage = (title, runtimeKind, scriptKind = runtimeKind, transparent = false) => {
        const assetVersion = Date.now().toString(36);
        const bodyStyle = transparent
            ? 'margin:0;background:transparent;color:#ffffff;font-family:Georgia,serif;'
            : 'margin:0;background:#101317;color:#ffffff;font-family:Georgia,serif;';
        const runtimeGuiConfig = {
            overlayMaxMessages: guiConfig.overlayMaxMessages,
            overlayMaxLinesPerMessage: guiConfig.overlayMaxLinesPerMessage,
            uiCompareMode: guiConfig.uiCompareMode === true
        };
        return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/gui/assets/styles.css?v=${assetVersion}"></head><body style="${bodyStyle}"><div id="app" data-kind="${runtimeKind}"></div><script>window.__STREAM_SYNC_GUI_KIND__=${JSON.stringify(runtimeKind)};window.__STREAM_SYNC_GUI_EVENTS__='/gui/events';window.__STREAM_SYNC_GUI_CONFIG__=${JSON.stringify(runtimeGuiConfig)};</script><script type="module" src="/gui/assets/${scriptKind}.js?v=${assetVersion}"></script></body></html>`;
    };

    const sendSse = (payload) => {
        const packet = `data: ${JSON.stringify(payload)}\n\n`;
        for (const client of clients) {
            try {
                client.write(packet);
            } catch (error) {
                clients.delete(client);
                try {
                    client.destroy();
                } catch (destroyError) {
                    errorHandler.logOperationalError('Failed destroying stale GUI SSE client', 'sse-write', {
                        error: destroyError.message
                    });
                }
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
            enqueueDispatch(async () => {
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
        });
    };

    const subscribeToDisplayEffects = () => {
        if (!eventBus || typeof eventBus.subscribe !== 'function') {
            return;
        }

        unsubscribeDisplayEffects = eventBus.subscribe('display:gift-animation', (payload) => {
            enqueueDispatch(() => {
                const giftsVisible = guiConfig.showGifts !== false;
                if (!giftsVisible) {
                    return;
                }

                const runtimeAssetId = registerRuntimeAsset({
                    filePath: payload?.mediaFilePath,
                    contentType: payload?.mediaContentType || 'video/mp4'
                });

                const effectPayload = {
                    __guiEvent: 'effect',
                    effectType: 'tiktok-gift-animation',
                    playbackId: payload?.playbackId,
                    durationMs: payload?.durationMs,
                    assetUrl: `/gui/runtime/${runtimeAssetId}.mp4`,
                    config: payload?.animationConfig
                };

                sendSse(effectPayload);
            });
        });
    };

    const unsubscribeFromDisplayRows = () => {
        if (typeof unsubscribeDisplayRows === 'function') {
            unsubscribeDisplayRows();
        }
        unsubscribeDisplayRows = null;
    };

    const unsubscribeFromDisplayEffects = () => {
        if (typeof unsubscribeDisplayEffects === 'function') {
            unsubscribeDisplayEffects();
        }
        unsubscribeDisplayEffects = null;
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

        const runtimeAssetMatch = url.match(/^\/gui\/runtime\/([a-f0-9]+)\.mp4$/);
        if (runtimeAssetMatch) {
            const runtimeAsset = resolveRuntimeAsset(runtimeAssetMatch[1]);
            if (!runtimeAsset || !fs.existsSync(runtimeAsset.filePath)) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not Found');
                return;
            }

            const stat = fs.statSync(runtimeAsset.filePath);
            if (!stat.isFile()) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not Found');
                return;
            }

            const totalSize = stat.size;
            const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range.trim() : '';

            if (totalSize === 0) {
                if (rangeHeader) {
                    res.writeHead(416, {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Content-Range': 'bytes */0',
                        'Accept-Ranges': 'bytes'
                    });
                    res.end('Requested Range Not Satisfiable');
                    return;
                }

                res.writeHead(200, {
                    'Content-Type': runtimeAsset.contentType,
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'X-Content-Type-Options': 'nosniff',
                    'Accept-Ranges': 'bytes',
                    'Content-Length': '0'
                });
                res.end();
                return;
            }

            let start = 0;
            let end = Math.max(0, totalSize - 1);
            let partialContent = false;

            if (rangeHeader) {
                const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader);
                if (!match) {
                    res.writeHead(416, {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Content-Range': `bytes */${totalSize}`,
                        'Accept-Ranges': 'bytes'
                    });
                    res.end('Requested Range Not Satisfiable');
                    return;
                }

                const startToken = match[1];
                const endToken = match[2];

                if (startToken.length === 0 && endToken.length === 0) {
                    res.writeHead(416, {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Content-Range': `bytes */${totalSize}`,
                        'Accept-Ranges': 'bytes'
                    });
                    res.end('Requested Range Not Satisfiable');
                    return;
                }

                if (startToken.length === 0) {
                    const suffixLength = Number(endToken);
                    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
                        res.writeHead(416, {
                            'Content-Type': 'text/plain; charset=utf-8',
                            'Content-Range': `bytes */${totalSize}`,
                            'Accept-Ranges': 'bytes'
                        });
                        res.end('Requested Range Not Satisfiable');
                        return;
                    }

                    start = Math.max(0, totalSize - suffixLength);
                    end = Math.max(0, totalSize - 1);
                } else {
                    start = Number(startToken);
                    end = endToken.length > 0 ? Number(endToken) : Math.max(0, totalSize - 1);

                    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
                        res.writeHead(416, {
                            'Content-Type': 'text/plain; charset=utf-8',
                            'Content-Range': `bytes */${totalSize}`,
                            'Accept-Ranges': 'bytes'
                        });
                        res.end('Requested Range Not Satisfiable');
                        return;
                    }

                    if (start >= totalSize) {
                        res.writeHead(416, {
                            'Content-Type': 'text/plain; charset=utf-8',
                            'Content-Range': `bytes */${totalSize}`,
                            'Accept-Ranges': 'bytes'
                        });
                        res.end('Requested Range Not Satisfiable');
                        return;
                    }

                    end = Math.min(end, totalSize - 1);
                }

                partialContent = true;
            }

            const contentLength = Math.max(0, end - start + 1);
            const headers = {
                'Content-Type': runtimeAsset.contentType,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'X-Content-Type-Options': 'nosniff',
                'Accept-Ranges': 'bytes',
                'Content-Length': String(contentLength)
            };

            if (partialContent) {
                headers['Content-Range'] = `bytes ${start}-${end}/${totalSize}`;
                res.writeHead(206, headers);
            } else {
                res.writeHead(200, headers);
            }

            const stream = fs.createReadStream(runtimeAsset.filePath, { start, end });
            stream.on('error', () => {
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                }
                res.end('Failed to read runtime asset');
            });
            stream.pipe(res);
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
                res.end(renderActivePage('Stream Sync Dock', 'dock', 'dock', true));
                return;
            }
            res.end(renderDisabledPage('Stream Sync Dock', 'Dock disabled', true));
            return;
        }

        if (url === '/tiktok-animations') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            if (guiConfig.enableDock === true || guiConfig.enableOverlay === true) {
                res.end(renderActivePage('Stream Sync TikTok Animations', 'tiktok-animations', 'dock', true));
                return;
            }
            res.end(renderDisabledPage('Stream Sync TikTok Animations', 'TikTok animations disabled', true));
            return;
        }

        if (url === '/overlay') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            if (guiConfig.enableOverlay === true) {
                res.end(renderActivePage('Stream Sync Overlay', 'overlay', 'overlay', true));
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
        subscribeToDisplayEffects();

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
            unsubscribeFromDisplayEffects();
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
        dispatchEpoch += 1;
        unsubscribeFromDisplayRows();
        unsubscribeFromDisplayEffects();
        await dispatchChain;
        runtimeAssetRegistry.clear();
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
