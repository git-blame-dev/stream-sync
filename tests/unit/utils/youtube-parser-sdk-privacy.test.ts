import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';

it('projects provider-controlled installed SDK parser keys safely into logger and collector', () => {
    const adapter = new URL('../../../src/utils/youtube-parser-log-adapter.ts', import.meta.url).href;
    // The SDK has a global handler with no getter. A child keeps its installation
    // and runtime-generated classes out of other tests and the adapter WeakSet.
    const script = `
        import assert from 'node:assert/strict';
        import { Parser } from 'youtubei.js';
        import { installYouTubeParserLogAdapter, collectParserWarningsDuring } from ${JSON.stringify(adapter)};
        const calls = [];
        const logger = { warn: (...args) => calls.push(args), error: () => { throw new Error('unexpected adapter failure'); } };
        assert.equal(installYouTubeParserLogAdapter({ logger, youtubeModule: { Parser } }).installed, true);
        const { warnings } = collectParserWarningsDuring(() => {
            for (const key of [
                'synthetic-person@example.invalid',
                'https://synthetic-parser.invalid/private-location?test=query',
                'syntheticSafePrivacyRenderer',
            ]) Parser.parseItem({ [key]: {} });
        });
        assert.equal(warnings.length, 3);
        assert.deepEqual(calls.map(call => call[2]), warnings);
        for (const output of [JSON.stringify(calls), JSON.stringify(warnings)]) {
            assert.doesNotMatch(output, /synthetic-person|example\\.invalid|synthetic-parser\\.invalid|private-location/i);
            assert.match(output, /SyntheticSafePrivacy/);
            assert.match(output, /class_not_found/);
        }
        for (const warning of warnings) {
            for (const value of Object.values(warning)) assert.ok(value.length <= 256);
        }
    `;
    const child = spawnSync(process.execPath, ['--no-env-file', '--eval', script], {
        env: { PATH: process.env.PATH, NODE_ENV: 'test', CHAT_BOT_CONFIG_PATH: process.env.CHAT_BOT_CONFIG_PATH },
        encoding: 'utf8', timeout: 10000,
    });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
});
