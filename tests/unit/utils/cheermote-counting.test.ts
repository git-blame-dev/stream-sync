const { CheermoteProcessor } = require('../../../src/utils/cheermote-processor.ts');
const { extractTwitchMessageData } = require('../../../src/utils/message-normalization.ts');

export {};

describe('Cheermote counting', () => {
    it('counts cheermotes and totals bits from EventSub fragments', () => {
        const fragments = [
            { type: 'cheermote', text: 'uni100', cheermote: { prefix: 'uni', bits: 100 } },
            { type: 'cheermote', text: 'uni100', cheermote: { prefix: 'uni', bits: 100 } }
        ];

        const result = CheermoteProcessor.processEventSubFragments(fragments);

        expect(result.fragments).toHaveLength(2);
        expect(result.totalBits).toBe(200);
        expect(result.primaryType).toBe('uni');
    });

    it('selects primary cheermote by total bits across types', () => {
        const fragments = [
            { type: 'cheermote', text: 'Cheer10', cheermote: { prefix: 'Cheer', bits: 10 } },
            { type: 'cheermote', text: 'Cheer10', cheermote: { prefix: 'Cheer', bits: 10 } },
            { type: 'cheermote', text: 'Cheer10', cheermote: { prefix: 'Cheer', bits: 10 } },
            { type: 'cheermote', text: 'Cheer10', cheermote: { prefix: 'Cheer', bits: 10 } },
            { type: 'cheermote', text: 'Cheer10', cheermote: { prefix: 'Cheer', bits: 10 } },
            { type: 'cheermote', text: 'uni100', cheermote: { prefix: 'uni', bits: 100 } }
        ];

        const result = CheermoteProcessor.processEventSubFragments(fragments);

        expect(result.totalBits).toBe(150);
        expect(result.primaryType).toBe('uni');
    });

    it('returns cheermote counts in extracted message data', () => {
        const messageObj = {
            text: 'uni100 uni100',
            fragments: [
                { type: 'cheermote', text: 'uni100', cheermote: { prefix: 'uni', bits: 100 } },
                { type: 'cheermote', text: 'uni100', cheermote: { prefix: 'uni', bits: 100 } }
            ]
        };

        const result = extractTwitchMessageData(messageObj);

        expect(result.cheermoteInfo).toEqual(expect.objectContaining({
            count: 2,
            totalBits: 200,
            prefix: 'uni'
        }));
    });

    it('returns an empty result when no cheermote fragments are present', () => {
        const result = CheermoteProcessor.processEventSubFragments([
            { type: 'text', text: 'hello world' }
        ]);

        expect(result).toEqual({
            totalBits: 0,
            primaryType: null,
            cleanPrimaryType: null,
            textContent: '',
            mixedTypes: false,
            otherTypesCount: 0,
            types: []
        });
    });

    it('returns mixed type metadata when multiple cheermote prefixes are present', () => {
        const result = CheermoteProcessor.processEventSubFragments([
            { type: 'cheermote', text: 'Cheer100', cheermote: { prefix: 'Cheer100', bits: 100 } },
            { type: 'cheermote', text: 'Party50', cheermote: { prefix: 'Party50', bits: 50 } }
        ]);

        expect(result.mixedTypes).toBe(true);
        expect(result.otherTypesCount).toBe(1);
        expect(result.types).toHaveLength(2);
    });
});
