import { beforeEach, describe, expect, test } from 'bun:test';

import { PRIORITY_LEVELS } from '../../../src/core/constants';
import { DisplayQueue } from '../../../src/obs/display-queue';
import { createMockOBSManager } from '../../helpers/mock-factories';

describe('DisplayQueue priority mapping', () => {
    let displayQueue: DisplayQueue;

    beforeEach(() => {
        const obsManager = createMockOBSManager();
        const constants = {
            PRIORITY_LEVELS
        };

        displayQueue = new DisplayQueue(obsManager, { autoProcess: false }, constants, null, {});
    });

    test('mapped display item types use expected priority levels', () => {
        const expectedPriorities = {
            'platform:share': PRIORITY_LEVELS.SHARE,
            'platform:paypiggy': PRIORITY_LEVELS.PAYPIGGY,
            'platform:giftpaypiggy': PRIORITY_LEVELS.GIFTPAYPIGGY,
            'platform:envelope': PRIORITY_LEVELS.ENVELOPE,
            'platform:chat-message': PRIORITY_LEVELS.CHAT,
            chat: PRIORITY_LEVELS.CHAT
        };

        for (const [type, expectedPriority] of Object.entries(expectedPriorities)) {
            expect(displayQueue.getTypePriority(type)).toBe(expectedPriority);
        }
    });
});
