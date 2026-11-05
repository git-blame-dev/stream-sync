import { expect, test } from 'bun:test';
import { createMainPresentationFixture } from '../helpers/main-presentation-fixture';
import type { UserTrackingService } from '../../src/services/UserTrackingService';
import { buildOperatorState } from '../../src/services/gui/operator-api';

for (const operator of [false, true]) {
    test(`real main preserves mixed follow defaults with operator ${operator}`, async () => {
        const h = await createMainPresentationFixture({ operator });
        h.config.general.followsEnabled = true;
        h.config.tiktok.followsEnabled = false;
        h.config.twitch.followsEnabled = true;
        h.config.youtube.followsEnabled = false;
        const follow = async (id: string) => {
            for (const platform of ['tiktok', 'twitch', 'youtube'] as const) {
                await h.runtime.platformEventRouter.routeEvent({ type: 'platform:follow', platform, data: {
                    username: 'Synthetic Policy Viewer', userId: `synthetic-${platform}-${id}`, timestamp: '2026-01-01T00:00:00.000Z'
                } });
            }
        };
        try {
            await h.start();
            await follow('config');
            await h.drain();
            expect(h.rows.map(row => row.platform)).toEqual(['twitch']);
            if (operator) {
                const controls = h.runtime.dependencies.operatorControls!;
                expect(buildOperatorState(controls).controls.find(control => control.key === 'followsEnabled')).toMatchObject({ overridden: false, configState: 'mixed' });
                await controls.setEnabled('followsEnabled', true);
                expect(buildOperatorState(controls).controls.find(control => control.key === 'followsEnabled')).toMatchObject({ overridden: true, enabled: true });
                await follow('override');
                await h.drain();
                expect(h.rows.slice(1).map(row => row.platform)).toEqual(['tiktok', 'twitch', 'youtube']);
                await follow('pending');
                await controls.reset();
                await h.drain();
                expect(h.rows.slice(4).map(row => row.platform)).toEqual(['twitch']);
                await controls.setEnabled('followsEnabled', true);
                const sequence = ['tiktok', 'twitch', 'youtube'].map(platform => ({ type: 'platform:follow', platform, data: { username: 'Synthetic Sequence Viewer', displayMessage: 'Synthetic follow' } }));
                expect(h.queue.addSequence(sequence)).toHaveLength(3);
                await controls.reset();
                await h.drain();
                expect(h.rows.slice(5).map(row => row.platform)).toEqual(['twitch']);
                await controls.setEnabled('followsEnabled', false);
                await follow('muted');
                await controls.setEnabled('followsEnabled', true);
                await h.drain();
                expect(h.rows).toHaveLength(6);
            }
        } finally { await h.dispose(); }
    });
}

for (const coordinated of [false, true]) {
    test(`mute during asynchronous TTS preparation drops credit and replay; active presentation finishes (coordinated ${coordinated})`, async () => {
        const h = await createMainPresentationFixture({ operator: true });
        h.config.obs.ttsNotificationsEnabled = true;
        h.config.gui.enableNotifications = coordinated;
        let enterPrepare!: () => void;
        let releasePrepare!: () => void;
        let enterSpeak!: () => void;
        let releaseSpeak!: () => void;
        const preparing = new Promise<void>(resolve => { enterPrepare = resolve; });
        const prepareGate = new Promise<void>(resolve => { releasePrepare = resolve; });
        const speaking = new Promise<void>(resolve => { enterSpeak = resolve; });
        const speakGate = new Promise<void>(resolve => { releaseSpeak = resolve; });
        const requests: string[] = [];
        let processing: Promise<void> | undefined;
        const gift = (id: string) => h.runtime.handleGiftNotification('twitch', 'Synthetic Policy Donor', {
            id, userId: 'synthetic-policy-donor', timestamp: '2026-01-01T00:00:00.000Z',
            giftType: 'Bits', giftCount: 1, amount: 100, currency: 'bits'
        });
        try {
            await h.start();
            const controls = h.runtime.dependencies.operatorControls!;
            h.queue.effects.fetch = async input => {
                const path = new URL(String(input)).pathname;
                requests.push(path);
                if (path === '/v1/prepare' && requests.filter(path => path === '/v1/prepare').length === 1) {
                    enterPrepare();
                    await prepareGate;
                }
                if (path === '/v1/speak') { enterSpeak(); await speakGate; }
                return new Response(null, { status: 200 });
            };
            await gift('synthetic-muted-during-prepare');
            processing = h.queue.processQueue();
            await preparing;
            await controls.setEnabled('giftsEnabled', false);
            releasePrepare();
            await processing;
            expect(h.rows).toHaveLength(0);
            expect(h.nativeGoal()?.current).toBe(0);
            expect(h.funding.snapshot.currentUsd).toBe(0);
            expect(requests).not.toContain('/v1/speak');
            await controls.setEnabled('giftsEnabled', true);
            await h.drain();
            expect(h.rows).toHaveLength(0);
            await gift('synthetic-active-finishes');
            processing = h.queue.processQueue();
            await speaking;
            await controls.setEnabled('giftsEnabled', false);
            releaseSpeak();
            await processing;
            expect(h.rows).toHaveLength(1);
            expect(h.nativeGoal()?.current).toBe(100);
            expect(h.funding.snapshot.currentUsd).toBe(1);
            expect(requests.filter(path => path === '/v1/speak')).toHaveLength(1);
        } finally {
            releasePrepare();
            releaseSpeak();
            if (processing) await processing;
            await h.dispose();
        }
    });
}

