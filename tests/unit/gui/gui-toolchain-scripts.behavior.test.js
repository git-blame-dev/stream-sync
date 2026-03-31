const { describe, it, expect } = require('bun:test');
const packageJson = require('../../../package.json');

describe('GUI toolchain scripts behavior', () => {
    it('defines the GUI command matrix scripts', () => {
        expect(packageJson.scripts).toBeDefined();
        expect(packageJson.scripts.build).toBe('vite build --config gui/vite.config.ts');
        expect(packageJson.scripts.dev).toBe('vite --config gui/vite.config.ts');
        expect(packageJson.scripts.lint).toBe('bun scripts/lint/no-raw-timeouts.js && bun scripts/lint/no-mock-timers-in-tests.js && bun scripts/lint/no-implementation-test-patterns.js && bun scripts/lint/no-implicit-test-defaults.js && bun scripts/lint/prefer-double-bang.js && eslint "src/**/*.{js,ts}" "tests/**/*.{js,ts}" "scripts/**/*.{js,ts}" "gui/**/*.{ts,tsx}" && knip --config knip.json --include files,unlisted,exports');
        expect(packageJson.scripts.start).toBe('tsx src/bootstrap.js');
        expect(packageJson.scripts['start:debug']).toBe('tsx src/bootstrap.js --debug');
        expect(packageJson.scripts['start:debug:build']).toBe('npm run build && tsx src/bootstrap.js --debug');
        expect(packageJson.scripts['gui:preview']).toBe('npm run build && tsx scripts/local/gui-preview.ts');
        expect(packageJson.scripts['typecheck:gui']).toBe('tsc --noEmit -p gui/tsconfig.json');
        expect(packageJson.scripts['typecheck:gui-node']).toBe('tsc --noEmit -p tsconfig.json');
    });
});
