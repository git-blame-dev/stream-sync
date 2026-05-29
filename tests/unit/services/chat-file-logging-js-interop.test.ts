import { describe, expect, it } from 'bun:test';
import { logger as appLogger } from '../../../src/core/logging';
import { ChatFileLoggingService } from '../../../src/services/ChatFileLoggingService';

const testLogger = {
config: {},
outputs: {
console: { write() {} },
file: { config: {}, fileLogger: null, write() {} },
},
reconfigure() {},
log() {},
shouldOutput: () => false,
info() {},
warn() {},
error() {},
debug() {},
emergency() {},
console() {},
} satisfies typeof appLogger;

describe('chat file logging JS interop', () => {
it('exposes ChatFileLoggingService as a named export from the JS wrapper', () => {
expect(typeof ChatFileLoggingService).toBe('function');
});

it('constructs the named wrapper export with logger/config dependencies', () => {
const service = new ChatFileLoggingService({
            logger: testLogger,
            config: {}
        });

        expect(typeof service.logRawPlatformData).toBe('function');
    });
});
