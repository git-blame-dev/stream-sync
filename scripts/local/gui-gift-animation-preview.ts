import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildPreviewConfig, buildPreviewScenarioEvents } from './gui-preview';
import { safeSetTimeout, safeDelay } from '../../src/utils/timeout-validator';
import type { createTikTokGiftAnimationResolver as createGiftResolver } from '../../src/services/tiktok-gift-animation/resolver';

const load = createRequire(__filename);

const DEFAULT_DURATION_MS = 12000;

type GiftAnimationPreviewTimerHandle = unknown;

interface GiftAnimationPreviewOptions {
    baseConfig?: Record<string, unknown>;
    durationMs?: number;
    logger?: {
        debug?: (...args: unknown[]) => void;
        info?: (...args: unknown[]) => void;
        warn?: (...args: unknown[]) => void;
        error?: (...args: unknown[]) => void;
    };
    createPreviewPipelineImpl?: (args: Record<string, unknown>) => {
        eventBus: { emit: (eventName: string, payload: unknown) => void };
        emitIngestEvent: (event: unknown) => void;
        dispose?: () => Promise<void> | void;
    };
    createGuiTransportServiceImpl?: (args: Record<string, unknown>) => {
        start: () => Promise<void>;
        stop?: () => Promise<void>;
    };
    safeSetTimeoutImpl?: (callback: () => void, duration: number) => GiftAnimationPreviewTimerHandle;
    clearTimeoutImpl?: (handle: GiftAnimationPreviewTimerHandle) => void;
    stdout?: { write: (text: string) => void };
    delay?: (ms: number) => Promise<void>;
    eventBus?: unknown;
    giftAnimationResolver?: {
        resolveFromNotificationData: (data: unknown) => Promise<unknown>;
        dispose?: () => Promise<void> | void;
    };
    createGiftAnimationResolverImpl?: typeof createGiftResolver;
    giftEvent?: { adapter: string; rawEvent: unknown };
}

type PreviewScenarioEvent = {
    adapter: string;
    rawEvent: {
        eventType?: string;
    } | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object') {
        return null;
    }

    return value as Record<string, unknown>;
};

function resolveLogger(logger: GiftAnimationPreviewOptions['logger']) {
    if (logger && typeof logger.error === 'function') {
        return logger;
    }

    const { logger: defaultLogger } = load('../../src/core/logging');
    if (defaultLogger && typeof defaultLogger.error === 'function') {
        return defaultLogger;
    }

    return {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
    };
}

function buildGiftAnimationPreviewEvent(): { adapter: string; rawEvent: unknown } {
    const event = (buildPreviewScenarioEvents() as PreviewScenarioEvent[])
        .find((entry) => entry.adapter === 'tiktok' && entry.rawEvent?.eventType === 'GIFT');
    if (!event) {
        throw new Error('Gift preview scenario is missing TikTok gift event');
    }
    return event;
}

function buildGiftPreviewNotificationData(giftEvent: { rawEvent: unknown }): Record<string, unknown> {
    const rawEvent = asRecord(giftEvent?.rawEvent) || {};
    const rawData = asRecord(rawEvent.data);
    const sourceUser = asRecord(rawData?.user) || {};
    const giftDetails = asRecord(rawData?.giftDetails);
    const gift = asRecord(rawData?.gift);
    const giftName = rawData
        ? (rawData.giftName || giftDetails?.giftName || 'Corgi')
        : 'Corgi';
    const repeatCount = rawData ? Number(rawData.repeatCount) || 1 : 1;
    const unitAmount = rawData ? Number(rawData.diamondCount) || 0 : 0;
    const giftImageUrl = typeof gift?.giftPictureUrl === 'string'
        ? gift.giftPictureUrl
        : '';

    return {
        username: sourceUser.nickname || sourceUser.uniqueId,
        userId: sourceUser.uniqueId || sourceUser.userId,
        giftType: giftName,
        giftCount: repeatCount,
        amount: unitAmount,
        currency: 'coins',
        ...(giftImageUrl ? { giftImageUrl } : {}),
        enhancedGiftData: {
            username: sourceUser.nickname || sourceUser.uniqueId,
            userId: sourceUser.uniqueId || sourceUser.userId,
            giftType: giftName,
            giftCount: repeatCount,
            amount: unitAmount,
            currency: 'coins',
            isAggregated: false,
            isStreakCompleted: true,
            originalData: {
                asset: rawData ? rawData.asset : undefined,
                giftDetails: giftDetails || undefined,
                gift: gift || undefined
            }
        }
    };
}