test('muted chat keeps commands independent and commits first-message/cooldown only on admission', async () => {
    const h = await createMainPresentationFixture({ operator: true });
    Object.assign(h.config.twitch, { messagesEnabled: false, commandsEnabled: false, greetingsEnabled: false, farewellsEnabled: false });
    h.config.commands.synthetic = '!synthetic-command,Synthetic Media';
    const userId = 'synthetic-policy-command-user';
    const message = { userId, username: 'Synthetic Policy Viewer', message: '!synthetic-command', timestamp: '2026-01-01T00:00:00.000Z' };
    try {
        await h.start();
        const controls = h.runtime.dependencies.operatorControls!;
        await h.runtime.handleChatMessage('twitch', message);
        expect(h.queue.getQueueLength()).toBe(0);
        expect((h.runtime.userTrackingService as UserTrackingService).hasSeenUser(userId)).toBe(false);
        expect(h.runtime.commandCooldownService.checkUserCooldown(userId, 60_000, 120_000)).toBe(true);
        await controls.setEnabled('commandsEnabled', true);
        await h.runtime.handleChatMessage('twitch', message);
        expect(h.queue.getQueueLength()).toBe(1);
        expect(h.queue.state.queue[0]).toMatchObject({ children: [{ type: 'command' }] });
        expect((h.runtime.userTrackingService as UserTrackingService).hasSeenUser(userId)).toBe(true);
        expect(h.runtime.commandCooldownService.checkUserCooldown(userId, 60_000, 120_000)).toBe(false);
        await controls.setEnabled('commandsEnabled', false);
        expect(h.queue.getQueueLength()).toBe(0);
        await controls.setEnabled('greetingsEnabled', true);
        await controls.setEnabled('messagesEnabled', true);
        await h.runtime.handleChatMessage('twitch', { ...message, userId: 'synthetic-policy-greeting-user', message: 'Synthetic hello' });
        expect(h.queue.getQueueLength()).toBe(2);
        expect(h.queue.state.queue[0]).toMatchObject({ children: [{ type: 'chat' }, { type: 'greeting' }] });
    } finally { await h.dispose(); }
});

for (const coordinated of [false, true]) {
    for (const cancellation of ['mute', 'reset'] as const) {
        test(`cancelled preparation stays retired after ${cancellation} then enable (coordinated ${coordinated})`, async () => {
            const h = await createMainPresentationFixture({ operator: true });
            h.config.twitch.giftsEnabled = false;
            h.config.obs.ttsNotificationsEnabled = true;
            h.config.gui.enableNotifications = coordinated;
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const requests: string[] = [];
            let processing: Promise<void> | undefined;
            const gift = (id: string) => h.runtime.handleGiftNotification('twitch', 'Synthetic Cancelled Donor', {
                id, userId: 'synthetic-cancelled-donor', timestamp: '2026-01-01T00:00:00.000Z',
                giftType: 'Bits', giftCount: 1, amount: 100, currency: 'bits'
            });
            try {
                await h.start();
                const controls = h.runtime.dependencies.operatorControls!;
                await controls.setEnabled('giftsEnabled', true);
                h.queue.effects.fetch = async input => {
                    const path = new URL(String(input)).pathname;
                    requests.push(path);
                    if (path === '/v1/prepare' && requests.filter(path => path === '/v1/prepare').length === 1) {
                        entered.resolve();
                        await release.promise;
                    }
                    return new Response(null, { status: 200 });
                };
                const writesBefore = h.socket.writes.length;
                await gift(`synthetic-cancelled-${cancellation}-${coordinated}`);
                processing = h.queue.processQueue();
                await entered.promise;
                if (cancellation === 'mute') await controls.setEnabled('giftsEnabled', false);
                else await controls.reset();
                await controls.setEnabled('giftsEnabled', true);
                release.resolve();
                await processing;
                await h.drain();
                expect(h.rows).toHaveLength(0);
                expect(h.nativeGoal()?.current).toBe(0);
                expect(h.funding.snapshot.currentUsd).toBe(0);
                expect(h.socket.writes).toHaveLength(writesBefore);
                expect(requests).not.toContain('/v1/speak');

                await gift(`synthetic-fresh-${cancellation}-${coordinated}`);
                await h.drain();
                expect(h.rows).toHaveLength(1);
                expect(h.nativeGoal()?.current).toBe(100);
                expect(h.funding.snapshot.currentUsd).toBe(1);
                expect(requests.filter(path => path === '/v1/speak')).toHaveLength(1);
            } finally {
                release.resolve();
                try { if (processing) await processing; }
                finally { await h.dispose(); }
            }
        });
    }
}
