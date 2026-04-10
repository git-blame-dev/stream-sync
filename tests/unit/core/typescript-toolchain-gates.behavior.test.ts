import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const repoRoot = join(__dirname, '..', '..', '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
};

const EXECUTABLE_TS_ROOTS = ['scripts/lint', 'tools'];
const EXCLUDED_SCAN_DIRECTORIES = new Set([
    'node_modules',
    '.git',
    'coverage',
    'dist',
    'tasks'
]);

function collectExecutableTypeScriptFiles(directoryPath: string, output: string[] = []) {
    const entries = readdirSync(directoryPath, { withFileTypes: true });

    for (const entry of entries) {
        if (EXCLUDED_SCAN_DIRECTORIES.has(entry.name)) {
            continue;
        }

        const fullPath = join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            collectExecutableTypeScriptFiles(fullPath, output);
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        const isExecutableTypeScript = (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) && !entry.name.endsWith('.d.ts');
        if (isExecutableTypeScript) {
            output.push(fullPath);
        }
    }

    return output;
}

function findCommonJsModuleSyntax(content: string) {
    const lines = content.split(/\r?\n/);
    const syntaxPatterns = [
        /^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/,
        /^\s*\(\s*\{.+?\}\s*=\s*require\s*\(/,
        /^\s*module\.exports\b/,
        /^\s*exports\./
    ];

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (syntaxPatterns.some(pattern => pattern.test(line))) {
            return index + 1;
        }
    }

    return null;
}

describe('TypeScript toolchain migration gates behavior', () => {
    it('keeps this toolchain gates module free of top-level commonjs declarations', () => {
        const content = readFileSync(__filename, 'utf8');

        expect(findCommonJsModuleSyntax(content)).toBeNull();
        expect(content).not.toMatch(/^\s*export\s*\{\};\s*$/m);
    });

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

    it('keeps superchat notification format unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/superchat-notification-format.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/superchat-notification-format.test.js'))).toBe(false);
    });

    it('keeps timeout nan fix unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/timeout-nan-fix.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/timeout-nan-fix.test.js'))).toBe(false);
    });

    it('keeps sanitize for obs unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/sanitize-for-obs.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/sanitize-for-obs.test.js'))).toBe(false);
    });

    it('keeps platform timestamp unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/platform-timestamp.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/platform-timestamp.test.js'))).toBe(false);
    });

    it('keeps tiktok gift count normalization unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/tiktok-gift-count-field-normalization.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/tiktok-gift-count-field-normalization.test.js'))).toBe(false);
    });

    it('keeps tiktok data extraction unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/tiktok-data-extraction.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/tiktok-data-extraction.test.js'))).toBe(false);
    });

    it('keeps tiktok webcast gift extraction unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/tiktok-data-extraction-webcast-gift.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/tiktok-data-extraction-webcast-gift.test.js'))).toBe(false);
    });

    it('keeps tiktok unknown user structure unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/tiktok-unknown-user-data-structure-mismatch.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/tiktok-unknown-user-data-structure-mismatch.test.js'))).toBe(false);
    });

    it('keeps tiktok data extraction behavior test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/tiktok-data-extraction.behavior.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/tiktok-data-extraction.behavior.test.js'))).toBe(false);
    });

    it('keeps youtube currency parsing modern unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-currency-parsing-modern.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-currency-parsing-modern.test.js'))).toBe(false);
    });

    it('keeps youtube author extraction modern unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-author-extraction-modern.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-author-extraction-modern.test.js'))).toBe(false);
    });

    it('keeps youtube message extraction modern unit test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-message-extraction-modern.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-message-extraction-modern.test.js'))).toBe(false);
    });

    it('keeps youtubei currency parser behavior test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtubei-currency-parser.behavior.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtubei-currency-parser.behavior.test.js'))).toBe(false);
    });

    it('keeps youtube turkish lira parsing fix test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-turkish-lira-parsing-fix.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-turkish-lira-parsing-fix.test.js'))).toBe(false);
    });

    it('keeps youtube connection management test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-connection-management.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-connection-management.test.js'))).toBe(false);
    });

    it('keeps youtube connection manager test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-connection-manager.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-connection-manager.test.js'))).toBe(false);
    });

    it('keeps youtube connection manager missing methods test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-connection-manager-missing-methods.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/utils/youtube-connection-manager-missing-methods.test.js'))).toBe(false);
    });

    it('keeps youtube viewer count behavior test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/youtube-viewer-count-behavior.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/youtube-viewer-count-behavior.test.js'))).toBe(false);
    });

    it('keeps notification duration removal behavior test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-duration-removal.behavior.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-duration-removal.behavior.test.js'))).toBe(false);
    });

    it('keeps notification input validator test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-input-validator.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-input-validator.test.js'))).toBe(false);
    });

    it('keeps notification payload builder test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-payload-builder.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-payload-builder.test.js'))).toBe(false);
    });

    it('keeps notification gate test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-gate.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-gate.test.js'))).toBe(false);
    });

    it('keeps notification type normalization test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-type-normalization.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-type-normalization.test.js'))).toBe(false);
    });

    it('keeps notification manager input validation test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-input-validation.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-input-validation.test.js'))).toBe(false);
    });

    it('keeps notification manager logger args test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-logger-args.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-logger-args.test.js'))).toBe(false);
    });

    it('keeps notification manager app dependency test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-app-dependency.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-app-dependency.test.js'))).toBe(false);
    });

    it('keeps notification manager behavior test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager.behavior.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager.behavior.test.js'))).toBe(false);
    });

    it('keeps notification manager follow raid share behavior test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-follow-raid-share-behavior.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-follow-raid-share-behavior.test.js'))).toBe(false);
    });

    it('keeps notification manager youtube monetisation behavior test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-youtube-monetisation.behavior.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-youtube-monetisation.behavior.test.js'))).toBe(false);
    });

    it('keeps notification manager twitch monetisation behavior test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-twitch-monetisation.behavior.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-twitch-monetisation.behavior.test.js'))).toBe(false);
    });

    it('keeps notification manager tiktok monetisation behavior test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-tiktok-monetisation.behavior.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-tiktok-monetisation.behavior.test.js'))).toBe(false);
    });

    it('keeps notification manager paypiggy normalization test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-paypiggy-normalization.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-paypiggy-normalization.test.js'))).toBe(false);
    });

    it('keeps notification manager spam config access test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-spam-config-access.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-spam-config-access.test.js'))).toBe(false);
    });

    it('keeps notification manager raid viewer count test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-raid-viewer-count.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-raid-viewer-count.test.js'))).toBe(false);
    });

    it('keeps notification manager coverage test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-coverage.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-coverage.test.js'))).toBe(false);
    });

    it('keeps notification manager error path test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-error-path.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-error-path.test.js'))).toBe(false);
    });

    it('keeps notification manager error handler test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-error-handler.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/notification-manager-error-handler.test.js'))).toBe(false);
    });

    it('keeps aggregated donation transformer test on TypeScript path', () => {
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/aggregated-donation-transformer.test.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'tests/unit/notifications/aggregated-donation-transformer.test.js'))).toBe(false);
    });

    it('keeps notifications cohort a tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/notifications/notification-duration-removal.behavior.test.ts',
            'tests/unit/notifications/notification-input-validator.test.ts',
            'tests/unit/notifications/notification-payload-builder.test.ts',
            'tests/unit/notifications/notification-gate.test.ts',
            'tests/unit/notifications/notification-type-normalization.test.ts',
            'tests/unit/notifications/notification-manager-input-validation.test.ts',
            'tests/unit/notifications/notification-manager-logger-args.test.ts',
            'tests/unit/notifications/notification-manager-app-dependency.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
        }
    });

    it('keeps notifications cohort b tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/notifications/notification-manager.behavior.test.ts',
            'tests/unit/notifications/notification-manager-follow-raid-share-behavior.test.ts',
            'tests/unit/notifications/notification-manager-youtube-monetisation.behavior.test.ts',
            'tests/unit/notifications/notification-manager-twitch-monetisation.behavior.test.ts',
            'tests/unit/notifications/notification-manager-tiktok-monetisation.behavior.test.ts',
            'tests/unit/notifications/notification-manager-spam-config-access.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
        }
    });

    it('keeps notifications cohort c tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/notifications/notification-manager-coverage.test.ts',
            'tests/unit/notifications/notification-manager-error-path.test.ts',
            'tests/unit/notifications/notification-manager-error-handler.test.ts',
            'tests/unit/notifications/aggregated-donation-transformer.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
        }
    });

    it('keeps platforms cohort a unit tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/unit/platforms/platform-config-parsing.behavior.test.ts',
            'tests/unit/platforms/streamelements-connection-error-handling.test.ts',
            'tests/unit/platforms/streamelements-message-parse-error-path.test.ts',
            'tests/unit/platforms/tiktok-connection-validation.test.ts',
            'tests/unit/platforms/tiktok-follow-share-routing.test.ts',
            'tests/unit/platforms/tiktok-initialize-propagates-failure.test.ts',
            'tests/unit/platforms/tiktok-raw-event-logging.test.ts',
            'tests/unit/platforms/tiktok-retry-dedup.test.ts',
            'tests/unit/platforms/tiktok-undefined-error.test.ts',
            'tests/unit/platforms/twitch-handler-naming-mismatches.test.ts'
        ];
        const cohortJsPaths = [
            'tests/unit/platforms/platform-config-parsing.behavior.test.js',
            'tests/unit/platforms/streamelements-connection-error-handling.test.js',
            'tests/unit/platforms/streamelements-message-parse-error-path.test.js',
            'tests/unit/platforms/tiktok-connection-validation.test.js',
            'tests/unit/platforms/tiktok-follow-share-routing.test.js',
            'tests/unit/platforms/tiktok-initialize-propagates-failure.test.js',
            'tests/unit/platforms/tiktok-raw-event-logging.test.js',
            'tests/unit/platforms/tiktok-retry-dedup.test.js',
            'tests/unit/platforms/tiktok-undefined-error.test.js',
            'tests/unit/platforms/twitch-handler-naming-mismatches.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps platforms cohort a tests free of broad unknown array captures', () => {
        const cohortPaths = [
            'tests/unit/platforms/platform-config-parsing.behavior.test.ts',
            'tests/unit/platforms/streamelements-connection-error-handling.test.ts',
            'tests/unit/platforms/streamelements-message-parse-error-path.test.ts',
            'tests/unit/platforms/tiktok-connection-validation.test.ts',
            'tests/unit/platforms/tiktok-follow-share-routing.test.ts',
            'tests/unit/platforms/tiktok-initialize-propagates-failure.test.ts',
            'tests/unit/platforms/tiktok-raw-event-logging.test.ts',
            'tests/unit/platforms/tiktok-retry-dedup.test.ts',
            'tests/unit/platforms/tiktok-undefined-error.test.ts',
            'tests/unit/platforms/twitch-handler-naming-mismatches.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/:\s*unknown\[\](?:\[\])?/);
        }
    });

    it('keeps platforms cohort b unit tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/unit/platforms/streamelements-platform.behavior.test.ts',
            'tests/unit/platforms/tiktok-connection-lifecycle.test.ts',
            'tests/unit/platforms/tiktok-connection-retry-cleanup.test.ts',
            'tests/unit/platforms/tiktok-envelope-notification.test.ts',
            'tests/unit/platforms/tiktok-error-handling.test.ts',
            'tests/unit/platforms/tiktok-websocket-client-error-handler.test.ts',
            'tests/unit/platforms/tiktok-websocket-client-social-routing.test.ts',
            'tests/unit/platforms/tiktok-websocket-client.behavior.test.ts',
            'tests/unit/platforms/tiktok-websocket-client.coverage.test.ts',
            'tests/unit/platforms/twitch-platform-paypiggy-and-gift-mapper.test.ts'
        ];
        const cohortJsPaths = [
            'tests/unit/platforms/streamelements-platform.behavior.test.js',
            'tests/unit/platforms/tiktok-connection-lifecycle.test.js',
            'tests/unit/platforms/tiktok-connection-retry-cleanup.test.js',
            'tests/unit/platforms/tiktok-envelope-notification.test.js',
            'tests/unit/platforms/tiktok-error-handling.test.js',
            'tests/unit/platforms/tiktok-websocket-client-error-handler.test.js',
            'tests/unit/platforms/tiktok-websocket-client-social-routing.test.js',
            'tests/unit/platforms/tiktok-websocket-client.behavior.test.js',
            'tests/unit/platforms/tiktok-websocket-client.coverage.test.js',
            'tests/unit/platforms/twitch-platform-paypiggy-and-gift-mapper.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps platforms cohort b tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/platforms/streamelements-platform.behavior.test.ts',
            'tests/unit/platforms/tiktok-connection-lifecycle.test.ts',
            'tests/unit/platforms/tiktok-connection-retry-cleanup.test.ts',
            'tests/unit/platforms/tiktok-envelope-notification.test.ts',
            'tests/unit/platforms/tiktok-error-handling.test.ts',
            'tests/unit/platforms/tiktok-websocket-client-error-handler.test.ts',
            'tests/unit/platforms/tiktok-websocket-client-social-routing.test.ts',
            'tests/unit/platforms/tiktok-websocket-client.behavior.test.ts',
            'tests/unit/platforms/tiktok-websocket-client.coverage.test.ts',
            'tests/unit/platforms/twitch-platform-paypiggy-and-gift-mapper.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
        }
    });

    it('keeps platforms cohort c unit tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/unit/platforms/youtube/platform-behavior.test.ts',
            'tests/unit/platforms/youtube/platform-core.behavior.test.ts',
            'tests/unit/platforms/youtube/youtube-configuration-validation.test.ts',
            'tests/unit/platforms/youtube/platform-event-routing.test.ts',
            'tests/unit/platforms/youtube/youtube-live-validation.test.ts',
            'tests/unit/twitch-viewer-count-invalid-auth.test.ts',
            'tests/unit/viewer-count-system-twitch-debug.test.ts',
            'tests/unit/viewer-count-polling-fix.test.ts',
            'tests/unit/utils/viewer-count-system.test.ts',
            'tests/unit/utils/viewer-count-providers-error-handler.test.ts'
        ];
        const cohortJsPaths = [
            'tests/unit/platforms/youtube/platform-behavior.test.js',
            'tests/unit/platforms/youtube/platform-core.behavior.test.js',
            'tests/unit/platforms/youtube/youtube-configuration-validation.test.js',
            'tests/unit/platforms/youtube/platform-event-routing.test.js',
            'tests/unit/platforms/youtube/youtube-live-validation.test.js',
            'tests/unit/twitch-viewer-count-invalid-auth.test.js',
            'tests/unit/viewer-count-system-twitch-debug.test.js',
            'tests/unit/viewer-count-polling-fix.test.js',
            'tests/unit/utils/viewer-count-system.test.js',
            'tests/unit/utils/viewer-count-providers-error-handler.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps platforms cohort c tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/platforms/youtube/platform-behavior.test.ts',
            'tests/unit/platforms/youtube/platform-core.behavior.test.ts',
            'tests/unit/platforms/youtube/youtube-configuration-validation.test.ts',
            'tests/unit/platforms/youtube/platform-event-routing.test.ts',
            'tests/unit/platforms/youtube/youtube-live-validation.test.ts',
            'tests/unit/twitch-viewer-count-invalid-auth.test.ts',
            'tests/unit/viewer-count-system-twitch-debug.test.ts',
            'tests/unit/viewer-count-polling-fix.test.ts',
            'tests/unit/utils/viewer-count-system.test.ts',
            'tests/unit/utils/viewer-count-providers-error-handler.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
        }
    });

    it('keeps utils cohort a unit tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/unit/utils/platform-connection-factory.behavior.test.ts',
            'tests/unit/utils/platform-interface-validator.behavior.test.ts',
            'tests/unit/utils/dependency-factory.behavior.test.ts',
            'tests/unit/utils/platform-initialization-manager.test.ts',
            'tests/unit/utils/platform-initialization-manager.behavior.test.ts',
            'tests/unit/utils/connection-state-manager.behavior.test.ts',
            'tests/unit/utils/interval-manager.behavior.test.ts',
            'tests/unit/utils/initialization-statistics.behavior.test.ts',
            'tests/unit/utils/logger-resolver.behavior.test.ts',
            'tests/unit/utils/http-error-utils.behavior.test.ts'
        ];
        const cohortJsPaths = [
            'tests/unit/utils/platform-connection-factory.behavior.test.js',
            'tests/unit/utils/platform-interface-validator.behavior.test.js',
            'tests/unit/utils/dependency-factory.behavior.test.js',
            'tests/unit/utils/platform-initialization-manager.test.js',
            'tests/unit/utils/platform-initialization-manager.behavior.test.js',
            'tests/unit/utils/connection-state-manager.behavior.test.js',
            'tests/unit/utils/interval-manager.behavior.test.js',
            'tests/unit/utils/initialization-statistics.behavior.test.js',
            'tests/unit/utils/logger-resolver.behavior.test.js',
            'tests/unit/utils/http-error-utils.behavior.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps utils cohort a tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/utils/platform-connection-factory.behavior.test.ts',
            'tests/unit/utils/platform-interface-validator.behavior.test.ts',
            'tests/unit/utils/dependency-factory.behavior.test.ts',
            'tests/unit/utils/platform-initialization-manager.test.ts',
            'tests/unit/utils/platform-initialization-manager.behavior.test.ts',
            'tests/unit/utils/connection-state-manager.behavior.test.ts',
            'tests/unit/utils/interval-manager.behavior.test.ts',
            'tests/unit/utils/initialization-statistics.behavior.test.ts',
            'tests/unit/utils/logger-resolver.behavior.test.ts',
            'tests/unit/utils/http-error-utils.behavior.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
        }
    });

    it('keeps utils cohort b unit tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/unit/utils/config-validator.behavior.test.ts',
            'tests/unit/utils/retry-system.behavior.test.ts',
            'tests/unit/utils/enhanced-http-client.behavior.test.ts',
            'tests/unit/utils/enhanced-http-client.test.ts',
            'tests/unit/utils/text-processing.test.ts',
            'tests/unit/utils/goal-tracker.test.ts',
            'tests/unit/utils/spam-detection.test.ts',
            'tests/unit/utils/spam-detection.behavior.test.ts',
            'tests/unit/utils/user-facing-content-validation.test.ts',
            'tests/unit/utils/file-logger.behavior.test.ts'
        ];
        const cohortJsPaths = [
            'tests/unit/utils/config-validator.behavior.test.js',
            'tests/unit/utils/retry-system.behavior.test.js',
            'tests/unit/utils/enhanced-http-client.behavior.test.js',
            'tests/unit/utils/enhanced-http-client.test.js',
            'tests/unit/utils/text-processing.test.js',
            'tests/unit/utils/goal-tracker.test.js',
            'tests/unit/utils/spam-detection.test.js',
            'tests/unit/utils/spam-detection.behavior.test.js',
            'tests/unit/utils/user-facing-content-validation.test.js',
            'tests/unit/utils/file-logger.behavior.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps utils cohort b tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/utils/config-validator.behavior.test.ts',
            'tests/unit/utils/retry-system.behavior.test.ts',
            'tests/unit/utils/enhanced-http-client.behavior.test.ts',
            'tests/unit/utils/enhanced-http-client.test.ts',
            'tests/unit/utils/text-processing.test.ts',
            'tests/unit/utils/goal-tracker.test.ts',
            'tests/unit/utils/spam-detection.test.ts',
            'tests/unit/utils/spam-detection.behavior.test.ts',
            'tests/unit/utils/user-facing-content-validation.test.ts',
            'tests/unit/utils/file-logger.behavior.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
        }
    });

    it('keeps utils cohort c unit tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/unit/utils/viewer-count-providers.test.ts',
            'tests/unit/utils/viewer-count-providers.behavior.test.ts',
            'tests/unit/utils/notification-builder-fallback-username.behavior.test.ts',
            'tests/unit/utils/notification-builder-edge-cases.test.ts',
            'tests/unit/utils/global-command-cooldown.test.ts',
            'tests/unit/utils/global-command-cooldown.behavior.test.ts',
            'tests/unit/utils/e2e-testing-infrastructure.behavior.test.ts'
        ];
        const cohortJsPaths = [
            'tests/unit/utils/viewer-count-providers.test.js',
            'tests/unit/utils/viewer-count-providers.behavior.test.js',
            'tests/unit/utils/notification-builder-fallback-username.behavior.test.js',
            'tests/unit/utils/notification-builder-edge-cases.test.js',
            'tests/unit/utils/global-command-cooldown.test.js',
            'tests/unit/utils/global-command-cooldown.behavior.test.js',
            'tests/unit/utils/e2e-testing-infrastructure.behavior.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps utils cohort c tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/utils/viewer-count-providers.test.ts',
            'tests/unit/utils/viewer-count-providers.behavior.test.ts',
            'tests/unit/utils/notification-builder-fallback-username.behavior.test.ts',
            'tests/unit/utils/notification-builder-edge-cases.test.ts',
            'tests/unit/utils/global-command-cooldown.test.ts',
            'tests/unit/utils/global-command-cooldown.behavior.test.ts',
            'tests/unit/utils/e2e-testing-infrastructure.behavior.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
        }
    });

    it('keeps unit core config cohort a tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/unit/core/terminology-consistency.test.ts',
            'tests/unit/core/config-example-gui-template.behavior.test.ts',
            'tests/unit/core/config-path-override.test.ts',
            'tests/unit/core/spam-configuration-missing-fix.test.ts',
            'tests/unit/core/spam-config-notification-manager-integration.test.ts',
            'tests/unit/core/spam-config-integration.test.ts',
            'tests/unit/core/spam-config-export-missing.test.ts',
            'tests/unit/configuration-system.test.ts',
            'tests/unit/config-undefined-handling.test.ts',
            'tests/unit/helpers/config-fixture.test.ts'
        ];
        const cohortJsPaths = [
            'tests/unit/core/terminology-consistency.test.js',
            'tests/unit/core/config-example-gui-template.behavior.test.js',
            'tests/unit/core/config-path-override.test.js',
            'tests/unit/core/spam-configuration-missing-fix.test.js',
            'tests/unit/core/spam-config-notification-manager-integration.test.js',
            'tests/unit/core/spam-config-integration.test.js',
            'tests/unit/core/spam-config-export-missing.test.js',
            'tests/unit/configuration-system.test.js',
            'tests/unit/config-undefined-handling.test.js',
            'tests/unit/helpers/config-fixture.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps unit core config cohort a tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/core/terminology-consistency.test.ts',
            'tests/unit/core/config-example-gui-template.behavior.test.ts',
            'tests/unit/core/config-path-override.test.ts',
            'tests/unit/core/spam-configuration-missing-fix.test.ts',
            'tests/unit/core/spam-config-notification-manager-integration.test.ts',
            'tests/unit/core/spam-config-integration.test.ts',
            'tests/unit/core/spam-config-export-missing.test.ts',
            'tests/unit/configuration-system.test.ts',
            'tests/unit/config-undefined-handling.test.ts',
            'tests/unit/helpers/config-fixture.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
        }
    });

    it('keeps unit root core config cohort b tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/unit/old-message-filter.test.ts',
            'tests/unit/greeting-system-diagnosis.test.ts',
            'tests/unit/bits-goal-counter-fix.test.ts',
            'tests/unit/tiktok-event-factory-behavior.test.ts',
            'tests/unit/startup-clearing-simple.test.ts',
            'tests/unit/startup-clearing-focused.test.ts',
            'tests/unit/debug-mode-command-line.test.ts',
            'tests/unit/template-interpolation-fallbacks.test.ts',
            'tests/unit/main-greeting-fix-validation.test.ts',
            'tests/unit/twitch-gift-sub-notification.test.ts'
        ];
        const cohortJsPaths = [
            'tests/unit/old-message-filter.test.js',
            'tests/unit/greeting-system-diagnosis.test.js',
            'tests/unit/bits-goal-counter-fix.test.js',
            'tests/unit/tiktok-event-factory-behavior.test.js',
            'tests/unit/startup-clearing-simple.test.js',
            'tests/unit/startup-clearing-focused.test.js',
            'tests/unit/debug-mode-command-line.test.js',
            'tests/unit/template-interpolation-fallbacks.test.js',
            'tests/unit/main-greeting-fix-validation.test.js',
            'tests/unit/twitch-gift-sub-notification.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps unit root core config cohort b tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/old-message-filter.test.ts',
            'tests/unit/greeting-system-diagnosis.test.ts',
            'tests/unit/bits-goal-counter-fix.test.ts',
            'tests/unit/tiktok-event-factory-behavior.test.ts',
            'tests/unit/startup-clearing-simple.test.ts',
            'tests/unit/startup-clearing-focused.test.ts',
            'tests/unit/debug-mode-command-line.test.ts',
            'tests/unit/template-interpolation-fallbacks.test.ts',
            'tests/unit/main-greeting-fix-validation.test.ts',
            'tests/unit/twitch-gift-sub-notification.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
        }
    });

    it('keeps unit chat observer extractor helper cohort tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/unit/chat/keyword-parsing-command-parser.test.ts',
            'tests/unit/chat/keyword-command-display-fix.test.ts',
            'tests/unit/observers/viewer-count-observer.behavior.test.ts',
            'tests/unit/observers/obs-viewer-count-observer.test.ts',
            'tests/unit/extractors/youtube-viewer-extractor.test.ts',
            'tests/unit/message-tts-handler.test.ts',
            'tests/unit/greeting-console-output.test.ts',
            'tests/unit/greeting-display-username-fix.test.ts',
            'tests/unit/gift-display-details-fix.test.ts',
            'tests/unit/notification-builder-superfan.test.ts'
        ];
        const cohortJsPaths = [
            'tests/unit/chat/keyword-parsing-command-parser.test.js',
            'tests/unit/chat/keyword-command-display-fix.test.js',
            'tests/unit/observers/viewer-count-observer.behavior.test.js',
            'tests/unit/observers/obs-viewer-count-observer.test.js',
            'tests/unit/extractors/youtube-viewer-extractor.test.js',
            'tests/unit/message-tts-handler.test.js',
            'tests/unit/greeting-console-output.test.js',
            'tests/unit/greeting-display-username-fix.test.js',
            'tests/unit/gift-display-details-fix.test.js',
            'tests/unit/notification-builder-superfan.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps unit chat observer extractor helper cohort tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/chat/keyword-parsing-command-parser.test.ts',
            'tests/unit/chat/keyword-command-display-fix.test.ts',
            'tests/unit/observers/viewer-count-observer.behavior.test.ts',
            'tests/unit/observers/obs-viewer-count-observer.test.ts',
            'tests/unit/extractors/youtube-viewer-extractor.test.ts',
            'tests/unit/message-tts-handler.test.ts',
            'tests/unit/greeting-console-output.test.ts',
            'tests/unit/greeting-display-username-fix.test.ts',
            'tests/unit/gift-display-details-fix.test.ts',
            'tests/unit/notification-builder-superfan.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
        }
    });

    it('keeps integration cohort a tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/integration/platform-status-interface.test.ts',
            'tests/integration/farewell-chat-routing.test.ts',
            'tests/integration/config-normalization-validation.test.ts',
            'tests/integration/command-cooldown-integration.test.ts',
            'tests/integration/critical-startup-flow.test.ts',
            'tests/integration/runtime-vfx-lifecycle-management.test.ts',
            'tests/integration/keyword-parsing-integration.test.ts',
            'tests/integration/notification-command-routing.test.ts'
        ];
        const cohortJsPaths = [
            'tests/integration/platform-status-interface.test.js',
            'tests/integration/farewell-chat-routing.test.js',
            'tests/integration/config-normalization-validation.test.js',
            'tests/integration/command-cooldown-integration.test.js',
            'tests/integration/critical-startup-flow.test.js',
            'tests/integration/runtime-vfx-lifecycle-management.test.js',
            'tests/integration/keyword-parsing-integration.test.js',
            'tests/integration/notification-command-routing.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps integration cohort a tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/integration/platform-status-interface.test.ts',
            'tests/integration/farewell-chat-routing.test.ts',
            'tests/integration/config-normalization-validation.test.ts',
            'tests/integration/command-cooldown-integration.test.ts',
            'tests/integration/critical-startup-flow.test.ts',
            'tests/integration/runtime-vfx-lifecycle-management.test.ts',
            'tests/integration/keyword-parsing-integration.test.ts',
            'tests/integration/notification-command-routing.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
        }
    });

    it('keeps integration cohort a test modules free of bun test require and transitional empty exports', () => {
        const cohortPaths = [
            'tests/integration/platform-status-interface.test.ts',
            'tests/integration/farewell-chat-routing.test.ts',
            'tests/integration/config-normalization-validation.test.ts',
            'tests/integration/command-cooldown-integration.test.ts',
            'tests/integration/critical-startup-flow.test.ts',
            'tests/integration/runtime-vfx-lifecycle-management.test.ts',
            'tests/integration/keyword-parsing-integration.test.ts',
            'tests/integration/notification-command-routing.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps integration cohort a test modules free of commonjs module syntax', () => {
        const cohortPaths = [
            'tests/integration/platform-status-interface.test.ts',
            'tests/integration/farewell-chat-routing.test.ts',
            'tests/integration/config-normalization-validation.test.ts',
            'tests/integration/command-cooldown-integration.test.ts',
            'tests/integration/critical-startup-flow.test.ts',
            'tests/integration/runtime-vfx-lifecycle-management.test.ts',
            'tests/integration/keyword-parsing-integration.test.ts',
            'tests/integration/notification-command-routing.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/\bexports\./);
        }
    });

    it('keeps e2e smoke cohort c test modules free of bun test require and transitional empty exports', () => {
        const cohortPaths = [
            'tests/e2e-smoke/platform-lifecycle-startup.test.ts',
            'tests/e2e-smoke/gui-transport-routes-smoke.test.ts',
            'tests/e2e-smoke/main-startup.test.ts',
            'tests/e2e-smoke/tiktok-event-pipeline.test.ts',
            'tests/e2e-smoke/twitch-chat-emote-parts-pipeline.test.ts',
            'tests/e2e-smoke/display-queue-gift-flow.test.ts',
            'tests/e2e-smoke/secret-manager-interactive-prompt.test.ts',
            'tests/e2e-smoke/youtube-chat-emote-parts-pipeline.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps e2e smoke cohort c test modules free of commonjs module syntax', () => {
        const cohortPaths = [
            'tests/e2e-smoke/platform-lifecycle-startup.test.ts',
            'tests/e2e-smoke/gui-transport-routes-smoke.test.ts',
            'tests/e2e-smoke/main-startup.test.ts',
            'tests/e2e-smoke/tiktok-event-pipeline.test.ts',
            'tests/e2e-smoke/twitch-chat-emote-parts-pipeline.test.ts',
            'tests/e2e-smoke/display-queue-gift-flow.test.ts',
            'tests/e2e-smoke/secret-manager-interactive-prompt.test.ts',
            'tests/e2e-smoke/youtube-chat-emote-parts-pipeline.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/\bexports\./);
        }
    });

    it('keeps unit viewer count cohort e test modules free of bun test require and transitional empty exports', () => {
        const cohortPaths = [
            'tests/unit/viewer-count/viewer-count-cleanup-resilience.test.ts',
            'tests/unit/viewer-count/viewer-count-error-handler.test.ts',
            'tests/unit/viewer-count/viewer-count-observer-notify.test.ts',
            'tests/unit/viewer-count/viewer-count-polling-error-resilience.test.ts',
            'tests/unit/viewer-count/viewer-count-polling-interval.test.ts',
            'tests/unit/viewer-count/viewer-count-polling-malformed.test.ts',
            'tests/unit/viewer-count/viewer-count-polling-observer.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps unit viewer count cohort e test modules free of commonjs module syntax', () => {
        const cohortPaths = [
            'tests/unit/viewer-count/viewer-count-cleanup-resilience.test.ts',
            'tests/unit/viewer-count/viewer-count-error-handler.test.ts',
            'tests/unit/viewer-count/viewer-count-observer-notify.test.ts',
            'tests/unit/viewer-count/viewer-count-polling-error-resilience.test.ts',
            'tests/unit/viewer-count/viewer-count-polling-interval.test.ts',
            'tests/unit/viewer-count/viewer-count-polling-malformed.test.ts',
            'tests/unit/viewer-count/viewer-count-polling-observer.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/\bexports\./);
        }
    });

    it('keeps unit viewer count cohort f test modules free of bun test require and transitional empty exports', () => {
        const cohortPaths = [
            'tests/unit/viewer-count/stream-status-handler.test.ts',
            'tests/unit/viewer-count/viewer-count-edge-cases.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps unit viewer count cohort f test modules free of commonjs module syntax', () => {
        const cohortPaths = [
            'tests/unit/viewer-count/stream-status-handler.test.ts',
            'tests/unit/viewer-count/viewer-count-edge-cases.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/\bexports\./);
        }
    });

    it('keeps unit viewer count cohort g test modules free of bun test require and transitional empty exports', () => {
        const cohortPaths = [
            'tests/unit/youtube-viewer-count-behavior.test.ts',
            'tests/unit/viewer-count-system-twitch-debug.test.ts',
            'tests/unit/viewer-count-polling-fix.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps unit viewer count cohort g test modules free of commonjs module syntax', () => {
        const cohortPaths = [
            'tests/unit/youtube-viewer-count-behavior.test.ts',
            'tests/unit/viewer-count-system-twitch-debug.test.ts',
            'tests/unit/viewer-count-polling-fix.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/\bexports\./);
        }
    });

    it('keeps integration smoke cohort b tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/integration/obs-connection-lifecycle.test.ts',
            'tests/integration/message-tts-integration.test.ts',
            'tests/integration/extractor-service-integration.test.ts',
            'tests/integration/observer-pattern-integration.test.ts',
            'tests/integration/obs-event-integration.test.ts',
            'tests/integration/production-spam-config-error-reproduction.test.ts',
            'tests/e2e-smoke/farewell-routing-smoke.test.ts',
            'tests/e2e-smoke/vfx-gift-resolution.test.ts'
        ];
        const cohortJsPaths = [
            'tests/integration/obs-connection-lifecycle.test.js',
            'tests/integration/message-tts-integration.test.js',
            'tests/integration/extractor-service-integration.test.js',
            'tests/integration/observer-pattern-integration.test.js',
            'tests/integration/obs-event-integration.test.js',
            'tests/integration/production-spam-config-error-reproduction.test.js',
            'tests/e2e-smoke/farewell-routing-smoke.test.js',
            'tests/e2e-smoke/vfx-gift-resolution.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps integration smoke cohort b tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/integration/obs-connection-lifecycle.test.ts',
            'tests/integration/message-tts-integration.test.ts',
            'tests/integration/extractor-service-integration.test.ts',
            'tests/integration/observer-pattern-integration.test.ts',
            'tests/integration/obs-event-integration.test.ts',
            'tests/integration/production-spam-config-error-reproduction.test.ts',
            'tests/e2e-smoke/farewell-routing-smoke.test.ts',
            'tests/e2e-smoke/vfx-gift-resolution.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*,/);
        }
    });

    it('keeps integration smoke cohort b test modules free of bun test require and transitional empty exports', () => {
        const cohortPaths = [
            'tests/integration/obs-connection-lifecycle.test.ts',
            'tests/integration/message-tts-integration.test.ts',
            'tests/integration/extractor-service-integration.test.ts',
            'tests/integration/observer-pattern-integration.test.ts',
            'tests/integration/obs-event-integration.test.ts',
            'tests/integration/production-spam-config-error-reproduction.test.ts',
            'tests/e2e-smoke/farewell-routing-smoke.test.ts',
            'tests/e2e-smoke/vfx-gift-resolution.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps integration smoke cohort b test modules free of commonjs module syntax', () => {
        const cohortPaths = [
            'tests/integration/obs-connection-lifecycle.test.ts',
            'tests/integration/message-tts-integration.test.ts',
            'tests/integration/extractor-service-integration.test.ts',
            'tests/integration/observer-pattern-integration.test.ts',
            'tests/integration/obs-event-integration.test.ts',
            'tests/integration/production-spam-config-error-reproduction.test.ts',
            'tests/e2e-smoke/farewell-routing-smoke.test.ts',
            'tests/e2e-smoke/vfx-gift-resolution.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/\bexports\./);
        }
    });

    it('keeps unit core dependency retry setup factory cohort c tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/unit/dependency-factory.test.ts',
            'tests/unit/dependency-injection-validation.test.ts',
            'tests/unit/core-utility-functions.test.ts',
            'tests/unit/adaptive-retry-system.test.ts',
            'tests/unit/retry-system-handle-connection-error.test.ts',
            'tests/unit/core/tts-boolean-parsing.test.ts',
            'tests/unit/factories/innertube-factory.behavior.test.ts',
            'tests/unit/setup/output-suppression.test.ts'
        ];
        const cohortJsPaths = [
            'tests/unit/dependency-factory.test.js',
            'tests/unit/dependency-injection-validation.test.js',
            'tests/unit/core-utility-functions.test.js',
            'tests/unit/adaptive-retry-system.test.js',
            'tests/unit/retry-system-handle-connection-error.test.js',
            'tests/unit/core/tts-boolean-parsing.test.js',
            'tests/unit/factories/innertube-factory.behavior.test.js',
            'tests/unit/setup/output-suppression.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps unit core dependency retry setup factory cohort c tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/dependency-factory.test.ts',
            'tests/unit/dependency-injection-validation.test.ts',
            'tests/unit/core-utility-functions.test.ts',
            'tests/unit/adaptive-retry-system.test.ts',
            'tests/unit/retry-system-handle-connection-error.test.ts',
            'tests/unit/core/tts-boolean-parsing.test.ts',
            'tests/unit/factories/innertube-factory.behavior.test.ts',
            'tests/unit/setup/output-suppression.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*,/);
        }
    });

    it('keeps remaining unit root runtime tiktok main twitch cohort d tests on TypeScript paths', () => {
        const cohortTsPaths = [
            'tests/unit/runtime-system-ready.test.ts',
            'tests/unit/twitch-resubscription-notification-fix.test.ts',
            'tests/unit/tiktok-official-gift-pattern.test.ts',
            'tests/unit/tiktok-connection-refactor.test.ts',
            'tests/unit/tiktok-connection-fix-validation.test.ts',
            'tests/unit/main-updateviewercount-obs-fix.test.ts',
            'tests/unit/main-supersticker-handler-missing.test.ts'
        ];
        const cohortJsPaths = [
            'tests/unit/runtime-system-ready.test.js',
            'tests/unit/twitch-resubscription-notification-fix.test.js',
            'tests/unit/tiktok-official-gift-pattern.test.js',
            'tests/unit/tiktok-connection-refactor.test.js',
            'tests/unit/tiktok-connection-fix-validation.test.js',
            'tests/unit/main-updateviewercount-obs-fix.test.js',
            'tests/unit/main-supersticker-handler-missing.test.js'
        ];

        for (const testPath of cohortTsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(true);
        }
        for (const testPath of cohortJsPaths) {
            expect(existsSync(join(repoRoot, testPath))).toBe(false);
        }
    });

    it('keeps remaining unit root runtime tiktok main twitch cohort d tests free of untyped mutable declarations', () => {
        const cohortPaths = [
            'tests/unit/runtime-system-ready.test.ts',
            'tests/unit/twitch-resubscription-notification-fix.test.ts',
            'tests/unit/tiktok-official-gift-pattern.test.ts',
            'tests/unit/tiktok-connection-refactor.test.ts',
            'tests/unit/tiktok-connection-fix-validation.test.ts',
            'tests/unit/main-updateviewercount-obs-fix.test.ts',
            'tests/unit/main-supersticker-handler-missing.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*;/);
            expect(content).not.toMatch(/\blet\s+[A-Za-z_$][\w$]*\s*,/);
        }
    });

    it('keeps cohort d test modules free of bun test require and transitional empty exports', () => {
        const cohortPaths = [
            'tests/unit/runtime-system-ready.test.ts',
            'tests/unit/twitch-resubscription-notification-fix.test.ts',
            'tests/unit/tiktok-official-gift-pattern.test.ts',
            'tests/unit/tiktok-connection-refactor.test.ts',
            'tests/unit/tiktok-connection-fix-validation.test.ts',
            'tests/unit/main-updateviewercount-obs-fix.test.ts',
            'tests/unit/main-supersticker-handler-missing.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps cohort d test modules free of commonjs module syntax', () => {
        const cohortPaths = [
            'tests/unit/runtime-system-ready.test.ts',
            'tests/unit/twitch-resubscription-notification-fix.test.ts',
            'tests/unit/tiktok-official-gift-pattern.test.ts',
            'tests/unit/tiktok-connection-refactor.test.ts',
            'tests/unit/tiktok-connection-fix-validation.test.ts',
            'tests/unit/main-updateviewercount-obs-fix.test.ts',
            'tests/unit/main-supersticker-handler-missing.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            const contentWithoutAllowedShim = testPath === 'tests/unit/runtime-system-ready.test.ts'
                ? content.replace("const { AppRuntime } = require('../../src/runtime/AppRuntime');", '')
                : content;

            expect(contentWithoutAllowedShim).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/\bexports\./);
        }
    });

    it('keeps cohort c test modules free of bun test require and transitional empty exports', () => {
        const cohortPaths = [
            'tests/unit/dependency-factory.test.ts',
            'tests/unit/dependency-injection-validation.test.ts',
            'tests/unit/core-utility-functions.test.ts',
            'tests/unit/adaptive-retry-system.test.ts',
            'tests/unit/retry-system-handle-connection-error.test.ts',
            'tests/unit/core/tts-boolean-parsing.test.ts',
            'tests/unit/factories/innertube-factory.behavior.test.ts',
            'tests/unit/setup/output-suppression.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps cohort c test modules free of commonjs module syntax', () => {
        const cohortPaths = [
            'tests/unit/dependency-factory.test.ts',
            'tests/unit/dependency-injection-validation.test.ts',
            'tests/unit/core-utility-functions.test.ts',
            'tests/unit/adaptive-retry-system.test.ts',
            'tests/unit/retry-system-handle-connection-error.test.ts',
            'tests/unit/core/tts-boolean-parsing.test.ts',
            'tests/unit/factories/innertube-factory.behavior.test.ts',
            'tests/unit/setup/output-suppression.test.ts'
        ];

        for (const testPath of cohortPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/\bexports\./);
        }
    });

    it('fails when executable lint/tools TypeScript files use commonjs module syntax outside approved shims', () => {
        const executableTypeScriptFiles = EXECUTABLE_TS_ROOTS
            .map(relativeRoot => join(repoRoot, relativeRoot))
            .filter(rootPath => existsSync(rootPath))
            .flatMap(rootPath => collectExecutableTypeScriptFiles(rootPath));

        const offenders: string[] = [];
        for (const filePath of executableTypeScriptFiles) {
            const content = readFileSync(filePath, 'utf8');
            const firstOffenseLine = findCommonJsModuleSyntax(content);
            if (firstOffenseLine !== null) {
                offenders.push(`${filePath.replace(`${repoRoot}/`, '')}:${firstOffenseLine}`);
            }
        }

        expect(offenders).toEqual([]);
    });

    it('keeps gui gift preview local script free of commonjs module syntax', () => {
        const content = readFileSync(join(repoRoot, 'scripts/local/gui-gift-animation-preview.ts'), 'utf8');

        expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
        expect(content).not.toContain('module.exports');
        expect(content).not.toMatch(/^\s*exports\./m);
    });

    it('keeps gui preview local script free of commonjs module syntax', () => {
        const content = readFileSync(join(repoRoot, 'scripts/local/gui-preview.ts'), 'utf8');

        expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
        expect(content).not.toContain('module.exports');
        expect(content).not.toMatch(/^\s*exports\./m);
    });

    it('keeps bun prerun setup bootstrap free of raw top-level require declarations', () => {
        const content = readFileSync(join(repoRoot, 'tests/setup/bun.prerun.ts'), 'utf8');

        expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
    });

    it('keeps bun setup bootstrap free of top-level commonjs declarations and exports', () => {
        const content = readFileSync(join(repoRoot, 'tests/setup/bun.setup.ts'), 'utf8');

        expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
        expect(content).not.toContain('module.exports');
    });

    it('keeps foundational test helper modules free of commonjs declarations and exports', () => {
        const helperPaths = [
            'tests/helpers/time-utils.ts',
            'tests/helpers/test-clock.ts',
            'tests/helpers/test-id.ts',
            'tests/helpers/output-capture.ts'
        ];

        for (const helperPath of helperPaths) {
            const content = readFileSync(join(repoRoot, helperPath), 'utf8');
            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toContain('module.exports');
        }
    });

    it('keeps bun mock helper modules free of commonjs declarations and exports', () => {
        const helperPaths = [
            'tests/helpers/bun-mock-utils.ts',
            'tests/helpers/bun-module-mocks.ts',
            'tests/helpers/bun-timers.ts'
        ];

        for (const helperPath of helperPaths) {
            const content = readFileSync(join(repoRoot, helperPath), 'utf8');
            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toContain('module.exports');
        }
    });

    it('keeps timeout and core utility modules free of commonjs export syntax', () => {
        const modulePaths = [
            'src/utils/timeout-validator.ts',
            'src/utils/timeout-wrapper.ts',
            'src/core/http-config.ts',
            'src/core/constants.ts',
            'src/auth/twitch-oauth-scopes.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps timeout/core unit test modules free of top-level commonjs and transitional exports', () => {
        const testPaths = [
            'tests/unit/utils/timeout-validator.test.ts',
            'tests/unit/utils/timeout-wrapper.test.ts',
            'tests/unit/core/http-config.test.ts',
            'tests/unit/core/constants.test.ts',
            'tests/unit/core/index.test.ts'
        ];

        for (const testPath of testPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');
            const contentWithoutAllowedShim = testPath === 'tests/unit/core/index.test.ts'
                ? content.replace("const core = require('../../../src/core/index.ts');", '')
                : content;

            expect(content).not.toContain("require('bun:test')");
            expect(contentWithoutAllowedShim).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps helper behavior test modules free of top-level commonjs and transitional exports', () => {
        const testPaths = [
            'tests/helpers/test-clock.test.ts',
            'tests/helpers/test-database.test.ts',
            'tests/helpers/bun-mock-utils.behavior.test.ts',
            'tests/helpers/bun-module-mocks.behavior.test.ts'
        ];

        for (const testPath of testPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');

            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps selected platform/chat/gift unit test modules free of top-level commonjs and transitional exports', () => {
        const testPaths = [
            'tests/unit/platforms/youtube/events/event-router.test.ts',
            'tests/unit/gift-display-details-fix.test.ts',
            'tests/unit/greeting-display-username-fix.test.ts',
            'tests/unit/observers/obs-viewer-count-observer.test.ts',
            'tests/unit/chat/keyword-command-display-fix.test.ts'
        ];

        for (const testPath of testPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');

            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps remaining chat observer extractor helper-cohort tests free of top-level commonjs and transitional exports', () => {
        const testPaths = [
            'tests/unit/chat/keyword-parsing-command-parser.test.ts',
            'tests/unit/observers/viewer-count-observer.behavior.test.ts',
            'tests/unit/extractors/youtube-viewer-extractor.test.ts',
            'tests/unit/message-tts-handler.test.ts',
            'tests/unit/greeting-console-output.test.ts',
            'tests/unit/notification-builder-superfan.test.ts'
        ];

        for (const testPath of testPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');

            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps startup template twitch-bits cohort tests free of top-level commonjs and transitional exports', () => {
        const testPaths = [
            'tests/unit/twitch-gift-sub-notification.test.ts',
            'tests/unit/main-greeting-fix-validation.test.ts',
            'tests/unit/template-interpolation-fallbacks.test.ts',
            'tests/unit/startup-clearing-focused.test.ts',
            'tests/unit/startup-clearing-simple.test.ts',
            'tests/unit/bits-goal-counter-fix.test.ts'
        ];

        for (const testPath of testPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');

            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps diagnosis config tiktok cohort tests free of top-level commonjs and transitional exports', () => {
        const testPaths = [
            'tests/unit/greeting-system-diagnosis.test.ts',
            'tests/unit/old-message-filter.test.ts',
            'tests/unit/tiktok-event-factory-behavior.test.ts',
            'tests/unit/debug-mode-command-line.test.ts',
            'tests/unit/config-undefined-handling.test.ts',
            'tests/unit/core/config-path-override.test.ts'
        ];

        for (const testPath of testPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');

            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps configuration spam helper cohort tests free of top-level commonjs and transitional exports', () => {
        const testPaths = [
            'tests/unit/configuration-system.test.ts',
            'tests/unit/core/spam-config-notification-manager-integration.test.ts',
            'tests/unit/core/spam-configuration-missing-fix.test.ts',
            'tests/unit/core/spam-config-export-missing.test.ts',
            'tests/unit/core/spam-config-integration.test.ts',
            'tests/unit/helpers/config-fixture.test.ts'
        ];

        for (const testPath of testPaths) {
            const content = readFileSync(join(repoRoot, testPath), 'utf8');

            expect(content).not.toContain("require('bun:test')");
            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toContain('export {};');
        }
    });

    it('keeps shared leaf contracts and validators free of commonjs module syntax', () => {
        const modulePaths = [
            'src/core/config-schema.ts',
            'src/core/secrets.ts',
            'src/utils/currency-utils.ts',
            'src/utils/dependency-validator.ts',
            'src/utils/platform-error-handler.ts',
            'src/utils/validation.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/module\[['\"]exports['\"]\]/);
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps core runtime support modules free of commonjs module syntax', () => {
        const modulePaths = [
            'src/core/EventBus.ts',
            'src/core/config-builders.ts',
            'src/core/config.ts',
            'src/core/index.ts',
            'src/core/logging.ts',
            'src/utils/logger-utils.ts',
            'src/utils/secret-manager.ts',
            'src/utils/user-friendly-errors.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps viewer-count pipeline modules free of commonjs module syntax', () => {
        const modulePaths = [
            'src/extractors/youtube-viewer-extractor.ts',
            'src/observers/viewer-count-observer.ts',
            'src/observers/obs-viewer-count-observer.ts',
            'src/services/viewer-count-extraction-service.ts',
            'src/utils/viewer-count-providers.ts',
            'src/utils/viewer-count.ts',
            'src/viewer-count/stream-status-handler.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/module\[['\"]exports['\"]\]/);
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps obs helper and rendering leaf modules free of commonjs module syntax', () => {
        const modulePaths = [
            'src/obs/display-config-validator.ts',
            'src/obs/display-queue-state.ts',
            'src/obs/display-renderer.ts',
            'src/obs/effects.ts',
            'src/obs/handcam-glow.ts',
            'src/obs/health-checker.ts',
            'src/obs/obs-event-service.ts',
            'src/obs/safe-operations.ts',
            'src/obs/scene-management-service.ts',
            'src/obs/startup.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/module\[['\"]exports['\"]\]/);
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps obs stateful manager modules free of commonjs module syntax', () => {
        const modulePaths = [
            'src/obs/connection.ts',
            'src/obs/display-queue-effects.ts',
            'src/obs/display-queue.ts',
            'src/obs/goals.ts',
            'src/obs/sources.ts',
            'src/utils/goal-tracker.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/module\[['\"]exports['\"]\]/);
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps youtube extractor helper modules free of commonjs exports syntax', () => {
        const helperPaths = [
            'src/platforms/youtube/youtube-author-extractor.ts',
            'src/platforms/youtube/youtube-message-extractor.ts',
            'src/platforms/youtube/youtube-username-normalizer.ts'
        ];

        for (const helperPath of helperPaths) {
            const content = readFileSync(join(repoRoot, helperPath), 'utf8');
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps youtube event modules free of commonjs exports syntax', () => {
        const eventModulePaths = [
            'src/platforms/youtube/events/event-normalizer.ts',
            'src/platforms/youtube/events/event-router.ts'
        ];

        for (const eventModulePath of eventModulePaths) {
            const content = readFileSync(join(repoRoot, eventModulePath), 'utf8');
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps youtube event factory module free of commonjs exports syntax', () => {
        const content = readFileSync(join(repoRoot, 'src/platforms/youtube/events/event-factory.ts'), 'utf8');

        expect(content).not.toContain('module.exports');
        expect(content).not.toMatch(/^\s*exports\./m);
    });

    it('keeps youtube connection factory module free of commonjs exports syntax', () => {
        const content = readFileSync(join(repoRoot, 'src/platforms/youtube/connections/youtube-connection-factory.ts'), 'utf8');

        expect(content).not.toContain('module.exports');
        expect(content).not.toMatch(/^\s*exports\./m);
    });

    it('keeps youtube monetization parser module free of commonjs exports syntax', () => {
        const content = readFileSync(join(repoRoot, 'src/platforms/youtube/monetization/monetization-parser.ts'), 'utf8');

        expect(content).not.toContain('module.exports');
        expect(content).not.toMatch(/^\s*exports\./m);
    });

    it('keeps youtube currency parser on TypeScript source path', () => {
        expect(existsSync(join(repoRoot, 'src/platforms/youtube/youtubei-currency-parser.ts'))).toBe(true);
        expect(existsSync(join(repoRoot, 'src/platforms/youtube/youtubei-currency-parser.js'))).toBe(false);
    });

    it('keeps youtube currency parser free of raw require syntax', () => {
        const content = readFileSync(join(repoRoot, 'src/platforms/youtube/youtubei-currency-parser.ts'), 'utf8');

        expect(content).not.toMatch(/\brequire\s*\(/);
    });

    it('keeps youtube multistream manager module free of commonjs exports syntax', () => {
        const content = readFileSync(join(repoRoot, 'src/platforms/youtube/streams/youtube-multistream-manager.ts'), 'utf8');

        expect(content).not.toContain('module.exports');
        expect(content).not.toMatch(/^\s*exports\./m);
    });

    it('keeps migrated youtube modules free of require syntax', () => {
        const youtubeModulePaths = [
            'src/platforms/youtube/events/event-router.ts',
            'src/platforms/youtube/events/event-factory.ts',
            'src/platforms/youtube/connections/youtube-connection-factory.ts',
            'src/platforms/youtube/monetization/monetization-parser.ts',
            'src/platforms/youtube/streams/youtube-multistream-manager.ts'
        ];

        for (const modulePath of youtubeModulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');
            expect(content).not.toMatch(/\brequire\s*\(/);
        }
    });

    it('keeps shared ts dependency modules free of commonjs exports syntax', () => {
        const sharedModulePaths = [
            'src/utils/timestamp.ts',
            'src/core/endpoints.ts',
            'src/utils/message-parts.ts'
        ];

        for (const modulePath of sharedModulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps migrated youtube modules free of nodeRequire for modernized dependencies', () => {
        const assertions = [
            {
                path: 'src/platforms/youtube/events/event-router.ts',
                forbidden: [
                    "nodeRequire('../../../utils/timestamp')"
                ]
            },
            {
                path: 'src/platforms/youtube/events/event-factory.ts',
                forbidden: [
                    "nodeRequire('../../../utils/timestamp')",
                    "nodeRequire('../../../utils/message-parts')"
                ]
            },
            {
                path: 'src/platforms/youtube/connections/youtube-connection-factory.ts',
                forbidden: [
                    "nodeRequire('../../../core/endpoints')"
                ]
            },
            {
                path: 'src/platforms/youtube/monetization/monetization-parser.ts',
                forbidden: [
                    "nodeRequire('../youtube-message-extractor')",
                    "nodeRequire('../youtubei-currency-parser')"
                ]
            },
            {
                path: 'src/platforms/youtube/streams/youtube-multistream-manager.ts',
                forbidden: [
                    "nodeRequire('../../../core/endpoints')"
                ]
            }
        ];

        for (const assertion of assertions) {
            const content = readFileSync(join(repoRoot, assertion.path), 'utf8');
            for (const forbiddenPattern of assertion.forbidden) {
                expect(content).not.toContain(forbiddenPattern);
            }
        }
    });

    it('keeps migrated youtube modules free of createRequire shim imports', () => {
        const modulePaths = [
            'src/platforms/youtube/monetization/monetization-parser.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');
            expect(content).not.toContain("from 'node:module'");
            expect(content).not.toContain('createRequire(');
            expect(content).not.toContain('nodeRequire(');
        }
    });
});
