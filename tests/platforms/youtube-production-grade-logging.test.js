
const fs = require('fs');
const path = require('path');

describe('YouTube Platform Production-Grade Logging', () => {
    const youtubePlatformPath = path.join(__dirname, '../../src/platforms/youtube.js');
    let sourceCode;

    beforeAll(() => {
        sourceCode = fs.readFileSync(youtubePlatformPath, 'utf8');
    });

    describe('Comment Standards', () => {
        test('should not contain "alpha version" or "beta version" in comments', () => {
            const alphaMatches = sourceCode.match(/alpha\s+version/gi);
            const betaMatches = sourceCode.match(/beta\s+version/gi);

            if (alphaMatches || betaMatches) {
                const matches = [...(alphaMatches || []), ...(betaMatches || [])];
                throw new Error(`Found non-production version markers in comments: ${matches.join(', ')}`);
            }

            expect(alphaMatches).toBeNull();
            expect(betaMatches).toBeNull();
        });

        test('should not contain excessive "called..." debug statements', () => {
            // Check for redundant "X() called..." patterns
            const calledPattern = /logger\.debug\(['"]\w+\(\)\s+called\.{3}['"]/g;
            const matches = sourceCode.match(calledPattern);

            // Allow a few but not excessive (more than 3 indicates noise)
            if (matches && matches.length > 3) {
                throw new Error(`Found ${matches.length} redundant "called..." debug statements. These add noise without value.`);
            }
        });

        test('should not have duplicate debug and info calls for the same message', () => {
            // Pattern: same message logged at both debug and info level consecutively
            const lines = sourceCode.split('\n');
            const duplicates = [];

            for (let i = 0; i < lines.length - 1; i++) {
                const currentLine = lines[i].trim();
                const nextLine = lines[i + 1].trim();

                // Check if two consecutive lines log similar messages at different levels
                const debugMatch = currentLine.match(/logger\.debug\(['"](.+?)['"],/);
                const infoMatch = nextLine.match(/logger\.info\(['"](.+?)['"],/);

                if (debugMatch && infoMatch) {
                    const debugMsg = debugMatch[1].toLowerCase();
                    const infoMsg = infoMatch[1].toLowerCase();

                    // If messages are very similar (>70% match), they're duplicates
                    if (debugMsg === infoMsg || debugMsg.includes(infoMsg) || infoMsg.includes(debugMsg)) {
                        duplicates.push({
                            line: i + 1,
                            debug: debugMatch[1],
                            info: infoMatch[1]
                        });
                    }
                }
            }

            if (duplicates.length > 0) {
                const formatted = duplicates.map(d =>
                    `Line ${d.line}: debug="${d.debug}" then info="${d.info}"`
                ).join('\n');
                throw new Error(`Found duplicate debug+info logging:\n${formatted}`);
            }
        });
    });

    describe('Debug Logging Volume', () => {
        test('should have reasonable debug logging density in initialization', () => {
            // Extract the initialize method
            const initMatch = sourceCode.match(/async initialize\([^)]*\)\s*\{[\s\S]*?\n    \}/);

            if (!initMatch) {
                throw new Error('Could not find initialize method');
            }

            const initMethod = initMatch[0];
            const totalLines = initMethod.split('\n').length;
            const debugCalls = (initMethod.match(/logger\.debug\(/g) || []).length;

            // More than 20% debug calls = too noisy
            const ratio = debugCalls / totalLines;

            if (ratio > 0.20) {
                throw new Error(`Initialize method has ${debugCalls} debug calls in ${totalLines} lines (${(ratio * 100).toFixed(1)}%). Should be <20% for production code.`);
            }
        });

        test('should have reasonable debug logging density in startMultiStreamMonitoring', () => {
            const methodMatch = sourceCode.match(/async startMultiStreamMonitoring\([^)]*\)\s*\{[\s\S]*?\n    \}/);

            if (!methodMatch) {
                throw new Error('Could not find startMultiStreamMonitoring method');
            }

            const method = methodMatch[0];
            const totalLines = method.split('\n').length;
            const debugCalls = (method.match(/logger\.debug\(/g) || []).length;

            const ratio = debugCalls / totalLines;

            if (ratio > 0.20) {
                throw new Error(`startMultiStreamMonitoring has ${debugCalls} debug calls in ${totalLines} lines (${(ratio * 100).toFixed(1)}%). Should be <20% for production code.`);
            }
        });
    });
});
