import { expect, it } from 'bun:test';

it('keeps long hyphenated diagnostics bounded through the serializer, logger, and SDK adapter', () => {
    const loggerModule = import.meta.resolve('../../../src/core/logging.ts');
    const serializerModule = import.meta.resolve('../../../src/core/logger/safe-log-serializer.ts');
    const adapterModule = import.meta.resolve('../../../src/utils/youtube-log-adapter.ts');
    const script = `
        import { createLogger } from ${JSON.stringify(loggerModule)};
        import { sanitizeLogText } from ${JSON.stringify(serializerModule)};
        import { installYouTubeLogAdapter } from ${JSON.stringify(adapterModule)};
        const logger = createLogger({}, { operatorCaptureEnabled: true });
        installYouTubeLogAdapter({ logger });
        for (const size of [10000, 20000, 40000]) {
            const message = 'a-'.repeat(size) + '! token=synthetic-private-token';
            const safe = sanitizeLogText(message);
            if (safe.includes('synthetic-private') || !safe.endsWith('token=[REDACTED]')) throw new Error('Synthetic redaction failed');
            logger.warn(message, 'synthetic-scaling');
            console.warn('[YOUTUBEJS][Session]:', message);
        }
        for (const size of [1000, 2000, 4000]) {
            // An opening quote, escaped quotes, and no closing quote.
            const message = String.fromCharCode(34) + String.fromCharCode(92, 34).repeat(size) + '! token=synthetic-private-token';
            const safe = sanitizeLogText(message);
            if (safe.includes('synthetic-private') || !safe.includes('omitted')) throw new Error('Synthetic malformed span was retained');
            logger.warn(message, 'synthetic-scaling');
            console.warn('[YOUTUBEJS][Session]:', message);
        }
        const entries = logger.getOperatorLogSource().history().entries;
        if (entries.length !== 12 || entries.some(entry => entry.message.includes('synthetic-private'))) throw new Error('Synthetic capture failed');
        process.stdout.write('synthetic-scan-ok');
    `;
    const child = Bun.spawnSync([process.execPath, '--no-env-file', '--eval', script], {
        env: { NODE_ENV: 'test' }, stdout: 'pipe', stderr: 'pipe', timeout: 2000,
    });
    expect(child.exitCode).toBe(0);
    expect(child.stderr.toString()).toBe('');
    expect(child.stdout.toString()).toBe('synthetic-scan-ok');
});
