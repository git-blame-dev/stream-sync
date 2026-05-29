import { describe, expect, it } from 'bun:test';
import { PlatformEventRouter } from '../../../src/services/PlatformEventRouter';

type RouterOptions = ConstructorParameters<typeof PlatformEventRouter>[0];

const noOpRouterLogger: RouterOptions['logger'] = {
    debug() {},
    warn() {},
    error() {}
};

describe('platform event router JS interop', () => {
it('exposes PlatformEventRouter as a named export from the JS wrapper', () => {
expect(typeof PlatformEventRouter).toBe('function');
});

it('constructs the named wrapper export with runtime dependencies', () => {
const router = new PlatformEventRouter({
            eventBus: { subscribe() { return () => {}; } },
            runtime: {},
            notificationManager: {},
            config: {},
            logger: noOpRouterLogger
        });

        expect(typeof router.dispose).toBe('function');
        router.dispose();
    });
});
