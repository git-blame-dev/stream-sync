import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { TwitchPlatform } from '../../src/platforms/twitch';
import { TwitchAuth } from '../../src/auth/TwitchAuth';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import { noOpLogger } from '../helpers/mock-factories';
import { captureStdout, captureStderr } from '../helpers/output-capture';

describe('real Twitch adapter to root-created presentation and accounting', () => {
    test('degraded otherwise priced input displays without credit, then a valid gift credits once', async () => {
        const stdout = captureStdout(); const stderr = captureStderr();
        const h = await createMainPresentationFixture();
        const auth = new TwitchAuth({ clientId: 'synthetic-client', tokenStorePath: join(h.dir, 'synthetic-tokens.json'), logger: noOpLogger });
        const platform = new TwitchPlatform({ enabled: true, dataLoggingEnabled: false }, { logger: noOpLogger, twitchAuth: auth });
        const routes: Promise<void>[] = [];
        const listener = (event: Parameters<typeof h.runtime.platformEventRouter.routeEvent>[0]) => {
            routes.push(h.runtime.platformEventRouter.routeEvent(event));
        };
        const valid = { id: 'synthetic-valid-bits', username: 'Synthetic Viewer', userId: 'synthetic-viewer',
            giftType: 'Bits', giftCount: 1, amount: 100, currency: 'bits', timestamp: '2026-01-01T00:00:00.000Z' };
        try {
            await h.start();
            platform.on('platform:event', listener);
            const baseline = { ...h.funding.snapshot };
            // This is the actual adapter branch for a missing timestamp. Its
            // error envelope retains priced data, challenging the credit guards.
            await platform.handleGiftEvent({ ...valid, id: 'synthetic-degraded-bits', timestamp: undefined });
            await Promise.all(routes.splice(0));
            expect(h.queue.getQueueLength()).toBe(1);
            await h.drain();
            expect(h.rows).toHaveLength(1);
            expect(h.rows[0]).toMatchObject({ type: 'platform:gift', platform: 'twitch', data: { isError: true, amount: 100, currency: 'bits' } });
            expect(String(h.rows[0]!.data.displayMessage)).toContain('Synthetic Viewer');
            expect(h.funding.snapshot).toEqual(baseline);
            expect(h.nativeGoal()).toMatchObject({ current: 0 });
            await platform.handleGiftEvent(valid);
            await Promise.all(routes.splice(0));
            await h.drain();
            expect(h.rows).toHaveLength(2);
            expect(h.rows[1]).toMatchObject({ type: 'platform:gift', data: { amount: 100, currency: 'bits' } });
            expect(h.rows[1]!.data.isError).not.toBe(true);
            expect(h.nativeGoal()).toMatchObject({ current: 100 });
            expect(h.funding.snapshot.currentUsd).toBe(1);
            expect(await h.persistedFunding()).toMatchObject({ currentMicros: 1000000, revision: 1 });
        } finally {
            platform.off('platform:event', listener);
            try { await platform.cleanup(); await auth.dispose(); await h.dispose(); } finally { stdout.restore(); stderr.restore(); }
        }
    });
    test('operator-muted valid gifts have empty admission and no rows or credit; re-enable credits a distinct event', async () => {
        const stdout = captureStdout(); const stderr = captureStderr();
        const h = await createMainPresentationFixture({ operator: true });
        const data = { username: 'Synthetic Controlled Viewer', userId: 'synthetic-controlled-viewer',
            id: 'synthetic-muted-bits', timestamp: '2026-01-01T00:00:00.000Z',
            giftType: 'Bits', giftCount: 1, amount: 100, currency: 'bits' };
        try {
            await h.start();
            const controls = h.runtime.dependencies.operatorControls;
            if (!controls) throw new Error('Real root operator controls were not acquired');
            await controls.setEnabled('giftsEnabled', false);
            const baseline = { ...h.funding.snapshot };
            const writes = h.socket.writes.length;
            expect(h.queue.addItem({ type: 'platform:gift', platform: 'twitch', data })).toEqual([]);
            await h.runtime.platformEventRouter.routeEvent({ type: 'platform:gift', platform: 'twitch', data });
            expect(h.queue.getQueueLength()).toBe(0);
            await h.drain();
            expect(h.rows).toEqual([]);
            expect(h.nativeGoal()).toMatchObject({ current: 0 });
            expect(h.funding.snapshot).toEqual(baseline);
            expect(h.socket.writes).toHaveLength(writes);
            await expect(stat(h.fundingPath)).rejects.toMatchObject({ code: 'ENOENT' });
            await controls.setEnabled('giftsEnabled', true);
            await h.runtime.platformEventRouter.routeEvent({ type: 'platform:gift', platform: 'twitch', data: { ...data, id: 'synthetic-enabled-bits' } });
            expect(h.queue.getQueueLength()).toBe(1);
            await h.drain();
            expect(h.rows).toHaveLength(1);
            expect(h.nativeGoal()).toMatchObject({ current: 100 });
            expect(h.funding.snapshot.currentUsd).toBe(1);
            expect(await h.persistedFunding()).toMatchObject({ currentMicros: 1000000, revision: 1 });
        } finally { try { await h.dispose(); } finally { stdout.restore(); stderr.restore(); } }
    });

});
