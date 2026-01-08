
const { DisplayQueue } = require('../../../src/obs/display-queue');
const { createMockOBSManager } = require('../../helpers/mock-factories');

describe('DisplayQueue share priority mapping', () => {
    let displayQueue;

    beforeEach(() => {
        const obsManager = createMockOBSManager();
        const constants = {
            PRIORITY_LEVELS: {
                CHAT: 1,
                FOLLOW: 2,
                GIFT: 4,
                MEMBER: 3,
                RAID: 6,
                SHARE: 6,
                ENVELOPE: 8,
                CHEER: 10,
                GIFTPAYPIGGY: 11,
                GREETING: 2,
                COMMAND: 4,
                REDEMPTION: 4
            }
        };

        displayQueue = new DisplayQueue(obsManager, { autoProcess: false }, constants);
    });

    test('share notifications use SHARE priority level', () => {
        const priority = displayQueue.getTypePriority('share');
        expect(priority).toBe(6);
    });
});
