const { createPlatformErrorHandler } = require('../../../utils/platform-error-handler');

function createTwitchEventSubWiring(options = {}) {
    const {
        eventSub,
        eventSubListeners,
        logger
    } = options;

    const errorHandler = createPlatformErrorHandler(logger, 'twitch-eventsub-wiring');

    const bind = (eventName, handler) => {
        if (!eventSub || typeof eventSub.on !== 'function') {
            return;
        }

        const alreadyBound = (eventSubListeners || []).some(
            (entry) => entry.eventName === eventName && entry.handler === handler
        );
        if (alreadyBound) {
            return;
        }

        eventSub.on(eventName, handler);
        eventSubListeners.push({ eventName, handler });
    };

    const bindAll = (handlersByEventName = {}) => {
        Object.entries(handlersByEventName).forEach(([eventName, handler]) => {
            if (typeof handler !== 'function') {
                return;
            }
            bind(eventName, handler);
        });
    };

    const unbindAll = () => {
        if (!eventSubListeners?.length || !eventSub) {
            if (eventSubListeners) {
                eventSubListeners.length = 0;
            }
            return;
        }

        eventSubListeners.forEach(({ eventName, handler }) => {
            try {
                if (typeof eventSub.off === 'function') {
                    eventSub.off(eventName, handler);
                } else if (typeof eventSub.removeListener === 'function') {
                    eventSub.removeListener(eventName, handler);
                }
            } catch (error) {
                errorHandler.handleCleanupError(error, 'twitch eventsub listener cleanup');
            }
        });

        eventSubListeners.length = 0;
    };

    return {
        bind,
        bindAll,
        unbindAll
    };
}

module.exports = {
    createTwitchEventSubWiring
};

