const { describe, it, expect } = require('bun:test');
const { createConfigFixture } = require('../../../helpers/config-fixture');
const { VFXCommandService } = require('../../../../src/services/VFXCommandService.js');

const createService = (keywordParsingEnabled) => new VFXCommandService(createConfigFixture({
    farewell: {
        command: '!bye, goodbye|cya'
    },
    general: {
        keywordParsingEnabled
    },
    vfx: {
        filePath: '/tmp'
    }
}), null);

describe('VFXCommandService farewell matching', () => {
    it('matches farewell trigger regardless of keyword parsing toggle', () => {
        const service = createService(false);

        const result = service.matchFarewell('!bye everyone', '!bye');

        expect(result).toBe('!bye');
    });

    it('does not match farewell keywords when keyword parsing is disabled', () => {
        const service = createService(false);

        const result = service.matchFarewell('goodbye everyone', 'goodbye');

        expect(result).toBeNull();
    });

    it('matches farewell keywords when keyword parsing is enabled', () => {
        const service = createService(true);

        const result = service.matchFarewell('goodbye everyone', 'goodbye');

        expect(result).toBe('goodbye');
    });
});
