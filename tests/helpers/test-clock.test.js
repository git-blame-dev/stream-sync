const testClock = require('./test-clock');

describe('testClock', () => {
    beforeEach(() => {
        testClock.reset();
    });

    test('starts at the default epoch and advances deterministically', () => {
        expect(testClock.now()).toBe(testClock.DEFAULT_EPOCH_MS);

        testClock.advance(250);
        expect(testClock.now()).toBe(testClock.DEFAULT_EPOCH_MS + 250);
    });

    test('set overrides the current time and reset restores the default', () => {
        testClock.set(1234);
        expect(testClock.now()).toBe(1234);

        testClock.reset();
        expect(testClock.now()).toBe(testClock.DEFAULT_EPOCH_MS);
    });

    test('rejects invalid time values', () => {
        expect(() => testClock.advance(-1)).toThrow('advance');
        expect(() => testClock.advance(NaN)).toThrow('advance');
        expect(() => testClock.set('100')).toThrow('set');
        expect(() => testClock.set(Infinity)).toThrow('set');
    });

    test('controls Date.now() via setSystemTime', () => {
        testClock.reset();
        // eslint-disable-next-line no-restricted-properties -- Testing that testClock controls Date.now
        expect(Date.now()).toBe(testClock.DEFAULT_EPOCH_MS);

        testClock.advance(1000);
        // eslint-disable-next-line no-restricted-properties -- Testing that testClock controls Date.now
        expect(Date.now()).toBe(testClock.DEFAULT_EPOCH_MS + 1000);

        testClock.set(5000);
        // eslint-disable-next-line no-restricted-properties -- Testing that testClock controls Date.now
        expect(Date.now()).toBe(5000);
    });

    test('controls new Date() via setSystemTime', () => {
        testClock.set(1700000000000);
        const date = new Date();
        expect(date.getTime()).toBe(1700000000000);
    });

    test('maintains sub-millisecond precision for testClock.now()', () => {
        testClock.reset();
        testClock.advance(0.5);
        expect(testClock.now()).toBe(testClock.DEFAULT_EPOCH_MS + 0.5);

        testClock.advance(0.3);
        expect(testClock.now()).toBe(testClock.DEFAULT_EPOCH_MS + 0.8);

        // eslint-disable-next-line no-restricted-properties -- Testing Date.now precision vs testClock
        expect(Date.now()).toBe(testClock.DEFAULT_EPOCH_MS);
    });
});
