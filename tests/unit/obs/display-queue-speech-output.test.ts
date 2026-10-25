import { describe, expect, it } from 'bun:test';
import { DisplayQueueEffects } from '../../../src/obs/display-queue-effects.ts';

function createEffects(options: {
    ttsMethod?: 'obs-text' | 'neural-tts';
    neuralTtsEndpoint?: string;
    neuralTtsVoice?: string;
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
    const textUpdates: string[] = [];
    const clearedSources: string[] = [];
    const effects = new DisplayQueueEffects({
        config: {
            obs: {
                ttsTxt: 'test-tts-source',
                ...(options.ttsMethod ? { ttsMethod: options.ttsMethod } : {}),
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
    it('keeps OBS text output as the default', async () => {
        const { effects, textUpdates, clearedSources } = createEffects({});

        await effects.setTTSText('synthetic speech');

        expect(clearedSources).toEqual(['test-tts-source']);
        expect(textUpdates).toEqual(['synthetic speech']);
    });

    it('checks readiness and posts neural speech with the configured voice', async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ url: String(input), ...(init ? { init } : {}) });
            return new Response(null, { status: 200 });
        };
        const { effects, textUpdates } = createEffects({
            ttsMethod: 'neural-tts',
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

    it('fails explicitly when the service is not ready and does not fall back', async () => {
        const requests: string[] = [];
        const fetch = async (input: RequestInfo | URL) => {
            requests.push(String(input));
            return new Response(null, { status: 503 });
        };
        const { effects, textUpdates, clearedSources } = createEffects({ ttsMethod: 'neural-tts', fetch });

        await expect(effects.setTTSText('fixture')).rejects.toThrow('not ready (HTTP 503)');

        expect(requests).toEqual(['http://127.0.0.1:8765/health']);
        expect(clearedSources).toEqual([]);
        expect(textUpdates).toEqual([]);
    });

    it('rejects non-loopback endpoints before making an HTTP request', async () => {
        let requestCount = 0;
        const fetch = async () => {
            requestCount += 1;
            return new Response(null, { status: 200 });
        };
        const { effects } = createEffects({ ttsMethod: 'neural-tts', neuralTtsEndpoint: 'http://example.test:8765', fetch });

        await expect(effects.setTTSText('fixture')).rejects.toThrow('must use HTTP on loopback');
        expect(requestCount).toBe(0);
    });

    it('disallows redirects and bounds health and speak requests', async () => {
        const requests: Array<{ url: string; init?: RequestInit }> = [];
        const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ url: String(input), ...(init ? { init } : {}) });
            return new Response(null, { status: 200 });
        };
        const { effects } = createEffects({ ttsMethod: 'neural-tts', fetch });

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
        const { effects, textUpdates } = createEffects({ ttsMethod: 'neural-tts', fetch });

        await expect(effects.setTTSText('synthetic speech')).rejects.toThrow('health request timed out');
        expect(textUpdates).toEqual([]);
    });

    it('speaks sequential notification stages in their existing queue order', async () => {
        const spoken: string[] = [];
        let responseCount = 0;
        const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'POST') {
                spoken.push(JSON.parse(String(init.body)).text);
            }
            responseCount += 1;
            return new Response(null, { status: 200 });
        };
        const { effects } = createEffects({ ttsMethod: 'neural-tts', fetch });

        await effects.handleSequentialEffects(
            { type: 'platform:follow', platform: 'test-platform', data: { username: 'test-user' } },
            [
                { type: 'primary', text: 'stage one', delay: 0 },
                { type: 'message', text: 'stage two', delay: 0 }
            ]
        );

        expect(spoken).toEqual(['stage one', 'stage two']);
        expect(responseCount).toBe(4);
    });

    it('does not advance to another neural stage if a speak request fails', async () => {
        const spoken: string[] = [];
        const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'POST') {
                spoken.push(JSON.parse(String(init.body)).text);
                return new Response(null, { status: 500 });
            }
            return new Response(null, { status: 200 });
        };
        const { effects } = createEffects({ ttsMethod: 'neural-tts', fetch });

        await expect(effects.handleSequentialEffects(
            { type: 'platform:follow', platform: 'test-platform', data: { username: 'test-user' } },
            [
                { type: 'primary', text: 'stage one', delay: 0 },
                { type: 'message', text: 'stage two', delay: 0 }
            ]
        )).rejects.toThrow('Neural TTS request failed (HTTP 500)');

        expect(spoken).toEqual(['stage one']);
    });

    it('preserves concurrent OBS-text gift stages while the first source update waits', async () => {
        const { effects } = createEffects({ ttsMethod: 'obs-text' });
        let clearCalls = 0;
        let releaseFirst!: () => void;
        const firstClear = new Promise<void>((resolve) => { releaseFirst = resolve; });
        effects.sourcesManager.clearTextSource = async () => {
            clearCalls += 1;
            if (clearCalls === 1) await firstClear;
        };

        const handling = effects.handleGiftEffects(
            { type: 'platform:gift', platform: 'synthetic-platform', data: { username: 'synthetic-user' } },
            [
                { type: 'primary', text: 'first synthetic stage', delay: 0 },
                { type: 'message', text: 'second synthetic stage', delay: 0 }
            ]
        );

        try {
            await Promise.resolve();
            expect(clearCalls).toBe(2);
        } finally {
            releaseFirst();
            await handling;
        }
    });
});
