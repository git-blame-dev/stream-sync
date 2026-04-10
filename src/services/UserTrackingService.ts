import { logger } from '../core/logging';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';

const errorHandler = createPlatformErrorHandler(logger, 'user-tracking');

type TrackingContext = {
    platform?: string;
    [key: string]: unknown;
};

function handleServiceError(message: string, error: unknown, context: TrackingContext = {}) {
    if (errorHandler && error instanceof Error) {
        errorHandler.handleEventProcessingError(error, 'user-tracking', context, message);
        return;
    }

    errorHandler.logOperationalError(message, 'user-tracking', {
        ...context,
        error
    });
}

class UserTrackingService {
    seenUsers;

    constructor() {
        this.seenUsers = new Set();
        logger.debug('[UserTrackingService] Initialized', 'user-tracking', {
            trackedUsers: 0
        });
    }

    isFirstMessage(userId: string | null | undefined, context: TrackingContext = {}) {
        if (!userId) {
            logger.warn('[UserTrackingService] No userId provided for first message check', 'user-tracking');
            return false;
        }

        try {
            if (this.seenUsers.has(userId)) {
                return false;
            }

            this.seenUsers.add(userId);
            logger.debug('[UserTrackingService] First message detected', 'user-tracking', {
                userId,
                platform: context.platform
            });
            return true;
        } catch (error) {
            handleServiceError('[UserTrackingService] Error checking first message', error, {
                userId,
                context
            });
            return false;
        }
    }
}

function createUserTrackingService() {
    return new UserTrackingService();
}

export { UserTrackingService, createUserTrackingService };
