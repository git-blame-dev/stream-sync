import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AppLogger } from '../../core/logger/types';
import { createPlatformErrorHandler } from '../../utils/platform-error-handler';
import type { OperatorLogEntry, OperatorLogSource } from '../operator/operator-log-source';
import {
    type OperatorAppearanceKey,
    type OperatorAppearanceService,
    type OperatorAppearanceSnapshot
} from '../operator/operator-appearance-service';
import {
    OPERATOR_CONTROL_KEYS,
    type OperatorControlKey,
    type OperatorControlService,
    type OperatorControlSnapshot
} from '../operator/operator-control-service';

type OperatorApiOptions = {
    controls: Pick<OperatorControlService, 'controls' | 'overriddenKeys' | 'revision' | 'reset' | 'setEnabled' | 'subscribe'>;
    appearance: Pick<OperatorAppearanceService, 'snapshot' | 'reset' | 'set' | 'subscribe'>;
    logger?: Pick<AppLogger, 'warn' | 'error'> | null;
    logs: OperatorLogSource;
};

type OperatorControlView = {
    key: OperatorControlKey;
    label: string;
    enabled: boolean;
    overridden: boolean;
};

type OperatorStateView = {
    revision: number;
    controls: OperatorControlView[];
};
type OperatorAppearanceView = OperatorAppearanceSnapshot;

type SseClient = {
    response: ServerResponse<IncomingMessage>;
    unsubscribe?: () => void;
    cleanedUp?: boolean;
};

const CONTROL_LABELS: Record<OperatorControlKey, string> = {
    messagesEnabled: 'Chat messages',
    commandsEnabled: 'Commands',
    greetingsEnabled: 'Greetings',
    farewellsEnabled: 'Farewells',
    followsEnabled: 'Follows',
    giftsEnabled: 'Gifts',
    paypiggiesEnabled: 'Paypiggies',
    raidsEnabled: 'Raids',
    sharesEnabled: 'Shares'
};
const OPERATOR_ROUTES = new Set([
    '/api/v1/operator/state',
    '/api/v1/operator/events',
    '/api/v1/operator/controls',
    '/api/v1/operator/controls/reset',
    '/api/v1/operator/appearance',
    '/api/v1/operator/appearance/reset',
    '/api/v1/logs/events'
]);
const MAX_CLIENTS = 4;
const MAX_REQUEST_BYTES = 2048;
const MAX_PACKET_BYTES = 64 * 1024;
const MAX_BUFFERED_BYTES = 256 * 1024;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function isOperatorRoute(route: string): boolean {
    return OPERATOR_ROUTES.has(route);
}

function buildOperatorState(
    controls: Pick<OperatorControlService, 'controls' | 'overriddenKeys' | 'revision'> | OperatorControlSnapshot
): OperatorStateView {
    const overriddenKeys = new Set(controls.overriddenKeys);
    return {
        revision: controls.revision,
        controls: OPERATOR_CONTROL_KEYS.map((key) => ({
            key,
            label: CONTROL_LABELS[key],
            enabled: controls.controls[key],
            overridden: overriddenKeys.has(key)
        }))
    };
}

function buildOperatorAppearance(snapshot: OperatorAppearanceSnapshot): OperatorAppearanceView {
    return {
        revision: snapshot.revision,
        settings: { ...snapshot.settings },
        overriddenKeys: [...snapshot.overriddenKeys]
    };
}

function sendJson(res: ServerResponse<IncomingMessage>, status: number, payload: unknown): void {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    });
    res.end(JSON.stringify(payload));
}

function sendMethodNotAllowed(res: ServerResponse<IncomingMessage>, allow: string): void {
    res.writeHead(405, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        Allow: allow
    });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
}

function parseRequestOrigin(req: IncomingMessage): URL | null {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (typeof origin !== 'string' || typeof host !== 'string') {
        return null;
    }
    try {
        const parsed = new URL(origin);
        return parsed.protocol === 'http:' && parsed.host === host && LOOPBACK_HOSTS.has(parsed.hostname)
            ? parsed
            : null;
    } catch {
        return null;
    }
}

function isAuthorizedMutation(req: IncomingMessage): boolean {
    const contentType = typeof req.headers['content-type'] === 'string'
        ? req.headers['content-type'].split(';', 1)[0]?.trim().toLowerCase()
        : null;
    return parseRequestOrigin(req) !== null &&
        req.headers['x-stream-sync-request'] === '1' &&
        contentType === 'application/json';
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    const declaredLength = Number(req.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
        throw new RangeError('Request body too large');
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_REQUEST_BYTES) {
            throw new RangeError('Request body too large');
        }
        chunks.push(buffer);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(text || '{}') as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function writeSse(
    client: SseClient,
    event: string,
    payload: unknown,
    id?: string | number
): boolean {
    let serializedPayload: string | undefined;
    try {
        serializedPayload = JSON.stringify(payload);
    } catch {
        client.response.destroy();
        return false;
    }
    if (typeof serializedPayload !== 'string') {
        client.response.destroy();
        return false;
    }
    const packet = `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${serializedPayload}\n\n`;
    const packetBytes = Buffer.byteLength(packet, 'utf8');
    if (packetBytes > MAX_PACKET_BYTES || client.response.writableLength + packetBytes > MAX_BUFFERED_BYTES) {
        client.response.destroy();
        return false;
    }
    try {
        client.response.write(packet);
        return true;
    } catch {
        client.response.destroy();
        return false;
    }
}

function writeLogEntry(client: SseClient, entry: OperatorLogEntry): boolean {
    return writeSse(client, 'log', entry, entry.id);
}

function prepareSse(res: ServerResponse<IncomingMessage>): void {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff'
    });
    res.write('retry: 3000\n: connected\n\n');
}

