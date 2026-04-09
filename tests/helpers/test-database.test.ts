import { beforeEach, describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';

import testClock from './test-clock';

const nodeRequire = createRequire(import.meta.url);
const { createTestDataFactory } = nodeRequire('./test-database') as {
    createTestDataFactory: (type: string) => (overrides?: Record<string, unknown>) => { timestamp?: string };
};

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
