const { describe, it, expect } = require('bun:test');
const packageJson = require('../../../package.json');

describe('GUI toolchain scripts behavior', () => {
    it('defines the GUI command matrix scripts', () => {
        expect(packageJson.scripts).toBeDefined();
        expect(packageJson.scripts.build).toBe('vite build --config gui/vite.config.ts');
        expect(packageJson.scripts.start).toBe('node src/bootstrap.js');
        expect(packageJson.scripts['start:debug']).toBe('node src/bootstrap.js --debug');
        expect(packageJson.scripts['start:debug:build']).toBe('npm run build && node src/bootstrap.js --debug');
        expect(packageJson.scripts.dev).toBe('vite --config gui/vite.config.ts');
    });
});