function createOperatorApi(options: OperatorApiOptions) {
    const { appearance, controls, logger, logs } = options;
    const errorHandler = typeof logger?.warn === 'function' && typeof logger.error === 'function'
        ? createPlatformErrorHandler(logger, 'operator-api')
        : null;
    const stateClients = new Set<SseClient>();
    const logClients = new Set<SseClient>();

    const removeClient = (clients: Set<SseClient>, client: SseClient) => {
        if (client.cleanedUp) return;
        client.cleanedUp = true;
        client.unsubscribe?.();
        clients.delete(client);
    };
    const attachCleanup = (req: IncomingMessage, clients: Set<SseClient>, client: SseClient): boolean => {
        const cleanup = () => removeClient(clients, client);
        req.once('close', cleanup);
        client.response.once('close', cleanup);
        client.response.once('error', cleanup);
        if (req.destroyed || client.response.destroyed || client.response.writableEnded) cleanup();
        return !client.cleanedUp;
    };
    let unsubscribeControls: (() => void) | null = null;
    let unsubscribeAppearance: (() => void) | null = null;
    const broadcastState = (snapshot: OperatorControlSnapshot) => {
        const state = buildOperatorState(snapshot);
        for (const client of stateClients) {
            if (!writeSse(client, 'state', state)) {
                removeClient(stateClients, client);
            }
        }
    };
    const broadcastAppearance = (snapshot: OperatorAppearanceSnapshot) => {
        const state = buildOperatorAppearance(snapshot);
        for (const client of stateClients) {
            if (!writeSse(client, 'appearance', state)) {
                removeClient(stateClients, client);
            }
        }
    };

    const handleState = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendMethodNotAllowed(res, 'GET, HEAD');
            return;
        }
        if (req.method === 'HEAD') {
            sendJson(res, 200, null);
            return;
        }
        sendJson(res, 200, buildOperatorState(controls));
    };

    const handleAppearance = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendMethodNotAllowed(res, 'GET, HEAD');
            return;
        }
        if (req.method === 'HEAD') {
            sendJson(res, 200, null);
            return;
        }
        sendJson(res, 200, buildOperatorAppearance(appearance.snapshot));
    };

    const handleStateEvents = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
        if (req.method !== 'GET') {
            sendMethodNotAllowed(res, 'GET');
            return;
        }
        if (stateClients.size >= MAX_CLIENTS) {
            sendJson(res, 503, { error: 'Operator state stream is full' });
            return;
        }
        const client: SseClient = { response: res };
        stateClients.add(client);
        if (!attachCleanup(req, stateClients, client)) return;
        prepareSse(res);
        if (!writeSse(client, 'state', buildOperatorState(controls))) {
            removeClient(stateClients, client);
            return;
        }
        if (!writeSse(client, 'appearance', buildOperatorAppearance(appearance.snapshot))) {
            removeClient(stateClients, client);
        }
    };

    const handleLogEvents = (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
        if (req.method !== 'GET') {
            sendMethodNotAllowed(res, 'GET');
            return;
        }
        if (logClients.size >= MAX_CLIENTS) {
            sendJson(res, 503, { error: 'Operator log stream is full' });
            return;
        }
        const lastEventId = req.headers['last-event-id'];
        const afterId = typeof lastEventId === 'string' && /^(?:0|[1-9]\d*)$/.test(lastEventId)
            ? Number(lastEventId)
            : undefined;
        const safeAfterId = afterId !== undefined && Number.isSafeInteger(afterId) ? afterId : undefined;
        const client: SseClient = { response: res };
        logClients.add(client);
        if (!attachCleanup(req, logClients, client)) return;
        const connection = logs.connect(safeAfterId, (entry) => writeLogEntry(client, entry));
        client.unsubscribe = connection.unsubscribe;
        if (client.cleanedUp) {
            connection.unsubscribe();
            return;
        }
        prepareSse(res);
        if (connection.history.truncated && !writeSse(client, 'log.history', {
                oldestId: connection.history.oldestId,
                newestId: connection.history.newestId,
                truncated: true
            })) {
            removeClient(logClients, client);
            return;
        }
        connection.activate();
    };

    const handleMutation = async (
        req: IncomingMessage,
        res: ServerResponse<IncomingMessage>,
        reset: boolean
    ) => {
        const expectedMethod = reset ? 'POST' : 'PATCH';
        if (req.method !== expectedMethod) {
            sendMethodNotAllowed(res, expectedMethod);
            return;
        }
        if (!isAuthorizedMutation(req)) {
            sendJson(res, 403, { error: 'Forbidden' });
            return;
        }
        try {
            const body = await readJsonBody(req);
            if (!isRecord(body)) {
                throw new TypeError('Expected JSON object');
            }
            if (reset) {
                if (Object.keys(body).length !== 0) {
                    throw new TypeError('Reset request must be an empty object');
                }
                await controls.reset();
            } else {
                if (Object.keys(body).sort().join(',') !== 'enabled,key') {
                    throw new TypeError('Control request must contain only key and enabled');
                }
                const key = body.key;
                const enabled = body.enabled;
                if (typeof key !== 'string' || typeof enabled !== 'boolean') {
                    throw new TypeError('Expected key and boolean enabled');
                }
                await controls.setEnabled(key as OperatorControlKey, enabled);
            }
            sendJson(res, 200, buildOperatorState(controls));
        } catch (error) {
            if (error instanceof RangeError || error instanceof TypeError || error instanceof SyntaxError) {
                sendJson(res, error instanceof RangeError && error.message.includes('large') ? 413 : 400, {
                    error: error.message
                });
                return;
            }
            errorHandler?.handleEventProcessingError(
                error,
                'control-mutation',
                null,
                'Failed updating operator controls'
            );
            sendJson(res, 500, { error: 'Unable to persist operator controls' });
        }
    };

    const handleAppearanceMutation = async (
        req: IncomingMessage,
        res: ServerResponse<IncomingMessage>,
        reset: boolean
    ) => {
        const expectedMethod = reset ? 'POST' : 'PATCH';
        if (req.method !== expectedMethod) {
            sendMethodNotAllowed(res, expectedMethod);
            return;
        }
        if (!isAuthorizedMutation(req)) {
            sendJson(res, 403, { error: 'Forbidden' });
            return;
        }
        try {
            const body = await readJsonBody(req);
            if (!isRecord(body)) throw new TypeError('Expected JSON object');
            if (reset) {
                if (Object.keys(body).length !== 0) {
                    throw new TypeError('Reset request must be an empty object');
                }
                await appearance.reset();
            } else {
                if (Object.keys(body).sort().join(',') !== 'key,value') {
                    throw new TypeError('Appearance request must contain only key and value');
                }
                if (typeof body.key !== 'string') throw new TypeError('Expected appearance key');
                await appearance.set(body.key as OperatorAppearanceKey, body.value as boolean | number);
            }
            sendJson(res, 200, buildOperatorAppearance(appearance.snapshot));
        } catch (error) {
            if (error instanceof RangeError || error instanceof TypeError || error instanceof SyntaxError) {
                sendJson(res, error instanceof RangeError && error.message.includes('large') ? 413 : 400, {
                    error: error.message
                });
                return;
            }
            errorHandler?.handleEventProcessingError(
                error,
                'appearance-mutation',
                null,
                'Failed updating operator appearance'
            );
            sendJson(res, 500, { error: 'Unable to persist operator appearance' });
        }
    };

    const handle = async (req: IncomingMessage, res: ServerResponse<IncomingMessage>, route: string): Promise<void> => {
        if (route === '/api/v1/operator/state') {
            handleState(req, res);
        } else if (route === '/api/v1/operator/events') {
            handleStateEvents(req, res);
        } else if (route === '/api/v1/logs/events') {
            handleLogEvents(req, res);
        } else if (route === '/api/v1/operator/controls') {
            await handleMutation(req, res, false);
        } else if (route === '/api/v1/operator/controls/reset') {
            await handleMutation(req, res, true);
        } else if (route === '/api/v1/operator/appearance') {
            if (req.method === 'GET' || req.method === 'HEAD') handleAppearance(req, res);
            else await handleAppearanceMutation(req, res, false);
        } else if (route === '/api/v1/operator/appearance/reset') {
            await handleAppearanceMutation(req, res, true);
        } else {
            sendJson(res, 404, { error: 'Not found' });
        }
    };

    const start = () => {
        unsubscribeControls ??= controls.subscribe(broadcastState);
        unsubscribeAppearance ??= appearance.subscribe(broadcastAppearance);
    };

    const stop = () => {
        unsubscribeControls?.();
        unsubscribeControls = null;
        unsubscribeAppearance?.();
        unsubscribeAppearance = null;
        for (const clients of [stateClients, logClients]) {
            for (const client of [...clients]) {
                removeClient(clients, client);
                client.response.end();
            }
        }
    };

    return { handle, start, stop };
}

export { buildOperatorAppearance, buildOperatorState, createOperatorApi, isOperatorRoute };
export type { OperatorAppearanceView, OperatorStateView };
