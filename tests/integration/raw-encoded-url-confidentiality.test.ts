import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RawPlatformDataLoggingService } from '../../src/services/RawPlatformDataLoggingService';
import { createBootstrapEmergencyLogger } from '../../src/core/bootstrap-emergency-logger';
import { sanitizeLogText } from '../../src/core/logger/safe-log-serializer';

test('redacts encoded URL credentials at the actual RAW file sink while preserving ordinary content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-raw-matrix-'));
    const url = 'https://synthetic-user:SYNTHETIC_PASSWORD@example.test/path?%74oken=SYNTHETIC_TOKEN&safe=keep';
    const cases = [
        JSON.stringify({ url }).replaceAll('/', '\\/'),
        JSON.stringify({ url }).replaceAll('https:', 'https\\u003a').replaceAll('/', '\\u002f'),
        JSON.stringify({ url: url.replace('https', 'ht\ttps') }),
        JSON.stringify({ nested: JSON.stringify({ url }) }),
        JSON.stringify({ url: url + ' synthetic suffix' }),
    ];
    const ordinary = JSON.stringify({
        url: 'https://example.test/watch?safe=keep#section=details',
        message: 'synthetic ordinary chat',
    });
    const payload = { cases, plain: url, ordinary };
    const service = new RawPlatformDataLoggingService({ config: { dataLoggingPath: dir } });
    try {
        await service.logRawPlatformData('tiktok', 'synthetic', payload, { dataLoggingEnabled: false });
        await expect(readFile(join(dir, 'tiktok-data-log.ndjson'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        await service.logRawPlatformData('tiktok', 'synthetic', payload, { dataLoggingEnabled: true });
        const data = JSON.parse(await readFile(join(dir, 'tiktok-data-log.ndjson'), 'utf8'));
        for (const captured of data.payload.cases) {
            expect(captured).not.toContain('SYNTHETIC_PASSWORD');
            expect(captured).not.toContain('SYNTHETIC_TOKEN');
            expect(captured).toContain('safe=keep');
        }
        expect(data.payload.plain).not.toContain('SYNTHETIC_PASSWORD');
        expect(data.payload.plain).not.toContain('SYNTHETIC_TOKEN');
        expect(data.payload.plain).toContain('safe=keep');
        for (const input of cases) {
            const general = sanitizeLogText(input);
            expect(general).not.toContain('SYNTHETIC_PASSWORD');
            expect(general).not.toContain('SYNTHETIC_TOKEN');
            expect(general).not.toContain('safe=keep');
        }
        expect(data.payload.ordinary).toBe(ordinary);
    } finally { await rm(dir, { recursive: true, force: true }); }
});


test('whole URL recognition also removes independent assignment and Bearer credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-raw-policies-'));
    const messages = [
        'https://example.test/path password=SYNTHETIC_PASSWORD',
        'https://example.test/path Bearer SYNTHETIC_TOKEN',
        'https://example.test/path?token=SYNTHETIC_URL_TOKEN&safe=keep password=SYNTHETIC_PASSWORD',
        'https://example.test/path?safe=keep\tpassword=SYNTHETIC_PASSWORD',
        'https://example.test/path?safe=keep https://synthetic-user:SYNTHETIC_PASSWORD@example.test/next',
        'https://example.test/path?safe=keep ht\ttps://synthetic-user:SYNTHETIC_PASSWORD@example.test/next',
        'https://example.test/path?safe=keep https://example.test/callback#access_token=SYNTHETIC_TOKEN',
    ];
    const cases = messages.flatMap(message => [message, JSON.stringify({ message }), JSON.stringify(JSON.stringify({ message }))]);
    try {
        const service = new RawPlatformDataLoggingService({ config: { dataLoggingPath: dir } });
        await service.logRawPlatformData('twitch', 'synthetic', { cases }, { dataLoggingEnabled: true });
        const output = await readFile(join(dir, 'twitch-data-log.ndjson'), 'utf8');
        const captured: string[] = JSON.parse(output).payload.cases;
        expect(captured).toHaveLength(cases.length);
        for (const [index, input] of cases.entries()) {
            if (input.includes('safe=keep')) expect(captured[index]).toContain('safe=keep');
        }
        expect(output).not.toContain('SYNTHETIC_');
        expect(output).toContain('safe=keep');
    } finally { await rm(dir, { recursive: true, force: true }); }
});


