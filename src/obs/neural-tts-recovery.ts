import { safeDelay } from '../utils/timeout-validator';

type SpeechFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type RecoveryOptions = {
    signal?: AbortSignal;
    timeoutMs?: number;
    probeTimeoutMs?: number;
    pollIntervalMs?: number;
    now?: () => number;
    delay?: (ms: number, signal: AbortSignal) => Promise<void>;
};

// Fresh session admission delegates worker ownership/recovery to Neural. This
// never retries speech or kills a service; only this temporary session is released.
export async function recoverNeuralTts(fetch: SpeechFetch, root: string, options: RecoveryOptions = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const probeTimeoutMs = options.probeTimeoutMs ?? 2_000;
    const pollIntervalMs = options.pollIntervalMs ?? 500;
    const now = options.now ?? (() => performance.now());
    const delay = options.delay ?? ((ms, signal) => safeDelay(ms, ms, 'neural-recovery', signal));
    const deadline = now() + timeoutMs;
    const lifetime = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, lifetime]) : lifetime;
    const request = (route: string, body?: object,
        requestSignal = AbortSignal.any([signal, AbortSignal.timeout(probeTimeoutMs)])) => fetch(`${root}${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        signal: requestSignal,
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    });
    signal.throwIfAborted();
    // Once admission starts, retain its bounded receipt even if presentation is
    // cancelled. Only then can we know which session must be released.
    const admission = await request('/v1/synthesis/session', {},
        AbortSignal.any([lifetime, AbortSignal.timeout(probeTimeoutMs)]));
    if (!admission.ok) throw new Error(`Neural TTS recovery unavailable (HTTP ${admission.status})`);
    const body: unknown = await admission.json();
    const session = body && typeof body === 'object' && 'session_id' in body ? body.session_id : undefined;
    if (typeof session !== 'string' || !/^[0-9a-f]{64}$/.test(session)) {
        throw new Error('Neural TTS recovery returned an invalid session');
    }
    try {
        while (now() < deadline) {
            signal.throwIfAborted();
            const health = await request('/health');
            if (health.ok) return;
            if (health.status !== 503) throw new Error(`Neural TTS service is not ready (HTTP ${health.status})`);
            const remaining = deadline - now();
            if (remaining <= 0) break;
            await delay(Math.min(pollIntervalMs, remaining), signal);
        }
        throw new Error('Neural TTS recovery readiness timed out');
    } finally {
        // Cancellation cannot cancel the receipt releasing our own session.
        const release = await request('/v1/synthesis/release', { session_id: session }, AbortSignal.timeout(probeTimeoutMs));
        if (!release.ok) throw new Error(`Neural TTS recovery session release failed (HTTP ${release.status})`);
    }
}
