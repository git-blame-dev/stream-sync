import type { PRIORITY_LEVELS } from './constants';

type PriorityLevels = typeof PRIORITY_LEVELS;
type PriorityLevelKey = keyof PriorityLevels;

const PRIORITY_KEY_BY_TYPE = {
    'platform:follow': 'FOLLOW',
    'platform:gift': 'GIFT',
    'platform:envelope': 'ENVELOPE',
    'platform:paypiggy': 'PAYPIGGY',
    'platform:raid': 'RAID',
    'platform:share': 'SHARE',
    'platform:giftpaypiggy': 'GIFTPAYPIGGY',
    'platform:chat-message': 'CHAT',
    chat: 'CHAT',
    command: 'COMMAND',
    greeting: 'GREETING',
    farewell: 'FAREWELL'
} as const satisfies Record<string, PriorityLevelKey>;

type PriorityMappedType = keyof typeof PRIORITY_KEY_BY_TYPE;
type NotificationPriorityMappedType = Exclude<PriorityMappedType, 'chat'>;

function hasPriorityMapping(type: string): type is PriorityMappedType {
    return Object.prototype.hasOwnProperty.call(PRIORITY_KEY_BY_TYPE, type);
}

function hasNotificationPriorityMapping(type: string): type is NotificationPriorityMappedType {
    return type !== 'chat' && hasPriorityMapping(type);
}

function resolvePriorityForType(type: string, priorityLevels: Record<string, number>): number | undefined {
    if (!hasPriorityMapping(type)) {
        return undefined;
    }

    const priority = priorityLevels[PRIORITY_KEY_BY_TYPE[type]];
    return typeof priority === 'number' ? priority : undefined;
}

export {
    PRIORITY_KEY_BY_TYPE,
    hasNotificationPriorityMapping,
    hasPriorityMapping,
    resolvePriorityForType
};

export type {
    PriorityLevels,
    PriorityLevelKey,
    NotificationPriorityMappedType,
    PriorityMappedType
};
