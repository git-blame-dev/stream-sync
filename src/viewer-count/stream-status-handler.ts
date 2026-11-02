import type { AppLogger } from '../core/logger/types';

type StreamStatusEvent = {
    type?: unknown;
    platform?: unknown;
    data?: {
        isLive?: unknown;
    } | unknown;
};

type WireStreamStatusHandlersOptions = {
    eventBus?: {
        subscribe?: (eventName: string, handler: (event?: unknown) => Promise<void>) => unknown;
    } | null;
    viewerCountSystem?: {
        updateStreamStatus?: (platform: string, isLive: boolean, options?: { countUnavailable?: boolean }) => Promise<unknown>;
    } | null;
    logger?: Partial<Pick<AppLogger<string>, 'warn'>> | null;
    isViewerCountEnabled?: ((platform: string) => boolean) | null;
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function wireStreamStatusHandlers({ eventBus, viewerCountSystem, logger, isViewerCountEnabled }: WireStreamStatusHandlersOptions) {
    if (!eventBus || typeof eventBus.subscribe !== 'function' || !viewerCountSystem) {
        return () => {};
    }

    const subscriptions: Array<() => unknown> = [];

    const isEnabled = (platform: string) => {
        if (typeof isViewerCountEnabled === 'function') {
            try {
                return isViewerCountEnabled(platform) !== false;
            } catch (error) {
                logger?.warn?.(`[ViewerCount] isViewerCountEnabled threw: ${getErrorMessage(error)}`, 'stream-status-handler');
            }
        }
        return true;
    };

    const safeUpdate = async (platform: string, isLive: boolean, countUnavailable: boolean) => {
        if (!platform || typeof viewerCountSystem.updateStreamStatus !== 'function') {
            return;
        }

        if (!isEnabled(platform)) {
            return;
        }

        try {
            if (countUnavailable) await viewerCountSystem.updateStreamStatus(platform, isLive, { countUnavailable: true });
            else await viewerCountSystem.updateStreamStatus(platform, isLive);
        } catch (error) {
            logger?.warn?.(`[ViewerCount] Failed to update ${platform} stream status: ${getErrorMessage(error)}`, 'stream-status-handler');
        }
    };

    const unsubscribe = eventBus.subscribe('platform:event', async (event: unknown = {}) => {
            const streamEvent = event as StreamStatusEvent;
            if (!streamEvent || typeof streamEvent !== 'object') {
                return;
            }
            if (streamEvent.type !== 'platform:stream-status') {
                return;
            }
            if (!streamEvent.data || typeof streamEvent.data !== 'object') {
                return;
            }
            const data = streamEvent.data as { isLive?: unknown; status?: unknown };
            if (typeof data.isLive !== 'boolean') {
                return;
            }
            if (typeof streamEvent.platform !== 'string' || streamEvent.platform.length === 0) {
                return;
            }
            await safeUpdate(streamEvent.platform, data.isLive, data.status === 'unavailable');
        });

    if (typeof unsubscribe === 'function') {
        subscriptions.push(unsubscribe as () => unknown);
    }

    return () => {
        subscriptions.forEach((unsubscribe: () => unknown) => {
            if (typeof unsubscribe === 'function') {
                try {
                    unsubscribe();
                } catch (error) {
                    logger?.warn?.(`[ViewerCount] Error unsubscribing stream status handler: ${getErrorMessage(error)}`, 'stream-status-handler');
                }
            }
        });
    };
}

export { wireStreamStatusHandlers };
