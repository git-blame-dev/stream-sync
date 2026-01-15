#!/usr/bin/env node
/**
 * Jest to Bun Test Migration Script
 *
 * Automatically converts Jest test files to use Bun's test runner with
 * the project's bun-* helper modules.
 *
 * Usage:
 *   node scripts/migrate-jest-to-bun.js [--dry-run] [--audit] [--fix] [file-pattern]
 *
 * Options:
 *   --dry-run   Show what would be changed without writing files
 *   --audit     Audit files for cleanup anti-patterns (no migration)
 *   --fix       Also fix cleanup anti-patterns (remove clearAllMocks from beforeEach,
 *               remove unnecessary resetModules)
 *   --verbose   Show detailed output for each file
 *
 * Examples:
 *   node scripts/migrate-jest-to-bun.js --dry-run          # Preview all migrations
 *   node scripts/migrate-jest-to-bun.js --fix              # Migrate + fix cleanup issues
 *   node scripts/migrate-jest-to-bun.js --audit            # Find cleanup anti-patterns
 *   node scripts/migrate-jest-to-bun.js "auth*.test.js"    # Migrate matching files only
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const AUDIT_MODE = args.includes('--audit');
const FIX_CLEANUP = args.includes('--fix');
const VERBOSE = args.includes('--verbose');
const filePattern = args.find(a => !a.startsWith('--'));

// Helper exports from each bun helper module
const BUN_MOCK_UTILS_EXPORTS = [
    'createMockFn', 'isMockFunction', 'mockResolvedValue', 'mockRejectedValue',
    'clearMock', 'resetMock', 'clearAllMocks', 'restoreAllMocks', 'resetAllMocks', 'spyOn'
];

const BUN_MODULE_MOCKS_EXPORTS = [
    'mockModule', 'unmockModule', 'requireActual', 'resetModules', 'restoreAllModuleMocks'
];

const BUN_TIMERS_EXPORTS = [
    'installTimerTracking', 'clearTrackedTimers', 'restoreTimerTracking',
    'useFakeTimers', 'useRealTimers', 'advanceTimersByTime', 'runOnlyPendingTimers',
    'runAllTimers', 'clearAllTimers', 'getTimerCount'
];

// Jest API to Bun helper mapping
const JEST_TO_BUN_MAPPING = {
    // bun-mock-utils replacements
    'jest.fn': 'createMockFn',
    'jest.spyOn': 'spyOn',
    'jest.clearAllMocks': 'clearAllMocks',
    'jest.restoreAllMocks': 'restoreAllMocks',
    'jest.resetAllMocks': 'resetAllMocks',
    'jest.isMockFunction': 'isMockFunction',

    // bun-module-mocks replacements
    'jest.mock': 'mockModule',
    'jest.unmock': 'unmockModule',
    'jest.requireActual': 'requireActual',
    'jest.resetModules': 'resetModules',
    'jest.doMock': 'mockModule',

    // bun-timers replacements
    'jest.useFakeTimers': 'useFakeTimers',
    'jest.useRealTimers': 'useRealTimers',
    'jest.advanceTimersByTime': 'advanceTimersByTime',
    'jest.runOnlyPendingTimers': 'runOnlyPendingTimers',
    'jest.runAllTimers': 'runAllTimers',
    'jest.runOnlyPendingTimersAsync': 'runOnlyPendingTimers',
    'jest.runAllTimersAsync': 'runAllTimers',
    'jest.clearAllTimers': 'clearAllTimers',
    'jest.getTimerCount': 'getTimerCount',

    // These stay as jest.X from bun:test
    'jest.setSystemTime': 'jest.setSystemTime',
    'jest.setTimeout': 'jest.setTimeout',
};

// Detect which helper module a function comes from
function getHelperModule(funcName) {
    if (BUN_MOCK_UTILS_EXPORTS.includes(funcName)) return 'bun-mock-utils';
    if (BUN_MODULE_MOCKS_EXPORTS.includes(funcName)) return 'bun-module-mocks';
    if (BUN_TIMERS_EXPORTS.includes(funcName)) return 'bun-timers';
    return null;
}

// Calculate relative path from test file to helpers
function getRelativePath(testFilePath, helperName) {
    const testDir = path.dirname(testFilePath);
    const helpersDir = path.join(process.cwd(), 'tests', 'helpers');
    let relativePath = path.relative(testDir, helpersDir);
    if (!relativePath.startsWith('.')) {
        relativePath = './' + relativePath;
    }
    return relativePath.replace(/\\/g, '/') + '/' + helperName;
}

// Analyze a file to detect Jest API usage
function analyzeFile(content) {
    const analysis = {
        hasJestGlobalsImport: /@jest\/globals/.test(content),
        hasBunTestImport: /require\(['"]bun:test['"]\)/.test(content),

        // Mock utils
        usesJestFn: /jest\.fn\s*\(/.test(content),
        usesJestSpyOn: /jest\.spyOn\s*\(/.test(content),
        usesJestClearAllMocks: /jest\.clearAllMocks\s*\(/.test(content),
        usesJestRestoreAllMocks: /jest\.restoreAllMocks\s*\(/.test(content),
        usesJestResetAllMocks: /jest\.resetAllMocks\s*\(/.test(content),
        usesJestIsMockFunction: /jest\.isMockFunction\s*\(/.test(content),

        // Module mocks
        usesJestMock: /jest\.mock\s*\(/.test(content),
        usesJestDoMock: /jest\.doMock\s*\(/.test(content),
        usesJestUnmock: /jest\.unmock\s*\(/.test(content),
        usesJestRequireActual: /jest\.requireActual\s*\(/.test(content),
        usesJestResetModules: /jest\.resetModules\s*\(/.test(content),

        // Timers
        usesJestFakeTimers: /jest\.useFakeTimers\s*\(/.test(content),
        usesJestRealTimers: /jest\.useRealTimers\s*\(/.test(content),
        usesJestAdvanceTimers: /jest\.advanceTimersByTime\s*\(/.test(content),
        usesJestRunPendingTimers: /jest\.runOnlyPendingTimers/.test(content),
        usesJestRunAllTimers: /jest\.runAllTimers/.test(content),
        usesJestClearAllTimers: /jest\.clearAllTimers\s*\(/.test(content),
        usesJestSetSystemTime: /jest\.setSystemTime\s*\(/.test(content),
        usesJestSetTimeout: /jest\.setTimeout\s*\(/.test(content),

        // Already has bun helpers
        hasBunMockUtils: /bun-mock-utils/.test(content),
        hasBunModuleMocks: /bun-module-mocks/.test(content),
        hasBunTimers: /bun-timers/.test(content),

        // Cleanup patterns
        hasAfterEach: /afterEach\s*\(/.test(content),
        hasBeforeEach: /beforeEach\s*\(/.test(content),
        hasRestoreAllMocksInCleanup: /afterEach[^}]*restoreAllMocks/s.test(content),
        hasRestoreAllModuleMocksInCleanup: /afterEach[^}]*restoreAllModuleMocks/s.test(content),
        hasResetModulesInCleanup: /afterEach[^}]*resetModules/s.test(content),
        hasClearAllMocksInBeforeEach: /beforeEach[^}]*clearAllMocks/s.test(content),
    };

    // Derived flags
    analysis.needsMockUtils = analysis.usesJestFn || analysis.usesJestSpyOn ||
        analysis.usesJestClearAllMocks || analysis.usesJestRestoreAllMocks ||
        analysis.usesJestResetAllMocks || analysis.usesJestIsMockFunction;

    analysis.needsModuleMocks = analysis.usesJestMock || analysis.usesJestDoMock ||
        analysis.usesJestUnmock || analysis.usesJestRequireActual || analysis.usesJestResetModules;

    analysis.needsTimers = analysis.usesJestFakeTimers || analysis.usesJestRealTimers ||
        analysis.usesJestAdvanceTimers || analysis.usesJestRunPendingTimers ||
        analysis.usesJestRunAllTimers || analysis.usesJestClearAllTimers;

    analysis.needsJestFromBunTest = analysis.usesJestSetSystemTime || analysis.usesJestSetTimeout;

    return analysis;
}

// Audit a file for cleanup overkill
function auditFile(filePath, content) {
    const analysis = analyzeFile(content);
    const issues = [];

    // Check for resetModules without dynamic requires
    if (analysis.hasResetModulesInCleanup) {
        // Check if file actually does dynamic requires (require inside test functions)
        const hasDynamicRequires = /(?:it|test|describe)\s*\([^)]+,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{[^}]*require\s*\(/s.test(content);
        if (!hasDynamicRequires) {
            issues.push({
                type: 'unnecessary-resetModules',
                message: 'resetModules() in cleanup but no dynamic requires detected',
                severity: 'warning'
            });
        }
    }

    // Check for restoreAllModuleMocks without mockModule
    if (analysis.hasRestoreAllModuleMocksInCleanup && !analysis.needsModuleMocks && !analysis.hasBunModuleMocks) {
        issues.push({
            type: 'unnecessary-restoreAllModuleMocks',
            message: 'restoreAllModuleMocks() in cleanup but no mockModule usage detected',
            severity: 'warning'
        });
    }

    // Check for clearAllMocks in beforeEach (anti-pattern)
    if (analysis.hasClearAllMocksInBeforeEach) {
        issues.push({
            type: 'clearAllMocks-in-beforeEach',
            message: 'clearAllMocks() in beforeEach - prefer restoreAllMocks() in afterEach',
            severity: 'info'
        });
    }

    return issues;
}

// Transform file content from Jest to Bun
function transformFile(filePath, content) {
    const analysis = analyzeFile(content);
    let transformed = content;
    const changes = [];

    // Skip if already fully migrated
    if (analysis.hasBunTestImport && !analysis.hasJestGlobalsImport &&
        !analysis.usesJestFn && !analysis.usesJestMock && !analysis.usesJestFakeTimers) {
        return { content: transformed, changes: [], skipped: true };
    }

    // 1. Remove @jest/globals import
    if (analysis.hasJestGlobalsImport) {
        transformed = transformed.replace(
            /const\s*\{[^}]+\}\s*=\s*require\s*\(\s*['"]@jest\/globals['"]\s*\)\s*;?\s*\n?/g,
            ''
        );
        changes.push('Removed @jest/globals import');
    }

    // 2. Determine what to import from bun:test
    const bunTestImports = new Set(['describe', 'test', 'expect']);
    if (/beforeEach/.test(transformed)) bunTestImports.add('beforeEach');
    if (/afterEach/.test(transformed)) bunTestImports.add('afterEach');
    if (/beforeAll/.test(transformed)) bunTestImports.add('beforeAll');
    if (/afterAll/.test(transformed)) bunTestImports.add('afterAll');
    if (/\bit\s*\(/.test(transformed)) bunTestImports.add('it');
    if (analysis.needsJestFromBunTest) bunTestImports.add('jest');

    // 3. Build helper imports based on what's needed
    const relativePath = (helper) => getRelativePath(filePath, helper);
    const helperImports = [];

    if (analysis.needsMockUtils || analysis.hasBunMockUtils) {
        const imports = [];
        if (analysis.usesJestFn) imports.push('createMockFn');
        if (analysis.usesJestSpyOn) imports.push('spyOn');
        if (analysis.usesJestClearAllMocks) imports.push('clearAllMocks');
        if (analysis.usesJestRestoreAllMocks || analysis.needsMockUtils) imports.push('restoreAllMocks');
        if (analysis.usesJestResetAllMocks) imports.push('resetAllMocks');
        if (analysis.usesJestIsMockFunction) imports.push('isMockFunction');

        // Dedupe
        const uniqueImports = [...new Set(imports)];
        if (uniqueImports.length > 0) {
            helperImports.push(`const { ${uniqueImports.join(', ')} } = require('${relativePath('bun-mock-utils')}');`);
        }
    }

    if (analysis.needsModuleMocks) {
        const imports = [];
        if (analysis.usesJestMock || analysis.usesJestDoMock) imports.push('mockModule');
        if (analysis.usesJestUnmock) imports.push('unmockModule');
        if (analysis.usesJestRequireActual) imports.push('requireActual');
        if (analysis.usesJestResetModules) imports.push('resetModules');
        imports.push('restoreAllModuleMocks'); // Always need this for cleanup

        const uniqueImports = [...new Set(imports)];
        helperImports.push(`const { ${uniqueImports.join(', ')} } = require('${relativePath('bun-module-mocks')}');`);
    }

    if (analysis.needsTimers) {
        const imports = [];
        if (analysis.usesJestFakeTimers) imports.push('useFakeTimers');
        if (analysis.usesJestRealTimers) imports.push('useRealTimers');
        if (analysis.usesJestAdvanceTimers) imports.push('advanceTimersByTime');
        if (analysis.usesJestRunPendingTimers) imports.push('runOnlyPendingTimers');
        if (analysis.usesJestRunAllTimers) imports.push('runAllTimers');
        if (analysis.usesJestClearAllTimers) imports.push('clearAllTimers');

        const uniqueImports = [...new Set(imports)];
        if (uniqueImports.length > 0) {
            helperImports.push(`const { ${uniqueImports.join(', ')} } = require('${relativePath('bun-timers')}');`);
        }
    }

    // 4. Add bun:test import at the top if not present
    if (!analysis.hasBunTestImport) {
        const bunTestImport = `const { ${[...bunTestImports].join(', ')} } = require('bun:test');\n`;

        // Find first non-comment, non-empty line to insert after
        const lines = transformed.split('\n');
        let insertIndex = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*')) {
                insertIndex = i;
                break;
            }
        }

        // Build the import block
        let importBlock = bunTestImport;
        if (helperImports.length > 0) {
            importBlock += helperImports.join('\n') + '\n';
        }

        lines.splice(insertIndex, 0, importBlock);
        transformed = lines.join('\n');
        changes.push('Added bun:test import');
        if (helperImports.length > 0) {
            changes.push(`Added helper imports: ${helperImports.length} modules`);
        }
    } else if (helperImports.length > 0) {
        // Insert helper imports after the bun:test import
        transformed = transformed.replace(
            /(const\s*\{[^}]+\}\s*=\s*require\s*\(\s*['"]bun:test['"]\s*\)\s*;?\s*\n)/,
            '$1' + helperImports.join('\n') + '\n'
        );
        changes.push(`Added helper imports: ${helperImports.length} modules`);
    }

    // 5. Replace Jest API calls with Bun equivalents
    const replacements = [
        // Mock utils
        [/jest\.fn\(\)/g, 'createMockFn()'],
        [/jest\.fn\(([^)]+)\)/g, 'createMockFn($1)'],
        [/jest\.spyOn\(/g, 'spyOn('],
        [/jest\.clearAllMocks\(\)/g, 'clearAllMocks()'],
        [/jest\.restoreAllMocks\(\)/g, 'restoreAllMocks()'],
        [/jest\.resetAllMocks\(\)/g, 'resetAllMocks()'],
        [/jest\.isMockFunction\(/g, 'isMockFunction('],

        // Module mocks - be careful with jest.mock() which has different syntax
        [/jest\.unmock\(/g, 'unmockModule('],
        [/jest\.requireActual\(/g, 'requireActual('],
        [/jest\.resetModules\(\)/g, 'resetModules()'],

        // Timers
        [/jest\.useFakeTimers\(\)/g, 'useFakeTimers()'],
        [/jest\.useFakeTimers\(([^)]+)\)/g, 'useFakeTimers($1)'],
        [/jest\.useRealTimers\(\)/g, 'useRealTimers()'],
        [/jest\.advanceTimersByTime\(/g, 'advanceTimersByTime('],
        [/jest\.runOnlyPendingTimers\(\)/g, 'runOnlyPendingTimers()'],
        [/jest\.runOnlyPendingTimersAsync\(\)/g, 'runOnlyPendingTimers()'],
        [/jest\.runAllTimers\(\)/g, 'runAllTimers()'],
        [/jest\.runAllTimersAsync\(\)/g, 'runAllTimers()'],
        [/jest\.clearAllTimers\(\)/g, 'clearAllTimers()'],
    ];

    for (const [pattern, replacement] of replacements) {
        if (pattern.test(transformed)) {
            transformed = transformed.replace(pattern, replacement);
            changes.push(`Replaced ${pattern.source.replace(/\\/g, '')} with ${replacement}`);
        }
    }

    // 6. Handle jest.mock() -> mockModule() (special case - different argument order sometimes)
    if (analysis.usesJestMock) {
        // jest.mock('module', () => ({...})) -> mockModule('module', () => ({...}))
        transformed = transformed.replace(/jest\.mock\(/g, 'mockModule(');
        changes.push('Replaced jest.mock with mockModule');
    }

    if (analysis.usesJestDoMock) {
        transformed = transformed.replace(/jest\.doMock\(/g, 'mockModule(');
        changes.push('Replaced jest.doMock with mockModule');
    }

    // 7. Add cleanup if needed and not present
    const needsCleanup = analysis.needsMockUtils || analysis.needsModuleMocks || analysis.needsTimers;
    if (needsCleanup && !analysis.hasAfterEach) {
        // Find the first describe block and add afterEach
        const cleanupCalls = [];
        if (analysis.needsMockUtils) cleanupCalls.push('restoreAllMocks();');
        if (analysis.needsModuleMocks) cleanupCalls.push('restoreAllModuleMocks();');
        if (analysis.needsTimers) cleanupCalls.push('useRealTimers();');

        const afterEachBlock = `\n    afterEach(() => {\n        ${cleanupCalls.join('\n        ')}\n    });\n`;

        // Insert after first describe( opening
        transformed = transformed.replace(
            /(describe\s*\([^,]+,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{)/,
            '$1' + afterEachBlock
        );
        changes.push('Added afterEach cleanup block');
    } else if (needsCleanup && analysis.hasAfterEach) {
        // Check if cleanup calls are missing from existing afterEach
        if (analysis.needsMockUtils && !analysis.hasRestoreAllMocksInCleanup) {
            // Try to add restoreAllMocks() to existing afterEach
            transformed = transformed.replace(
                /(afterEach\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{)/,
                '$1\n        restoreAllMocks();'
            );
            changes.push('Added restoreAllMocks() to existing afterEach');
        }
        if (analysis.needsModuleMocks && !analysis.hasRestoreAllModuleMocksInCleanup) {
            transformed = transformed.replace(
                /(afterEach\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[^}]*)(restoreAllMocks\(\);)?/,
                '$1$2\n        restoreAllModuleMocks();'
            );
            changes.push('Added restoreAllModuleMocks() to existing afterEach');
        }
    }

    // 8. Fix cleanup anti-patterns (when --fix is enabled)
    if (FIX_CLEANUP) {
        // Fix: Remove clearAllMocks() from beforeEach (it masks test pollution)
        if (/beforeEach\s*\([^)]*\)\s*=>\s*\{[^}]*clearAllMocks\s*\(\s*\)/s.test(transformed)) {
            // Remove clearAllMocks() call from beforeEach
            transformed = transformed.replace(
                /(beforeEach\s*\([^)]*\)\s*=>\s*\{[^}]*)clearAllMocks\s*\(\s*\)\s*;?\s*\n?\s*/s,
                '$1'
            );
            changes.push('Removed clearAllMocks() from beforeEach (anti-pattern)');

            // Make sure restoreAllMocks is in afterEach instead
            if (!/afterEach[^}]*restoreAllMocks/s.test(transformed)) {
                if (/afterEach\s*\(/.test(transformed)) {
                    transformed = transformed.replace(
                        /(afterEach\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{)/,
                        '$1\n        restoreAllMocks();'
                    );
                    changes.push('Added restoreAllMocks() to afterEach (replacement for beforeEach clearAllMocks)');
                }
            }
        }

        // Fix: Remove unnecessary resetModules() if no dynamic requires
        const hasDynamicRequires = /(?:it|test)\s*\([^)]+,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{[^}]*\brequire\s*\(/s.test(transformed);
        if (!hasDynamicRequires && /resetModules\s*\(\s*\)/.test(transformed)) {
            // Check if resetModules is only in afterEach cleanup (not in beforeEach for re-mocking)
            const hasResetModulesInBeforeEach = /beforeEach[^}]*resetModules\s*\(\s*\)/s.test(transformed);

            if (!hasResetModulesInBeforeEach) {
                // Safe to remove from afterEach
                transformed = transformed.replace(
                    /\s*resetModules\s*\(\s*\)\s*;?\s*\n?/g,
                    '\n'
                );
                changes.push('Removed unnecessary resetModules() (no dynamic requires)');

                // Also remove from imports if no longer used
                if (!/resetModules/.test(transformed.replace(/['"].*resetModules.*['"]/g, ''))) {
                    transformed = transformed.replace(
                        /,?\s*resetModules\s*,?/g,
                        (match) => match.includes(',') ? ', ' : ''
                    );
                }
            }
        }
    }

    return { content: transformed, changes, skipped: false };
}

// Find all test files
function findTestFiles(pattern) {
    const { execSync } = require('child_process');

    let cmd;
    if (pattern) {
        cmd = `find tests -name "${pattern}" -type f`;
    } else {
        cmd = `find tests -name "*.test.js" -type f | xargs grep -l 'jest\\.' 2>/dev/null || true`;
    }

    try {
        const output = execSync(cmd, { encoding: 'utf8', cwd: process.cwd() });
        return output.trim().split('\n').filter(f => f && f.endsWith('.test.js'));
    } catch (e) {
        return [];
    }
}

// Main execution
function main() {
    console.log('Jest to Bun Migration Script');
    console.log('============================');
    const modeFlags = [
        AUDIT_MODE ? 'AUDIT' : 'MIGRATE',
        FIX_CLEANUP ? '+fix-cleanup' : '',
        DRY_RUN ? '(dry-run)' : ''
    ].filter(Boolean).join(' ');
    console.log(`Mode: ${modeFlags}\n`);

    const testFiles = findTestFiles(filePattern);
    console.log(`Found ${testFiles.length} test files to process\n`);

    let totalChanges = 0;
    let filesModified = 0;
    let filesSkipped = 0;
    let auditIssues = [];

    for (const filePath of testFiles) {
        const fullPath = path.join(process.cwd(), filePath);

        try {
            const content = fs.readFileSync(fullPath, 'utf8');

            if (AUDIT_MODE) {
                const issues = auditFile(filePath, content);
                if (issues.length > 0) {
                    auditIssues.push({ file: filePath, issues });
                    if (VERBOSE) {
                        console.log(`\n${filePath}:`);
                        issues.forEach(i => console.log(`  [${i.severity}] ${i.message}`));
                    }
                }
            } else {
                const result = transformFile(fullPath, content);

                if (result.skipped) {
                    filesSkipped++;
                    if (VERBOSE) {
                        console.log(`SKIP: ${filePath} (already migrated)`);
                    }
                } else if (result.changes.length > 0) {
                    filesModified++;
                    totalChanges += result.changes.length;

                    console.log(`\n${filePath}:`);
                    result.changes.forEach(c => console.log(`  - ${c}`));

                    if (!DRY_RUN) {
                        fs.writeFileSync(fullPath, result.content, 'utf8');
                    }
                }
            }
        } catch (e) {
            console.error(`ERROR processing ${filePath}: ${e.message}`);
        }
    }

    console.log('\n============================');
    if (AUDIT_MODE) {
        console.log(`Audit complete: ${auditIssues.length} files with issues`);
        if (auditIssues.length > 0) {
            console.log('\nFiles with cleanup issues:');
            auditIssues.forEach(({ file, issues }) => {
                console.log(`  ${file}: ${issues.map(i => i.type).join(', ')}`);
            });
        }
    } else {
        console.log(`Migration complete:`);
        console.log(`  Files modified: ${filesModified}`);
        console.log(`  Files skipped: ${filesSkipped}`);
        console.log(`  Total changes: ${totalChanges}`);
        if (DRY_RUN) {
            console.log('\n(Dry run - no files were actually modified)');
        }
    }
}

main();
