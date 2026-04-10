import { logger } from '../core/logging';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';

let obsSafetyErrorHandler: ReturnType<typeof createPlatformErrorHandler> | null = null;

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function handleObsSafetyError(message: string, error: unknown, context: string) {
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

async function safeOBSOperation(obsManager: { isReady: () => Promise<boolean> }, operation: () => Promise<unknown>, context = 'Unknown Operation') {
    // Check if OBS is ready for operations
    if (!await obsManager.isReady()) {
        logger.debug(`[OBS Safety] Skipping ${context} - OBS not ready`, 'obs-safety');
        return null;
    }
    
    try {
        return await operation();
    } catch (error) {
        handleObsSafetyError(`[OBS Safety] ${context} failed: ${getErrorMessage(error)}`, error, context);
        throw error;
    }
}

export {
    safeOBSOperation
}; 
