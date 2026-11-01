import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLogger } from '../../../src/core/logging';
import { handleUserFacingError } from '../../../src/utils/user-friendly-errors';
import { RawEventLogWriter } from '../../../src/services/RawEventLogWriter';
import { RawPlatformDataLoggingService } from '../../../src/services/RawPlatformDataLoggingService';
import { installYouTubeLogAdapter } from '../../../src/utils/youtube-log-adapter';
import { captureStderr, captureStdout } from '../../helpers/output-capture';
import { formatBootstrapErrorDetails } from '../../../src/core/bootstrap-emergency-logger';

describe('logging boundary regressions', () => {
    it('keeps complete quoted URLs and adjacent quoted credential labels safe across sinks', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'synthetic-quoted-boundaries-'));
        const logger = createLogger({ file: { enabled: true, directory: root } }, { operatorCaptureEnabled: true });
        const original = { warn: console.warn, error: console.error, info: console.info, debug: console.debug };
        const urls = ['failed https://example.invalid/?opaque="synthetic-private-query" scope missing',
            "failed https://example.invalid/?opaque='synthetic-private-query' scope missing",
            'failed https://user:"synthetic-private-password"@example.invalid/ scope missing',
            "failed https://user:'synthetic-private-password'@example.invalid/ scope missing",
            'failed https://example.invalid/#opaque="synthetic-private-fragment" scope missing'];
        urls.push('failed https://user:"synthetic-first synthetic-private-password"@example.invalid/ scope missing',
            "failed https://user:'synthetic-first synthetic-private-password'@example.invalid/ scope missing",
            'failed https://example.invalid/?token="synthetic-first synthetic-private-query" scope missing',
            "failed https://example.invalid/?token='synthetic-first synthetic-private-query' scope missing");
        const labels = ['prefix"token":"synthetic-private-token" scope missing',
            '42"token":"synthetic-private-token" scope missing',
            'prefix"private\\u004bey":"synthetic-private-key" scope missing'];
        try {
            installYouTubeLogAdapter({ logger });
            for (const message of [...urls, ...labels]) {
                logger.warn(message, 'synthetic-review');
                console.warn('[YOUTUBEJS][Session]:', message);
                expect(formatBootstrapErrorDetails(message)).not.toContain('synthetic-private');
                const entry = logger.getOperatorLogSource()!.history().entries.at(-1)!;
                expect(entry.message).not.toContain('synthetic-private');
                expect(entry.message).toContain('scope missing');
            }
            const writer = new RawEventLogWriter({ directories: [root] });
            const ordinary = 'https://example.invalid/?note="ordinary test value"&other=1#chapter="ordinary"';
            const result = await writer.writeRawEvent({ dataLoggingPath: root, platform: 'twitch', eventType: 'chat',
                payload: { messages: [...urls.filter(url => url.includes('@')), ...labels,
                    'https://example.invalid/?token="synthetic-private-query"'], ordinary } });
            await logger.flush();
            expect(await readFile(path.join(root, 'runtime.log'), 'utf8')).not.toContain('synthetic-private');
            const raw = await readFile(result.filePath, 'utf8');
            expect(raw).not.toContain('synthetic-private');
            expect(JSON.parse(raw).payload.ordinary).toBe(ordinary);
        } finally { Object.assign(console, original); await logger.flush(); await rm(root, { recursive: true, force: true }); }
    });

    it('redacts encoded Bearer schemes at operational and raw sinks', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'synthetic-encoded-schemes-'));
        const logger = createLogger({ file: { enabled: true, directory: root } }, { operatorCaptureEnabled: true });
        const messages = [String.raw`before "Bearer\u0020synthetic-private-token" after`,
            JSON.stringify('Bearer\tsynthetic-private-token'),
            String.raw`before "B\u0065arer\u0020synthetic-private-token" after`,
            JSON.stringify(JSON.stringify('Bearer\nsynthetic-private-token')),
            JSON.stringify('Bearer "synthetic-private-first synthetic-private-second"'),
            JSON.stringify('Authorization: Bearer "synthetic-private-first synthetic-private-second"'),
            JSON.stringify('Authorization: Basic "synthetic-private-first synthetic-private-second"'),
            'https://example.invalid/?note=Bearer synthetic-private-token'];
        try {
            for (const message of messages) {
                logger.warn(message, 'synthetic-review');
                const entry = logger.getOperatorLogSource()!.history().entries.at(-1)!;
                expect(entry.message).not.toContain('synthetic-private');
                if (message.startsWith('before')) expect(entry.message).toEndWith(' after');
            }
            const writer = new RawEventLogWriter({ directories: [root] });
            const result = await writer.writeRawEvent({ dataLoggingPath: root, platform: 'twitch', eventType: 'chat', payload: { messages } });
            await logger.flush();
            for (const file of ['runtime.log', result.fileName]) {
                expect(await readFile(path.join(root, file), 'utf8')).not.toContain('synthetic-private');
            }
        } finally { await logger.flush(); await rm(root, { recursive: true, force: true }); }
    });

    it('redacts encoded credential objects from standalone and embedded text at both real sinks', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'synthetic-encoded-logging-'));
        const logger = createLogger({ file: { enabled: true, directory: root } }, { operatorCaptureEnabled: true });
        try {
            let encoded = JSON.stringify({ token: 'synthetic-private-token', sessionId: 'synthetic-private-session',
                privateKey: 'synthetic-private-key', client_secret: 'synthetic-private-client', apiKey: 123456789,
                credentials: { username: 'synthetic-private-user', nested: ['synthetic-private-value'] }, diagnostic: 'scope missing' })
                .replace('"privateKey"', '"private\\u004bey"');
            for (let depth = 0; depth < 4; depth++) {
                for (const message of [encoded, `before ${encoded} after`]) {
                    logger.warn(message, 'synthetic-review');
                    const entry = logger.getOperatorLogSource()!.history().entries.at(-1)!;
                    expect(entry.message).not.toContain('synthetic-private');
                    expect(entry.message).not.toContain('123456789');
                    expect(entry.message).toContain('scope missing');
                    if (message.startsWith('before')) {
                        expect(entry.message).toStartWith('before ');
                        expect(entry.message).toEndWith(' after');
                    }
                }
                encoded = JSON.stringify(encoded);
            }
            await logger.flush();
            const file = await readFile(path.join(root, 'runtime.log'), 'utf8');
            expect(file).not.toContain('synthetic-private');
            expect(file.match(/scope missing/g)).toHaveLength(8);
        } finally { await logger.flush(); await rm(root, { recursive: true, force: true }); }
    });

    it('applies the same credential key policy to operational and raw records', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'synthetic-logging-policy-'));
        const credentials = Object.fromEntries(['id_token', 'authToken', 'set-cookie', 'proxy-authorization',
            'session_token', 'privateKey', 'signature', 'credentials'].map(key => [key, 'synthetic-private-value']));
        const logger = createLogger({}, { operatorCaptureEnabled: true });
        try {
            logger.info('Synthetic diagnostics', 'fixture', credentials);
            const writer = new RawEventLogWriter({ directories: [root] });
            const result = await writer.writeRawEvent({ dataLoggingPath: root, platform: 'twitch', eventType: 'chat', payload: credentials });
            const raw = JSON.parse(await readFile(result.filePath, 'utf8'));
            const operational = logger.getOperatorLogSource()!.history().entries[0]!.data;
            expect(operational).toEqual(Object.fromEntries(Object.keys(credentials).map(key => [key, '[REDACTED]'])));
            expect(raw.payload).toEqual(operational);
        } finally { await rm(root, { recursive: true, force: true }); }
    });

    it.each(['token=synthetic-private-value', 'sessionId=synthetic-private-value',
        'private_key="synthetic private value"', 'Authorization: synthetic-private-value',
        'signature=synthetic-private-value', 'session_token=synthetic-private-value',
        'note="token=synthetic-nested-secret"', '{"note":"sessionId=synthetic-nested-secret"}',
        'private_key="synthetic-unterminated secret', '"token=synthetic-quoted-secret"',
        '"token\\u003dsynthetic-encoded-secret"', '--token=synthetic-private-value'])(
        'redacts credential assignments from message text: %s', message => {
            const logger = createLogger({}, { operatorCaptureEnabled: true });
            logger.warn(message, 'fixture');
            expect(logger.getOperatorLogSource()!.history().entries[0]!.message).not.toContain('synthetic');
        });

    it.each([true, false])('emits one user-facing record and honors logTechnical=%s', logTechnical => {
        const logger = createLogger({}, { operatorCaptureEnabled: true });
        handleUserFacingError(new Error('Synthetic unexpected failure'), { logger }, { logTechnical });
        expect(logger.getOperatorLogSource()!.history().entries.map(entry => entry.level))
            .toEqual(logTechnical ? ['console', 'error'] : ['console']);
    });

    it('routes non-Text YouTube diagnostics through logger capture instead of native console', async () => {
        const logger = createLogger({}, { operatorCaptureEnabled: true });
        const original = { warn: console.warn, error: console.error, info: console.info, debug: console.debug };
        const calls: unknown[][] = [];
        console.warn = (...args) => { calls.push(args); };
        try {
            installYouTubeLogAdapter({ logger });
            const { Log } = await import('youtubei.js');
            Log.warn('Session', 'Synthetic session warning token=synthetic-private-value', { payload: 'synthetic-private-payload' });
            expect(calls).toEqual([]);
            const entries = logger.getOperatorLogSource()!.history().entries;
            expect(entries).toHaveLength(1);
            expect(entries[0]!.source).toBe('youtube-sdk');
            expect(JSON.stringify(entries)).not.toContain('synthetic-private');
        } finally { Object.assign(console, original); }
    });

    it('attributes a failed raw capture without retaining filesystem paths or payloads', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'synthetic-capture-failure-'));
        const logger = createLogger({}, { operatorCaptureEnabled: true });
        const stderr = captureStderr();
        const stdout = captureStdout();
        try {
            const blocked = path.join(root, 'synthetic-private-path');
            await writeFile(blocked, 'synthetic obstruction');
            const service = new RawPlatformDataLoggingService({ logger, config: { dataLoggingPath: blocked } });
            await service.logRawPlatformData('twitch', 'chat', { content: 'synthetic-private-content' }, { dataLoggingEnabled: true });
            const entries = logger.getOperatorLogSource()!.history().entries;
            expect(entries).toHaveLength(1);
            expect(entries[0]!.data).toMatchObject({ platform: 'twitch', eventType: 'chat', failure: 'filesystem' });
            expect(JSON.stringify(entries)).not.toContain('synthetic-private');
        } finally { stdout.restore(); stderr.restore(); await rm(root, { recursive: true, force: true }); }
    });
});