async function runGuiGiftAnimationPreview(options: GiftAnimationPreviewOptions = {}): Promise<void> {
    const { createPreviewPipeline } = load('./gui-preview');
    const { createGuiTransportService } = load('../../src/services/gui/gui-transport-service');
    const { createPlatformErrorHandler } = load('../../src/utils/platform-error-handler');
    const { createTikTokGiftAnimationResolver } = load('../../src/services/tiktok-gift-animation/resolver');
    const baseConfig = (options.baseConfig && typeof options.baseConfig === 'object')
        ? options.baseConfig
        : {};
    const baseGui = (baseConfig.gui && typeof baseConfig.gui === 'object')
        ? baseConfig.gui
        : {};

    const config = buildPreviewConfig({
        ...baseConfig,
        gui: {
            ...baseGui,
            showMessages: false,
            showCommands: false,
            showGreetings: false,
            showFarewells: false,
            showEnvelopes: false
        }
    });
    const durationMs: number = Number.isInteger(options.durationMs) && (options.durationMs as number) > 0
        ? (options.durationMs as number)
        : DEFAULT_DURATION_MS;
    const logger = resolveLogger(options.logger);
    const errorHandler = createPlatformErrorHandler(logger, 'gui-gift-animation-preview');
    const createPreviewPipelineImpl = options.createPreviewPipelineImpl || createPreviewPipeline;
    const createGuiTransportServiceImpl = options.createGuiTransportServiceImpl || createGuiTransportService;
    const safeSetTimeoutImpl = options.safeSetTimeoutImpl || ((callback, duration) => safeSetTimeout(callback, duration));
    const clearTimeoutImpl = options.clearTimeoutImpl || ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const stdout = options.stdout || process.stdout;
    const delay = options.delay || ((ms) => {
        const parsed = Number(ms);
        return safeDelay(parsed, Number.isFinite(parsed) ? parsed : 5000, 'gui-gift-animation-preview delay');
    });

    let pipeline: ReturnType<NonNullable<GiftAnimationPreviewOptions['createPreviewPipelineImpl']>> | null = null;
    let service: ReturnType<NonNullable<GiftAnimationPreviewOptions['createGuiTransportServiceImpl']>> | null = null;
    const scheduledEmitTimers: GiftAnimationPreviewTimerHandle[] = [];
    let closed = false;
    let ownedResolver: ReturnType<typeof createGiftResolver> | null = null;
    const reportError = (error: unknown, context: string, message: string) => {
        try {
            errorHandler.handleEventProcessingError(error, context, null, message);
        } catch {
            // A reporting failure must not replace the run failure or interrupt resource retirement.
        }
    };

    try {
        const giftAnimationResolver = options.giftAnimationResolver || (ownedResolver =
            (options.createGiftAnimationResolverImpl || createTikTokGiftAnimationResolver)({ logger }));

        pipeline = createPreviewPipelineImpl({
            config,
            logger,
            eventBus: options.eventBus,
            giftAnimationResolver,
            delay
        });

        if (!pipeline || typeof pipeline.emitIngestEvent !== 'function' || !pipeline.eventBus) {
            throw new Error('Gift animation preview pipeline requires eventBus and emitIngestEvent');
        }

        const createdService = createGuiTransportServiceImpl({
            config,
            eventBus: pipeline.eventBus,
            logger
        });
        service = createdService;
        await createdService.start();

        stdout.write(`GUI gift animation preview running for ${Math.floor(durationMs / 1000)}s\n`);
        const guiConfig = asRecord(config.gui) || {};
        stdout.write(`Dock URL: http://${guiConfig.host}:${guiConfig.port}/dock\n`);
        stdout.write(`TikTok Animation URL: http://${guiConfig.host}:${guiConfig.port}/tiktok-animations\n`);

        const giftEvent = options.giftEvent || buildGiftAnimationPreviewEvent();
        const notificationData = buildGiftPreviewNotificationData(giftEvent);
        const resolved = await giftAnimationResolver.resolveFromNotificationData(notificationData);
        if (!resolved) {
            throw new Error('Gift animation preview failed to resolve animation payload');
        }

        const previewPipeline = pipeline;

        const emitGiftAnimation = () => {
            if (closed) return;
            previewPipeline.eventBus.emit('display:gift-animation', {
                playbackId: randomUUID(),
                type: 'platform:gift',
                platform: 'tiktok',
                durationMs: resolved.durationMs,
                mediaFilePath: resolved.mediaFilePath,
                mediaContentType: resolved.mediaContentType,
                animationConfig: resolved.animationConfig
            });
        };

        await new Promise<void>((resolve, reject) => {
            let armed = false;
            const pending: Array<() => void> = [];
            const fail = (error: unknown) => {
                closed = true;
                reject(error);
            };
            const schedule = (callback: () => void, duration: number) => {
                const invoke = () => {
                    if (closed) return;
                    try {
                        callback();
                    } catch (error) {
                        fail(error);
                    }
                };
                scheduledEmitTimers.push(safeSetTimeoutImpl(() => {
                    if (armed) invoke();
                    else pending.push(invoke);
                }, duration));
            };
            schedule(emitGiftAnimation, 750);
            schedule(emitGiftAnimation, 2250);
            schedule(() => {
                closed = true;
                resolve();
            }, durationMs);
            armed = true;
            try {
                emitGiftAnimation();
            } catch (error) {
                fail(error);
            }
            pending.forEach((callback) => callback());
        });

        stdout.write('GUI gift animation preview finished\n');
    } catch (error) {
        reportError(error, 'preview-run', 'GUI gift animation preview failed');
        throw error;
    } finally {
        closed = true;
        for (const timerHandle of scheduledEmitTimers) {
            try {
                clearTimeoutImpl(timerHandle);
            } catch (error) {
                reportError(error, 'preview-cleanup', 'Failed clearing GUI gift animation preview timer');
            }
        }

        if (service && typeof service.stop === 'function') {
            try {
                await service.stop();
            } catch (error) {
                reportError(error, 'preview-cleanup', 'Failed stopping GUI gift animation preview transport');
            }
        }

        if (pipeline && typeof pipeline.dispose === 'function') {
            try {
                await pipeline.dispose();
            } catch (error) {
                reportError(error, 'preview-cleanup', 'Failed disposing GUI gift animation preview pipeline');
            }
        }
        if (ownedResolver) {
            try {
                await ownedResolver.dispose();
            } catch (error) {
                reportError(error, 'preview-cleanup', 'Failed disposing GUI gift animation preview resolver');
            }
        }
    }
}

if (require.main === module) {
    runGuiGiftAnimationPreview().catch((error) => {
        process.stderr.write(`GUI gift animation preview failed: ${error && error.message ? error.message : error}\n`);
        process.exit(1);
    });
}

export {
    DEFAULT_DURATION_MS,
    buildGiftAnimationPreviewEvent,
    buildGiftPreviewNotificationData,
    runGuiGiftAnimationPreview
};
