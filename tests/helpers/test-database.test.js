const testClock = require('./test-clock');
const { createTestDataFactory } = require('./test-database');

describe('test-database helpers', () => {
    beforeEach(() => {
        testClock.reset();
    });

    test('notification factory timestamps are deterministic', () => {
        testClock.set(2000);
        const notification = createTestDataFactory('notification')();

        expect(notification.timestamp).toBe(new Date(2000).toISOString());
    });
});
