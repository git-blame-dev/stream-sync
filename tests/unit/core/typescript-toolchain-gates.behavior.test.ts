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
});
