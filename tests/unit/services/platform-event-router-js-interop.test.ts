import { describe, expect, it } from 'bun:test';

const platformEventRouterModule = require('../../../src/services/PlatformEventRouter.js');

describe('platform event router JS interop', () => {
    it('exposes PlatformEventRouter as a named export from the JS wrapper', () => {
        expect(typeof platformEventRouterModule.PlatformEventRouter).toBe('function');
    });

    it('constructs the named wrapper export with runtime dependencies', () => {
        const router = new platformEventRouterModule.PlatformEventRouter({
            eventBus: { emit() {}, subscribe() { return () => {}; } },
            runtime: {},
            notificationManager: {},
            config: {},
            logger: { debug() {}, info() {}, warn() {}, error() {} }
        });

        expect(typeof router.dispose).toBe('function');
        router.dispose();
    });
});
