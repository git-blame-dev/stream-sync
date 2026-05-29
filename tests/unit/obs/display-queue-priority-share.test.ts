import { beforeEach, describe, expect, test } from 'bun:test';

import { PRIORITY_LEVELS } from '../../../src/core/constants';
import { DisplayQueue } from '../../../src/obs/display-queue';
import { createMockOBSManager } from '../../helpers/mock-factories';

describe('DisplayQueue share priority mapping', () => {
    let displayQueue: DisplayQueue;

    beforeEach(() => {
        const obsManager = createMockOBSManager();
        const constants = {
            PRIORITY_LEVELS
        };

        displayQueue = new DisplayQueue(obsManager, { autoProcess: false }, constants, null, {});
    });

    test('share notifications use SHARE priority level', () => {
        const priority = displayQueue.getTypePriority('platform:share');
        expect(priority).toBe(PRIORITY_LEVELS.SHARE);
    });
});
