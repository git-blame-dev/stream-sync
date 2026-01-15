#!/usr/bin/env node

/**
 * Raw timeout guard
 *
 * Lightweight lint step that scans source files for direct usage of
 * setTimeout/setInterval so we can enforce the shared safeSetTimeout/safeSetInterval
 * utilities even without a full ESLint toolchain.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const TARGET_DIRECTORIES = ['src', 'tests'];
const FILE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const IGNORE_DIRECTORIES = new Set([
  'node_modules',
  'coverage',
  'logs',
  'archive',
  'scripts/lint' // prevent self-scanning
]);

const VIOLATION_PATTERN = /\bset(?:Timeout|Interval)\s*\(/g;
const SAFE_PREFIX = 'safe';
const ALLOWED_PREFIXES = [];
const PROMISE_TIMEOUT_PATTERN = /new\s+Promise\s*\([^)]*=>\s*(?:safeSetTimeout|setTimeout)\s*\(/;
const PROMISE_TIMEOUT_ALLOWLIST = new Set([
  'src/utils/timeout-validator.js'
]);
const PROMISE_RACE_TIMEOUT_PATTERN = /Promise\.race\([\s\S]*?new\s+Promise\s*\([^)]*=>\s*(?:safeSetTimeout|setTimeout)/g;
const PROMISE_RACE_ALLOWLIST = new Set([
  'src/utils/timeout-validator.js'
]);
const RAW_TIMER_ALLOWLIST = new Set([
  'src/utils/timeout-validator.js',
  'tests/setup/bun.setup.js'
]);

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

/**
 * Recursively collect files to scan.
 */
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
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Determine whether a match is already using the safe wrapper.
 */
function isSafeUsage(line, matchIndex) {
  const charBefore = matchIndex > 0 ? line[matchIndex - 1] : '';
  if (charBefore === '\'' || charBefore === '"' || charBefore === '`') {
    return true;
  }

  const trimmedPrefix = line.slice(0, matchIndex).trimEnd();
  if (trimmedPrefix.toLowerCase().endsWith(SAFE_PREFIX)) {
    return true;
  }

  if (ALLOWED_PREFIXES.some(prefix => trimmedPrefix.endsWith(prefix))) {
    return true;
  }

  return false;
}

/**
 * Scan a single file and return violations.
 */
function scanFile(relativePath) {
  const absolutePath = path.join(PROJECT_ROOT, relativePath);
  const fileText = fs.readFileSync(absolutePath, 'utf8');
  const contents = fileText.split('\n');
  const violations = [];
  const normalizedPath = normalizePath(relativePath);
  const enforcePromiseTimeoutRule =
    normalizedPath.startsWith('src/') &&
    !PROMISE_TIMEOUT_ALLOWLIST.has(normalizedPath);
  const enforcePromiseRaceRule =
    normalizedPath.startsWith('src/') &&
    !PROMISE_RACE_ALLOWLIST.has(normalizedPath);
  const enforceRawTimerRule =
    !RAW_TIMER_ALLOWLIST.has(normalizedPath);

  contents.forEach((line, lineNumber) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      return;
    }

    if (enforcePromiseTimeoutRule && PROMISE_TIMEOUT_PATTERN.test(trimmed)) {
      violations.push({
        file: relativePath,
        line: lineNumber + 1,
        snippet: trimmed,
        hint: 'Use safeDelay/createTimeoutController instead of inline Promise + setTimeout.'
      });
    }

    if (enforceRawTimerRule) {
      let match;
      while ((match = VIOLATION_PATTERN.exec(line)) !== null) {
        if (isSafeUsage(line, match.index)) {
          continue;
        }

        violations.push({
          file: relativePath,
          line: lineNumber + 1,
          snippet: line.trim()
        });
      }
    }
  });

  if (enforcePromiseRaceRule) {
    const racePattern = new RegExp(PROMISE_RACE_TIMEOUT_PATTERN.source, 'g');
    let match;
    while ((match = racePattern.exec(fileText)) !== null) {
      const precedingText = fileText.slice(0, match.index);
      const lineNumber = precedingText.split('\n').length;
      violations.push({
        file: relativePath,
        line: lineNumber,
        snippet: contents[lineNumber - 1]?.trim() || '',
        hint: 'Use withTimeout/createTimeoutController instead of Promise.race(...) with inline timeout promises.'
      });
    }
  }

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
    console.log('✓ No raw setTimeout/setInterval usage detected.');
    return;
  }

  console.error('✗ Raw timeout usage detected:');
  issues.forEach((issue) => {
    console.error(`  ${issue.file}:${issue.line}  ${issue.snippet}`);
    if (issue.hint) {
      console.error(`      hint: ${issue.hint}`);
    }
  });
  console.error('\nHint: import { safeSetTimeout, safeSetInterval, safeDelay } from "src/utils/timeout-validator" (or use createTimeoutController) and replace raw timers or inline Promise delays with the safe helpers.');
  process.exitCode = 1;
}

main();