test('preserves diagnostic separators while recognizing protocol controls across supported schemes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-raw-url-boundaries-'));
    const inputs: string[] = [];
    for (const scheme of ['http', 'https', 'ws', 'wss']) {
        for (const control of ['\t', '\r', '\n']) {
            for (let position = 1; position <= scheme.length + 2; position++) {
                const protocol = `${scheme}://`;
                const controlled = protocol.slice(0, position) + control + protocol.slice(position);
                for (const separator of [' ', '\t', '\r', '\n', '\r\n']) {
                    const message = `https://example.test/path?safe=keep${separator}${controlled}synthetic-user:SYNTHETIC_PASSWORD@example.test/next`;
                    inputs.push(message, JSON.stringify({ message }), JSON.stringify(JSON.stringify({ message })));
                }
            }
        }
    }
    try {
        const service = new RawPlatformDataLoggingService({ config: { dataLoggingPath: dir } });
        for (let index = 0; index < inputs.length; index += 48) {
            await service.logRawPlatformData('twitch', 'synthetic', { cases: inputs.slice(index, index + 48) }, { dataLoggingEnabled: true });
        }
        const entries = (await readFile(join(dir, 'twitch-data-log.ndjson'), 'utf8')).trim().split('\n');
        const captured: string[] = entries.flatMap(entry => JSON.parse(entry).payload.cases);
        expect(captured).toHaveLength(inputs.length);
        for (const value of captured) {
            expect(value).not.toContain('SYNTHETIC_PASSWORD');
            expect(value).toContain('safe=keep');
        }
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test('both real log sinks remove prefixed and control-separated authority credentials', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-shared-log-boundaries-'));
    const stderr: string[] = [];
    const messages: string[] = [];
    for (const control of ['\t', '\r', '\n']) {
        for (const separator of [' ', '\t', '\r', '\n', '\r\n']) {
            for (const authority of [
                `synthetic-user:${control}SYNTHETIC_PASSWORD@example.test`,
                `synthetic-${control}user:SYNTHETIC_PASSWORD@example.test`,
                `synthetic-user:SYNTHETIC_${control}PASSWORD@example.test`,
            ]) {
                for (const prefix of ['failed ', `https://example.test/path?safe=keep${separator}`]) {
                    const message = `${prefix}ht${control}tps://${authority}/next?%74oken=SYNTHETIC_TOKEN&safe=keep`;
                    messages.push(message, JSON.stringify({ message }), JSON.stringify(JSON.stringify({ message })));
                }
            }
        }
    }
    try {
        const raw = new RawPlatformDataLoggingService({ config: { dataLoggingPath: join(dir, 'raw') } });
        const general = createBootstrapEmergencyLogger({ logsDir: join(dir, 'general'), stderr: { write(value) { stderr.push(String(value)); return true; } } });
        for (let index = 0; index < messages.length; index += 48) {
            await raw.logRawPlatformData('twitch', 'synthetic', { cases: messages.slice(index, index + 48) }, { dataLoggingEnabled: true });
        }
        for (const message of messages) general.writeUnhandledRejection(message);
        const rawText = await readFile(join(dir, 'raw/twitch-data-log.ndjson'), 'utf8');
        const captured: string[] = rawText.trim().split('\n').flatMap(entry => JSON.parse(entry).payload.cases);
        expect(captured).toHaveLength(messages.length);
        for (const output of captured) {
            expect(output.replace(/\\[tnr]|[\t\r\n]/g, '')).not.toContain('SYNTHETIC_');
            expect(output).toContain('safe=keep');
        }
        for (const output of [stderr.join(''), await readFile(join(dir, 'general/program-log.txt'), 'utf8')]) {
            expect(output.replace(/\\[tnr]|[\t\r\n]/g, '')).not.toContain('SYNTHETIC_');
            expect(output).not.toContain('safe=keep');
            expect(output).toContain('failed ');
        }
    } finally { await rm(dir, { recursive: true, force: true }); }
});
