const { describe, it, expect } = require('bun:test');
export {};
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const repoRoot = join(__dirname, '..', '..', '..');
const packageJson = require('../../../package.json');

describe('TypeScript toolchain migration gates behavior', () => {
    it('defines repo-wide typecheck script lanes', () => {
        expect(packageJson.scripts['typecheck:src']).toBe('tsc --noEmit -p tsconfig.src.json');
        expect(packageJson.scripts['typecheck:tests']).toBe('tsc --noEmit -p tsconfig.tests.json');
        expect(packageJson.scripts['typecheck:scripts']).toBe('tsc --noEmit -p tsconfig.scripts.json');
        expect(packageJson.scripts['typecheck:tools']).toBe('tsc --noEmit -p tsconfig.tools.json');
        expect(packageJson.scripts['typecheck:all']).toBe('tsc --noEmit -p tsconfig.all.json');
    });

    it('ships the repo-wide TypeScript project files', () => {
        expect(existsSync(join(repoRoot, 'tsconfig.src.json'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tsconfig.tests.json'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tsconfig.scripts.json'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tsconfig.tools.json'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tsconfig.all.json'))).toBe(true);
    });

    it('keeps Bun test preload contracts explicit', () => {
        const bunfig = readFileSync(join(repoRoot, 'bunfig.toml'), 'utf8');

        expect(bunfig).toContain('./tests/setup/bun.prerun.ts');
        expect(bunfig).toContain('./tests/setup/bun.setup.ts');
    });

    it('keeps lint script contracts on TypeScript tooling paths', () => {
        const lintScript = packageJson.scripts.lint;

        expect(lintScript).toContain('bun scripts/lint/no-raw-timeouts.ts');
        expect(lintScript).toContain('bun scripts/lint/no-mock-timers-in-tests.ts');
        expect(lintScript).toContain('bun scripts/lint/no-implementation-test-patterns.ts');
        expect(lintScript).toContain('bun scripts/lint/no-implicit-test-defaults.ts');
        expect(lintScript).toContain('bun scripts/lint/prefer-double-bang.ts');
        expect(lintScript).toContain('bun x eslint');
    });

    it('keeps foundational test helper modules on TypeScript file paths', () => {
        const helperTsPaths = [
            'tests/helpers/config-fixture.ts',
            'tests/helpers/test-clock.ts',
            'tests/helpers/test-id.ts',
            'tests/helpers/time-utils.ts',
            'tests/helpers/mock-validation.ts',
            'tests/helpers/mock-lifecycle.ts',
            'tests/helpers/behavior-validation.ts',
            'tests/helpers/assertion-helpers.ts',
            'tests/helpers/test-setup.ts',
            'tests/helpers/mock-factories.ts',
            'tests/helpers/output-capture.ts',
            'tests/helpers/bun-timers.ts',
            'tests/helpers/bun-mock-utils.ts',
            'tests/helpers/bun-module-mocks.ts',
            'tests/helpers/display-queue-test-factory.ts',
            'tests/helpers/notification-test-utils.ts',
            'tests/helpers/test-logger.ts',
            'tests/helpers/test-database.ts',
            'tests/helpers/event-driven-testing.ts',
            'tests/helpers/e2e-testing-infrastructure.ts',
            'tests/helpers/tiktok-test-data.ts',
            'tests/helpers/twitch-test-data.ts',
            'tests/helpers/youtube-test-data.ts',
            'tests/helpers/platform-test-data.ts',
            'tests/helpers/runtime-test-harness.ts',
            'tests/helpers/farewell-routing-harness.ts'
        ];
        const helperJsPaths = [
            'tests/helpers/config-fixture.js',
            'tests/helpers/test-clock.js',
            'tests/helpers/test-id.js',
            'tests/helpers/time-utils.js',
            'tests/helpers/mock-validation.js',
            'tests/helpers/mock-lifecycle.js',
            'tests/helpers/behavior-validation.js',
            'tests/helpers/assertion-helpers.js',
            'tests/helpers/test-setup.js',
            'tests/helpers/mock-factories.js',
            'tests/helpers/output-capture.js',
            'tests/helpers/bun-timers.js',
            'tests/helpers/bun-mock-utils.js',
            'tests/helpers/bun-module-mocks.js',
            'tests/helpers/display-queue-test-factory.js',
            'tests/helpers/notification-test-utils.js',
            'tests/helpers/test-logger.js',
            'tests/helpers/test-database.js',
            'tests/helpers/event-driven-testing.js',
            'tests/helpers/e2e-testing-infrastructure.js',
            'tests/helpers/tiktok-test-data.js',
            'tests/helpers/twitch-test-data.js',
            'tests/helpers/youtube-test-data.js',
            'tests/helpers/platform-test-data.js',
            'tests/helpers/runtime-test-harness.js',
            'tests/helpers/farewell-routing-harness.js'
        ];

        for (const helperPath of helperTsPaths) {
            expect(existsSync(join(repoRoot, helperPath))).toBe(true);
        }
        for (const helperPath of helperJsPaths) {
            expect(existsSync(join(repoRoot, helperPath))).toBe(false);
        }
    });

    it('keeps mock-factories behavior helper free of broad any casts', () => {
        const content = readFileSync(join(repoRoot, 'tests/helpers/mock-factories.behavior.test.ts'), 'utf8');

        expect(content).not.toContain(' as any');
        expect(content).not.toContain(': any');
    });

    it('keeps helper test specs on TypeScript paths for migrated helper batch', () => {
        const helperTestTsPaths = [
            'tests/helpers/test-clock.test.ts',
            'tests/helpers/test-database.test.ts',
            'tests/helpers/event-driven-testing.test.ts'
        ];
        const helperTestJsPaths = [
            'tests/helpers/test-clock.test.js',
            'tests/helpers/test-database.test.js',
            'tests/helpers/event-driven-testing.test.js'
        ];

        for (const helperPath of helperTestTsPaths) {
            expect(existsSync(join(repoRoot, helperPath))).toBe(true);
        }
        for (const helperPath of helperTestJsPaths) {
            expect(existsSync(join(repoRoot, helperPath))).toBe(false);
        }
    });

    it('keeps env-file-parser unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/env-file-parser.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/env-file-parser.test.js'))).toBe(false);
    });

    it('keeps greeting identity key normalizer unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/greeting-identity-key-normalizer.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/greeting-identity-key-normalizer.test.js'))).toBe(false);
    });

    it('keeps config field presence unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/config-field-presence.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/config-field-presence.test.js'))).toBe(false);
    });

    it('keeps youtube text log adapter unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-text-log-adapter.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-text-log-adapter.test.js'))).toBe(false);
    });

    it('keeps youtube parser log adapter unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-parser-log-adapter.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-parser-log-adapter.test.js'))).toBe(false);
    });

    it('keeps youtube user agent utility unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-user-agent-utility.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-user-agent-utility.test.js'))).toBe(false);
    });

    it('keeps youtube username normalizer unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-username-normalizer.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-username-normalizer.test.js'))).toBe(false);
    });

    it('keeps notification strings formatting unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/notification-strings-formatting.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/notification-strings-formatting.test.js'))).toBe(false);
    });

    it('keeps notification strings resubscription unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/notification-strings-resubscription.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/notification-strings-resubscription.test.js'))).toBe(false);
    });

    it('keeps notification template sanitization unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/notification-template-sanitization.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/notification-template-sanitization.test.js'))).toBe(false);
    });

    it('keeps template interpolation validation unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/template-interpolation-validation.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/template-interpolation-validation.test.js'))).toBe(false);
    });
});
