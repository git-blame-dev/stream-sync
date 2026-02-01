
const { isDebugModeEnabled } = require('./utils/logger-utils');

// BOOTSTRAP LOGGING: Use console.log here because unified logging system is not yet initialized
// Top-level debug print to confirm script startup (only in debug mode)
if (isDebugModeEnabled()) {
    console.log('[DEBUG] [Bootstrap] Script starting...'); // BOOTSTRAP: Pre-logger initialization
}

// BOOTSTRAP ERROR HANDLING: Use console.error for fatal errors before logger is available
if (!process.__streamSyncUncaughtExceptionHandlerInstalled) {
    process.__streamSyncUncaughtExceptionHandlerInstalled = true;
    process.on('uncaughtException', (err) => {
        console.error('[FATAL] Uncaught Exception:', err); // BOOTSTRAP: Critical error before logger ready
        try {
            const fs = require('fs');
            const path = require('path');
            const logsDir = path.join(__dirname, '..', 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            fs.appendFileSync(path.join(logsDir, 'program-log.txt'), `[FATAL] Uncaught Exception: ${err.stack || err}\n`);
        } catch (e) {
            console.error('[FATAL] Failed to write to log file:', e);
        }
        process.exit(1);
    });
}

if (!process.__streamSyncUnhandledRejectionHandlerInstalled) {
    process.__streamSyncUnhandledRejectionHandlerInstalled = true;
    process.on('unhandledRejection', (reason) => {
        console.error('[BOOTSTRAP] Unhandled Rejection:', reason); // BOOTSTRAP: Critical error before logger ready
        try {
            const fs = require('fs');
            const path = require('path');
            const logsDir = path.join(__dirname, '..', 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            fs.appendFileSync(path.join(logsDir, 'program-log.txt'), `[BOOTSTRAP] Unhandled Rejection: ${reason && reason.stack ? reason.stack : reason}\n`);
        } catch (e) {
            console.error('[BOOTSTRAP] Failed to write to log file:', e); // BOOTSTRAP: Emergency fallback logging
        }
    });
}

// Bootstrap file to set logging config validator before any other code runs
if (isDebugModeEnabled()) {
    console.log('[DEBUG] [Bootstrap] Importing config validator...');
}
// Import config validator first
const { validateLoggingConfig } = require('./core/config');
if (isDebugModeEnabled()) {
    console.log('[DEBUG] [Bootstrap] Config validator imported');
}

if (isDebugModeEnabled()) {
    console.log('[DEBUG] [Bootstrap] Importing logging system...'); // BOOTSTRAP: Pre-logger initialization
}
// Import logging system and set config validator
const { setConfigValidator } = require('./core/logging');
if (isDebugModeEnabled()) {
    console.log('[DEBUG] [Bootstrap] Logging system imported'); // BOOTSTRAP: Logger imported but not initialized
}

// Set the config validator BEFORE any logging system usage
if (isDebugModeEnabled()) {
    console.log('[DEBUG] [Bootstrap] Setting config validator...'); // BOOTSTRAP: Logger not fully initialized
}
setConfigValidator(validateLoggingConfig);
if (isDebugModeEnabled()) {
    console.log('[DEBUG] [Bootstrap] Config validator set'); // BOOTSTRAP: Logger not fully initialized
}

// Now load the main application and start it
if (isDebugModeEnabled()) {
    console.log('[DEBUG] [Bootstrap] Importing main application...'); // BOOTSTRAP: Logger not fully initialized
}
const { main } = require('./main');
if (isDebugModeEnabled()) {
    console.log('[DEBUG] [Bootstrap] Main application imported, starting...'); // BOOTSTRAP: Logger not fully initialized
}

// Start the main application and keep it running
(async () => {
    try {
        console.log('[DEBUG] [Bootstrap] About to call main()...');
        await main();
        console.log('[DEBUG] [Bootstrap] main() completed successfully');
    } catch (error) {
        // Use console.error for fatal bootstrap errors since logging might not be available
        console.error('[FATAL] [Bootstrap] Main function failed:', error); // BOOTSTRAP: Critical error handling
        process.exit(1);
    }
})(); 
