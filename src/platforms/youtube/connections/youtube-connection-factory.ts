import {
    installYouTubeLiveChatUnknownRendererCapture,
    type InstallYouTubeLiveChatUnknownRendererCaptureOptions
} from './youtube-live-chat-unknown-renderer-capture';
import { InnertubeFactory } from '../../../factories/innertube-factory';
import type { UnknownRecord } from '../../../utils/record-contracts';
import { normalizeYouTubeUsername } from '../youtube-username-normalizer';
import { withOperationDeadline } from '../../../utils/timeout-wrapper';
import type { InnertubeChatClientOwner, InnertubeChatClientCreation, InnertubeOperationContext } from '../../../services/innertube-service';
import type { YouTubeConnectionAttemptContext } from '../youtube-connection-manager';

const RETIREMENT_TIMEOUT_MS = 5000;

interface LoggerLike {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
}

interface YouTubePlatform {
    logger: LoggerLike;
    config: UnknownRecord;
    viewerService?: {
        setActiveStream?: (videoId: string) => Promise<void>;
    };
    isCurrentYouTubeConnection: (videoId: string, attemptId: number) => boolean;
    setYouTubeConnectionReady: (videoId: string, attemptId: number) => void;
    disconnectFromYouTubeStream: (
        videoId: string,
        reason: string,
        options?: { requestImmediateRefresh?: boolean; source?: string; expectedAttemptId?: number }
  ) => Promise<boolean>;
    handleChatMessage: (message: UnknownRecord, isCurrent?: () => boolean) => void | Promise<void>;
    logRawPlatformData: (channel: string, payload: unknown) => Promise<void>;
    _validateVideoForConnection: (videoId: string, info: unknown) => { shouldConnect: boolean; reason?: string };
    _handleProcessingError: (message: string, error: unknown, category: string, metadata?: UnknownRecord) => void;
    _extractMessagesFromChatItem: (chatItem: UnknownRecord) => UnknownRecord[];
    _shouldSkipMessage: (message: UnknownRecord) => boolean;
    _resolveChatItemAuthorName: (message: UnknownRecord) => string;
}

interface YouTubeConnectionFactoryOptions {
    platform?: YouTubePlatform;
    innertubeService?: unknown;
    innertubeCreationTimeoutMs?: number;
    installLiveChatUnknownRendererCapture?: LiveChatUnknownRendererCaptureInstaller;
}

interface YouTubeConnection {
    on: (event: string, handler: (payload?: unknown) => void | Promise<void>) => void;
    off?: (event: string, handler: (payload?: unknown) => void) => unknown;
    removeListener?: (event: string, handler: (payload?: unknown) => void) => unknown;
    start: () => void | Promise<void>;
    stop?: () => void | Promise<void>;
    disconnect?: () => void | Promise<void>;
    applyFilter?: (filterName: string) => void | Promise<void>;
    sendMessage?: (message: unknown) => Promise<unknown>;
}

