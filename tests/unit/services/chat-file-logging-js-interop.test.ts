import { describe, expect, it } from 'bun:test';

const chatFileLoggingModule = require('../../../src/services/ChatFileLoggingService.js');

describe('chat file logging JS interop', () => {
    it('exposes ChatFileLoggingService as a named export from the JS wrapper', () => {
        expect(typeof chatFileLoggingModule.ChatFileLoggingService).toBe('function');
    });

    it('constructs the named wrapper export with logger/config dependencies', () => {
        const service = new chatFileLoggingModule.ChatFileLoggingService({
            logger: { debug() {}, info() {}, warn() {}, error() {} },
            config: {}
        });

        expect(typeof service.logRawPlatformData).toBe('function');
    });
});
