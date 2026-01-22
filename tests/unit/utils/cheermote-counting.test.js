const { CheermoteProcessor } = require('../../../src/utils/cheermote-processor');
const { extractTwitchMessageData } = require('../../../src/utils/message-normalization');

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
});
