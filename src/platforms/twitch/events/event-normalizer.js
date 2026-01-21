const normalizeMonths = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : undefined;
};

const normalizeUserIdentity = (username, userId) => ({ username, userId });

const resolveNotificationTimestamp = (event, metadata, subscriptionType) => {
    if (!event || typeof event !== 'object') {
        return metadata?.message_timestamp;
    }

    if (subscriptionType === 'stream.online') {
        return event.started_at || event.timestamp || metadata?.message_timestamp;
    }

    if (subscriptionType === 'stream.offline') {
        return event.ended_at || event.timestamp || metadata?.message_timestamp;
    }

    return event.timestamp || metadata?.message_timestamp;
};

const applyTimestampFallback = (event, metadata, subscriptionType) => {
    const resolvedTimestamp = resolveNotificationTimestamp(event, metadata, subscriptionType);
    if (!resolvedTimestamp || (event && event.timestamp)) {
        return event;
    }
    return { ...event, timestamp: resolvedTimestamp };
};

module.exports = {
    applyTimestampFallback,
    normalizeMonths,
    normalizeUserIdentity
};
