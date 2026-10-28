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

    const remove = (listener: EventSubListener): void => {
        try {
            if (typeof eventSub?.off === 'function') eventSub.off(listener.eventName, listener.handler);
            else if (typeof eventSub?.removeListener === 'function') eventSub.removeListener(listener.eventName, listener.handler);
            else return;
            const index = listenerStore.indexOf(listener);
            if (index !== -1) listenerStore.splice(index, 1);
        } catch (error) {
            try { errorHandler.handleCleanupError(error, 'twitch eventsub listener cleanup'); }
            catch { /* Keep the entry retryable even if cleanup reporting fails. */ }
        }
    };

    const bindAll = (handlersByEventName: Record<string, unknown> = {}): void => {
        const previous = new Set(listenerStore);
        try {
            for (const [eventName, handler] of Object.entries(handlersByEventName)) {
                if (typeof handler === 'function') bind(eventName, handler as (...args: unknown[]) => void);
            }
        } catch (error) {
            for (const listener of [...listenerStore]) {
                if (!previous.has(listener)) remove(listener);
            }
            throw error;
        }
    };

    const unbindAll = (): void => {
        for (const listener of [...listenerStore]) remove(listener);
    };

    return {
        bind,
        bindAll,
        unbindAll
    };
}

export { createTwitchEventSubWiring };
