import { test, expect } from 'bun:test';
import { access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { useFakeTimers, useRealTimers, advanceTimersByTime, getTimerCount } from '../helpers/bun-timers';
import { runYouTubeSdkChild } from './youtube-sdk-child';

// The normal preload replaces youtubei.js. A fresh test process must load the
// installed SDK, not that mock; an empty config disables preloads and the child
// explicitly disables .env loading.
if (process.env.YOUTUBE_SDK_RETIREMENT_CHILD !== '1') {
    test('actual installed YouTube SDK retirement (without global module mocks)', async () => {
        const { stdout, stderr, exit, configDir } = await runYouTubeSdkChild(['test', import.meta.filename]);
        expect({ exit, output: exit ? stdout + stderr : '' }).toEqual({ exit: 0, output: '' });
        expect(stderr).toContain('10 pass');
        await expect(access(configDir)).rejects.toThrow();
    }, 30000);
    test('nonexiting SDK child is killed, reaped, drained and its config removed', async () => {
        const result = await runYouTubeSdkChild(['--eval', "process.on('SIGTERM', () => {}); console.log('TEST_CHILD_READY'); const { setTimeout: delay } = await import('node:timers/promises'); await delay(60000);"], 1000);
        expect(result.stdout).toContain('TEST_CHILD_READY');
        expect(result.exit).not.toBe(0);
        expect(result.signal).toBe('SIGKILL');
        expect(() => process.kill(result.pid, 0)).toThrow();
        await expect(access(result.configDir)).rejects.toThrow();
    }, 5000);
} else {
    const base = new URL('../../node_modules/youtubei.js/dist/src/', import.meta.url);
    await import(new URL('platform/node.js', base).href);
    const { default: LiveChat } = await import(new URL('parser/youtube/LiveChat.js', base).href);
    const { Parser, LiveChatContinuation } = await import(new URL('parser/index.js', base).href);
    const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
    const advance = async (ms: number) => {
        await flush();
        for (let elapsed = 0; elapsed < ms; elapsed += 100) {
            advanceTimersByTime(Math.min(100, ms - elapsed)); await flush();
        }
    };
    const deferred = () => {
        let resolve!: (value: any) => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
        return { promise, resolve, reject };
    };
    const response = () => Parser.parseResponse({ continuationContents: { liveChatContinuation: {
        header: { liveChatHeaderRenderer: {} },
        continuations: [{ timedContinuationData: { continuation: 'TEST_NEXT', timeoutMs: 1000 } }], actions: []
    } } });
    const metadata = () => ({ data: { actions: [{ updateTitleAction: { title: { simpleText: 'TEST_ONLY_TITLE' } } }] } });
    function fixture(execute: (index: number) => any) {
        let calls = 0;
        let metadataCalls = 0;
        const oldMetadata = deferred();
        const events: string[] = [];
        const chat = new LiveChat({ basic_info: { id: 'TEST_VIDEO', channel_id: 'TEST_CHANNEL' },
            livechat: { continuation: 'TEST_INITIAL' }, actions: { execute(endpoint: string) {
                return endpoint === '/updated_metadata' ? (++metadataCalls === 1 ? oldMetadata.promise : deferred().promise) : execute(++calls);
            } } });
        for (const name of ['start', 'chat-update', 'metadata-update', 'error', 'end']) chat.on(name, () => events.push(name));
        return { chat, oldMetadata, events, calls: () => calls };
    }
    test('real timers: retired backoff and late responses stay silent beyond retry delay', async () => {
        const pending = deferred();
        const late = fixture(() => pending.promise);
        const retry = fixture(() => Promise.reject(new Error('TEST_REAL_TIMER_RETRY')));
        try {
            late.chat.start(); retry.chat.start(); await flush();
            late.chat.stop(); retry.chat.stop();
            const before = [late.calls(), late.events.length, retry.calls(), retry.events.length];
            pending.resolve(response()); late.oldMetadata.resolve(metadata());
            await delay(2200);
            expect([late.calls(), late.events.length, retry.calls(), retry.events.length]).toEqual(before);
        } finally { late.chat.stop(); retry.chat.stop(); }
    });
    for (const failure of [false, true]) {
        test(`late chat and metadata ${failure ? 'failure' : 'success'} cannot publish or retry after stop`, async () => {
            useFakeTimers();
            const pending = deferred();
            const s = fixture(() => pending.promise);
            try {
                expect(response().continuation_contents).toBeInstanceOf(LiveChatContinuation);
                s.chat.start(); await flush(); s.chat.stop();
                const before = [s.calls(), s.events.length];
                if (failure) { pending.reject(new Error('TEST_LATE_FAILURE')); s.oldMetadata.reject(new Error('TEST_METADATA_FAILURE')); }
                else { pending.resolve(response()); s.oldMetadata.resolve(metadata()); }
                await advance(15000);
                expect([s.calls(), s.events.length]).toEqual(before);
                expect(getTimerCount()).toBe(0);
            } finally { s.chat.stop(); useRealTimers(); }
        });
    }
    test('old response cannot become the replacement generation', async () => {
        useFakeTimers();
        const old = deferred(), replacement = deferred();
        const s = fixture(i => i === 1 ? old.promise : i === 2 ? replacement.promise : deferred().promise);
        try {
            s.chat.start(); await flush(); s.chat.stop(); s.chat.start(); await flush();
            old.resolve(response()); await advance(7000);
            expect(s.calls()).toBe(2); expect(s.events).toEqual([]);
            replacement.resolve(response()); await flush();
            expect(s.events).toEqual(['start']); expect(s.chat.running).toBe(true);
        } finally { s.chat.stop(); useRealTimers(); }
    });
    for (const kind of ['missing', 'invalid', 'retry'] as const) for (const failure of [false, true]) {
        test(`${kind} terminal retirement precedes one end and permits synchronous restart; old metadata failure=${failure}`, async () => {
            useFakeTimers();
            const next = deferred();
            const terminalCalls = kind === 'retry' ? 11 : 1;
            const s = fixture(i => i > terminalCalls + 1 ? deferred().promise : i > terminalCalls ? next.promise :
                kind === 'retry' ? Promise.reject(new Error('TEST_RETRY')) : Promise.resolve({ continuation_contents: kind === 'missing' ? undefined : {} }));
            let stoppedAtEnd = false;
            s.chat.once('end', () => { stoppedAtEnd = !s.chat.running; s.chat.start(); });
            try {
                s.chat.start(); await advance(kind === 'retry' ? 22000 : 0);
                expect(stoppedAtEnd).toBe(true);
                expect(s.events.filter(e => e === 'end')).toHaveLength(1);
                expect(s.chat.running).toBe(true);
                const before = [s.calls(), s.events.length];
                if (failure) s.oldMetadata.reject(new Error('TEST_OLD_METADATA')); else s.oldMetadata.resolve(metadata());
                await advance(7000);
                expect([s.calls(), s.events.length]).toEqual(before);
                expect(s.chat.metadata).toBeUndefined();
                next.resolve(response()); await flush();
                expect(s.events.filter(e => e === 'start')).toHaveLength(1);
                expect(s.chat.running).toBe(true);
            } finally { s.chat.stop(); useRealTimers(); }
        });
    }
}
