import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { createPlatformErrorHandler } from '../../utils/platform-error-handler';
import { createEventToGuiContractMapper } from './event-to-gui-contract-mapper';
import { GIFT_ANIMATION_CACHE_DIR } from '../tiktok-gift-animation/resolver';
import {
    renderActivePage,
    renderDisabledPage,
    isHeadRequest,
    requireGetRequest,
    resolveAssetFilePath,
    sendNoCacheHtml,
    sendOperatorHtml,
    sendNotFound,
    sendStaticAsset
} from './gui-http-responses';
import {
    buildGuiRuntimeConfig,
    isGuiActive,
    resolveGuiPageRuntimeConfig,
    toTransportRecord,
    type TransportRecord
} from './gui-runtime-config';
import { getSystemTimestampISO, isIsoTimestamp } from '../../utils/timestamp';
import type { AppLogger } from '../../core/logger/types';
import type { OperatorControlService } from '../operator/operator-control-service';
import type { OperatorLogSource } from '../operator/operator-log-source';
import { createOperatorApi, isOperatorRoute } from './operator-api';
import {
    DISPLAY_EVENT_TYPES,
    type GiftAnimationSettledPayload,
    type GiftAnimationSettledReason
} from '../../interfaces/DisplayEvents';
import type {
    OperatorAppearanceService,
    OperatorAppearanceSnapshot
} from '../operator/operator-appearance-service';

type GuiTransportLogger = Partial<AppLogger> & {
    debug?: (message: string, scope: string, data?: unknown) => void;
    info?: (message: string, scope: string, data?: unknown) => void;
};

type GuiTransportEventBus = {
    subscribe: (eventName: string, handler: (payload: unknown) => void | Promise<void>) => (() => void) | void;
    emit?: (eventName: string, payload: unknown) => void;
};

type DisplayRowMapperInput = Parameters<ReturnType<typeof createEventToGuiContractMapper>['mapDisplayRow']>[0];

type GuiTransportMapper = {
    mapDisplayRow: (row: DisplayRowMapperInput) => Promise<TransportRecord | null>;
};

type GuiHttpServer = {
    address: Server['address'];
    close: (callback?: (error?: Error) => void) => unknown;
    listen: (port: number, host: string, callback?: () => void) => unknown;
    on?: (eventName: string, listener: (error: Error) => void) => unknown;
    once: (eventName: string, listener: (error: Error) => void) => unknown;
    removeListener?: (eventName: string, listener: (error: Error) => void) => unknown;
};

