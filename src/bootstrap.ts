import { resolve } from 'node:path';
import { createBootstrapEmergencyLogger } from './core/bootstrap-emergency-logger';
import { main } from './main';
import { isBootstrapDebugModeEnabled } from './utils/bootstrap-debug-mode';

const bootstrapEmergencyLogger = createBootstrapEmergencyLogger({ logsDir: resolve(process.cwd(), 'logs') });
const bootstrapProcess = process as typeof process & {
    __streamSyncUncaughtExceptionHandlerInstalled?: boolean;
    __streamSyncUnhandledRejectionHandlerInstalled?: boolean;
};

// The unified logger is not initialized before main() starts.
if (isBootstrapDebugModeEnabled()) {
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
        if (isBootstrapDebugModeEnabled()) {
            console.log('[DEBUG] [Bootstrap] Importing main application...');
        }
        if (isBootstrapDebugModeEnabled()) {
            console.log('[DEBUG] [Bootstrap] Main application imported, starting...');
        }
        if (isBootstrapDebugModeEnabled()) {
            console.log('[DEBUG] [Bootstrap] About to call main()...');
        }
        await main();
        if (isBootstrapDebugModeEnabled()) {
            console.log('[DEBUG] [Bootstrap] main() completed successfully');
        }
    } catch (error) {
        bootstrapEmergencyLogger.writeMainFailure(error);
        process.exit(1);
    }
})(); 
