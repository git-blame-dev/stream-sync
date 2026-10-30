import { describe, expect, it } from 'bun:test';
import { PRIORITY_LEVELS } from '../../../src/core/constants';
import { createEventBus } from '../../../src/core/EventBus';
import type { DisplayLifecyclePayload } from '../../../src/interfaces/DisplayEvents';
import type { DisplayQueueItem } from '../../../src/interfaces/DisplayQueue';
import { DisplayQueue } from '../../../src/obs/display-queue';
import { createOBSGoalsManager } from '../../../src/obs/goals';
import { createOBSSourcesManager } from '../../../src/obs/sources';
import { withTimeout } from '../../../src/utils/timeout-wrapper';

describe('display queue with degraded neural TTS', () => {
    for (const failingPath of ['/health', '/v1/prepare']) {
        it(`preserves visual presentation and advances after ${failingPath} returns 503`, async () => {
            const bus = createEventBus();
            const events: string[] = [];
            const rows: DisplayQueueItem[] = [];
            const lifecycle: DisplayLifecyclePayload[] = [];
            const requests: string[] = [];
            let failed = false;
            let finishVfx!: (correlationId: string) => void;
            const vfxStarted = new Promise<string>((resolve) => { finishVfx = resolve; });
            const unsubscribers = [
                bus.subscribe('display:row', value => {
                    const row = value as DisplayQueueItem;
                    rows.push(row);
                    events.push(`row:${row.eventId}`);
                }),
                bus.subscribe('display:notification-lifecycle', value => {
                    const payload = value as DisplayLifecyclePayload;
                    lifecycle.push(payload);
                    events.push(`${payload.phase}:${payload.eventId}`);
                }),
                bus.subscribe('vfx:command-received', value => {
                    const payload = value as { correlationId: string };
                    events.push('vfx:started');
                    finishVfx(payload.correlationId);
                })
            ];
            // Only the OBS transport and neural HTTP responses are simulated.
            const obs = {
                call: async () => ({}),
                ensureConnected: async () => {},
                isConnected: () => true,
                isReady: async () => true
            };
            const sourcesManager = createOBSSourcesManager(obs);
            const goalsManager = createOBSGoalsManager(obs, {
                config: { goals: { enabled: false } },
                updateTextSource: sourcesManager.updateTextSource
            });
            const queue = new DisplayQueue(obs, {
                autoProcess: false,
                rowIntervalMs: 0,
                ttsNotificationsEnabled: true,
                gui: { enableNotifications: true },
                notificationIdleHoldMs: 0,
                notificationTransitionMs: 0,
                obs: { neuralTtsEndpoint: 'http://127.0.0.1:8765' }
            }, { PRIORITY_LEVELS }, bus, {
                sourcesManager,
                goalsManager,
                delay: async () => {},
                notificationDelay: async () => {},
                fetch: async (input, init) => {
                    const path = new URL(String(input)).pathname;
                    const text = init?.body ? (JSON.parse(String(init.body)) as { text: string }).text : '';
                    requests.push(`${path}:${text}`);
                    if (!failed && path === failingPath) {
                        failed = true;
                        events.push('tts:503');
                        return new Response(null, { status: 503 });
                    }
                    return new Response(null, { status: 200 });
                }
            });
            queue.addItem({
                eventId: 'synthetic-degraded-follow',
                type: 'platform:follow',
                platform: 'synthetic-platform',
                data: { username: 'synthetic-first-viewer', ttsMessage: 'synthetic first speech' },
                vfxConfig: {
                    commandKey: 'synthetic-follow', command: '!synthetic-follow',
                    filename: 'synthetic-follow.mp4', mediaSource: 'Synthetic VFX Source',
                    vfxFilePath: '/synthetic/vfx'
                }
            });
            queue.addItem({
                eventId: 'synthetic-recovered-follow',
                type: 'platform:follow',
                platform: 'synthetic-platform',
                data: { username: 'synthetic-next-viewer', ttsMessage: 'synthetic next speech' }
            });

            const running = queue.processQueue();
            try {
                const correlationId = await withTimeout(vfxStarted, 1000);
                expect(rows.map(row => row.eventId)).toEqual(['synthetic-degraded-follow']);
                expect(rows[0]?.data.username).toBe('synthetic-first-viewer');
                expect(lifecycle.map(({ phase, eventId }) => [phase, eventId])).toEqual([
                    ['started', 'synthetic-degraded-follow']
                ]);
                expect(events).toEqual([
                    'tts:503', 'row:synthetic-degraded-follow',
                    'started:synthetic-degraded-follow', 'vfx:started'
                ]);
                expect(requests).toEqual(failingPath === '/health'
                    ? ['/health:']
                    : ['/health:', '/v1/prepare:synthetic first speech']);

                bus.emit('vfx:effect-completed', { correlationId });
                await running;

                expect(rows.map(row => row.eventId)).toEqual([
                    'synthetic-degraded-follow', 'synthetic-recovered-follow'
                ]);
                expect(lifecycle.map(({ phase, eventId }) => [phase, eventId])).toEqual([
                    ['started', 'synthetic-degraded-follow'],
                    ['exit-started', 'synthetic-degraded-follow'],
                    ['started', 'synthetic-recovered-follow'],
                    ['exit-started', 'synthetic-recovered-follow']
                ]);
                expect(requests).toEqual([
                    '/health:',
                    ...(failingPath === '/v1/prepare' ? ['/v1/prepare:synthetic first speech'] : []),
                    '/health:', '/v1/prepare:synthetic next speech', '/v1/speak:synthetic next speech'
                ]);
                expect(queue.getQueueLength()).toBe(0);
                expect(queue.isProcessing).toBe(false);
                expect(bus.listenerCount('vfx:effect-completed')).toBe(0);
            } finally {
                await queue.stop();
                await running;
                for (const unsubscribe of unsubscribers) unsubscribe();
            }
        });
    }
});
