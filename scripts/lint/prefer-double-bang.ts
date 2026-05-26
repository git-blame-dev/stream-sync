#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const BOOLEAN_PATTERN = /(?<![a-zA-Z_.])Boolean\(([^)]+)\)/g;

const SOURCE_DIRS: readonly string[] = ['src', 'tests', 'scripts'];

type BooleanViolation = {
    line: number;
    content: string;
    suggestion: string;
};

function findSourceFiles(dir: string): string[] {
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

function checkFile(filePath: string): BooleanViolation[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const violations: BooleanViolation[] = [];
    
    let match: RegExpExecArray | null;
    while ((match = BOOLEAN_PATTERN.exec(content)) !== null) {
        const lineNumber = content.slice(0, match.index).split('\n').length;
        const line = lines[lineNumber - 1];
        const innerExpr = match[1];

        if (line === undefined) {
            throw new Error(`Unable to resolve line ${lineNumber} in ${filePath}`);
        }

        if (innerExpr === undefined) {
            throw new Error(`Boolean() match did not include expected capture group in ${filePath}:${lineNumber}`);
        }
        
        violations.push({
            line: lineNumber,
            content: line.trim(),
            suggestion: `!!(${innerExpr.trim()})`
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
