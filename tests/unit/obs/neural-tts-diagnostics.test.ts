import { describe, expect, it } from 'bun:test';
import { requestNeuralTts } from '../../../src/obs/neural-tts-diagnostics';
import { createRecordingLogger } from '../../helpers/recording-logger';

describe('neural TTS diagnostics', () => {
    it('correlates requests and records only allowed audio metadata', async () => {
        const logger = createRecordingLogger();
        const response = new Response(null, { headers: {
            'x-neural-tts-diagnostics': JSON.stringify({
                stage: 'completed', audioSource: 'prepared', samples: 48000,
                sampleRateHz: 48000, channels: 1, audioMs: 1000,
                peak: 0.5, clippedSamples: 0, nonFiniteSamples: 0,
                resolveMs: 0, playbackMs: 1001, text: 'synthetic private response'
            })
        } });
        await requestNeuralTts(async (_url, init) => {
            expect(new Headers(init?.headers).get('x-request-id')).toBeTruthy();
            expect(JSON.parse(String(init?.body)).text).toBe('synthetic private input');
            return response;
        }, 'http://127.0.0.1:8765', 'speak', 'synthetic private input', 'synthetic-voice', logger);
        expect(logger.entries).toHaveLength(2);
        const start = logger.entries[0]?.data as Record<string, unknown>;
        const end = logger.entries[1]?.data as Record<string, unknown>;
        expect(end.requestId).toBe(start.requestId);
        expect(end.status).toBe(200);
        expect(end.diagnostics).toEqual({
            stage: 'completed', audioSource: 'prepared', samples: 48000,
            sampleRateHz: 48000, channels: 1, audioMs: 1000, peak: 0.5,
            clippedSamples: 0, nonFiniteSamples: 0, resolveMs: 0, playbackMs: 1001
        });
        expect(JSON.stringify(logger.entries)).not.toContain('synthetic private');
    });

    it('records request failure without leaking exception content and rethrows it', async () => {
        const logger = createRecordingLogger();
        const failure = new Error('synthetic private failure detail');
        await expect(requestNeuralTts(async () => { throw failure; },
            'http://127.0.0.1:8765', 'prepare', 'synthetic input', undefined, logger)).rejects.toBe(failure);
        expect(logger.entries.at(-1)?.level).toBe('warn');
        expect(JSON.stringify(logger.entries)).not.toContain(failure.message);
    });

    it('logs HTTP failure and ignores malformed or oversized metadata', async () => {
        for (const header of ['{invalid', 'x'.repeat(2049), '{"stage":"synthetic injected content","samples":-1}']) {
            const logger = createRecordingLogger();
            const result = await requestNeuralTts(async () => new Response(null, {
                status: 502, headers: { 'x-neural-tts-diagnostics': header }
            }), 'http://127.0.0.1:8765', 'speak', 'synthetic input', undefined, logger);
            expect(result.status).toBe(502);
            expect(logger.entries.at(-1)?.level).toBe('warn');
            expect(JSON.stringify(logger.entries)).not.toContain('synthetic injected content');
        }
    });

    it('warns on detected PCM anomalies even when playback succeeds', async () => {
        const logger = createRecordingLogger();
        await requestNeuralTts(async () => new Response(null, { headers: {
            'x-neural-tts-diagnostics': '{"stage":"completed","nonFiniteSamples":1}'
        } }), 'http://127.0.0.1:8765', 'speak', 'synthetic input', undefined, logger);
        expect(logger.entries.at(-1)?.level).toBe('warn');
    });

    it('links prepare and speak for the same text and voice without retaining either', async () => {
        const logger = createRecordingLogger();
        const fetch = async () => new Response(null);
        await requestNeuralTts(fetch, 'http://127.0.0.1:8765', 'prepare', 'synthetic content', 'synthetic voice', logger);
        await requestNeuralTts(fetch, 'http://127.0.0.1:8765', 'speak', 'synthetic content', 'synthetic voice', logger);
        await requestNeuralTts(fetch, 'http://127.0.0.1:8765', 'speak', 'synthetic content', 'synthetic other voice', logger);
        const starts = logger.entries.filter(entry => entry.message.endsWith('started')).map(entry => entry.data as Record<string, unknown>);
        expect(starts[0]?.utteranceId).toBe(starts[1]?.utteranceId);
        expect(starts[0]?.requestId).not.toBe(starts[1]?.requestId);
        expect(starts[0]?.utteranceId).not.toBe(starts[2]?.utteranceId);
        expect(JSON.stringify(logger.entries)).not.toContain('synthetic content');
        expect(JSON.stringify(logger.entries)).not.toContain('synthetic voice');
    });
});
