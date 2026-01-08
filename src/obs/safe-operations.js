
const { logger } = require('../core/logging');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

let obsSafetyErrorHandler = null;

function handleObsSafetyError(message, error, context) {
    if (!obsSafetyErrorHandler && logger) {
        obsSafetyErrorHandler = createPlatformErrorHandler(logger, 'obs-safety');
    }

    if (obsSafetyErrorHandler && error instanceof Error) {
        obsSafetyErrorHandler.handleEventProcessingError(error, 'obs-operation', context ? { context } : null, message, 'obs-safety');
        return;
    }

    if (obsSafetyErrorHandler) {
        obsSafetyErrorHandler.logOperationalError(message, 'obs-safety', context ? { context } : null);
    }
}

async function safeOBSOperation(obsManager, operation, context = 'Unknown Operation') {
    // Check if OBS is ready for operations
    if (!await obsManager.isReady()) {
        logger.debug(`[OBS Safety] Skipping ${context} - OBS not ready`, 'obs-safety');
        return null;
    }
    
    try {
        return await operation();
    } catch (error) {
        handleObsSafetyError(`[OBS Safety] ${context} failed: ${error.message}`, error, context);
        throw error;
    }
}

module.exports = {
    safeOBSOperation
}; 
