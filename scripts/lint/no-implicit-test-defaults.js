#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REQUIRED_DEPS = ['twitchAuth', 'authManager'];

const PATTERN = new RegExp(
    `(${REQUIRED_DEPS.join('|')})\\s*\\|\\|\\s*\\{`,
    'g'
);

const TEST_DIRS = ['tests/helpers', 'tests/unit', 'tests/integration', 'tests/e2e-smoke'];

function findJsFiles(dir) {
    const files = [];
    if (!fs.existsSync(dir)) return files;
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...findJsFiles(fullPath));
        } else if (entry.name.endsWith('.js')) {
            files.push(fullPath);
        }
    }
    return files;
}

function checkFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const violations = [];
    
    lines.forEach((line, index) => {
        const matches = line.match(PATTERN);
        if (matches) {
            violations.push({
                line: index + 1,
                content: line.trim(),
                matches
            });
        }
    });
    
    return violations;
}

function main() {
    const allFiles = TEST_DIRS.flatMap(findJsFiles);
    let hasViolations = false;
    
    for (const file of allFiles) {
        const violations = checkFile(file);
        if (violations.length > 0) {
            hasViolations = true;
            console.error(`\n${file}:`);
            for (const v of violations) {
                console.error(`  Line ${v.line}: ${v.content}`);
            }
        }
    }
    
    if (hasViolations) {
        console.error('\n✗ Implicit mock defaults found for required production dependencies.');
        console.error('  Use explicit null and let tests fail-fast if they access unset dependencies.');
        console.error('  See AGENTS.md Testing Standards for details.\n');
        process.exit(1);
    }
    
    console.log('✓ No implicit mock defaults for required production dependencies.');
    process.exit(0);
}

main();
