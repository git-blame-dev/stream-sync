const { logger } = require('../core/logging');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

const errorHandler = createPlatformErrorHandler(logger, 'user-tracking');

function handleServiceError(message, error, context = {}) {
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
    constructor() {
        this.seenUsers = new Set();
        logger.debug('[UserTrackingService] Initialized', 'user-tracking', {
            trackedUsers: 0
        });
    }

    isFirstMessage(userId, context = {}) {
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

module.exports = {
    UserTrackingService,
    createUserTrackingService
};
