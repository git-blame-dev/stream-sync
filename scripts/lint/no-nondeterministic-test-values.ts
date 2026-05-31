#!/usr/bin/env bun

/**
 * Nondeterministic test value guard
 *
 * Tests should use deterministic fixture IDs, counters, and testClock-controlled
 * time. This guard catches true randomness in tests and helpers while leaving
 * production runtime randomness untouched.
 */

import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TARGET_DIRECTORIES: readonly string[] = ['tests'];
const FILE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const IGNORE_DIRECTORIES = new Set([
    'node_modules',
    'coverage'
]);

type NondeterministicPattern = {
    pattern: RegExp;
    message: string;
    hint: string;
};

const NONDETERMINISTIC_PATTERNS: readonly NondeterministicPattern[] = [
    {
        pattern: /\bMath\.random\s*\(/g,
        message: 'Math.random() in test code',
        hint: 'Use deterministic fixture values or explicit seeded/counter-based helpers.'
    },
    {
        pattern: /\bcrypto\.(?:randomUUID|randomInt|randomBytes|getRandomValues)\s*\(/g,
        message: 'crypto randomness in test code',
        hint: 'Use deterministic fake IDs/values, or inject randomness behind an explicitly tested boundary.'
    },
    {
        pattern: /(?<!\.)\b(?:randomUUID|randomInt|randomBytes|getRandomValues)\s*\(/g,
        message: 'bare random crypto helper call in test code',
        hint: 'Use deterministic fake IDs/values instead of imported random helpers.'
    },
    {
        pattern: /import\s*\{[^}]*\b(?:randomUUID|randomInt|randomBytes|getRandomValues)\b[^}]*\}\s*from\s*['"](?:node:crypto|crypto)['"]/g,
        message: 'random crypto helper import in test code',
        hint: 'Do not import random crypto helpers into tests unless the file is an explicit randomness-injection test.'
    },
    {
        pattern: /(?:import\s+.*\s+from\s*['"](?:uuid|nanoid)['"]|require\s*\(\s*['"](?:uuid|nanoid)['"]\s*\))/g,
        message: 'random ID library import in test code',
        hint: 'Use obviously fake deterministic IDs instead of uuid/nanoid in tests.'
    }
];

type NondeterministicViolation = {
    file: string;
    line: number;
    snippet: string;
    message: string;
    hint: string;
};

function collectFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(PROJECT_ROOT, fullPath);

        if (entry.isDirectory()) {
            if (IGNORE_DIRECTORIES.has(entry.name)) {
                continue;
            }
            files.push(...collectFiles(fullPath));
        } else if (FILE_EXTENSIONS.has(path.extname(entry.name))) {
            files.push(relativePath);
        }
    }

    return files;
}

function scanFile(relativePath: string): NondeterministicViolation[] {
    const absolutePath = path.join(PROJECT_ROOT, relativePath);
    const fileText = fs.readFileSync(absolutePath, 'utf8');
    const lines = fileText.split('\n');
    const violations: NondeterministicViolation[] = [];

    lines.forEach((line, lineIndex) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) {
            return;
        }

        for (const { pattern, message, hint } of NONDETERMINISTIC_PATTERNS) {
            pattern.lastIndex = 0;
            if (pattern.test(line)) {
                violations.push({
                    file: relativePath,
                    line: lineIndex + 1,
                    snippet: trimmed.slice(0, 120) + (trimmed.length > 120 ? '...' : ''),
                    message,
                    hint
                });
            }
        }
    });

    return violations;
}

function main() {
    const issues: NondeterministicViolation[] = [];

    for (const dir of TARGET_DIRECTORIES) {
        const absoluteDir = path.join(PROJECT_ROOT, dir);
        if (!fs.existsSync(absoluteDir)) continue;
        const files = collectFiles(absoluteDir);
        files.forEach((file) => issues.push(...scanFile(file)));
    }

    if (issues.length === 0) {
        console.log('✓ No nondeterministic test values detected.');
        return;
    }

    console.error('✗ Nondeterministic test values detected:');
    issues.forEach((issue) => {
        console.error(`  ${issue.file}:${issue.line}`);
        console.error(`    ${issue.message}: ${issue.snippet}`);
        console.error(`    hint: ${issue.hint}`);
    });
    console.error('\nTests should use deterministic fixture values, counters, or testClock-controlled time.');
    process.exitCode = 1;
}

main();
