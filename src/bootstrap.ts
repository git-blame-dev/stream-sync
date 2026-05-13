import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBootstrapEmergencyLogger } from './core/bootstrap-emergency-logger';
import { isDebugModeEnabled } from './utils/logger-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const bootstrapEmergencyLogger = createBootstrapEmergencyLogger({ logsDir: join(__dirname, '..', 'logs') });
const bootstrapProcess = process as typeof process & {
    __streamSyncUncaughtExceptionHandlerInstalled?: boolean;
    __streamSyncUnhandledRejectionHandlerInstalled?: boolean;
};

// BOOTSTRAP LOGGING: Use console.log here because unified logging system is not yet initialized
// Top-level debug print to confirm script startup (only in debug mode)
if (isDebugModeEnabled()) {
    console.log('[DEBUG] [Bootstrap] Script starting...'); // BOOTSTRAP: Pre-logger initialization
}

// BOOTSTRAP ERROR HANDLING: Use emergency output for fatal errors before logger is available
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

// Now load the main application and start it
// Start the main application and keep it running
(async () => {
    try {
        if (isDebugModeEnabled()) {
            console.log('[DEBUG] [Bootstrap] Importing main application...'); // BOOTSTRAP: Logger not fully initialized
        }
        const { main } = await import('./main');
        if (isDebugModeEnabled()) {
            console.log('[DEBUG] [Bootstrap] Main application imported, starting...'); // BOOTSTRAP: Logger not fully initialized
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
