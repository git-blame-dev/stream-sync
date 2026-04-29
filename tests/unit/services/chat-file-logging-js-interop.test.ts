import { describe, expect, it } from 'bun:test';
import { ChatFileLoggingService } from '../../../src/services/ChatFileLoggingService';

describe('chat file logging JS interop', () => {
it('exposes ChatFileLoggingService as a named export from the JS wrapper', () => {
expect(typeof ChatFileLoggingService).toBe('function');
});

it('constructs the named wrapper export with logger/config dependencies', () => {
const service = new ChatFileLoggingService({
            logger: { debug() {}, info() {}, warn() {}, error() {} },
            config: {}
        });

        expect(typeof service.logRawPlatformData).toBe('function');
    });
});
