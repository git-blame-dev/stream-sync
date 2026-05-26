type SubscriptionConditionInput = {
  userId?: string;
  broadcasterId: string;
};

type SubscriptionCondition = {
  broadcaster_user_id?: string;
  user_id?: string;
  moderator_user_id?: string;
  to_broadcaster_user_id?: string;
};

type SubscriptionConfig = {
  name: string;
  type: string;
  version: string;
  requiresUserScope?: boolean;
  requiresModeratorScope?: boolean;
  usesToBroadcaster?: boolean;
};

type EventSubSubscriptionDefinition = {
  name: string;
  type: string;
  version: string;
  getCondition: (input: SubscriptionConditionInput) => SubscriptionCondition;
  handler: string;
};

function createSubscriptionCondition(
  { userId, broadcasterId }: SubscriptionConditionInput,
  config: SubscriptionConfig
): SubscriptionCondition {
    const baseCondition = { broadcaster_user_id: broadcasterId };

    if (config.requiresUserScope) {
        return userId ? { ...baseCondition, user_id: userId } : baseCondition;
    }
    if (config.requiresModeratorScope) {
        return userId ? { ...baseCondition, moderator_user_id: userId } : baseCondition;
    }
    if (config.usesToBroadcaster) {
        return { to_broadcaster_user_id: broadcasterId };
    }

    return baseCondition;
}

function getHandlerName(subscriptionType: string): string {
    const handlerMap: Record<string, string> = {
        'channel.chat.message': 'handleChatMessage',
        'channel.follow': 'handleFollow',
        'channel.subscribe': 'handlePaypiggy',
        'channel.raid': 'handleRaid',
        'channel.bits.use': 'handleBitsUse',
        'channel.subscription.gift': 'handlePaypiggyGift',
        'channel.subscription.message': 'handlePaypiggyMessage',
        'stream.online': 'handleStreamOnline',
        'stream.offline': 'handleStreamOffline'
    };

    return handlerMap[subscriptionType] || 'handleUnknown';
}

function createTwitchEventSubSubscriptions(): EventSubSubscriptionDefinition[] {
    const subscriptionConfigs = [
        { name: 'Chat Messages', type: 'channel.chat.message', version: '1', requiresUserScope: true },
        { name: 'Follows', type: 'channel.follow', version: '2', requiresModeratorScope: true },
        { name: 'Subscriptions', type: 'channel.subscribe', version: '1' },
        { name: 'Raids', type: 'channel.raid', version: '1', usesToBroadcaster: true },
        { name: 'Cheers/Bits', type: 'channel.bits.use', version: '1' },
        { name: 'Subscription Gifts', type: 'channel.subscription.gift', version: '1' },
        { name: 'Subscription Messages', type: 'channel.subscription.message', version: '1' },
        { name: 'Stream Online', type: 'stream.online', version: '1' },
        { name: 'Stream Offline', type: 'stream.offline', version: '1' }
    ];

  return subscriptionConfigs.map((config): EventSubSubscriptionDefinition => {
        const getCondition = ({ userId, broadcasterId }: SubscriptionConditionInput) => {
            const conditionInput = userId === undefined ? { broadcasterId } : { userId, broadcasterId };
            return createSubscriptionCondition(conditionInput, config);
        };

        return {
        name: config.name,
        type: config.type,
        version: config.version,
            getCondition,
        handler: getHandlerName(config.type)
        };
    });
}

export { createTwitchEventSubSubscriptions };