type GuiHttpCreateServer = (
    requestListener: (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void
) => GuiHttpServer;

type GuiTransportOptions = {
    config?: TransportRecord;
    logger?: GuiTransportLogger | null;
    eventBus?: GuiTransportEventBus;
    mapper?: GuiTransportMapper;
    createServer?: GuiHttpCreateServer;
    assetsRoot?: string;
    runtimeAssetRoots?: readonly string[];
    demoOnly?: boolean;
    operatorControls?: OperatorControlService;
    operatorAppearance?: OperatorAppearanceService;
    operatorLogs?: OperatorLogSource;
};

type RuntimeAssetRecord = {
    filePath: string;
    contentType: string;
    expiresAt: number;
};

type GuiTransportService = {
start: () => Promise<void>;
stop: () => Promise<void>;
getAddress: () => ReturnType<Server['address']> | null;
    getSseClientCount: () => number;
    isActive: () => boolean;
    publishChatMessage: (platform: string, payload: Record<string, unknown>) => void;
};

type GuiMapperConfig = {
gui?: Record<string, unknown>;
};

function createGuiTransportErrorHandler(logger: GuiTransportLogger | undefined): ReturnType<typeof createPlatformErrorHandler> {
    return createPlatformErrorHandler(logger, 'gui-transport');
}

function directoryExists(directoryPath: string): boolean {
    try {
        return fs.statSync(directoryPath).isDirectory();
    } catch {
        return false;
    }
}

function resolveDefaultAssetsRoot(): string {
    const sourceTreeAssetsRoot = path.resolve(__dirname, '../../../gui/dist');
    const candidateRoots = [
        path.resolve(path.dirname(process.execPath), 'gui/dist'),
        path.resolve(process.cwd(), 'gui/dist'),
        sourceTreeAssetsRoot
    ];

    return candidateRoots.find(directoryExists) ?? sourceTreeAssetsRoot;
}

function createGuiTransportService(options: GuiTransportOptions = {}): GuiTransportService {
    const config = toTransportRecord(options.config);
    const guiConfig = toTransportRecord(config.gui);
    const logger = options.logger;
    const eventBus = options.eventBus;
    const demoOnly = options.demoOnly === true;
    const mapperConfig: GuiMapperConfig = { gui: guiConfig };
    const mapper = options.mapper ?? (createEventToGuiContractMapper({
        config: mapperConfig
    }) as GuiTransportMapper);
    const createServer = typeof options.createServer === 'function'
        ? options.createServer
        : http.createServer;
    const errorHandler = createGuiTransportErrorHandler(logger ?? undefined);
    const logDebug = (message: string, data?: unknown) => {
        if (logger && typeof logger.debug === 'function') {
            logger.debug(message, 'gui-transport', data || null);
        }
    };
    const logInfo = (message: string, data?: unknown) => {
        if (logger && typeof logger.info === 'function') {
            logger.info(message, 'gui-transport', data || null);
        }
    };
    const assetsRoot = typeof options.assetsRoot === 'string' && options.assetsRoot.trim()
        ? options.assetsRoot
        : resolveDefaultAssetsRoot();
    const runtimeAssetRoots = Array.isArray(options.runtimeAssetRoots) && options.runtimeAssetRoots.length > 0
        ? options.runtimeAssetRoots
        : [GIFT_ANIMATION_CACHE_DIR];
    const normalizedRuntimeAssetRoots = runtimeAssetRoots
        .map((root) => root.trim())
        .filter((root) => root.length > 0)
        .map((root) => path.resolve(root));

    let server: GuiHttpServer | null = null;
    let active = false;
    let startPromise: Promise<void> | null = null;
    let serverRuntimeErrorHandler: ((error: Error) => void) | null = null;
    let unsubscribeDisplayRows: (() => void) | null = null;
    let unsubscribeDisplayEffects: (() => void) | null = null;
    let unsubscribeDisplayLifecycle: (() => void) | null = null;
    let unsubscribeAppearance: (() => void) | null = null;
    const clients = new Set<ServerResponse<IncomingMessage>>();
    const chatClients = new Set<ServerResponse<IncomingMessage>>();
    const chatFeedEnabled = guiConfig.enableChatFeed === true;
    const operatorEnabled = guiConfig.enableOperator === true;
    const operatorApi = operatorEnabled && options.operatorControls && options.operatorLogs && options.operatorAppearance
        ? createOperatorApi({
            controls: options.operatorControls,
            appearance: options.operatorAppearance,
            logs: options.operatorLogs,
            ...(logger && typeof logger.warn === 'function' && typeof logger.error === 'function'
                ? { logger: { warn: logger.warn, error: logger.error } }
                : {})
        })
        : null;
    const CHAT_MAX_CLIENTS = 4;
    const CHAT_MAX_PACKET_BYTES = 16 * 1024;
    const CHAT_MAX_BUFFERED_BYTES = 64 * 1024;
    const GUI_MAX_CLIENTS = 48;
    const GUI_MAX_PACKET_BYTES = 256 * 1024;
    const GUI_MAX_BUFFERED_BYTES = 512 * 1024;
    const runtimeAssetRegistry = new Map<string, RuntimeAssetRecord>();
    const giftPlaybackRegistry = new Map<string, { expiresAt: number; settled: boolean }>();
    let dispatchChain = Promise.resolve();
    let dispatchEpoch = 0;
    const guiAppearanceSnapshot = () => options.operatorAppearance?.snapshot ?? buildGuiRuntimeConfig(guiConfig).appearance;

    const RUNTIME_ASSET_MAX_ENTRIES = 64;
    const RUNTIME_ASSET_TTL_MS = 5 * 60 * 1000;
    const GIFT_PLAYBACK_MAX_ENTRIES = 128;
    const GIFT_PLAYBACK_TTL_MS = 10 * 60 * 1000;
    const GIFT_ANIMATION_SETTLED_REASONS = new Set<GiftAnimationSettledReason>([
        'ended',
        'media-error',
        'play-rejected',
        'canvas-unavailable',
        'timeout'
    ]);

    const pruneGiftPlaybackRegistry = () => {
        const now = Date.now();
        for (const [id, record] of giftPlaybackRegistry) {
            if (record.expiresAt <= now) giftPlaybackRegistry.delete(id);
        }
        while (giftPlaybackRegistry.size > GIFT_PLAYBACK_MAX_ENTRIES) {
            const oldest = giftPlaybackRegistry.keys().next().value;
            if (typeof oldest !== 'string') break;
            giftPlaybackRegistry.delete(oldest);
        }
    };

    const registerGiftPlayback = (playbackId: unknown) => {
        if (typeof playbackId !== 'string' || !crypto.randomUUID) return;
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playbackId)) return;
        pruneGiftPlaybackRegistry();
        giftPlaybackRegistry.set(playbackId, { expiresAt: Date.now() + GIFT_PLAYBACK_TTL_MS, settled: false });
        pruneGiftPlaybackRegistry();
    };

    const normalizeRuntimeAssetRecord = (record: unknown): RuntimeAssetRecord | null => {
        if (!record || typeof record !== 'object') {
            return null;
        }

        const recordShape = toTransportRecord(record);

        const filePath = typeof recordShape.filePath === 'string' ? recordShape.filePath.trim() : '';
        if (!filePath) {
            return null;
        }

        const contentType = typeof recordShape.contentType === 'string' && recordShape.contentType.trim()
            ? recordShape.contentType
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

    const registerRuntimeAsset = (record: unknown) => {
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

        const isAllowedPath = normalizedRuntimeAssetRoots.some((rootPath: string) => {
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

    const resolveRuntimeAsset = (assetId: string) => {
        pruneRuntimeAssets();
        const record = runtimeAssetRegistry.get(assetId);
        if (!record) {
            return null;
        }
        record.expiresAt = Date.now() + RUNTIME_ASSET_TTL_MS;
        runtimeAssetRegistry.set(assetId, record);
        return record;
    };

    const enqueueDispatch = (operation: () => void | Promise<void>) => {
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

    const sendSse = (payload: unknown) => {
        let packet: string;
        try {
            packet = `data: ${JSON.stringify(payload)}\n\n`;
        } catch (error) {
            errorHandler.handleEventProcessingError(
                error,
                'sse-serialize',
                null,
                'Failed serializing GUI SSE event'
            );
            return;
        }
        const packetBytes = Buffer.byteLength(packet, 'utf8');
        if (packetBytes > GUI_MAX_PACKET_BYTES) {
            return;
        }
        for (const client of clients) {
            try {
                if (client.writableLength + packetBytes > GUI_MAX_BUFFERED_BYTES) {
                    clients.delete(client);
                    client.destroy();
                    continue;
                }
                client.write(packet);
            } catch (error) {
                clients.delete(client);
                try {
                    client.destroy();
                } catch (destroyError) {
                    errorHandler.logOperationalError('Failed destroying stale GUI SSE client', 'sse-write', {
                        error: destroyError instanceof Error ? destroyError.message : String(destroyError)
                    });
                }
                const payloadRecord = toTransportRecord(payload);
                errorHandler.handleEventProcessingError(
                    error,
                    'sse-write',
                    { payloadType: payloadRecord.type },
                    'Failed writing GUI SSE event'
                );
            }
        }
    };

    const subscribeToDisplayLifecycle = () => {
        if (!eventBus || typeof eventBus.subscribe !== 'function') return;
        const unsubscribe = eventBus.subscribe(DISPLAY_EVENT_TYPES.NOTIFICATION_LIFECYCLE, (payload: unknown) => {
            enqueueDispatch(() => {
                const record = toTransportRecord(payload);
                const eventId = typeof record.eventId === 'string' ? record.eventId : '';
                const phase = record.phase;
                const timestamp = Number(record.timestamp);
                if (!eventId || eventId.length > 256 ||
                    (phase !== 'started' && phase !== 'exit-started') ||
                    !Number.isFinite(timestamp)) return;
                sendSse({
                    __guiEvent: 'notification-lifecycle',
                    eventId,
                    phase
                });
            });
        });
        unsubscribeDisplayLifecycle = typeof unsubscribe === 'function' ? unsubscribe : null;
    };

    const createAppearanceEnvelope = (snapshot: OperatorAppearanceSnapshot | ReturnType<typeof guiAppearanceSnapshot>) => ({
        __guiEvent: 'appearance' as const,
        profile: 'minimal' as const,
        revision: snapshot.revision,
        settings: { ...snapshot.settings }
    });

    const subscribeToAppearance = () => {
        if (!options.operatorAppearance) return;
        unsubscribeAppearance = options.operatorAppearance.subscribe((snapshot) => {
            enqueueDispatch(() => sendSse(createAppearanceEnvelope(snapshot)));
        });
    };

    const unsubscribeFromAppearance = () => {
        unsubscribeAppearance?.();
        unsubscribeAppearance = null;
    };

    const publishChatMessage = (platform: string, payload: Record<string, unknown>) => {
        if (!chatFeedEnabled) {
            return;
        }

        const receivedAt = getSystemTimestampISO();
        const user = {
            displayName: String(payload.username ?? ''),
            isModerator: payload.isMod === true,
            isBroadcaster: payload.isBroadcaster === true,
            ...(typeof payload.userId === 'string' && payload.userId ? { id: payload.userId } : {})
        };
        const text = typeof payload.message === 'object' && payload.message !== null
            ? String((payload.message as Record<string, unknown>).text ?? '')
            : String(payload.message ?? '');
        const event = {
            schemaVersion: 1,
            type: 'chat.message',
            eventId: crypto.randomUUID(),
            platform,
            occurredAt: isIsoTimestamp(payload.timestamp) ? String(payload.timestamp) : receivedAt,
            receivedAt,
            user,
            message: { text }
        };
        const packet = `id: ${event.eventId}\nevent: chat.message\ndata: ${JSON.stringify(event)}\n\n`;

        if (Buffer.byteLength(packet, 'utf8') > CHAT_MAX_PACKET_BYTES) {
            return;
        }

        for (const client of chatClients) {
            try {
                if (client.writableLength > CHAT_MAX_BUFFERED_BYTES || !client.write(packet)) {
                    chatClients.delete(client);
                    client.destroy();
                }
            } catch {
                chatClients.delete(client);
                client.destroy();
            }
        }
    };

    const subscribeToDisplayRows = () => {
        if (!eventBus || typeof eventBus.subscribe !== 'function') {
            return;
        }

        const unsubscribe = eventBus.subscribe('display:row', async (row: unknown) => {
            enqueueDispatch(async () => {
                try {
                    const mapped = await mapper.mapDisplayRow(row as DisplayRowMapperInput);
                    if (!mapped) {
                        return;
                    }
                    sendSse(mapped);
                } catch (error) {
                    const rowRecord = toTransportRecord(row);
                    errorHandler.handleEventProcessingError(
                        error,
                        'display-row-map',
                        { rowType: rowRecord.type },
                        'Failed mapping display row for GUI transport'
                    );
                }
            });
        });
        unsubscribeDisplayRows = typeof unsubscribe === 'function' ? unsubscribe : null;
    };

    const subscribeToDisplayEffects = () => {
        if (!eventBus || typeof eventBus.subscribe !== 'function') {
            return;
        }

        const unsubscribe = eventBus.subscribe('display:gift-animation', (payload: unknown) => {
            enqueueDispatch(() => {
                const payloadRecord = toTransportRecord(payload);
                const giftsVisible = guiConfig.showGifts !== false;
                if (!giftsVisible) {
                    logDebug('Skipping gift animation effect packet because gifts are hidden', {
                        playbackId: payloadRecord.playbackId || null
                    });
                    return;
                }

                const runtimeAssetId = registerRuntimeAsset({
                    filePath: payloadRecord.mediaFilePath,
                    contentType: payloadRecord.mediaContentType || 'video/mp4'
                });

                const effectPayload = {
                    __guiEvent: 'effect',
                    effectType: 'tiktok-gift-animation',
                    playbackId: payloadRecord.playbackId,
                    durationMs: payloadRecord.durationMs,
                    assetUrl: `/gui/runtime/${runtimeAssetId}.mp4`,
                    config: payloadRecord.animationConfig
                };

                registerGiftPlayback(effectPayload.playbackId);

                logDebug('Dispatching gift animation effect packet', {
                    playbackId: effectPayload.playbackId || null,
                    durationMs: effectPayload.durationMs || null,
                    runtimeAssetId,
                    assetUrl: effectPayload.assetUrl,
                    clientCount: clients.size
                });

                sendSse(effectPayload);
            });
        });
        unsubscribeDisplayEffects = typeof unsubscribe === 'function' ? unsubscribe : null;
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
    const unsubscribeFromDisplayLifecycle = () => {
        unsubscribeDisplayLifecycle?.();
        unsubscribeDisplayLifecycle = null;
    };

    const isRouteAvailable = (route: string): boolean => {
        if (route === '/health') {
            return true;
        }

        if (demoOnly) {
            return route === '/demo';
        }

        if (route === '/dock') return guiConfig.enableDock === true;
        if (route === '/overlay') return guiConfig.enableOverlay === true;
        if (route === '/notifications') return guiConfig.enableNotifications === true;
        if (route === '/operator') return operatorEnabled && !!operatorApi;
        if (route === '/tiktok-animations') {
            return guiConfig.enableDock === true || guiConfig.enableOverlay === true;
        }

        return false;
    };

    const requestHandler = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
        const rawUrl = typeof req.url === 'string' ? req.url : '/';
        const sendBody = !isHeadRequest(req);
        let url = rawUrl;
        let parsedRequestUrl: URL | null = null;
        let routeProbe: string | null = null;
        try {
            parsedRequestUrl = new URL(rawUrl, 'http://localhost');
            url = parsedRequestUrl.pathname;
            routeProbe = parsedRequestUrl.searchParams.get('route');
        } catch {
            url = rawUrl;
        }

        if (isOperatorRoute(url)) {
            if (!operatorEnabled || !operatorApi) {
                sendNotFound(res);
                return;
            }
            void operatorApi.handle(req, res, url);
            return;
        }

        if (url === '/gui/events') {
            if (demoOnly) {
                sendNotFound(res);
                return;
            }
            if (!requireGetRequest(req, res)) {
                return;
            }
            if (clients.size >= GUI_MAX_CLIENTS) {
                res.writeHead(503);
                res.end('GUI event feed full');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no'
            });
            if (!sendBody) {
                res.end();
                return;
            }
            res.write('retry: 3000\n: connected\n\n');
            clients.add(res);
            res.write(`data: ${JSON.stringify(createAppearanceEnvelope(guiAppearanceSnapshot()))}\n\n`);
            logDebug('GUI SSE client connected', {
                clientCount: clients.size
            });

            let cleanedUp = false;
            const cleanup = () => {
                if (cleanedUp) return;
                cleanedUp = true;
                clients.delete(res);
                logDebug('GUI SSE client disconnected', {
                    clientCount: clients.size
                });
            };
            req.once('close', cleanup);
            res.once('close', cleanup);
            res.once('error', cleanup);
            return;
        }

        if (url === '/api/v1/gui/gift-animations/ack') {
            if (demoOnly) {
                sendNotFound(res);
                return;
            }
            if (req.method !== 'POST') {
                res.writeHead(405, { Allow: 'POST' }); res.end(); return;
            }
            const origin = req.headers.origin;
            const host = req.headers.host;
            let sameOrigin = false;
            try {
                const parsed = typeof origin === 'string' ? new URL(origin) : null;
                sameOrigin = !!parsed && parsed.protocol === 'http:' && parsed.host === host &&
                    ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname);
            } catch { /* invalid origin */ }
            if (!sameOrigin || req.headers['x-stream-sync-request'] !== '1' ||
                typeof req.headers['content-type'] !== 'string' ||
                !req.headers['content-type'].toLowerCase().startsWith('application/json')) {
                res.writeHead(403); res.end(); return;
            }
            void (async () => {
                try {
                    const length = Number(req.headers['content-length']);
                    if (Number.isFinite(length) && length > 2048) throw new RangeError('Request body too large');
                    const chunks: Buffer[] = []; let size = 0;
                    for await (const chunk of req) {
                        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                        size += buffer.length;
                        if (size > 2048) throw new RangeError('Request body too large');
                        chunks.push(buffer);
                    }
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
                    const record = toTransportRecord(body);
                    const keys = Object.keys(record).sort().join(',');
                    const playbackId = record.playbackId;
                    const reason = record.reason;
                    if (keys !== 'playbackId,reason' || typeof playbackId !== 'string' ||
                        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(playbackId) ||
                        typeof reason !== 'string' ||
                        !GIFT_ANIMATION_SETTLED_REASONS.has(reason as GiftAnimationSettledReason)) {
                        throw new TypeError('Invalid gift animation acknowledgement');
                    }
                    pruneGiftPlaybackRegistry();
                    const playback = giftPlaybackRegistry.get(playbackId);
                    if (!playback) { res.writeHead(404); res.end(); return; }
                    if (playback.settled) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ first: false })); return; }
                    playback.settled = true;
                    eventBus?.emit?.(
                        DISPLAY_EVENT_TYPES.GIFT_ANIMATION_SETTLED,
                        { playbackId, reason: reason as GiftAnimationSettledReason } satisfies GiftAnimationSettledPayload
                    );
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ first: true }));
                } catch (error) {
                    const status = error instanceof RangeError ? 413 : 400;
                    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid request' }));
                }
            })();
            return;
        }

        if (url === '/api/v1/chat/events') {
            if (!chatFeedEnabled) {
                sendNotFound(res);
                return;
            }
            if (req.headers.origin) {
                res.writeHead(403);
                res.end();
                return;
            }
            if (!requireGetRequest(req, res)) {
                return;
            }
            if (chatClients.size >= CHAT_MAX_CLIENTS) {
                res.writeHead(503);
                res.end('chat feed full');
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
                Connection: 'keep-alive',
                'X-Accel-Buffering': 'no'
            });
            if (!sendBody) {
                res.end();
                return;
            }

            res.write(': connected\n\n');
            chatClients.add(res);
            const removeClient = () => chatClients.delete(res);
            req.once('close', removeClient);
            res.once('close', removeClient);
            res.once('error', removeClient);
            return;
        }

        const runtimeAssetMatch = url.match(/^\/gui\/runtime\/([a-f0-9]+)\.mp4$/);
        if (runtimeAssetMatch) {
            if (demoOnly) {
                sendNotFound(res);
                return;
            }
            if (!requireGetRequest(req, res)) {
                return;
            }

            const runtimeAssetId = runtimeAssetMatch[1];
            if (!runtimeAssetId) {
                sendNotFound(res);
                return;
            }

            const runtimeAsset = resolveRuntimeAsset(runtimeAssetId);
            if (!runtimeAsset || !fs.existsSync(runtimeAsset.filePath)) {
                sendNotFound(res);
                return;
            }

            const stat = fs.statSync(runtimeAsset.filePath);
            if (!stat.isFile()) {
                sendNotFound(res);
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
                res.end(sendBody ? 'Requested Range Not Satisfiable' : undefined);
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
                    res.end(sendBody ? 'Requested Range Not Satisfiable' : undefined);
                    return;
                }

                const startToken = match[1] ?? '';
                const endToken = match[2] ?? '';

                if (startToken.length === 0 && endToken.length === 0) {
                    res.writeHead(416, {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Content-Range': `bytes */${totalSize}`,
                        'Accept-Ranges': 'bytes'
                    });
                    res.end(sendBody ? 'Requested Range Not Satisfiable' : undefined);
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
                        res.end(sendBody ? 'Requested Range Not Satisfiable' : undefined);
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
                        res.end(sendBody ? 'Requested Range Not Satisfiable' : undefined);
                        return;
                    }

                    if (start >= totalSize) {
                        res.writeHead(416, {
                            'Content-Type': 'text/plain; charset=utf-8',
                            'Content-Range': `bytes */${totalSize}`,
                            'Accept-Ranges': 'bytes'
                        });
                        res.end(sendBody ? 'Requested Range Not Satisfiable' : undefined);
                        return;
                    }

                    end = Math.min(end, totalSize - 1);
                }

                partialContent = true;
            }

            const contentLength = Math.max(0, end - start + 1);
            const headers: Record<string, string> = {
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

            if (!sendBody) {
                res.end();
                return;
            }

            const stream = fs.createReadStream(runtimeAsset.filePath, { start, end });
            stream.on('error', () => {
                if (!res.headersSent) {
                    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                }
                res.end(sendBody ? 'Failed to read runtime asset' : undefined);
            });
            stream.pipe(res);
            return;
        }

        if (url.startsWith('/gui/assets/')) {
            if (!requireGetRequest(req, res)) {
                return;
            }

            const assetPath = resolveAssetFilePath(url, assetsRoot);
            if (!assetPath || !fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
                sendNotFound(res);
                return;
            }

            sendStaticAsset(res, assetPath, sendBody);
            return;
        }

        if (url === '/health') {
            if (!requireGetRequest(req, res)) {
                return;
            }

            const requestedRoute = routeProbe && routeProbe.startsWith('/') ? routeProbe : null;
            const ok = requestedRoute ? isRouteAvailable(requestedRoute) : true;
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(sendBody ? JSON.stringify({ ok, service: 'stream-sync-gui', route: requestedRoute }) : undefined);
            return;
        }

        if (url === '/demo') {
            if (!demoOnly) {
                sendNotFound(res);
                return;
            }
            if (!requireGetRequest(req, res)) {
                return;
            }

            sendNoCacheHtml(res, renderActivePage({
                title: 'Stream Sync Demo',
                runtimeKind: 'demo',
                scriptKind: 'demo',
                transparent: true,
                includeEventGlobals: false,
                guiConfig
            }), sendBody);
            return;
        }

        if (demoOnly) {
            sendNotFound(res);
            return;
        }

        if (url === '/operator') {
            if (!requireGetRequest(req, res)) {
                return;
            }
            if (operatorEnabled && operatorApi) {
                sendOperatorHtml(res, sendBody);
                return;
            }
            sendNoCacheHtml(res, renderDisabledPage('Stream Sync Operator', 'Operator console disabled'), sendBody);
            return;
        }

        if (url === '/dock') {
            if (!requireGetRequest(req, res)) {
                return;
            }
            if (guiConfig.enableDock === true) {
                sendNoCacheHtml(res, renderActivePage({
                    title: 'Stream Sync Dock',
                    runtimeKind: 'dock',
                    scriptKind: 'dock',
                    transparent: true,
                    guiConfig,
                    runtimeGuiConfig: resolveGuiPageRuntimeConfig(
                        guiConfig,
                        'dock',
                        parsedRequestUrl?.searchParams ?? new URLSearchParams(),
                        guiAppearanceSnapshot()
                    )
                }), sendBody);
                return;
            }
            sendNoCacheHtml(res, renderDisabledPage('Stream Sync Dock', 'Dock disabled', true), sendBody);
            return;
        }

        if (url === '/notifications') {
            if (!requireGetRequest(req, res)) return;
            if (guiConfig.enableNotifications === true) {
                sendNoCacheHtml(res, renderActivePage({
                    title: 'Stream Sync Notifications',
                    runtimeKind: 'notifications',
                    scriptKind: 'dock',
                    transparent: true,
                    guiConfig,
                    runtimeGuiConfig: resolveGuiPageRuntimeConfig(
                        guiConfig,
                        'notifications',
                        parsedRequestUrl?.searchParams ?? new URLSearchParams(),
                        guiAppearanceSnapshot()
                    )
                }), sendBody);
                return;
            }
            sendNoCacheHtml(res, renderDisabledPage('Stream Sync Notifications', 'Notifications disabled', true), sendBody);
            return;
        }

        if (url === '/tiktok-animations') {
            if (!requireGetRequest(req, res)) {
                return;
            }
            if (guiConfig.enableDock === true || guiConfig.enableOverlay === true) {
                sendNoCacheHtml(res, renderActivePage({
                    title: 'Stream Sync TikTok Animations',
                    runtimeKind: 'tiktok-animations',
                    scriptKind: 'dock',
                    transparent: true,
                    guiConfig,
                    runtimeGuiConfig: resolveGuiPageRuntimeConfig(
                        guiConfig,
                        'tiktok-animations',
                        parsedRequestUrl?.searchParams ?? new URLSearchParams(),
                        guiAppearanceSnapshot()
                    )
                }), sendBody);
                return;
            }
            sendNoCacheHtml(res, renderDisabledPage('Stream Sync TikTok Animations', 'TikTok animations disabled', true), sendBody);
            return;
        }

        if (url === '/overlay') {
            if (!requireGetRequest(req, res)) {
                return;
            }
            if (guiConfig.enableOverlay === true) {
                sendNoCacheHtml(res, renderActivePage({
                    title: 'Stream Sync Overlay',
                    runtimeKind: 'overlay',
                    scriptKind: 'overlay',
                    transparent: true,
                    guiConfig,
                    runtimeGuiConfig: resolveGuiPageRuntimeConfig(
                        guiConfig,
                        'overlay',
                        parsedRequestUrl?.searchParams ?? new URLSearchParams(),
                        guiAppearanceSnapshot()
                    )
                }), sendBody);
                return;
            }
            sendNoCacheHtml(res, renderDisabledPage('Stream Sync Overlay', 'Overlay disabled', true), sendBody);
            return;
        }

        sendNotFound(res);
    };

    const start = async () => {
        if (startPromise) {
            return await startPromise;
        }

        startPromise = (async () => {
            if (active && server) {
                return;
            }

            if (!active && server) {
                await stop();
            }

            if (!demoOnly && !isGuiActive(config) && !chatFeedEnabled) {
                active = false;
                return;
            }

            const host = typeof guiConfig.host === 'string' ? guiConfig.host.trim() : '';
            if (!host) {
                throw new Error('GUI transport requires non-empty host');
            }
            if (chatFeedEnabled && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
                throw new Error('Chat feed requires loopback host');
            }
            if (operatorEnabled && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
                throw new Error('Operator console requires loopback host');
            }
            if (operatorEnabled && !operatorApi) {
                throw new Error('Operator console requires runtime controls, appearance, and logs');
            }
            const port = Number(guiConfig.port);
            if (!Number.isInteger(port) || port < 0 || port > 65535) {
                throw new Error('GUI transport requires integer port between 0 and 65535');
            }

            operatorApi?.start();
            subscribeToAppearance();
            subscribeToDisplayRows();
            subscribeToDisplayEffects();
            subscribeToDisplayLifecycle();

            serverRuntimeErrorHandler = (error: Error) => {
                active = false;
                errorHandler.handleEventProcessingError(
                    error,
                    'server-runtime',
                    null,
                    'GUI transport server runtime error'
                );
            };

            try {
                await new Promise<void>((resolve, reject) => {
                    server = createServer(requestHandler);
                    server.once('error', reject);
                    server.listen(port, host, () => {
                        if (server && typeof server.removeListener === 'function') {
                            server.removeListener('error', reject);
                        }
                        if (server && typeof server.on === 'function' && serverRuntimeErrorHandler) {
                            server.on('error', serverRuntimeErrorHandler);
                        }
                        active = true;
                        const address = server && typeof server.address === 'function' ? server.address() : null;
                        const boundPort = address && typeof address === 'object' ? address.port : port;
                        logInfo(`GUI transport started on ${host}:${boundPort}`);
                        resolve();
                    });
                });
            } catch (error) {
                unsubscribeFromDisplayRows();
                unsubscribeFromDisplayEffects();
                unsubscribeFromDisplayLifecycle();
                unsubscribeFromAppearance();
                operatorApi?.stop();
                if (server) {
                    if (serverRuntimeErrorHandler && typeof server.removeListener === 'function') {
                        server.removeListener('error', serverRuntimeErrorHandler);
                    }
                    try {
                        server.close();
                    } catch (closeError) {
                        errorHandler.logOperationalError('Failed closing GUI server after start error', 'gui-transport', {
                            error: closeError instanceof Error ? closeError.message : String(closeError)
                        });
                    }
                    server = null;
                }
                active = false;
                throw error;
            }
        })().finally(() => {
            startPromise = null;
        });

        return await startPromise;
    };

    const stop = async () => {
        dispatchEpoch += 1;
        unsubscribeFromDisplayRows();
        unsubscribeFromDisplayEffects();
        unsubscribeFromDisplayLifecycle();
        unsubscribeFromAppearance();
        await dispatchChain;
        runtimeAssetRegistry.clear();
        giftPlaybackRegistry.clear();
        operatorApi?.stop();
        for (const client of clients) {
            try {
                client.end();
            } catch (error) {
                errorHandler.logOperationalError('Failed closing GUI SSE client', 'gui-transport', {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        clients.clear();
        for (const client of chatClients) {
            client.end();
        }
        chatClients.clear();

        if (!server) {
            active = false;
            return;
        }

        const closingServer = server;
        server = null;
        active = false;
        if (serverRuntimeErrorHandler && typeof closingServer.removeListener === 'function') {
            closingServer.removeListener('error', serverRuntimeErrorHandler);
        }
        serverRuntimeErrorHandler = null;

        await new Promise<void>((resolve) => {
            closingServer.close((error) => {
                if (error) {
                    errorHandler.logOperationalError('Failed closing GUI transport server', 'gui-transport', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
                resolve();
            });
        });
    };

    const getAddress = (): ReturnType<Server['address']> | null => {
        if (!server || !active) {
            return null;
        }
        return server.address();
    };

    const isActive = (): boolean => active;
    const getSseClientCount = (): number => clients.size;

    return {
        start,
        stop,
        getAddress,
        getSseClientCount,
        isActive,
        publishChatMessage
    };
}

export { createGuiTransportService, isGuiActive };
