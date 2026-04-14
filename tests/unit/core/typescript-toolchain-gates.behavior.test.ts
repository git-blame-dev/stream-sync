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

type ExecutableJavaScriptInventory = {
    total: number;
    withTypeScriptSiblingCount: number;
    wrapperProxyCount: number;
    withTypeScriptSiblingNonWrapperCount: number;
    withoutTypeScriptSiblingCount: number;
};

const WRAPPER_PROXY_PATTERN = /^module\.exports\s*=\s*require\((['"])\.\/[^'"]+\.ts\1\);?$/;

function collectExecutableJavaScriptInventory(directoryPath: string): ExecutableJavaScriptInventory {
    const inventory: ExecutableJavaScriptInventory = {
        total: 0,
        withTypeScriptSiblingCount: 0,
        wrapperProxyCount: 0,
        withTypeScriptSiblingNonWrapperCount: 0,
        withoutTypeScriptSiblingCount: 0
    };

    if (!existsSync(directoryPath)) {
        return inventory;
    }

    const walk = (currentPath: string): void => {
        const entries = readdirSync(currentPath, { withFileTypes: true });

        for (const entry of entries) {
            if (EXCLUDED_SCAN_DIRECTORIES.has(entry.name)) {
                continue;
            }

            const fullPath = join(currentPath, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
                continue;
            }

            if (!entry.isFile() || !entry.name.endsWith('.js')) {
                continue;
            }

            inventory.total += 1;

            const siblingTypeScriptPath = `${fullPath.slice(0, -3)}.ts`;
            const hasTypeScriptSibling = existsSync(siblingTypeScriptPath);
            if (!hasTypeScriptSibling) {
                inventory.withoutTypeScriptSiblingCount += 1;
                continue;
            }

            inventory.withTypeScriptSiblingCount += 1;

            const content = readFileSync(fullPath, 'utf8').trim();
            const isWrapperProxy = WRAPPER_PROXY_PATTERN.test(content);
            if (isWrapperProxy) {
                inventory.wrapperProxyCount += 1;
                continue;
            }

            inventory.withTypeScriptSiblingNonWrapperCount += 1;
        }
    };

    walk(directoryPath);
    return inventory;
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

    it('keeps executable tests, scripts, and tools lanes free of javascript files', () => {
        const laneRoots = ['tests', 'scripts', 'tools'];

        for (const laneRoot of laneRoots) {
            const laneInventory = collectExecutableJavaScriptInventory(join(repoRoot, laneRoot));
            expect(laneInventory.total).toBe(0);
        }
    });

    it('keeps source javascript migration inventory explicit and measurable', () => {
        const sourceInventory = collectExecutableJavaScriptInventory(join(repoRoot, 'src'));

        expect(sourceInventory.total).toBe(122);
        expect(sourceInventory.withTypeScriptSiblingCount).toBe(87);
        expect(sourceInventory.wrapperProxyCount).toBe(75);
        expect(sourceInventory.withTypeScriptSiblingNonWrapperCount).toBe(12);
        expect(sourceInventory.withoutTypeScriptSiblingCount).toBe(35);
    });

    it('removes first safe ts-proxy wrapper batch from source lane', () => {
        const removedWrapperPaths = [
            'src/core/EventBus.js',
            'src/core/config-builders.js',
            'src/obs/display-config-validator.js',
            'src/obs/display-queue-state.js',
            'src/obs/display-renderer.js',
            'src/obs/obs-event-service.js',
            'src/obs/safe-operations.js',
            'src/utils/currency-utils.js',
            'src/utils/monetization-error-utils.js',
            'src/utils/user-friendly-errors.js'
        ];

        for (const wrapperPath of removedWrapperPaths) {
            expect(existsSync(join(repoRoot, wrapperPath))).toBe(false);
        }
    });

    it('migrates first js-only utility batch to typescript source files', () => {
        const migratedUtilities = [
            'src/utils/env-file-parser',
            'src/utils/file-logger'
        ];

        for (const modulePath of migratedUtilities) {
            expect(existsSync(join(repoRoot, `${modulePath}.ts`))).toBe(true);
            expect(existsSync(join(repoRoot, `${modulePath}.js`))).toBe(false);
        }
    });

    it('keeps transitional tsconfig allowJs lane contracts explicit before final hardening', () => {
        const laneConfigPaths = [
            'tsconfig.src.json',
            'tsconfig.tests.json',
            'tsconfig.scripts.json',
            'tsconfig.tools.json'
        ];

        for (const laneConfigPath of laneConfigPaths) {
            const laneConfig = JSON.parse(readFileSync(join(repoRoot, laneConfigPath), 'utf8')) as {
                compilerOptions?: {
                    allowJs?: boolean;
                };
                include?: string[];
            };

            expect(laneConfig.compilerOptions?.allowJs).toBe(true);
            expect(laneConfig.include?.some(pattern => pattern.includes('**/*.js'))).toBe(true);
        }
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

    it('keeps gui preview script strictness contracts explicit and narrowed', () => {
        const modulePaths = [
            'scripts/local/gui-preview.ts',
            'scripts/local/gui-gift-animation-preview.ts'
        ];
        const forbiddenLegacySignatures: Array<{ path: string; signatures: string[] }> = [
            {
                path: 'scripts/local/gui-preview.ts',
                signatures: [
                    'type UnknownRecord = Record<string, any>;',
                    'TwitchEventRouterModule as unknown as',
                    'UserTrackingServiceModule as unknown as',
                    'VFXCommandServiceModule as unknown as',
                    'CommandCooldownServiceModule as unknown as'
                ]
            },
            {
                path: 'scripts/local/gui-gift-animation-preview.ts',
                signatures: [
                    'const rawEvent: any =',
                    'const rawData: any =',
                    'const sourceUser: any ='
                ]
            }
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toContain(': any');
            expect(content).not.toContain('as unknown as');
            expect(content).not.toContain('Record<string, any>');
        }

        for (const assertion of forbiddenLegacySignatures) {
            const content = readFileSync(join(repoRoot, assertion.path), 'utf8');
            for (const signature of assertion.signatures) {
                expect(content).not.toContain(signature);
            }
        }
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

    it('keeps youtube and innertube service chain modules free of commonjs module syntax', () => {
        const modulePaths = [
            'src/factories/innertube-factory.ts',
            'src/services/innertube-instance-manager.ts',
            'src/services/innertube-service.ts',
            'src/services/youtube-channel-resolver.ts',
            'src/services/youtube-live-stream-service.ts',
            'src/services/youtube-stream-detection-service.ts'
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

    it('keeps messaging and notification surface modules free of commonjs module syntax', () => {
        const modulePaths = [
            'src/chat/commands.ts',
            'src/services/ChatFileLoggingService.ts',
            'src/services/ChatNotificationRouter.ts',
            'src/services/SelfMessageDetectionService.ts',
            'src/services/UserTrackingService.ts',
            'src/utils/message-normalization.ts',
            'src/utils/monetization-error-utils.ts',
            'src/utils/notification-builder.ts',
            'src/utils/notification-template-interpolator.ts'
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

    it('keeps lifecycle, vfx, and gui orchestration modules free of commonjs module syntax', () => {
        const modulePaths = [
            'src/services/CommandCooldownService.ts',
            'src/services/GracefulExitService.ts',
            'src/services/PlatformEventRouter.ts',
            'src/services/PlatformLifecycleService.ts',
            'src/services/VFXCommandService.ts',
            'src/services/gui/event-to-gui-contract-mapper.ts',
            'src/services/gui/gui-transport-service.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/module\[['"]exports['"]\]/);
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps tiktok helper pipeline modules free of commonjs module syntax', () => {
        const modulePaths = [
            'src/platforms/tiktok-websocket-client.ts',
            'src/platforms/tiktok/connections/tiktok-connection-orchestrator.ts',
            'src/platforms/tiktok/events/event-factory.ts',
            'src/platforms/tiktok/events/event-normalizer.ts',
            'src/platforms/tiktok/events/event-router.ts',
            'src/platforms/tiktok/monetization/gift-aggregator.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/module\[['"]exports['"]\]/);
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps tiktok strictness contracts explicit and narrowed', () => {
        const modulePaths = [
            'src/platforms/tiktok.ts',
            'src/platforms/tiktok-websocket-client.ts',
            'src/platforms/tiktok/connections/tiktok-connection-orchestrator.ts',
            'src/platforms/tiktok/events/event-factory.ts',
            'src/platforms/tiktok/events/event-normalizer.ts',
            'src/platforms/tiktok/events/event-router.ts',
            'src/platforms/tiktok/monetization/gift-aggregator.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toContain(': any');
            expect(content).not.toContain('UnknownRecord');
        }
    });

    it('keeps messaging, lifecycle, and gui strictness contracts explicit and narrowed', () => {
        const modulePaths = [
            'src/chat/commands.ts',
            'src/services/ChatNotificationRouter.ts',
            'src/services/PlatformEventRouter.ts',
            'src/services/PlatformLifecycleService.ts',
            'src/services/VFXCommandService.ts',
            'src/services/gui/event-to-gui-contract-mapper.ts',
            'src/services/gui/gui-transport-service.ts',
            'src/utils/message-normalization.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toContain(': any');
            expect(content).not.toContain('UnknownRecord');
        }
    });

    it('keeps twitch auth and oauth-flow strictness contracts explicit and narrowed', () => {
        const modulePaths = [
            'src/auth/TwitchAuth.ts',
            'src/auth/oauth-flow.ts'
        ];
        const forbiddenLegacySignatures: Array<{ path: string; signatures: string[] }> = [
            {
                path: 'src/auth/TwitchAuth.ts',
                signatures: [
                    'const createTwitchAuthErrorHandler = (logger) =>',
                    'const logAuthError = (handler, message, error',
                    'const ensureCamelTokenPayload = (payload, sourceLabel) =>',
                    'const parseRefreshResponse = (data) =>',
                    'const computeExpiresAt = (normalized) =>'
                ]
            },
            {
                path: 'src/auth/oauth-flow.ts',
                signatures: [
                    'const createOAuthFlowErrorHandler = (logger) =>',
                    'const safeCloseServer = (server) =>',
                    'function buildAuthUrl(clientId, redirectUri',
                    'function displayOAuthInstructions(authUrl, logger',
                    'function openBrowser(authUrl, logger'
                ]
            }
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toContain(': any');
            expect(content).not.toContain('UnknownRecord');
        }

        for (const assertion of forbiddenLegacySignatures) {
            const content = readFileSync(join(repoRoot, assertion.path), 'utf8');
            for (const signature of assertion.signatures) {
                expect(content).not.toContain(signature);
            }
        }
    });

    it('keeps platform-event and twitch eventsub strictness contracts explicit and narrowed', () => {
        const modulePaths = [
            'src/interfaces/PlatformEvents.ts',
            'src/platforms/twitch-eventsub.ts',
            'src/platforms/twitch.ts',
            'src/platforms/twitch/events/event-normalizer.ts',
            'src/platforms/twitch/events/event-router.ts'
        ];
        const forbiddenLegacySignatures: Array<{ path: string; signatures: string[] }> = [
            {
                path: 'src/interfaces/PlatformEvents.ts',
                signatures: [
                    'function resolveAvatarUrl(avatarUrl)',
                    'validate(event) {',
                    '_validateFieldType(value, schema, fieldName)',
                    'createChatMessage(params) {',
                    'normalizeMessage(platform, data) {',
                    'static createChatMessageEvent(platform, identity, message, metadata = {})',
                    'platform(platform) {'
                ]
            },
            {
                path: 'src/platforms/twitch-eventsub.ts',
                signatures: [
                    'constructor(config, dependencies = {})',
                    '_isDuplicateMessageId(metadata) {',
                    'handleWebSocketMessage(message) {',
                    'sendMessage(message) {',
                    "_logEventSubError(message, error = null, eventType = 'twitch-eventsub', payload = null)"
                ]
            },
            {
                path: 'src/platforms/twitch.ts',
                signatures: [
                    'constructor(config, dependencies = {})',
                    'async initialize(handlers) {',
                    '_resolvePlatformEventType(eventType) {',
                    "_logPlatformError(message, error = null, eventType = 'twitch-platform', payload = null)"
                ]
            },
            {
                path: 'src/platforms/twitch/events/event-normalizer.ts',
                signatures: [
                    'const normalizeMonths = (value) =>',
                    'const normalizeUserIdentity = (username, userId) =>',
                    'const applyNotificationMetadataFallback = (event, metadata, subscriptionType) =>'
                ]
            },
            {
                path: 'src/platforms/twitch/events/event-router.ts',
                signatures: [
                    'function createTwitchEventSubEventRouter(options = {})',
                    'const logRawIfEnabled = (eventType, event, failureStage, failureMessagePrefix) =>',
                    'const handleNotificationEvent = (subscriptionType, event, metadata) =>'
                ]
            }
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toContain(': any');
            expect(content).not.toContain('UnknownRecord');
        }

        for (const assertion of forbiddenLegacySignatures) {
            const content = readFileSync(join(repoRoot, assertion.path), 'utf8');
            for (const signature of assertion.signatures) {
                expect(content).not.toContain(signature);
            }
        }
    });

    it('keeps tiktok platform shell module free of commonjs module syntax', () => {
        const content = readFileSync(join(repoRoot, 'src/platforms/tiktok.ts'), 'utf8');

        expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
        expect(content).not.toMatch(/\brequire\s*\(/);
        expect(content).not.toContain('module.exports');
        expect(content).not.toMatch(/module\[['"]exports['"]\]/);
        expect(content).not.toMatch(/^\s*exports\./m);
    });

    it('keeps twitch eventsub, event, and api helper modules free of commonjs module syntax', () => {
        const modulePaths = [
            'src/platforms/twitch/connections/eventsub-subscription-manager.ts',
            'src/platforms/twitch/connections/eventsub-subscriptions.ts',
            'src/platforms/twitch/connections/wiring.ts',
            'src/platforms/twitch/connections/ws-lifecycle.ts',
            'src/platforms/twitch/events/event-factory.ts',
            'src/platforms/twitch/events/event-normalizer.ts',
            'src/platforms/twitch/events/event-router.ts',
            'src/utils/api-clients/twitch-api-client.ts',
            'src/utils/cheermote-processor.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/module\[['"]exports['"]\]/);
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps twitch auth, shell, and token modules free of commonjs module syntax', () => {
        const modulePaths = [
            'src/auth/TwitchAuth.ts',
            'src/auth/oauth-flow.ts',
            'src/platforms/twitch-eventsub.ts',
            'src/platforms/twitch.ts',
            'src/utils/token-store.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/module\[['"]exports['"]\]/);
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps app composition entrypoint modules free of commonjs module syntax', () => {
        const modulePaths = [
            'src/bootstrap.ts',
            'src/interfaces/PlatformEvents.ts',
            'src/main.ts',
            'src/platforms/index.ts',
            'src/runtime/AppRuntime.ts'
        ];

        for (const modulePath of modulePaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/module\[['"]exports['"]\]/);
            expect(content).not.toMatch(/^\s*exports\./m);
        }
    });

    it('keeps phase 15 runtime core interop seams explicit and narrowed', () => {
        const commonJsBoundaryPaths = [
            'src/core/config.ts',
            'src/core/index.ts'
        ];
        const forbiddenInteropPatterns = [
            {
                path: 'src/main.ts',
                forbidden: [
                    "const nodeRequire = createRequire(import.meta.url);",
                    "nodeRequire('./core')",
                    "nodeRequire('./core/constants')",
                    "from './services/CommandCooldownService.js'",
                    "from './services/GracefulExitService.js'",
                    "from './services/PlatformLifecycleService.js'",
                    "from './services/VFXCommandService.js'"
                ]
            },
            {
                path: 'src/runtime/AppRuntime.ts',
                forbidden: [
                    "from '../services/ChatNotificationRouter.js'",
                    "from '../services/PlatformEventRouter.js'",
                    "from '../services/VFXCommandService.js'"
                ]
            },
            {
                path: 'src/core/logging.ts',
                forbidden: [
                    "nodeRequire('../utils/text-processing')",
                    "nodeRequire('../utils/file-logger')"
                ]
            },
            {
                path: 'src/utils/logger-utils.ts',
                forbidden: [
                    "nodeRequire('../core/logging')"
                ]
            },
            {
                path: 'src/utils/secret-manager.ts',
                forbidden: [
                    "nodeRequire('./env-file-parser')",
                    "nodeRequire('./logger-resolver')"
                ]
            },
            {
                path: 'src/utils/validation.ts',
                forbidden: [
                    "nodeRequire('../core/config')"
                ]
            }
        ];

        for (const modulePath of commonJsBoundaryPaths) {
            const content = readFileSync(join(repoRoot, modulePath), 'utf8');

            expect(content).not.toMatch(/^\s*(?:const|let|var)\s+.+?=\s*require\s*\(/m);
            expect(content).not.toMatch(/\brequire\s*\(/);
            expect(content).not.toContain('module.exports');
            expect(content).not.toMatch(/module\[['"]exports['"]\]/);
            expect(content).not.toMatch(/^\s*exports\./m);
        }

        for (const assertion of forbiddenInteropPatterns) {
            const content = readFileSync(join(repoRoot, assertion.path), 'utf8');
            for (const forbiddenPattern of assertion.forbidden) {
                expect(content).not.toContain(forbiddenPattern);
            }
        }
    });

    it('keeps obs stateful manager strictness seams explicit and narrowed', () => {
        const assertions = [
            {
                path: 'src/obs/display-queue.ts',
                forbidden: [
                    "from 'node:module'",
                    'createRequire(',
                    'nodeRequire('
                ]
            },
            {
                path: 'src/obs/sources.ts',
                forbidden: [
                    "from 'node:module'",
                    'createRequire(',
                    'nodeRequire('
                ]
            },
            {
                path: 'src/obs/connection.ts',
                forbidden: [
                    "from 'node:module'",
                    'createRequire(',
                    'nodeRequire('
                ]
            },
            {
                path: 'src/obs/display-queue-effects.ts',
                forbidden: [
                    "from 'node:module'",
                    'createRequire(',
                    'nodeRequire('
                ]
            },
            {
                path: 'src/utils/goal-tracker.ts',
                forbidden: [
                    "from 'node:module'",
                    'createRequire(',
                    'nodeRequire('
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

    it('keeps youtube currency parser logger resolver typing declaration present', () => {
        const declarationPath = join(repoRoot, 'src/utils/logger-resolver.d.ts');
        expect(existsSync(declarationPath)).toBe(true);

        const declarationContent = readFileSync(declarationPath, 'utf8');
        expect(declarationContent).toContain('export function resolveLogger(');
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

    it('keeps phase 15 youtube interop seams explicit and import-based', () => {
        const assertions: Array<{ path: string; forbidden: string[] }> = [
            {
                path: 'src/platforms/youtube/events/event-router.ts',
                forbidden: [
                    "import { createRequire } from 'node:module';",
                    'const nodeRequire = createRequire(__filename);',
                    "nodeRequire('../../../utils/platform-error-handler')",
                    "nodeRequire('../../../interfaces/PlatformEvents')",
                    "nodeRequire('../../../utils/dependency-validator')"
                ]
            },
            {
                path: 'src/platforms/youtube/events/event-factory.ts',
                forbidden: [
                    "import { createRequire } from 'node:module';",
                    'const nodeRequire = createRequire(__filename);',
                    "nodeRequire('../../../interfaces/PlatformEvents')",
                    "nodeRequire('../../../constants/avatar')",
                    "nodeRequire('../../../constants/degraded-chat')",
                    "nodeRequire('../../../utils/missing-fields')"
                ]
            },
            {
                path: 'src/platforms/youtube/connections/youtube-connection-factory.ts',
                forbidden: [
                    "import { createRequire } from 'node:module';",
                    'const nodeRequire = createRequire(__filename);',
                    "nodeRequire('../../../utils/validation')",
                    "nodeRequire('../youtube-username-normalizer')",
                    "nodeRequire('../../../factories/innertube-factory')"
                ]
            },
            {
                path: 'src/platforms/youtube/streams/youtube-multistream-manager.ts',
                forbidden: [
                    "import { createRequire } from 'node:module';",
                    'const nodeRequire = createRequire(__filename);',
                    "nodeRequire('../../../interfaces/PlatformEvents')"
                ]
            },
            {
                path: 'src/platforms/youtube/youtubei-currency-parser.ts',
                forbidden: [
                    "import { createRequire } from 'node:module';",
                    'const nodeRequire = createRequire(__filename);',
                    "nodeRequire('../../utils/platform-error-handler')",
                    "nodeRequire('../../utils/logger-resolver')"
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
});
