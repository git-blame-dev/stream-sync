import { describe, expect, it } from 'bun:test';

const { PRIORITY_LEVELS, NOTIFICATION_CONFIGS, VIEWER_COUNT_CONSTANTS } = require('../../../src/core/constants.ts');

describe('core/constants', () => {
    it('exports expected priority levels', () => {
        expect(PRIORITY_LEVELS.CHAT).toBe(1);
        expect(PRIORITY_LEVELS.GIFTPAYPIGGY).toBe(11);
    });

    it('exports notification route mappings', () => {
        expect(NOTIFICATION_CONFIGS['platform:gift']).toEqual({
            timing: 'three_step',
            settingKey: 'giftsEnabled',
            commandKey: 'gifts'
        });
    });

    it('exports viewer-count constants', () => {
        expect(VIEWER_COUNT_CONSTANTS.MS_PER_SECOND).toBe(1000);
        expect(VIEWER_COUNT_CONSTANTS.PLATFORM_NAMES).toContain('youtube');
    });
});
