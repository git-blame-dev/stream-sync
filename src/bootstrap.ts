import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDebugModeEnabled } from './utils/logger-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const bootstrapProcess = process as typeof process & {
    __streamSyncUncaughtExceptionHandlerInstalled?: boolean;
    __streamSyncUnhandledRejectionHandlerInstalled?: boolean;
};

// BOOTSTRAP LOGGING: Use console.log here because unified logging system is not yet initialized
// Top-level debug print to confirm script startup (only in debug mode)
if (isDebugModeEnabled()) {
    console.log('[DEBUG] [Bootstrap] Script starting...'); // BOOTSTRAP: Pre-logger initialization
}

// BOOTSTRAP ERROR HANDLING: Use console.error for fatal errors before logger is available
if (!bootstrapProcess.__streamSyncUncaughtExceptionHandlerInstalled) {
    bootstrapProcess.__streamSyncUncaughtExceptionHandlerInstalled = true;
    bootstrapProcess.on('uncaughtException', (err) => {
        console.error('[FATAL] Uncaught Exception:', err); // BOOTSTRAP: Critical error before logger ready
        try {
            const logsDir = join(__dirname, '..', 'logs');
            if (!existsSync(logsDir)) {
                mkdirSync(logsDir, { recursive: true });
            }
            appendFileSync(join(logsDir, 'program-log.txt'), `[FATAL] Uncaught Exception: ${err.stack || err}\n`);
        } catch (e) {
            console.error('[FATAL] Failed to write to log file:', e);
        }
        process.exit(1);
    });
}

if (!bootstrapProcess.__streamSyncUnhandledRejectionHandlerInstalled) {
    bootstrapProcess.__streamSyncUnhandledRejectionHandlerInstalled = true;
    bootstrapProcess.on('unhandledRejection', (reason) => {
        console.error('[BOOTSTRAP] Unhandled Rejection:', reason); // BOOTSTRAP: Critical error before logger ready
        try {
            const logsDir = join(__dirname, '..', 'logs');
            if (!existsSync(logsDir)) {
                mkdirSync(logsDir, { recursive: true });
            }
            const rejectionDetails = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
            appendFileSync(join(logsDir, 'program-log.txt'), `[BOOTSTRAP] Unhandled Rejection: ${rejectionDetails}\n`);
        } catch (e) {
            console.error('[BOOTSTRAP] Failed to write to log file:', e); // BOOTSTRAP: Emergency fallback logging
        }
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
        console.log('[DEBUG] [Bootstrap] About to call main()...');
        await main();
        console.log('[DEBUG] [Bootstrap] main() completed successfully');
    } catch (error) {
        // Use console.error for fatal bootstrap errors since logging might not be available
        console.error('[FATAL] [Bootstrap] Main function failed:', error); // BOOTSTRAP: Critical error handling
        process.exit(1);
    }
})(); 
