import { describe, it, expect } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const fs = load('fs');
const os = load('os');
const path = load('path');
const { ConfigValidator } = load('../../src/utils/config-validator');
const { buildConfig: _buildConfig } = load('../../src/core/config-builders');
const { getRawTestConfig } = load('../helpers/config-fixture');
const { ensureSecrets } = load('../../src/utils/secret-manager.ts');

describe('secret-manager interactive prompt smoke E2E', () => {
    it('prompts and persists secrets for built config when interactive and TTY is available', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-secrets-smoke-'));
        const envFilePath = path.join(tempDir, '.env');

        const originalIsTTY = process.stdin.isTTY;
        const originalCI = process.env.CI;
        const originalNodeEnv = process.env.NODE_ENV;
        const originalEnv = {
            TIKTOK_API_KEY: process.env.TIKTOK_API_KEY
        };

        process.stdin.isTTY = true;
        delete process.env.CI;
        process.env.NODE_ENV = 'test';
        delete process.env.TIKTOK_API_KEY;

        const promptCalls: string[] = [];
        const promptFor = async (secretId) => {
            promptCalls.push(secretId);
            return 'test-tiktok-api-key';
        };

        const logger = {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {}
        };

        try {
            const rawConfig = getRawTestConfig();
            rawConfig.tiktok.enabled = 'true';
            rawConfig.twitch.enabled = 'false';
            rawConfig.obs.enabled = 'false';
            rawConfig.streamelements = { enabled: 'false' };

            const normalized = ConfigValidator.normalize(rawConfig);
            const builtConfig = _buildConfig(normalized);

            const result = await ensureSecrets({
                config: builtConfig,
                logger,
                interactive: true,
                envFilePath,
                envFileReadEnabled: false,
                envFileWriteEnabled: true,
                promptFor
            });

            const envContent = fs.readFileSync(envFilePath, 'utf8');
            expect(envContent).toContain('TIKTOK_API_KEY=test-tiktok-api-key');
            expect(promptCalls).toEqual(['TIKTOK_API_KEY']);
            expect(result.missingRequired).toEqual([]);
        } finally {
            process.stdin.isTTY = originalIsTTY;
            if (originalCI === undefined) {
                delete process.env.CI;
            } else {
                process.env.CI = originalCI;
            }
            if (originalNodeEnv === undefined) {
                delete process.env.NODE_ENV;
            } else {
                process.env.NODE_ENV = originalNodeEnv;
            }
            if (originalEnv.TIKTOK_API_KEY === undefined) {
                delete process.env.TIKTOK_API_KEY;
            } else {
                process.env.TIKTOK_API_KEY = originalEnv.TIKTOK_API_KEY;
            }
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
