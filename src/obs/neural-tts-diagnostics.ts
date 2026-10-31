import crypto from 'node:crypto';
import type { AppLogger } from '../core/logger/types';

type SpeechFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const correlationKey = crypto.randomBytes(32);

function readDiagnostics(response: Response): Record<string, string | number> {
    const header = response.headers.get('x-neural-tts-diagnostics');
    if (!header || header.length > 2048) return {};
    try {
        const value: unknown = JSON.parse(header);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        const input = value as Record<string, unknown>;
        const result: Record<string, string | number> = {};
        if (['completed', 'synthesis_failed', 'playback_failed', 'worker_failed'].includes(String(input.stage))) {
            result.stage = String(input.stage);
        }
        if (['prepared', 'synthesized', 'in_flight'].includes(String(input.audioSource))) {
            result.audioSource = String(input.audioSource);
        }
        for (const key of ['samples', 'sampleRateHz', 'channels', 'audioMs', 'peak', 'clippedSamples', 'nonFiniteSamples', 'resolveMs', 'playbackMs']) {
            const number = input[key];
            if (typeof number === 'number' && Number.isFinite(number) && number >= 0) result[key] = number;
        }
        return result;
    } catch {
        return {};
    }
}

// HTTP response metadata stays with its operation ID in the existing rotating log.
// Never retain speech text, arbitrary provider errors, or response bodies here.
export async function requestNeuralTts(
    fetch: SpeechFetch, root: string, operation: 'prepare' | 'speak', text: string,
    voice: string | undefined, logger: AppLogger
): Promise<Response> {
    const metadata = {
        requestId: crypto.randomUUID(), operation, textLength: text.length,
        utteranceId: crypto.createHmac('sha256', correlationKey).update(JSON.stringify([voice, text])).digest('hex').slice(0, 16)
    };
    const started = performance.now();
    logger.info('Neural TTS request started', 'neural-tts', metadata);
    try {
        const response = await fetch(`${root}/v1/${operation}`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
            headers: { 'content-type': 'application/json', 'x-request-id': metadata.requestId },
            body: JSON.stringify({ text, ...(voice ? { voice } : {}) })
        });
        const diagnostics = readDiagnostics(response);
        const hasAnomaly = Number(diagnostics.nonFiniteSamples) > 0 || Number(diagnostics.clippedSamples) > 0;
        const level = !response.ok || hasAnomaly ? 'warn' : 'info';
        logger[level]('Neural TTS request finished', 'neural-tts', {
            ...metadata, elapsedMs: Math.round(performance.now() - started), status: response.status, diagnostics
        });
        return response;
    } catch (error) {
        logger.warn('Neural TTS request failed', 'neural-tts', {
            ...metadata, elapsedMs: Math.round(performance.now() - started),
            failure: error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'transport_or_cancelled'
        });
        throw error;
    }
}
