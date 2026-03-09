const { describe, it, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
const ini = require('ini');

const { DEFAULTS } = require('../../../src/core/config-schema');
const { ConfigValidator } = require('../../../src/utils/config-validator');

function readConfigExample() {
    const filePath = path.resolve(__dirname, '../../../config.example.ini');
    const raw = fs.readFileSync(filePath, 'utf8');
    return ini.parse(raw);
}

describe('config example GUI template behavior', () => {
    it('defines the gui section with schema-aligned keys and defaults', () => {
        const parsed = readConfigExample();
        expect(parsed.gui).toBeDefined();

        expect(Object.keys(parsed.gui).sort()).toEqual(Object.keys(DEFAULTS.gui).sort());

        const normalized = ConfigValidator.normalize({ gui: parsed.gui });
        expect(normalized.gui).toEqual(DEFAULTS.gui);
    });
});
