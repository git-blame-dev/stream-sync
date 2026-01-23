#!/usr/bin/env bun

/**
 * Mock timer guard for tests
 *
 * Detects anti-patterns where tests inject mock timer functions instead of
 * using the fake timer helpers from tests/helpers/bun-timers.js.
 *
 * Anti-patterns detected:
 * - safeSetTimeout: createMockFn() or safeSetTimeout: (callback) => ...
 * - now: () => ... (injecting mock time)
 * - clearTimeoutFn: (timer) => ... (injecting mock clear)
 *
 * Correct approach:
 * - import { useFakeTimers, setSystemTime, advanceTimersByTime } from 'bun-timers.js'
 * - Use setSystemTime() to control Date.now()
 * - Use advanceTimersByTime() to trigger timers
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

// Allowlist for existing files that need refactoring (technical debt)
// New test files should use fake timers, not mock injection
const ALLOWLIST = new Set([
    'tests/unit/platforms/twitch/connections/eventsub-ws-lifecycle.test.js',
    'tests/unit/platforms/youtube/streams/multistream-manager.test.js'
]);

const MOCK_TIMER_PATTERNS = [
    {
        pattern: /safeSetTimeout\s*:\s*(?:createMockFn\s*\(|function\s*\(|\([^)]*\)\s*=>)/g,
        message: 'Injecting mock safeSetTimeout',
        hint: 'Use useFakeTimers() and advanceTimersByTime() from tests/helpers/bun-timers.js'
    },
    {
        pattern: /clearTimeoutFn\s*:\s*(?:createMockFn\s*\(|function\s*\(|\([^)]*\)\s*=>)/g,
        message: 'Injecting mock clearTimeoutFn',
        hint: 'Use useFakeTimers() and getTimerCount() from tests/helpers/bun-timers.js'
    },
    {
        pattern: /\bnow\s*:\s*\(\s*\)\s*=>\s*\d+/g,
        message: 'Injecting mock now() function',
        hint: 'Use setSystemTime(new Date(...)) from tests/helpers/bun-timers.js'
    },
    {
        pattern: /\bnow\s*:\s*\(\s*\)\s*=>\s*\w+\.shift\s*\(\s*\)/g,
        message: 'Injecting mock now() with shifting values',
        hint: 'Use setSystemTime() to advance time at specific points in your test'
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
    const normalizedPath = normalizePath(relativePath);
    if (ALLOWLIST.has(normalizedPath)) {
        return [];
    }

    const absolutePath = path.join(PROJECT_ROOT, relativePath);
    const fileText = fs.readFileSync(absolutePath, 'utf8');
    const lines = fileText.split('\n');
    const violations = [];

    lines.forEach((line, lineIndex) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) {
            return;
        }

        for (const { pattern, message, hint } of MOCK_TIMER_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(line)) {
                violations.push({
                    file: relativePath,
                    line: lineIndex + 1,
                    snippet: trimmed,
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
        console.log('✓ No mock timer injection detected in tests.');
        return;
    }

    console.error('✗ Mock timer injection detected in tests:');
    issues.forEach((issue) => {
        console.error(`  ${issue.file}:${issue.line}`);
        console.error(`    ${issue.message}: ${issue.snippet}`);
        console.error(`    hint: ${issue.hint}`);
    });
    console.error('\nTests should use fake timer helpers instead of injecting mocks.');
    console.error('Import from tests/helpers/bun-timers.js:');
    console.error('  - useFakeTimers() / useRealTimers() in beforeEach/afterEach');
    console.error('  - setSystemTime(new Date(...)) to control Date.now()');
    console.error('  - advanceTimersByTime(ms) to trigger timers');
    console.error('  - getTimerCount() to verify timer state');
    process.exitCode = 1;
}

main();
