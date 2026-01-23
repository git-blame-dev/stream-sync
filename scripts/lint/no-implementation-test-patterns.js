#!/usr/bin/env bun

/**
 * Implementation test pattern guard
 *
 * Detects anti-patterns where tests assert on implementation details
 * rather than observable behavior.
 *
 * Anti-patterns detected:
 * - Log message content assertions (non-contractual logs)
 * - Manual callback capture and invocation
 * - Error handler argument assertions beyond error identity
 *
 * Correct approach:
 * - Test observable outputs (payloads to downstream, state changes, thrown errors)
 * - Use fake timers to trigger callbacks naturally
 * - Only assert on contractual log output (monitoring/alerting requirements)
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TARGET_DIRECTORIES = ['tests'];
const FILE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const IGNORE_DIRECTORIES = new Set([
    'node_modules',
    'coverage',
    'helpers',
    'setup'
]);

const IMPLEMENTATION_PATTERNS = [
    {
        pattern: /(?:warnings|logs|debugLogs|infoLogs|errorLogs)\.some\s*\(\s*(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>\s*[^)]*\.(?:msg|message)\.includes\s*\(/g,
        message: 'Asserting on log message content',
        hint: 'Log assertions are only valid for contractual logs (monitoring/alerting). Test observable behavior instead.'
    },
    {
        pattern: /expect\s*\(\s*(?:warnings|logs)\[?\d*\]?(?:\[\d+\])?\s*\)\.(?:toContain|toMatch|toEqual)/g,
        message: 'Asserting on captured log content',
        hint: 'Test observable behavior (state changes, outputs) rather than internal log messages.'
    },
    {
        pattern: /let\s+captured(?:Callback|Fn|Handler)\b/g,
        message: 'Manual callback capture variable',
        hint: 'Use useFakeTimers() and advanceTimersByTime() to trigger callbacks naturally.'
    },
    {
        pattern: /await\s+captured(?:Callback|Fn|Handler)\s*\(\s*\)/g,
        message: 'Manual callback invocation',
        hint: 'Use advanceTimersByTime() to trigger timer callbacks instead of manual invocation.'
    },
    {
        pattern: /errorCalls\[\d+\]\[\d+\]\.(?:toBe|toEqual)\s*\(\s*['"`][^'"`]+['"`]\s*\)/g,
        message: 'Asserting on error handler internal arguments',
        hint: 'Only assert that errors are handled (errorCalls.length). Internal context strings are implementation details.'
    },
    {
        pattern: /expect\s*\(\s*errorCalls\[\d+\]\[1\]\s*\)\.toBe/g,
        message: 'Asserting on error handler context string argument',
        hint: 'Error context strings (second arg) are implementation details. Only verify errors are handled via errorCalls.length.'
    }
];

function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
}

function collectFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(PROJECT_ROOT, fullPath);

        if (entry.isDirectory()) {
            if (IGNORE_DIRECTORIES.has(entry.name)) {
                continue;
            }
            files.push(...collectFiles(fullPath));
        } else if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
            if (entry.name.includes('.test.') || entry.name.includes('.spec.')) {
                files.push(relativePath);
            }
        }
    }

    return files;
}

function scanFile(relativePath) {
    const absolutePath = path.join(PROJECT_ROOT, relativePath);
    const fileText = fs.readFileSync(absolutePath, 'utf8');
    const lines = fileText.split('\n');
    const violations = [];

    lines.forEach((line, lineIndex) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) {
            return;
        }

        for (const { pattern, message, hint } of IMPLEMENTATION_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(line)) {
                violations.push({
                    file: relativePath,
                    line: lineIndex + 1,
                    snippet: trimmed.slice(0, 100) + (trimmed.length > 100 ? '...' : ''),
                    message,
                    hint
                });
            }
        }
    });

    return violations;
}

function main() {
    const issues = [];

    for (const dir of TARGET_DIRECTORIES) {
        const absoluteDir = path.join(PROJECT_ROOT, dir);
        if (!fs.existsSync(absoluteDir)) continue;
        const files = collectFiles(absoluteDir);
        files.forEach((file) => issues.push(...scanFile(file)));
    }

    if (issues.length === 0) {
        console.log('✓ No implementation test anti-patterns detected.');
        return;
    }

    console.error('✗ Implementation test anti-patterns detected:');
    issues.forEach((issue) => {
        console.error(`  ${issue.file}:${issue.line}`);
        console.error(`    ${issue.message}`);
        console.error(`    snippet: ${issue.snippet}`);
        console.error(`    hint: ${issue.hint}`);
    });
    console.error('\nTests should assert on observable behavior, not implementation details:');
    console.error('  - Payloads passed to downstream handlers');
    console.error('  - State changes on public objects');
    console.error('  - Thrown errors at public API boundaries');
    console.error('  - Return values from public methods');
    process.exitCode = 1;
}

main();
