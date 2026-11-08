import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'bun:test';
import { PRIORITY_LEVELS } from '../../../src/core/constants';
import { DisplayQueue } from '../../../src/obs/display-queue.ts';
import { DisplayQueueEffects } from '../../../src/obs/display-queue-effects.ts';

function createEffects(options: {
    neuralTtsEndpoint?: string;
    neuralTtsVoice?: string;
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
    const textUpdates: string[] = [];
    const clearedSources: string[] = [];
    const effects = new DisplayQueueEffects({
        config: {
            obs: {
                ...(options.neuralTtsEndpoint ? { neuralTtsEndpoint: options.neuralTtsEndpoint } : {}),
                ...(options.neuralTtsVoice ? { neuralTtsVoice: options.neuralTtsVoice } : {})
            }
        },
        sourcesManager: {
            clearTextSource: async (source) => { clearedSources.push(source); },
            updateTextSource: async (_source, text) => { textUpdates.push(text); }
        },
        obsManager: { call: async () => ({}) },
        goalsManager: { processDonationGoal: async () => {}, processPaypiggyGoal: async () => {} },
        delay: async () => {},
        handleDisplayQueueError: () => {},
        extractUsername: () => null,
        ...(options.fetch ? { fetch: options.fetch } : {})
    });
    return { effects, textUpdates, clearedSources };
}

describe('display queue speech output', () => {
    it('recovers an unavailable worker before admitting new speech and releases only its recovery session', async () => {
        const operations: string[] = [];
        let healthCalls = 0;
        const session = 'a'.repeat(64);
        const { effects } = createEffects({ fetch: async (input, init) => {
            const route = new URL(String(input)).pathname;
            operations.push(route);
            if (route === '/health') return new Response(null, { status: ++healthCalls === 1 ? 503 : 200 });
            if (route === '/v1/synthesis/session') return Response.json({ session_id: session });
            if (route === '/v1/synthesis/release') expect(JSON.parse(String(init?.body))).toEqual({ session_id: session });
            return new Response(null, { status: 200 });
        } });

        await effects.setTTSText('Synthetic recovery notification');

        expect(operations).toEqual(['/health', '/v1/synthesis/session', '/health', '/v1/synthesis/release', '/v1/speak']);
    });

    it('checks readiness and posts neural speech with the configured voice', async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ url: String(input), ...(init ? { init } : {}) });
            return new Response(null, { status: 200 });
        };
        const { effects, textUpdates } = createEffects({
            neuralTtsEndpoint: 'http://127.0.0.1:8765/',
            neuralTtsVoice: ' test-voice ',
            fetch
        });

        await effects.setTTSText('hello from synthetic fixture');

        expect(requests.map(({ url, init }) => [url, init?.method])).toEqual([
            ['http://127.0.0.1:8765/health', 'GET'],
            ['http://127.0.0.1:8765/v1/speak', 'POST']
        ]);
        expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
            text: 'hello from synthetic fixture',
            voice: 'test-voice'
        });
        expect(textUpdates).toEqual([]);
    });

    it('releases recovery admission after presentation cancellation without speaking', async () => {
        const operations: string[] = [];
        let healthCalls = 0;
        const { effects } = createEffects({ fetch: async (input, init) => {
            const route = new URL(String(input)).pathname;
            operations.push(route);
            if (route === '/v1/synthesis/session') return Response.json({ session_id: 'c'.repeat(64) });
            if (route === '/health') {
                if (++healthCalls === 2) effects.cancelActive();
                return new Response(null, { status: 503 });
            }
            expect(init?.signal?.aborted).toBe(false);
            return new Response(null, { status: 200 });
        } });
        await expect(effects.setTTSText('Synthetic cancelled notification')).rejects.toThrow();
        expect(operations).toEqual(['/health', '/v1/synthesis/session', '/health', '/v1/synthesis/release']);
    });

    it('recovers for the next notification without replaying a failed speech request', async () => {
        const spoken: string[] = [];
        let crashed = false;
        const { effects } = createEffects({ fetch: async (input, init) => {
            const route = new URL(String(input)).pathname;
            if (route === '/health') return new Response(null, { status: crashed ? 503 : 200 });
            if (route === '/v1/synthesis/session') {
                crashed = false;
                return Response.json({ session_id: 'd'.repeat(64) });
            }
            if (route === '/v1/speak') {
                spoken.push(JSON.parse(String(init?.body)).text);
                if (spoken.length === 1) {
                    crashed = true;
                    return new Response(null, { status: 500 });
                }
            }
            return new Response(null, { status: 200 });
        } });
        await expect(effects.setTTSText('Synthetic failed notification')).rejects.toThrow('HTTP 500');
        effects.beginPresentation();
        await effects.setTTSText('Synthetic next notification');
        expect(spoken).toEqual(['Synthetic failed notification', 'Synthetic next notification']);
    });

    it('fails explicitly when the service is not ready and does not fall back', async () => {
        const requests: string[] = [];
        const fetch = async (input: RequestInfo | URL) => {
            requests.push(String(input));
            return new Response(null, { status: 503 });
        };
        const { effects, textUpdates, clearedSources } = createEffects({ fetch });

        await expect(effects.setTTSText('fixture')).rejects.toThrow('recovery unavailable (HTTP 503)');

        expect(requests).toEqual(['http://127.0.0.1:8765/health', 'http://127.0.0.1:8765/v1/synthesis/session']);
        expect(clearedSources).toEqual([]);
        expect(textUpdates).toEqual([]);
    });

    it('rejects non-loopback endpoints before making an HTTP request', async () => {
        let requestCount = 0;
        const fetch = async () => {
            requestCount += 1;
            return new Response(null, { status: 200 });
        };
        const { effects } = createEffects({ neuralTtsEndpoint: 'http://example.test:8765', fetch });

        await expect(effects.setTTSText('fixture')).rejects.toThrow('must use HTTP on loopback');
        expect(requestCount).toBe(0);
    });

    it('disallows redirects and bounds health and speak requests', async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ url: String(input), ...(init ? { init } : {}) });
            return new Response(null, { status: 200 });
        };
        const { effects } = createEffects({ fetch });

        await effects.setTTSText('synthetic speech');

        expect(requests).toHaveLength(2);
        for (const { init } of requests) {
            expect(init?.redirect).toBe('error');
            expect(init?.signal).toBeInstanceOf(AbortSignal);
        }
    });

    it('rejects an unresponsive health request without using OBS text', async () => {
        const fetch = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
            new Promise((_resolve, reject) => {
                if (!init?.signal) {
                    reject(new Error('missing request deadline'));
                    return;
                }
                init.signal.addEventListener('abort', () => reject(new Error('health request timed out')), { once: true });
            });
        const { effects, textUpdates } = createEffects({ fetch });

        await expect(effects.setTTSText('synthetic speech')).rejects.toThrow('health request timed out');
        expect(textUpdates).toEqual([]);
    });

    it('speaks sequential notification stages in their existing queue order', async () => {
        const prepared: string[] = [];
        const spoken: string[] = [];
        let responseCount = 0;
        const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith('/v1/prepare') && init?.method === 'POST') {
                prepared.push(JSON.parse(String(init.body)).text);
            } else if (url.endsWith('/v1/speak') && init?.method === 'POST') {
                spoken.push(JSON.parse(String(init.body)).text);
            }
            responseCount += 1;
            return new Response(null, { status: 200 });
        };
        const { effects } = createEffects({ fetch });

        await effects.handleSequentialEffects(
            { type: 'platform:follow', platform: 'test-platform', data: { username: 'test-user' } },
            [
                { type: 'primary', text: 'stage one', delay: 0 },
                { type: 'message', text: 'stage two', delay: 0 }
            ]
        );

        expect(prepared).toEqual(['stage one', 'stage two']);
        expect(spoken).toEqual(['stage one', 'stage two']);
        expect(responseCount).toBe(5);
    });

    it('does not advance to another neural stage if a speak request fails', async () => {
        const spoken: string[] = [];
        const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).endsWith('/v1/speak') && init?.method === 'POST') {
                spoken.push(JSON.parse(String(init.body)).text);
                return new Response(null, { status: 500 });
            }
            return new Response(null, { status: 200 });
        };
        const { effects } = createEffects({ fetch });

        await expect(effects.handleSequentialEffects(
            { type: 'platform:follow', platform: 'test-platform', data: { username: 'test-user' } },
            [
                { type: 'primary', text: 'stage one', delay: 0 },
                { type: 'message', text: 'stage two', delay: 0 }
            ]
        )).rejects.toThrow('Neural TTS request failed (HTTP 500)');

        expect(spoken).toEqual(['stage one']);
    });

    it('fails before starting playback when /v1/prepare returns a non-404 error', async () => {
        const requests: string[] = [];
        const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            requests.push(`${init?.method || 'GET'}:${new URL(url).pathname}`);
            if (url.endsWith('/v1/prepare')) {
                return new Response(null, { status: 502 });
            }
            return new Response(null, { status: 200 });
        };
        const { effects } = createEffects({ fetch });

        await expect(effects.handleSequentialEffects(
            { type: 'platform:follow', platform: 'test-platform', data: { username: 'test-user' } },
            [
                { type: 'primary', text: 'stage one', delay: 0 },
                { type: 'message', text: 'stage two', delay: 0 }
            ]
        )).rejects.toThrow('Neural TTS request failed (HTTP 502)');

        expect(requests).toEqual(['GET:/health', 'POST:/v1/prepare']);
    });

    it('prepares all gift TTS stages via /v1/prepare before starting gift media, animation, or /v1/speak and skips duplicate /health calls', async () => {
        const events: string[] = [];
        let markPrepareInFlight!: () => void;
        const prepareInFlight = new Promise<void>((resolve) => { markPrepareInFlight = resolve; });
        let releaseSecondPrepare!: () => void;
        const secondPrepareGate = new Promise<void>((resolve) => { releaseSecondPrepare = resolve; });

        const effects = new DisplayQueueEffects({
            config: {
                ttsNotificationsEnabled: true,
                obs: {
                    neuralTtsEndpoint: 'http://127.0.0.1:8765',
                    neuralTtsVoice: 'synthetic-voice'
                },
                gifts: {
                    giftVideoSource: 'synthetic-gift-video',
                    giftAudioSource: 'synthetic-gift-audio'
                },
                gui: {
                    enableOverlay: true,
                    enableDock: false,
                    showGifts: true
                }
            },
            sourcesManager: {
                clearTextSource: async () => {},
                updateTextSource: async () => {}
            },
            obsManager: {
                call: async (requestType, payload) => {
                    events.push(`obs:${requestType}:${String(payload.inputName)}`);
                    return {};
                }
            },
            goalsManager: {
                processDonationGoal: async () => {},
                processPaypiggyGoal: async () => {}
            },
            eventBus: {
                emit: (eventName) => {
                    events.push(`event:${eventName}`);
                }
            },
            delay: async () => {},
            handleDisplayQueueError: () => {},
            extractUsername: (data) => (typeof data?.username === 'string' ? data.username : null),
            giftAnimationResolver: {
                resolveFromNotificationData: async () => {
                    events.push('animation:resolve');
                    return null;
                }
            },
            fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input);
                if (url.endsWith('/health')) {
                    events.push('health');
                    return new Response(null, { status: 200 });
                }
                if (url.endsWith('/v1/prepare')) {
                    const payload = JSON.parse(String(init?.body)) as { text: string; voice?: string };
                    events.push(`prepare:${payload.text}:${payload.voice ?? ''}`);
                    if (payload.text === 'second gift stage') {
                        markPrepareInFlight();
                        await secondPrepareGate;
                        events.push('prepare-done:second gift stage');
                    }
                    return new Response(null, { status: 200 });
                }
                if (url.endsWith('/v1/speak')) {
                    const payload = JSON.parse(String(init?.body)) as { text: string; voice?: string };
                    events.push(`speak:${payload.text}:${payload.voice ?? ''}`);
                    return new Response(null, { status: 200 });
                }
                return new Response(null, { status: 404 });
            }
        });

        effects.beginPresentation();
        const handling = effects.handleGiftEffects(
            {
                type: 'platform:gift',
                platform: 'tiktok',
                data: { username: 'synthetic-user' }
            },
            [
                { type: 'primary', text: 'first gift stage', delay: 0 },
                { type: 'message', text: 'second gift stage', delay: 0 }
            ]
        );

        await prepareInFlight;
        await Promise.resolve();
        await Promise.resolve();

        expect(events).toEqual([
            'health',
            'prepare:first gift stage:synthetic-voice',
            'prepare:second gift stage:synthetic-voice'
        ]);

        releaseSecondPrepare();
        await handling;

        expect(events.slice(0, 4)).toEqual([
            'health',
            'prepare:first gift stage:synthetic-voice',
            'prepare:second gift stage:synthetic-voice',
            'prepare-done:second gift stage'
        ]);
        expect(events.filter((entry) => entry === 'health')).toHaveLength(1);
        expect(events).toContain('animation:resolve');
        expect(events).toContain('obs:TriggerMediaInputAction:synthetic-gift-video');
        expect(events).toContain('obs:TriggerMediaInputAction:synthetic-gift-audio');
        expect(events).toContain('speak:first gift stage:synthetic-voice');
        expect(events).toContain('speak:second gift stage:synthetic-voice');
        const prepareDoneIndex = events.indexOf('prepare-done:second gift stage');
        expect(events.indexOf('animation:resolve')).toBeGreaterThan(prepareDoneIndex);
        expect(events.indexOf('obs:TriggerMediaInputAction:synthetic-gift-video')).toBeGreaterThan(prepareDoneIndex);
        expect(events.indexOf('speak:first gift stage:synthetic-voice')).toBeGreaterThan(prepareDoneIndex);
    });

    it('prepares all sequential TTS stages via /v1/prepare before VFX playback and calls /v1/speak only after VFX finishes', async () => {
        const events: string[] = [];
        const bus = new EventEmitter();
        let markPrepareInFlight!: () => void;
        const prepareInFlight = new Promise<void>((resolve) => { markPrepareInFlight = resolve; });
        let releasePrepare!: () => void;
        const prepareGate = new Promise<void>((resolve) => { releasePrepare = resolve; });
        let capturedCorrelationId: string | null = null;
        let markVfxEmitted!: () => void;
        const vfxEmitted = new Promise<void>((resolve) => { markVfxEmitted = resolve; });

        const effects = new DisplayQueueEffects({
            config: {
                ttsNotificationsEnabled: true,
                obs: {
                    neuralTtsEndpoint: 'http://127.0.0.1:8765'
                }
            },
            sourcesManager: {
                clearTextSource: async () => {},
                updateTextSource: async () => {}
            },
            obsManager: { call: async () => ({}) },
            goalsManager: {
                processDonationGoal: async () => {},
                processPaypiggyGoal: async () => {}
            },
            eventBus: {
                emit: (eventName, payload) => {
                    events.push(`event:${eventName}`);
                    if (eventName === 'vfx:command-received') {
                        capturedCorrelationId = String(payload.correlationId);
                        markVfxEmitted();
                    }
                    bus.emit(eventName, payload);
                },
                subscribe: (eventName, handler) => {
                    bus.on(eventName, handler);
                    return () => bus.off(eventName, handler);
                }
            },
            delay: async () => {},
            handleDisplayQueueError: () => {},
            extractUsername: (data) => (typeof data?.username === 'string' ? data.username : null),
            fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input);
                if (url.endsWith('/health')) {
                    events.push('health');
                    return new Response(null, { status: 200 });
                }
                if (url.endsWith('/v1/prepare')) {
                    const payload = JSON.parse(String(init?.body)) as { text: string };
                    events.push(`prepare:${payload.text}`);
                    if (payload.text === 'stage two') {
                        markPrepareInFlight();
                        await prepareGate;
                        events.push('prepare-done:stage two');
                    }
                    return new Response(null, { status: 200 });
                }
                if (url.endsWith('/v1/speak')) {
                    const payload = JSON.parse(String(init?.body)) as { text: string };
                    events.push(`speak:${payload.text}`);
                    return new Response(null, { status: 200 });
                }
                return new Response(null, { status: 404 });
            }
        });

        effects.beginPresentation();
        const handling = effects.handleSequentialEffects(
            {
                type: 'platform:follow',
                platform: 'twitch',
                vfxConfig: {
                    commandKey: 'follow-vfx',
                    command: '!follow',
                    filename: 'follow.mp4',
                    mediaSource: 'synthetic-vfx-source',
                    vfxFilePath: '/synthetic/vfx'
                },
                data: { username: 'synthetic-follower' }
            },
            [
                { type: 'primary', text: 'stage one', delay: 0 },
                { type: 'message', text: 'stage two', delay: 0 }
            ]
        );

        await prepareInFlight;
        await Promise.resolve();
        expect(events).toEqual([
            'health',
            'prepare:stage one',
            'prepare:stage two'
        ]);

        releasePrepare();
        await vfxEmitted;
        await Promise.resolve();

        expect(events).toEqual([
            'health',
            'prepare:stage one',
            'prepare:stage two',
            'prepare-done:stage two',
            'event:vfx:command-received'
        ]);

        events.push('vfx:complete-signal');
        bus.emit('vfx:effect-completed', { correlationId: capturedCorrelationId });
        await handling;

        expect(events).toEqual([
            'health',
            'prepare:stage one',
            'prepare:stage two',
            'prepare-done:stage two',
            'event:vfx:command-received',
            'vfx:complete-signal',
            'speak:stage one',
            'speak:stage two'
        ]);
    });

    it('completes GET /health and POST /v1/prepare before emitting display:row, lifecycle started, goal updates, or VFX in DisplayQueue', async () => {
        const events: string[] = [];
        const bus = new EventEmitter();
        let markPrepareInFlight!: () => void;
        const prepareInFlight = new Promise<void>((resolve) => { markPrepareInFlight = resolve; });
        let releasePrepare!: () => void;
        const prepareGate = new Promise<void>((resolve) => { releasePrepare = resolve; });
        let capturedCorrelationId: string | null = null;
        let markVfxEmitted!: () => void;
        const vfxEmitted = new Promise<void>((resolve) => { markVfxEmitted = resolve; });

        const queue = new DisplayQueue(
            { call: async () => ({}) },
            {
                autoProcess: false,
                rowIntervalMs: 0,
                ttsNotificationsEnabled: true,
                gui: { enableNotifications: true },
                obs: { neuralTtsEndpoint: 'http://127.0.0.1:8765' }
            },
            { PRIORITY_LEVELS },
            {
                emit: (eventName: string, payload: Record<string, unknown>) => {
                    if (eventName === 'display:row') {
                        events.push(`row:${String((payload.data as { username?: string })?.username ?? '')}`);
                    } else if (eventName === 'display:notification-lifecycle') {
                        events.push(`lifecycle:${String(payload.phase)}`);
                    } else if (eventName === 'vfx:command-received') {
                        events.push('vfx:command-received');
                        capturedCorrelationId = String(payload.correlationId);
                        markVfxEmitted();
                    }
                    bus.emit(eventName, payload);
                },
                subscribe: (eventName: string, handler: (payload: Record<string, unknown>) => void) => {
                    bus.on(eventName, handler);
                    return () => bus.off(eventName, handler);
                }
            } as unknown as ConstructorParameters<typeof DisplayQueue>[3],
            {
                sourcesManager: {
                    clearTextSource: async () => {},
                    updateTextSource: async () => {}
                },
                goalsManager: {
                    processDonationGoal: async () => {
                        events.push('goal:donation');
                        return { success: true };
                    },
                    processPaypiggyGoal: async () => {
                        events.push('goal:paypiggy');
                        return { success: true };
                    }
                } as unknown as NonNullable<NonNullable<ConstructorParameters<typeof DisplayQueue>[4]>['goalsManager']>,
                delay: async () => {},
                notificationDelay: async () => {},
                fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
                    const url = String(input);
                    if (url.endsWith('/health')) {
                        events.push('health');
                        return new Response(null, { status: 200 });
                    }
                    if (url.endsWith('/v1/prepare')) {
                        const payload = JSON.parse(String(init?.body)) as { text: string };
                        events.push(`prepare:${payload.text}`);
                        markPrepareInFlight();
                        await prepareGate;
                        events.push(`prepare-done:${payload.text}`);
                        return new Response(null, { status: 200 });
                    }
                    if (url.endsWith('/v1/speak')) {
                        const payload = JSON.parse(String(init?.body)) as { text: string };
                        events.push(`speak:${payload.text}`);
                        return new Response(null, { status: 200 });
                    }
                    return new Response(null, { status: 404 });
                }
            }
        );

        queue.addItem({
            type: 'platform:paypiggy',
            platform: 'twitch',
            vfxConfig: {
                commandKey: 'paypiggy-vfx',
                command: '!sub',
                filename: 'sub.mp4',
                mediaSource: 'synthetic-vfx-source',
                vfxFilePath: '/synthetic/vfx'
            },
            data: {
                username: 'synthetic-subscriber',
                ttsMessage: 'synthetic-subscriber subscribed'
            }
        });

        const running = queue.processQueue();
        await prepareInFlight;
        await Promise.resolve();
        await Promise.resolve();

        expect(events).toEqual([
            'health',
            'prepare:synthetic-subscriber subscribed'
        ]);

        releasePrepare();
        await vfxEmitted;
        await Promise.resolve();

        expect(events).toEqual([
            'health',
            'prepare:synthetic-subscriber subscribed',
            'prepare-done:synthetic-subscriber subscribed',
            'row:synthetic-subscriber',
            'lifecycle:started',
            'goal:paypiggy',
            'vfx:command-received'
        ]);

        bus.emit('vfx:effect-completed', { correlationId: capturedCorrelationId });
        await running;
        await queue.stop();

        expect(events).toEqual([
            'health',
            'prepare:synthetic-subscriber subscribed',
            'prepare-done:synthetic-subscriber subscribed',
            'row:synthetic-subscriber',
            'lifecycle:started',
            'goal:paypiggy',
            'vfx:command-received',
            'speak:synthetic-subscriber subscribed',
            'lifecycle:exit-started'
        ]);
    });

    it('serializes gift TTS stages in neural-tts mode so stage two waits for stage one /v1/speak to resolve', async () => {
        const events: string[] = [];
        let speakCalls = 0;
        let markFirstSpeakInFlight!: () => void;
        const firstSpeakInFlight = new Promise<void>((resolve) => { markFirstSpeakInFlight = resolve; });
        let resolveFirstSpeak!: (response: Response) => void;

        const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = String(input);
            if (url.endsWith('/health')) {
                events.push(`health:${speakCalls + 1}`);
                return new Response(null, { status: 200 });
            }
            if (url.endsWith('/v1/speak')) {
                speakCalls += 1;
                const payload = JSON.parse(String(init?.body));
                events.push(`speak-start:${payload.text}`);
                if (speakCalls === 1) {
                    markFirstSpeakInFlight();
                    return await new Promise<Response>((res) => {
                        resolveFirstSpeak = (response) => {
                            events.push(`speak-done:${payload.text}`);
                            res(response);
                        };
                    });
                }
                events.push(`speak-done:${payload.text}`);
                return new Response(null, { status: 200 });
            }
            return new Response(null, { status: 404 });
        };

        const { effects } = createEffects({
            fetch
        });

        const handling = effects.handleGiftEffects(
            { type: 'platform:gift', platform: 'synthetic-platform', data: { username: 'synthetic-user' } },
            [
                { type: 'primary', text: 'first gift stage', delay: 0 },
                { type: 'message', text: 'second gift stage', delay: 25 }
            ]
        );

        await firstSpeakInFlight;
        await Promise.resolve();
        await Promise.resolve();

        expect(events).toEqual([
            'health:1',
            'speak-start:first gift stage'
        ]);

        resolveFirstSpeak(new Response(null, { status: 200 }));
        await handling;

        expect(events).toEqual([
            'health:1',
            'speak-start:first gift stage',
            'speak-done:first gift stage',
            'speak-start:second gift stage',
            'speak-done:second gift stage'
        ]);
    });

    it('aborts an in-flight /v1/speak signal on cancelActive() or dispose() and prevents subsequent stages from starting', async () => {
        for (const cancelMode of ['cancelActive', 'dispose'] as const) {
            const events: string[] = [];
            let capturedSpeakSignal: AbortSignal | undefined;
            let markSpeakInFlight!: () => void;
            const speakInFlight = new Promise<void>((resolve) => { markSpeakInFlight = resolve; });

            const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
                const url = String(input);
                if (url.endsWith('/health')) {
                    events.push('health');
                    return new Response(null, { status: 200 });
                }
                if (url.endsWith('/v1/speak')) {
                    const payload = JSON.parse(String(init?.body));
                    events.push(`speak:${payload.text}`);
                    capturedSpeakSignal = init?.signal ?? undefined;
                    markSpeakInFlight();
                    return await new Promise<Response>((_resolve, reject) => {
                        if (!init?.signal) {
                            reject(new Error('Expected AbortSignal on /v1/speak'));
                            return;
                        }
                        if (init.signal.aborted) {
                            reject(init.signal.reason ?? new Error('Aborted'));
                            return;
                        }
                        init.signal.addEventListener(
                            'abort',
                            () => reject(init.signal?.reason ?? new Error('Aborted')),
                            { once: true }
                        );
                    });
                }
                return new Response(null, { status: 404 });
            };

            const { effects } = createEffects({
                fetch
            });

            const handling = effects.handleSequentialEffects(
                { type: 'platform:follow', platform: 'synthetic-platform', data: { username: 'synthetic-user' } },
                [
                    { type: 'primary', text: 'stage one', delay: 0 },
                    { type: 'message', text: 'stage two', delay: 0 }
                ]
            );

            await speakInFlight;
            expect(capturedSpeakSignal?.aborted).toBe(false);

            if (cancelMode === 'cancelActive') {
                effects.cancelActive();
            } else {
                await effects.dispose();
            }
            expect(capturedSpeakSignal?.aborted).toBe(true);

            await expect(handling).rejects.toThrow();
            expect(events).toEqual(['health', 'speak:stage one']);
        }
    });
});
