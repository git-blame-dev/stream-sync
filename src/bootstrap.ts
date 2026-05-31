import { resolve } from 'node:path';
import { createBootstrapEmergencyLogger } from './core/bootstrap-emergency-logger';
import { main } from './main';
import { isDebugModeEnabled } from './utils/logger-utils';

const bootstrapEmergencyLogger = createBootstrapEmergencyLogger({ logsDir: resolve(process.cwd(), 'logs') });
const bootstrapProcess = process as typeof process & {
    __streamSyncUncaughtExceptionHandlerInstalled?: boolean;
    __streamSyncUnhandledRejectionHandlerInstalled?: boolean;
};

// The unified logger is not initialized before main() starts.
if (isDebugModeEnabled()) {
    console.log('[DEBUG] [Bootstrap] Script starting...');
}

if (!bootstrapProcess.__streamSyncUncaughtExceptionHandlerInstalled) {
    bootstrapProcess.__streamSyncUncaughtExceptionHandlerInstalled = true;
    bootstrapProcess.on('uncaughtException', (err) => {
        bootstrapEmergencyLogger.writeUncaughtException(err);
        process.exit(1);
    });
}

if (!bootstrapProcess.__streamSyncUnhandledRejectionHandlerInstalled) {
    bootstrapProcess.__streamSyncUnhandledRejectionHandlerInstalled = true;
    bootstrapProcess.on('unhandledRejection', (reason) => {
        bootstrapEmergencyLogger.writeUnhandledRejection(reason);
    });
}

(async () => {
    try {
        if (isDebugModeEnabled()) {
            console.log('[DEBUG] [Bootstrap] Importing main application...');
        }
        if (isDebugModeEnabled()) {
            console.log('[DEBUG] [Bootstrap] Main application imported, starting...');
        }
        if (isDebugModeEnabled()) {
            console.log('[DEBUG] [Bootstrap] About to call main()...');
        }
        await main();
        if (isDebugModeEnabled()) {
            console.log('[DEBUG] [Bootstrap] main() completed successfully');
        }
    } catch (error) {
        bootstrapEmergencyLogger.writeMainFailure(error);
        process.exit(1);
    }
})(); 
