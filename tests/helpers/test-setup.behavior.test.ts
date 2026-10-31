import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { initializeLoggingConfig, logger } from '../../src/core/logging';
import { captureStderr, captureStdout } from './output-capture';
import { createTestNotification, createTestUser, initializeTestLogging } from './test-setup';
import testClock from './test-clock';

describe('test-setup helper behavior', () => {
    beforeEach(() => {
        testClock.reset();
    });

    afterEach(() => {
        testClock.useRealTime();
        initializeTestLogging();
    });

    it('silences the real logger after a previous test enables output', async () => {
        const stdout = captureStdout();
        const stderr = captureStderr();
        try {
            initializeLoggingConfig({ logging: { console: { enabled: true }, file: { enabled: false } } });
            initializeTestLogging();
            let reads = 0;
            const data = { get syntheticValue() { reads++; return 'synthetic value'; } };
            logger.debug('synthetic debug', 'test', data);
            logger.info('synthetic info', 'test', data);
            logger.warn('synthetic warning', 'test', data);
            logger.error('synthetic error', 'test', data);
            logger.console('synthetic chat');
            await logger.flush?.();
            expect(stdout.output).toEqual([]);
            expect(stderr.output).toEqual([]);
            expect(reads).toBe(0);
        } finally {
            stdout.restore();
            stderr.restore();
        }
    });

    it('creates deterministic test users and supports overrides', () => {
        const defaultUser = createTestUser();
        expect(defaultUser.username).toBe('TestUser');
        expect(defaultUser.userId).toBe('test-user-id');
        expect(defaultUser.isMod).toBe(false);
        const overriddenUser = createTestUser({ username: 'test-alt-user', isSubscriber: true });
        expect(overriddenUser.username).toBe('test-alt-user');
        expect(overriddenUser.isSubscriber).toBe(true);
    });

    it('creates notifications with deterministic identity and supports overrides', () => {
        const first = createTestNotification('platform:gift');
        const second = createTestNotification('platform:gift');

        expect(first.type).toBe('platform:gift');
        expect(first.platform).toBe('tiktok');
        expect(first.id).not.toBe(second.id);
        expect(first.processedAt).toBeLessThan(second.processedAt);
        expect(first.timestamp).toContain('T');

        const overridden = createTestNotification('platform:follow', {
            username: 'test-user',
            platform: 'youtube'
        });
        expect(overridden.username).toBe('test-user');
        expect(overridden.platform).toBe('youtube');
    });

});
