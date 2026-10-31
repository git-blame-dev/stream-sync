import { resolve } from 'node:path';
import { createBootstrapEmergencyLogger } from './core/bootstrap-emergency-logger';

const bootstrapEmergencyLogger = createBootstrapEmergencyLogger({ logsDir: resolve(process.cwd(), 'logs') });
const bootstrapProcess = process as typeof process & {
    __streamSyncUncaughtExceptionHandlerInstalled?: boolean;
    __streamSyncUnhandledRejectionHandlerInstalled?: boolean;
};

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
        process.exit(1);
    });
}

(async () => {
    try {
        const { main } = await import('./main');
        await main();
    } catch (error) {
        bootstrapEmergencyLogger.writeMainFailure(error);
        process.exit(1);
    }
})();
