
const { DisplayQueue } = require('../../../src/obs/display-queue.ts');
const { createMockOBSManager } = require('../../helpers/mock-factories');
const { PRIORITY_LEVELS } = require('../../../src/core/constants');

describe('DisplayQueue share priority mapping', () => {
    let displayQueue;

    beforeEach(() => {
        const obsManager = createMockOBSManager();
        const constants = {
            PRIORITY_LEVELS
        };

        displayQueue = new DisplayQueue(obsManager, { autoProcess: false }, constants, null, constants);
    });

    test('share notifications use SHARE priority level', () => {
        const priority = displayQueue.getTypePriority('platform:share');
        expect(priority).toBe(PRIORITY_LEVELS.SHARE);
    });
});
