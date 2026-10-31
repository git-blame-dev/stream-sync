import { describe, expect, test } from 'bun:test';
import { acquireSingleInstanceGuard } from '../../src/services/SingleInstanceGuard';
import { withTimeout } from '../../src/utils/timeout-wrapper';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { captureStdout, captureStderr } from '../helpers/output-capture';

const gift = {
    username: 'Synthetic Viewer', userId: 'synthetic-main-viewer', id: 'synthetic-main-gift',
    timestamp: '2026-01-01T00:00:00.000Z', giftType: 'Bits', giftCount: 1, amount: 100, currency: 'bits',
};

describe('main real-owner startup and presentation', () => {
    test('root-created routing and queue present a valid gift and persist exact credit', async () => {
        const stdout = captureStdout(); const stderr = captureStderr();
        const h = await createMainPresentationFixture();
        let unsubscribe: (() => void) | undefined;
        try {
            h.config.displayQueue.autoProcess = true;
            const result = await h.start();
            expect(result).toMatchObject({ success: true, appStarted: true });
            expect(h.funding.snapshot.currentUsd).toBe(0);
            const presented = new Promise<void>(resolve => {
                unsubscribe = h.bus.subscribe('display:row', () => resolve());
            });
            h.bus.emit('platform:event', { platform: 'twitch', type: 'platform:gift', data: gift });
            await withTimeout(presented, 2000);
            await h.drain();
            expect(h.rows).toHaveLength(1);
            expect(h.rows[0]).toMatchObject({ platform: 'twitch', type: 'platform:gift', data: { username: gift.username, amount: 100, currency: 'bits' } });
            expect(h.funding.snapshot.currentUsd).toBe(1);
            expect(await h.persistedFunding()).toMatchObject({ currentMicros: 1000000, revision: 1 });
            expect(h.nativeGoal()).toMatchObject({ current: 100 });
            expect(h.queue.getQueueLength()).toBe(0);
        } finally { unsubscribe?.(); try { await h.dispose(); } finally { stdout.restore(); stderr.restore(); } }
    });

    test('invalid root configuration rolls back acquired funding and the real instance listener', async () => {
        const stdout = captureStdout(); const stderr = captureStderr();
        const h = await createMainPresentationFixture();
        try {
            Reflect.deleteProperty(h.config, 'goals');
            await expect(h.start()).rejects.toThrow('requires goals configuration');
            const successor = await acquireSingleInstanceGuard({ port: h.instancePort });
            await successor.release();
            await expect(h.funding.processPresentedContributions([])).rejects.toThrow('disposed');
        } finally { try { await h.dispose(); } finally { stdout.restore(); stderr.restore(); } }
    });
});
