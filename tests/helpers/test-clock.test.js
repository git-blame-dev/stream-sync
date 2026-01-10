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
});
