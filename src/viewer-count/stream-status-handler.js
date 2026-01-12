function wireStreamStatusHandlers({ eventBus, viewerCountSystem, logger, isViewerCountEnabled }) {
    if (!eventBus || typeof eventBus.subscribe !== 'function' || !viewerCountSystem) {
        return () => {};
    }

    const subscriptions = [];

    const isEnabled = (platform) => {
        if (typeof isViewerCountEnabled === 'function') {
            try {
                return isViewerCountEnabled(platform) !== false;
            } catch (error) {
                logger?.warn?.(`[ViewerCount] isViewerCountEnabled threw: ${error.message}`);
            }
        }
        return true;
    };

    const safeUpdate = async (platform, isLive) => {
        if (!platform || typeof viewerCountSystem.updateStreamStatus !== 'function') {
            return;
        }

        if (!isEnabled(platform)) {
            return;
        }

        try {
            await viewerCountSystem.updateStreamStatus(platform, isLive);
        } catch (error) {
            logger?.warn?.(`[ViewerCount] Failed to update ${platform} stream status: ${error.message}`);
        }
    };

    subscriptions.push(
        eventBus.subscribe('platform:event', async (event = {}) => {
            if (!event || typeof event !== 'object') {
                return;
            }
            if (event.type !== 'platform:stream-status') {
                return;
            }
            if (!event.data || typeof event.data !== 'object') {
                return;
            }
            if (typeof event.data.isLive !== 'boolean') {
                return;
            }
            if (!event.platform) {
                return;
            }
            await safeUpdate(event.platform, event.data.isLive);
        })
    );

    return () => {
        subscriptions.forEach((unsubscribe) => {
            if (typeof unsubscribe === 'function') {
                try {
                    unsubscribe();
                } catch (error) {
                    logger?.warn?.(`[ViewerCount] Error unsubscribing stream status handler: ${error.message}`);
                }
            }
        });
    };
}

module.exports = wireStreamStatusHandlers;
