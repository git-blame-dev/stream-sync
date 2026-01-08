const { resolveLogger } = require('../../../src/utils/logger-resolver');

describe('logger-resolver behavior', () => {
    it('preserves prototype methods like console on class-based loggers', () => {
        class TestLogger {
            constructor() {
                this.debugCalls = 0;
                this.consoleCalls = 0;
            }

            debug() {
                this.debugCalls += 1;
            }

            info() {}

            warn() {}

            error() {}

            console() {
                this.consoleCalls += 1;
            }
        }

        const logger = new TestLogger();
        const resolved = resolveLogger(logger, 'TestLogger');

        resolved.debug('test');
        resolved.console('message', 'source');

        expect(resolved.debugCalls).toBe(1);
        expect(resolved.consoleCalls).toBe(1);
        expect(typeof resolved.console).toBe('function');
    });
});
