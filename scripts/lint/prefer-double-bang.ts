#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const BOOLEAN_PATTERN = /(?<![a-zA-Z_.])Boolean\(([^)]+)\)/g;

const SOURCE_DIRS = ['src', 'tests', 'scripts'];

type BooleanViolation = {
    line: number;
    content: string;
    suggestion: string;
};

function findSourceFiles(dir) {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...findSourceFiles(fullPath));
        } else if (entry.name.endsWith('.js') || entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
            files.push(fullPath);
        }
    }
    return files;
}

function checkFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const violations: BooleanViolation[] = [];
    
    let match;
    while ((match = BOOLEAN_PATTERN.exec(content)) !== null) {
        const lineNumber = content.slice(0, match.index).split('\n').length;
        const line = lines[lineNumber - 1];
        const innerExpr = match[1].trim();
        
        violations.push({
            line: lineNumber,
            content: line.trim(),
            suggestion: `!!(${innerExpr})`
        });
    }
    
    return violations;
}

function main() {
    const allFiles = SOURCE_DIRS.flatMap(findSourceFiles);
    let hasViolations = false;
    
    for (const file of allFiles) {
        const violations = checkFile(file);
        if (violations.length > 0) {
            hasViolations = true;
            console.error(`\n${file}:`);
            for (const v of violations) {
                console.error(`  Line ${v.line}: ${v.content}`);
                console.error(`    Suggestion: Use ${v.suggestion} instead`);
            }
        }
    }
    
    if (hasViolations) {
        console.error('\n✗ Prefer !! over Boolean() for boolean coercion.\n');
        process.exit(1);
    }
    
    console.log('✓ No Boolean() patterns detected.');
    process.exit(0);
}

main();
