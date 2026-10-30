import { expect, test } from 'bun:test';
import { createTikTokLifetimeFixture, flushConnectorSetup } from '../helpers/tiktok-connector-fixture';
import { createRecordingLogger } from '../helpers/recording-logger';
import { useFakeTimers, useRealTimers, advanceTimersByTime } from '../helpers/bun-timers';

test('offline initialization and minute checks stay quiet, reconnect promptly, and report the next offline transition', async () => {
    useFakeTimers();
    const logger = createRecordingLogger();
    const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false }, undefined, logger);
    const offlineEntries = () => logger.entries.filter(entry => entry.level === 'info' && entry.message.includes('offline; monitoring'));
    try {
        const initialized = fixture.platform.initialize();
        await flushConnectorSetup();
        fixture.connectors[0]!.fail(Object.assign(new Error('synthetic offline'), { code: 4404 }));
        expect(await initialized).toEqual({ state: 'monitoring' });
        expect(fixture.platform.connectionStateManager.getState()).toBe('disconnected');
        expect(offlineEntries()).toHaveLength(1);
        const visibleEntries = logger.entries.filter(entry => entry.level !== 'debug').length;
        for (let attempt = 1; attempt <= 2; attempt++) {
            await advanceTimersByTime(60000);
            await flushConnectorSetup();
            expect(fixture.connectors).toHaveLength(attempt + 1);
            fixture.connectors[attempt]!.fail(Object.assign(new Error('synthetic offline'), { code: 4404 }));
            await flushConnectorSetup();
            expect(fixture.platform.connectionStateManager.getState()).toBe('disconnected');
        }
        expect(logger.entries.filter(entry => entry.level !== 'debug')).toHaveLength(visibleEntries);
        expect(logger.entries.filter(entry => entry.level === 'warn' || entry.level === 'error')).toHaveLength(0);
        await advanceTimersByTime(60000);
        await flushConnectorSetup();
        const live = fixture.connectors.at(-1)!;
        live.open(); live.enter();
        await flushConnectorSetup();
        expect(fixture.platform.connectionStatus).toBe(true);
        expect(fixture.platform.intervalManager.hasInterval('tiktok-stream-reconnect')).toBe(false);
        live.emit('streamEnd');
        await flushConnectorSetup();
        expect(fixture.platform.connectionStatus).toBe(false);
        expect(offlineEntries()).toHaveLength(2);
        expect(fixture.platform.intervalManager.hasInterval('tiktok-stream-reconnect')).toBe(true);
    } finally {
        await fixture.cleanup();
        useRealTimers();
    }
});

test('real TikTok signing failures remain visible and do not become offline monitoring', async () => {
    const logger = createRecordingLogger();
    const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false }, undefined, logger);
    try {
        const initialized = fixture.platform.initialize().catch(error => error);
        await flushConnectorSetup();
        fixture.connectors[0]!.fail(Object.assign(new Error('synthetic signing failure'), { code: 4401 }));
        expect(await initialized).toBeInstanceOf(Error);
        expect(fixture.platform.connectionStateManager.getState()).toBe('error');
        expect(logger.entries.some(entry => entry.level === 'error')).toBe(true);
        expect(logger.entries.some(entry => entry.message.includes('offline; monitoring'))).toBe(false);
        expect(fixture.platform.intervalManager.hasInterval('tiktok-stream-reconnect')).toBe(false);
    } finally { await fixture.cleanup(); }
});
