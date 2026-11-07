import { describe, expect, it, vi } from 'bun:test';
import { createTikTokLifetimeFixture, flushConnectorSetup } from './tiktok-connector-fixture';
import { noOpLogger } from './mock-factories';

describe('TikTok lifetime fixture cleanup', () => {
    it('retires independent clients and retries after an external cleanup diagnostic fails', async () => {
        vi.useFakeTimers();
        let failDiagnostics = false;
        const diagnosticFailure = new Error('Synthetic diagnostic sink failure');
        let fixture: ReturnType<typeof createTikTokLifetimeFixture> | undefined;
        const pending: Promise<unknown>[] = [];
        try {
            fixture = createTikTokLifetimeFixture({}, undefined, {
                ...noOpLogger,
                debug: message => {
                    if (failDiagnostics && typeof message === 'string' && message.startsWith('Cleared ')) throw diagnosticFailure;
                },
                warn: () => { if (failDiagnostics) throw diagnosticFailure; },
                error: () => { if (failDiagnostics) throw diagnosticFailure; },
            });
            fixture.platform.intervalManager.createInterval('synthetic-cleanup', () => {}, 1000);
            for (let index = 0; index < 2; index++) {
                const client = fixture.createConnection();
                pending.push(client.connect().catch(error => error));
            }
            await flushConnectorSetup();
            expect(fixture.connectors).toHaveLength(2);
            fixture.platform.on('synthetic-event', () => {});
            failDiagnostics = true;
            await expect(fixture.cleanup()).rejects.toMatchObject({ errors: [diagnosticFailure] });
            expect(fixture.connectors.map(connector => connector.signal?.aborted)).toEqual([true, true]);
            expect(fixture.connectors.map(connector => connector.terminated)).toEqual([1, 1]);
            expect(await Promise.all(pending)).toEqual([expect.objectContaining({ code: 1000 }), expect.objectContaining({ code: 1000 })]);
            expect(fixture.platform.listenerCount('synthetic-event')).toBe(0);
            failDiagnostics = false;
            fixture.retry.handleConnectionError('tiktok', new Error('Synthetic transport failure'), async () => {});
            expect(Object.keys(fixture.retry.retryTimers)).toEqual([]);
        } finally {
            failDiagnostics = false;
            try {
                await fixture?.cleanup();
                await Promise.all(pending);
            } finally {
                vi.useRealTimers();
            }
        }
    });
});
