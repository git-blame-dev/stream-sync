import { describe, expect, test } from 'bun:test';
import { TikTokTransportDiagnostics } from '../../../src/platforms/tiktok/transport-diagnostics';

function setup() {
    let elapsed = 0;
    const entries: { level: string; message: unknown; source: string | undefined; data: unknown }[] = [];
    const diagnostics = new TikTokTransportDiagnostics({
        debug: (message, source, data) => { entries.push({ level: 'debug', message, source, data }); },
        warn: (message, source, data) => { entries.push({ level: 'warn', message, source, data }); },
    }, () => elapsed);
    return { diagnostics, entries, advance: (ms: number) => { elapsed += ms; } };
}

describe('TikTok transport diagnostics', () => {
    test('counts decoding outcomes without retaining provider text or objects', () => {
        const { diagnostics, entries } = setup();
        diagnostics.record([
            { method: 'WebcastChatMessage', decodedData: { content: 'synthetic private chat' } },
            { method: 'WebcastEmoteChatMessage', decodedData: { user: 'synthetic private viewer' } },
            { method: 'WebcastChatMessage', decodeError: new Error('synthetic private error') },
            { method: 'WebcastEmoteChatMessage', decodeError: 'synthetic private error' },
            { method: 'synthetic-private-unknown-method' },
        ]);
        diagnostics.close();
        expect(entries).toHaveLength(2);
        expect(entries[0]?.level).toBe('warn');
        expect(entries[1]?.data).toEqual({ stage: 'closed', elapsedMs: 0, batches: 1, messages: 5,
            decodedMessages: 2, chatMessages: 2, emoteMessages: 2, decodeFailures: 2,
            chatDecodeFailures: 1, emoteDecodeFailures: 1, undecodedWithoutError: 1 });
        expect(JSON.stringify(entries)).not.toContain('private');
    });

    test('bounds reports during bursts and preserves cumulative totals', () => {
        const { diagnostics, entries, advance } = setup();
        const malformed = [{ method: 'WebcastChatMessage', decodeError: new Error('synthetic failure') }];
        for (let index = 0; index < 1000; index++) diagnostics.record(malformed);
        expect(entries).toHaveLength(1);
        advance(59_999); diagnostics.record(malformed);
        expect(entries).toHaveLength(1);
        advance(1); diagnostics.record(malformed);
        expect(entries).toHaveLength(2);
        expect(entries[1]?.data).toMatchObject({ decodeFailures: 1002, elapsedMs: 60_000 });
        diagnostics.close();
        expect(entries).toHaveLength(3);
    });

    test('healthy batches report periodically and snapshots do not change later', () => {
        const { diagnostics, entries, advance } = setup();
        const healthy = [{ method: 'WebcastRoomUserSeqMessage', decodedData: {} }];
        diagnostics.record(healthy); expect(entries).toHaveLength(0);
        advance(60_000); diagnostics.record(healthy);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ level: 'debug', data: { stage: 'periodic', messages: 2 } });
        diagnostics.record(healthy); diagnostics.close();
        expect(entries[0]?.data).toMatchObject({ messages: 2 });
        expect(entries[1]?.data).toMatchObject({ stage: 'closed', messages: 3 });
    });

    test('retirement reports zero traffic once and ignores subsequent batches', () => {
        const { diagnostics, entries } = setup();
        diagnostics.close(); diagnostics.close();
        diagnostics.record([{ method: 'WebcastChatMessage', decodeError: new Error('synthetic late') }]);
        expect(entries).toHaveLength(1);
        expect(entries[0]?.data).toMatchObject({ stage: 'closed', messages: 0, batches: 0 });
    });

    test('a failing logger cannot interrupt processing or close', () => {
        const fail = () => { throw new Error('synthetic sink failure'); };
        const diagnostics = new TikTokTransportDiagnostics({ debug: fail, warn: fail }, () => 0);
        expect(() => diagnostics.record([{ method: 'WebcastChatMessage', decodeError: true }])).not.toThrow();
        expect(() => diagnostics.close()).not.toThrow();
    });
});
