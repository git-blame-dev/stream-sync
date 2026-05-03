import { createPlatformErrorHandler } from '../../../utils/platform-error-handler';

type EventSubListener = {
  eventName: string;
  handler: (...args: unknown[]) => void;
};

type EventEmitterLike = {
  on?: (eventName: string, handler: (...args: unknown[]) => void) => void;
  off?: (eventName: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (eventName: string, handler: (...args: unknown[]) => void) => void;
};

type WiringOptions = {
  eventSub?: EventEmitterLike;
  eventSubListeners?: EventSubListener[];
  logger?: unknown;
};

function createTwitchEventSubWiring(options: WiringOptions = {}) {
    const {
        eventSub,
        eventSubListeners,
        logger
    } = options;
    const listenerStore = Array.isArray(eventSubListeners) ? eventSubListeners : [];

    const errorHandler = createPlatformErrorHandler(logger, 'twitch-eventsub-wiring');

  const bind = (eventName: string, handler: (...args: unknown[]) => void): void => {
        if (!eventSub || typeof eventSub.on !== 'function') {
            return;
        }

        const alreadyBound = listenerStore.some(
            (entry) => entry.eventName === eventName && entry.handler === handler
        );
        if (alreadyBound) {
            return;
        }

        eventSub.on(eventName, handler);
        listenerStore.push({ eventName, handler });
    };

  const bindAll = (handlersByEventName: Record<string, unknown> = {}): void => {
        Object.entries(handlersByEventName).forEach(([eventName, handler]) => {
      if (typeof handler !== 'function') {
        return;
      }
      bind(eventName, handler as (...args: unknown[]) => void);
    });
  };

  const unbindAll = (): void => {
        if (!listenerStore.length || !eventSub) {
            listenerStore.length = 0;
            return;
        }

        listenerStore.forEach(({ eventName, handler }) => {
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

        listenerStore.length = 0;
    };

    return {
        bind,
        bindAll,
        unbindAll
    };
}

export { createTwitchEventSubWiring };
