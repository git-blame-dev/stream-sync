import { describe, expect, it } from 'bun:test';
import { recoverNeuralTts } from '../../../src/obs/neural-tts-recovery';

const root = 'http://127.0.0.1:8765';
const session = 'b'.repeat(64);

describe('Neural worker recovery admission', () => {
    it('waits for warmup and releases only its session without invoking speech or shutdown', async () => {
        const routes: string[] = [];
        let clock = 0;
        let probes = 0;
        await recoverNeuralTts(async (input, init) => {
            const route = new URL(String(input)).pathname;
            routes.push(route);
            expect(init?.redirect).toBe('error');
            expect(init?.signal).toBeInstanceOf(AbortSignal);
            if (route.endsWith('/session')) return Response.json({ session_id: session });
            if (route === '/health') return new Response(null, { status: ++probes === 1 ? 503 : 200 });
            expect(JSON.parse(String(init?.body))).toEqual({ session_id: session });
            return Response.json({ released: true });
        }, root, { now: () => clock, delay: async ms => { clock += ms; } });
        expect(routes).toEqual(['/v1/synthesis/session', '/health', '/health', '/v1/synthesis/release']);
    });

    it('bounds unsuccessful readiness and releases its session', async () => {
        const routes: string[] = [];
        let clock = 0;
        await expect(recoverNeuralTts(async input => {
            const route = new URL(String(input)).pathname;
            routes.push(route);
            return route.endsWith('/session') ? Response.json({ session_id: session })
                : new Response(null, { status: route === '/health' ? 503 : 200 });
        }, root, { timeoutMs: 10, now: () => clock, delay: async ms => { clock += ms; } }))
            .rejects.toThrow('readiness timed out');
        expect(routes).toEqual(['/v1/synthesis/session', '/health', '/v1/synthesis/release']);
    });

    it('does not retry rejected admission or accept malformed sessions', async () => {
        for (const response of [new Response(null, { status: 503 }), Response.json({ session_id: 'synthetic-invalid' })]) {
            let calls = 0;
            await expect(recoverNeuralTts(async () => { calls++; return response; }, root)).rejects.toThrow();
            expect(calls).toBe(1);
        }
    });

    it('reports failed release and unexpected health without replaying anything', async () => {
        for (const failure of ['health', 'release']) {
            const routes: string[] = [];
            await expect(recoverNeuralTts(async input => {
                const route = new URL(String(input)).pathname;
                routes.push(route);
                if (route.endsWith('/session')) return Response.json({ session_id: session });
                return new Response(null, { status: route.endsWith('/' + failure) ? 500 : 200 });
            }, root)).rejects.toThrow(failure === 'health' ? 'not ready' : 'release failed');
            expect(routes).toEqual(['/v1/synthesis/session', '/health', '/v1/synthesis/release']);
        }
    });

    it('cancels warmup while retaining a separate deadline for session release', async () => {
        const controller = new AbortController();
        const cancelled = new Error('Synthetic presentation cancellation');
        const routes: string[] = [];
        await expect(recoverNeuralTts(async (input, init) => {
            const route = new URL(String(input)).pathname;
            routes.push(route);
            if (route.endsWith('/session')) return Response.json({ session_id: session });
            if (route === '/health') {
                controller.abort(cancelled);
                return new Response(null, { status: 503 });
            }
            expect(init?.signal?.aborted).toBe(false);
            return new Response(null, { status: 200 });
        }, root, { signal: controller.signal })).rejects.toBe(cancelled);
        expect(routes).toEqual(['/v1/synthesis/session', '/health', '/v1/synthesis/release']);
    });

    it('does not contact a service after cancellation', async () => {
        let calls = 0;
        await expect(recoverNeuralTts(async () => { calls++; return new Response(); }, root,
            { signal: AbortSignal.abort(new Error('Synthetic cancellation')) })).rejects.toThrow('Synthetic cancellation');
        expect(calls).toBe(0);
    });

    for (const cancelAt of ['headers', 'body']) {
        it(`retains the bounded admission receipt when cancelled during ${cancelAt}`, async () => {
            const controller = new AbortController();
            const cancelled = new Error('Synthetic admission cancellation');
            const routes: string[] = [];
            await expect(recoverNeuralTts(async (input, init) => {
                const route = new URL(String(input)).pathname;
                routes.push(route);
                if (route.endsWith('/session')) {
                    if (cancelAt === 'headers') controller.abort(cancelled);
                    expect(init?.signal?.aborted).toBe(false);
                    return new Response(new ReadableStream({
                        pull(stream) {
                            if (cancelAt === 'body') controller.abort(cancelled);
                            init?.signal?.throwIfAborted();
                            stream.enqueue(new TextEncoder().encode(JSON.stringify({ session_id: session })));
                            stream.close();
                        }
                    }));
                }
                expect(JSON.parse(String(init?.body))).toEqual({ session_id: session });
                expect(init?.signal?.aborted).toBe(false);
                return new Response(null, { status: 200 });
            }, root, { signal: controller.signal })).rejects.toBe(cancelled);
            expect(routes).toEqual(['/v1/synthesis/session', '/v1/synthesis/release']);
        });
    }
});
