function createSubscriptionCondition({ userId, broadcasterId }, config) {
    const baseCondition = { broadcaster_user_id: broadcasterId };

    if (config.requiresUserScope) {
        return { ...baseCondition, user_id: userId };
    }
    if (config.requiresModeratorScope) {
        return { ...baseCondition, moderator_user_id: userId };
    }
    if (config.usesToBroadcaster) {
        return { to_broadcaster_user_id: broadcasterId };
    }

    return baseCondition;
}

function getHandlerName(subscriptionType) {
    const handlerMap = {
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

function createTwitchEventSubSubscriptions() {
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

    return subscriptionConfigs.map(config => ({
        name: config.name,
        type: config.type,
        version: config.version,
        getCondition: ({ userId, broadcasterId }) => createSubscriptionCondition({ userId, broadcasterId }, config),
        handler: getHandlerName(config.type)
    }));
}

module.exports = {
    createTwitchEventSubSubscriptions
};