interface YouTubeInfo {
    getLiveChat: () => Promise<unknown>;
    actions?: {
        execute?: (endpoint: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    livechat?: {
        continuation?: string | null;
    };
}

interface YouTubeClient {
    getInfo: (videoId: string, options?: Record<string, unknown>) => Promise<unknown>;
}

export type YouTubeChatClientProvider = {
    beginChatClient: (context: InnertubeOperationContext) => InnertubeChatClientCreation<YouTubeClient>;
};

function isChatClientProvider(value: unknown): value is YouTubeChatClientProvider {
    return isRecord(value) && typeof value.beginChatClient === 'function';
}

function isYouTubeConnection(value: unknown): value is YouTubeConnection {
    return isRecord(value) && typeof value.on === 'function' && typeof value.start === 'function' && typeof value.stop === 'function';
}

type ParserModuleLike = {
    Parser?: {
        parseResponse?: (data: unknown) => unknown;
    };
};

type LiveChatUnknownRendererCaptureOptions = Omit<
    InstallYouTubeLiveChatUnknownRendererCaptureOptions,
    'parser' | 'logUnknownRenderer'
>;

type LiveChatUnknownRendererCaptureInstaller = (options: LiveChatUnknownRendererCaptureOptions) => void | Promise<void>;

function isParserLike(value: ParserModuleLike['Parser']): value is { parseResponse: (data: unknown) => unknown } {
    return !!value && typeof value.parseResponse === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isYouTubeClient(value: unknown): value is YouTubeClient {
  return isRecord(value) && typeof value.getInfo === 'function';
}

function isYouTubeInfo(value: unknown): value is YouTubeInfo {
  return isRecord(value) && typeof value.getLiveChat === 'function';
}

function isActionsLike(value: unknown): value is LiveChatUnknownRendererCaptureOptions['actions'] {
  return isRecord(value) && typeof value.execute === 'function';
}

function createYouTubeConnectionFactory(options: YouTubeConnectionFactoryOptions = {}) {
    const {
        platform,
        innertubeService,
        innertubeCreationTimeoutMs,
        installLiveChatUnknownRendererCapture
    } = options;

    if (!platform) {
        throw new Error('YouTube connection factory requires platform instance');
    }

    const timeoutMs = Number(innertubeCreationTimeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error('YouTube connection factory requires positive innertubeCreationTimeoutMs');
    }

    const captureInstaller: LiveChatUnknownRendererCaptureInstaller = typeof installLiveChatUnknownRendererCapture === 'function'
        ? installLiveChatUnknownRendererCapture
        : async (captureOptions: LiveChatUnknownRendererCaptureOptions) => {
            const youtubeModule = await InnertubeFactory.getLazyYouTubeModule() as ParserModuleLike;
            const parser = youtubeModule.Parser;
            if (!isParserLike(parser)) {
                return;
            }

            installYouTubeLiveChatUnknownRendererCapture({
                ...captureOptions,
                parser,
                isEnabled: () => platform.config.dataLoggingEnabled === true,
                logUnknownRenderer: async (entry) => {
                    if (platform.config.dataLoggingEnabled !== true) {
                        return;
                    }

                    try {
                        await platform.logRawPlatformData('unknown-renderer', entry);
                    } catch (error: unknown) {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        platform._handleProcessingError(
                            `Error logging YouTube unknown renderer data: ${errorMessage}`,
                            error,
                            'data-logging',
                            { videoId: entry.videoId, endpoint: entry.endpoint }
                        );
                    }
                }
            });
        };

    const applyConfiguredChatMode = async (connection: YouTubeConnection, videoId: string, attemptId: number, startData: unknown) => {
        const chatMode = platform.config.chatMode;
        const isTopChatMode = chatMode === 'top';
        const filterName = isTopChatMode ? 'TOP_CHAT' : 'LIVE_CHAT';

        if (typeof connection.applyFilter !== 'function') {
            platform.logger.warn(
                `Cannot apply YouTube chat mode for ${videoId}: applyFilter unavailable`,
                'youtube'
            );
            return;
        }

    const startDataRecord = isRecord(startData) ? startData : null;
    const header = isRecord(startDataRecord?.header) ? startDataRecord.header : null;
    const viewSelector = isRecord(header?.view_selector) ? header.view_selector : null;
    const menuItems = Array.isArray(viewSelector?.sub_menu_items)
      ? viewSelector.sub_menu_items
      : null;
        if (!Array.isArray(menuItems) || menuItems.length === 0) {
            platform.logger.warn(
                `Cannot apply YouTube chat mode for ${videoId}: selector unavailable`,
                'youtube'
            );
            return;
        }

        const modeIndex = isTopChatMode ? 0 : 1;
        const targetModeItem = menuItems[modeIndex];
        if (!targetModeItem) {
            platform.logger.warn(
                `Cannot apply YouTube chat mode for ${videoId}: missing ${chatMode} selector item`,
                'youtube'
            );
            return;
        }

        if (targetModeItem.selected) {
            return;
        }

        if (!targetModeItem.continuation) {
            platform.logger.warn(
                `Cannot apply YouTube chat mode for ${videoId}: missing ${chatMode} continuation`,
                'youtube'
            );
            return;
        }

        try {
            await connection.applyFilter(filterName);
            if (!platform.isCurrentYouTubeConnection(videoId, attemptId)) return;
            platform.logger.debug(`Applied YouTube chat mode for ${videoId}: ${chatMode}`, 'youtube');
        } catch (error: unknown) {
            if (!platform.isCurrentYouTubeConnection(videoId, attemptId)) return;
            const errorMessage = error instanceof Error ? error.message : String(error);
            platform._handleProcessingError(
                `Failed to apply YouTube chat mode for ${videoId}: ${errorMessage}`,
                error,
                'chat-mode',
                { videoId, chatMode }
            );
        }
    };

    const reportCleanup = (error: unknown, videoId: string) => {
        try { platform._handleProcessingError('YouTube chat operation failed', error, 'connection-cleanup', { videoId }); }
        catch { /* Reporting cannot replace the original failure or interrupt retirement. */ }
    };

    const requestDisconnect = (videoId: string, reason: string, settings: { expectedAttemptId: number; requestImmediateRefresh?: boolean; source?: string }) => {
        // The manager owns this retirement. Awaiting it inside an owned event
        // callback would make disposal join itself; still observe its rejection.
        try {
            void Promise.resolve(platform.disconnectFromYouTubeStream(videoId, reason, settings)).catch(error => {
                if (platform.isCurrentYouTubeConnection(videoId, settings.expectedAttemptId)) reportCleanup(error, videoId);
            });
        } catch (error) { reportCleanup(error, videoId); }
    };

    const manageConnection = (raw: YouTubeConnection, owner: InnertubeChatClientOwner<YouTubeClient>, videoId: string, context: YouTubeConnectionAttemptContext, actions: YouTubeInfo['actions']) => {
        let closed = false;
        let retirement: Promise<void> | undefined;
        const listeners: Array<{ event: string; handler: (payload?: unknown) => void }> = [];
        const assertOpen = () => {
            context.signal.throwIfAborted();
            if (closed) throw new Error('YouTube chat connection retired');
        };
        if (isActionsLike(actions)) {
            const execute = actions.execute.bind(actions);
            // LiveChat starts private fire-and-forget polling loops. Own their
            // actual execute/body/parser completion, not merely start()'s return.
            // Install only after setup, so setup requests retain their short scope.
            actions.execute = (endpoint, args) => owner.run(async () => {
                assertOpen();
                return await execute(endpoint, args);
            });
        }
        const detach = (event: string, handler: (payload?: unknown) => void) => {
            try {
                if (typeof raw.off === 'function') raw.off(event, handler);
                else raw.removeListener?.(event, handler);
            } catch (error) { reportCleanup(error, videoId); }
        };
        const managed = {
            on(event: string, handler: (payload?: unknown) => void | Promise<void>) {
                assertOpen();
                const ownedHandler = (payload?: unknown) => {
                    if (closed || context.signal.aborted) return;
                    try {
                        void owner.run(async () => {
                            if (closed || context.signal.aborted) return;
                            await handler(payload);
                        }).catch(error => { if (!closed && !context.signal.aborted) reportCleanup(error, videoId); });
                    } catch (error) { if (!closed && !context.signal.aborted) reportCleanup(error, videoId); }
                };
                listeners.push({ event, handler: ownedHandler });
                try { raw.on(event, ownedHandler); }
                finally { if (closed) detach(event, ownedHandler); }
                assertOpen();
            },
            start() {
                assertOpen();
                return owner.run(async () => { assertOpen(); await raw.start(); });
            },
            ...(typeof raw.applyFilter !== 'function' ? {} : { applyFilter(filter: string) {
                assertOpen();
                return owner.run(async () => { assertOpen(); await raw.applyFilter!(filter); });
            } }),
            ...(typeof raw.sendMessage !== 'function' ? {} : { sendMessage(message: unknown) {
                assertOpen();
                return owner.run(async () => { assertOpen(); return await raw.sendMessage!(message); });
            } }),
            stop() {
                if (retirement) return retirement;
                closed = true;
                let complete!: () => void, fail!: (error: unknown) => void;
                retirement = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
                for (const { event, handler } of listeners) detach(event, handler);
                listeners.length = 0;
                let stopped: Promise<void>;
                try { stopped = Promise.resolve(raw.stop?.()); }
                catch (error) { stopped = Promise.reject(error); }
                // Native SDK stop closes scheduling synchronously. Independently
                // join actual owned fetch/body/callback cleanup even if stop fails.
                const disposed = owner.dispose();
                void withOperationDeadline(() => Promise.allSettled([stopped, disposed]), {
                    budgetMs: RETIREMENT_TIMEOUT_MS, operationName: 'YouTube chat retirement'
                }).then(outcomes => {
                    const failure = outcomes.find(outcome => outcome.status === 'rejected');
                    if (failure?.status === 'rejected') fail(failure.reason);
                    else complete();
                }, fail);
                return retirement;
            }
        };
        return managed;
    };

    const createConnection = async (videoId: string, context: YouTubeConnectionAttemptContext) => {
        if (!isChatClientProvider(innertubeService)) throw new Error('YouTube chat requires innertubeService.beginChatClient');
        let creation: InnertubeChatClientCreation<YouTubeClient> | undefined;
        let managed: ReturnType<typeof manageConnection> | undefined;
        try {
            return await withOperationDeadline(async ({ signal, remainingBudgetMs }) => {
                creation = innertubeService.beginChatClient({ signal, timeoutMs: Math.ceil(remainingBudgetMs()) });
                const owner = await creation.ready;
                signal.throwIfAborted();
                const acquiredOwner = owner;
                return await acquiredOwner.run(async client => {
                    if (!isYouTubeClient(client)) throw new Error('YouTube chat owner returned invalid client');
                    const info = await client.getInfo(videoId, { client: 'WEB' });
                    signal.throwIfAborted();
                    if (!isYouTubeInfo(info)) throw new Error(`YouTube getInfo returned invalid stream info for ${videoId}`);
                    const validation = platform._validateVideoForConnection(videoId, info);
                    if (!validation.shouldConnect) throw new Error(`Stream validation failed: ${validation.reason}`);
                    if (isActionsLike(info.actions)) await captureInstaller({ actions: info.actions, videoId,
                        initialContinuation: typeof info.livechat?.continuation === 'string' ? info.livechat.continuation : null });
                    signal.throwIfAborted();
                    const chat = await info.getLiveChat();
                    if (!isYouTubeConnection(chat)) throw new Error('YouTube getLiveChat returned invalid connection');
                    // The callback itself remains tracked by the owner. A late SDK
                    // result is stopped here even after bounded logical retirement.
                    if (signal.aborted) {
                        try { await chat.stop?.(); } catch (error) { reportCleanup(error, videoId); }
                        signal.throwIfAborted();
                    }
                    managed = manageConnection(chat, acquiredOwner, videoId, context, info.actions);
                    context.adopt(managed);
                    return managed;
                }, { signal, timeoutMs: Math.ceil(remainingBudgetMs()) });
            }, { budgetMs: timeoutMs, parentAbortSignal: context.signal, operationName: 'YouTube chat setup' });
        } catch (error) {
            try {
                // The handle exists before initialization starts, so cancellation
                // joins actual cleanup even when no client was ever published.
                if (managed) await managed.stop();
                else await creation?.dispose();
            } catch (cleanupError) { reportCleanup(cleanupError, videoId); }
            throw error;
        }
    };

    const cleanupUnownedConnection = async (connection: YouTubeConnection, videoId: string, attemptId: number) => {
        for (const method of ['stop', 'disconnect'] as const) {
            const cleanup = connection[method];
            if (typeof cleanup !== 'function') {
                continue;
            }
            try {
                await cleanup.call(connection);
            } catch (cleanupError) {
                const cleanupErrorMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
                try {
                    platform._handleProcessingError(
                        `Failed to ${method} unowned YouTube connection for ${videoId}: ${cleanupErrorMessage}`,
                        cleanupError,
                        'connection-cleanup',
                        { videoId, attemptId, method }
                    );
                } catch {
                    // Preserve the setup failure even if cleanup reporting fails.
                }
            }
        }
    };

    const registerConnectionEventListeners = async (connection: YouTubeConnection, videoId: string, attemptId: number) => {
        if (!connection || typeof connection.on !== 'function') {
            throw new Error('YouTube connection missing event emitter interface (on)');
        }

        let readyReported = false;
        connection.on('start', async (data: unknown) => {
            if (!platform.isCurrentYouTubeConnection(videoId, attemptId)) {
                return;
            }
            if (!readyReported) {
                readyReported = true;
                platform.logger.info(`Chat listener started for stream: ${videoId}`, 'youtube');
            }
            platform.setYouTubeConnectionReady(videoId, attemptId);
            await applyConfiguredChatMode(connection, videoId, attemptId, data);
            if (!platform.isCurrentYouTubeConnection(videoId, attemptId)) return;

        });

        connection.on('error', (error: unknown) => {
            if (!platform.isCurrentYouTubeConnection(videoId, attemptId)) {
                return;
            }
            const debugErrorMessage = error instanceof Error ? error.message : String(error);
            platform.logger.debug(
                `LiveChat 'error' event for: ${videoId} - ${debugErrorMessage}`,
                'youtube'
            );

            const errorMessage = error instanceof Error && typeof error.message === 'string'
                ? error.message
                : String(error);
            const isTemporaryError = errorMessage.includes('ECONNRESET') ||
                errorMessage.includes('ETIMEDOUT') ||
                errorMessage.includes('503') ||
                errorMessage.includes('502');

            if (isTemporaryError) {
                platform.logger.warn(`Temporary error for ${videoId}, not disconnecting`, 'youtube');
                return;
            }

            const isApiError = errorMessage.includes('400') || errorMessage.includes('403') || errorMessage.includes('429');
            if (isApiError) {
                platform.logger.warn(`YouTube API error for stream ${videoId}: ${errorMessage}`, 'youtube');
                requestDisconnect(videoId, `API error: ${errorMessage}`, { expectedAttemptId: attemptId });
                return;
            }

            platform._handleProcessingError(`Stream ${videoId} error: ${errorMessage}`, error, 'stream-error', { videoId });
            requestDisconnect(videoId, `Error: ${errorMessage}`, {
                requestImmediateRefresh: true,
                source: 'livechat-error',
                expectedAttemptId: attemptId
            });
        });

        connection.on('chat-update', async (chatItem: unknown) => {
            if (!platform.isCurrentYouTubeConnection(videoId, attemptId)) {
                return;
            }
            const logging = platform.config.dataLoggingEnabled && chatItem !== undefined
                ? platform.logRawPlatformData('chat', chatItem).catch((logError: unknown) => {
                    if (!platform.isCurrentYouTubeConnection(videoId, attemptId)) return;
                    const logErrorMessage = logError instanceof Error ? logError.message : String(logError);
                    platform._handleProcessingError(
                        `Error logging raw chat data: ${logErrorMessage}`,
                        logError,
                        'data-logging'
                    );
                }) : undefined;

            try {

            if (!chatItem || typeof chatItem !== 'object') {
                platform.logger.debug(`Received invalid chat-update for ${videoId}: null or non-object`, 'youtube');
                return;
            }

            const chatItemRecord = chatItem as UnknownRecord;

            if (chatItemRecord.author && chatItemRecord.text) {
                const authorRecord = chatItemRecord.author && typeof chatItemRecord.author === 'object'
                    ? chatItemRecord.author as UnknownRecord
                    : null;
                const rawAuthorName = authorRecord && typeof authorRecord.name === 'string'
                    ? authorRecord.name
                    : (typeof chatItemRecord.author === 'string' ? chatItemRecord.author : '');
                const authorName = normalizeYouTubeUsername(rawAuthorName);
                const authorId = authorRecord && typeof authorRecord.id === 'string'
                    ? authorRecord.id.trim()
                    : '';

                if (!authorName || !authorId) {
                    return;
                }

                const messageText = typeof chatItemRecord.text === 'string' ? chatItemRecord.text.trim() : '';
                if (!messageText) {
                    return;
                }

                const rawUsec = chatItemRecord.timestamp_usec;
                const rawTimestamp = rawUsec !== undefined && rawUsec !== null
                    ? rawUsec
                    : chatItemRecord.timestamp;
                const timestampField = rawUsec !== undefined && rawUsec !== null
                    ? { timestamp_usec: rawUsec }
                    : (rawTimestamp !== undefined && rawTimestamp !== null ? { timestamp: rawTimestamp } : {});
                const normalizedChatItem = {
                    item: {
                        type: 'LiveChatTextMessage',
                        ...(chatItemRecord.id ? { id: chatItemRecord.id } : {}),
                        ...timestampField,
                        author: {
                            id: authorId,
                            name: rawAuthorName.trim()
                        },
                        message: {
                            text: messageText
                        }
                    },
                    videoId
                };
                await platform.handleChatMessage(normalizedChatItem, () => platform.isCurrentYouTubeConnection(videoId, attemptId));
                return;
            }

            const messages = platform._extractMessagesFromChatItem(chatItemRecord);

            for (const message of messages) {
                if (!platform.isCurrentYouTubeConnection(videoId, attemptId)) return;
                if (platform._shouldSkipMessage(message)) {
                    continue;
                }

                const enhancedMessage: UnknownRecord = {
                    ...message,
                    videoId
                };

                const authorName = platform._resolveChatItemAuthorName(enhancedMessage);
                const enhancedItem = enhancedMessage.item && typeof enhancedMessage.item === 'object'
                    ? enhancedMessage.item as UnknownRecord
                    : null;
                const eventType = enhancedItem
                    ? enhancedItem.type || null
                    : (enhancedMessage.type || null);
                const shouldAllowMissingAuthor = eventType === 'LiveChatSponsorshipsGiftPurchaseAnnouncement';
                if (!authorName && !shouldAllowMissingAuthor) {
                    continue;
                }

                await platform.handleChatMessage(enhancedMessage, () => platform.isCurrentYouTubeConnection(videoId, attemptId));
            }
            } finally { await logging; }
        });

        connection.on('end', () => {
            if (!platform.isCurrentYouTubeConnection(videoId, attemptId)) {
                return;
            }
            platform.logger.info(`Stream ended: ${videoId}`, 'youtube');
            requestDisconnect(videoId, 'stream ended', {
                requestImmediateRefresh: true,
                source: 'livechat-end',
                expectedAttemptId: attemptId
            });
        });
        await connection.start();
        if (!platform.isCurrentYouTubeConnection(videoId, attemptId)) throw new Error('YouTube connection retired during start');

        if (platform.viewerService && typeof platform.viewerService.setActiveStream === 'function') {
            try {
                await platform.viewerService.setActiveStream(videoId);
                if (!platform.isCurrentYouTubeConnection(videoId, attemptId)) return;
            } catch (serviceError: unknown) {
                if (!platform.isCurrentYouTubeConnection(videoId, attemptId)) return;
                const serviceErrorMessage = serviceError instanceof Error ? serviceError.message : String(serviceError);
                platform.logger.warn(`Failed to set active stream in viewer service: ${serviceErrorMessage}`, 'youtube');
            }
        }
    };

    const setupConnectionEventListeners = async (connection: YouTubeConnection, videoId: string, attemptId: number) => {
        try {
            await registerConnectionEventListeners(connection, videoId, attemptId);
        } catch (setupError) {
            await cleanupUnownedConnection(connection, videoId, attemptId);
            throw setupError;
        }
    };

    return {
        createConnection,
        setupConnectionEventListeners
    };
}

export { createYouTubeConnectionFactory };
