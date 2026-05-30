import { describe, expect, it } from 'bun:test';

import { NOTIFICATION_CONFIGS, PRIORITY_LEVELS } from '../../../src/core/constants';
import { resolvePriorityForType } from '../../../src/core/notification-priority';

describe('notification priority resolver', () => {
    it('resolves every configured notification type', () => {
        for (const notificationType of Object.keys(NOTIFICATION_CONFIGS)) {
            expect(resolvePriorityForType(notificationType, PRIORITY_LEVELS)).toBeNumber();
        }
    });

    it('resolves display queue chat aliases', () => {
        expect(resolvePriorityForType('chat', PRIORITY_LEVELS)).toBe(PRIORITY_LEVELS.CHAT);
        expect(resolvePriorityForType('platform:chat-message', PRIORITY_LEVELS)).toBe(PRIORITY_LEVELS.CHAT);
    });

    it('resolves monetization priority types', () => {
        expect(resolvePriorityForType('platform:gift', PRIORITY_LEVELS)).toBe(PRIORITY_LEVELS.GIFT);
        expect(resolvePriorityForType('platform:paypiggy', PRIORITY_LEVELS)).toBe(PRIORITY_LEVELS.PAYPIGGY);
        expect(resolvePriorityForType('platform:giftpaypiggy', PRIORITY_LEVELS)).toBe(PRIORITY_LEVELS.GIFTPAYPIGGY);
        expect(resolvePriorityForType('platform:envelope', PRIORITY_LEVELS)).toBe(PRIORITY_LEVELS.ENVELOPE);
    });

    it('returns undefined for unknown or incomplete mappings', () => {
        expect(resolvePriorityForType('unknown:type', PRIORITY_LEVELS)).toBeUndefined();
        expect(resolvePriorityForType('platform:gift', {})).toBeUndefined();
    });
});
