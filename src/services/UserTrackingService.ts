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

    hasSeenUser(userId: string | null | undefined, context: TrackingContext = {}) {
        if (!userId) {
            logger.warn('[UserTrackingService] No userId provided for seen-user check', 'user-tracking');
            return true;
        }

        try {
            return this.seenUsers.has(userId);
        } catch (error) {
            handleServiceError('[UserTrackingService] Error checking seen-user state', error, {
                userId,
                context
            });
            return true;
        }
    }

    markMessageSeen(userId: string | null | undefined, context: TrackingContext = {}) {
        if (!userId) {
            logger.warn('[UserTrackingService] No userId provided for message tracking', 'user-tracking');
            return false;
        }

        try {
            this.seenUsers.add(userId);
            logger.debug('[UserTrackingService] Message marked as seen', 'user-tracking', {
                userId,
                platform: context.platform
            });
            return true;
        } catch (error) {
            handleServiceError('[UserTrackingService] Error marking message as seen', error, {
                userId,
                context
            });
            return false;
        }
    }

    isFirstMessage(userId: string | null | undefined, context: TrackingContext = {}) {
        if (this.hasSeenUser(userId, context)) {
            return false;
        }

        return this.markMessageSeen(userId, context);
    }
}

function createUserTrackingService() {
    return new UserTrackingService();
}

export { UserTrackingService, createUserTrackingService };
