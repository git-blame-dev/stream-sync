const normalizeMonths = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : undefined;
};

const normalizeUserIdentity = (username, userId) => ({ username, userId });

const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const normalizeTimestampValue = (value) => {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return null;
    }

    if (!RFC3339_UTC_PATTERN.test(trimmedValue)) {
        return null;
    }

    const parsedTimestamp = Date.parse(trimmedValue);
    if (Number.isNaN(parsedTimestamp) || parsedTimestamp <= 0) {
        return null;
    }

    return new Date(parsedTimestamp).toISOString();
};

const metadataMessageTimestamp = (_event, metadata) => normalizeTimestampValue(metadata?.message_timestamp);

const TIMESTAMP_RESOLVERS = {
    'stream.online': (event) => normalizeTimestampValue(event?.started_at),
    'channel.follow': (event) => normalizeTimestampValue(event?.followed_at),
    'channel.chat.message': metadataMessageTimestamp,
    'channel.subscribe': metadataMessageTimestamp,
    'channel.subscription.message': metadataMessageTimestamp,
    'channel.subscription.gift': metadataMessageTimestamp,
    'channel.bits.use': metadataMessageTimestamp,
    'channel.raid': metadataMessageTimestamp,
    'stream.offline': metadataMessageTimestamp
};

const STRICT_TIMESTAMP_SUBSCRIPTIONS = new Set(Object.keys(TIMESTAMP_RESOLVERS));

const resolveNotificationTimestamp = (event, metadata, subscriptionType) => {
    if (!event || typeof event !== 'object') {
        return null;
    }

    const resolver = TIMESTAMP_RESOLVERS[subscriptionType];
    return resolver ? resolver(event, metadata) : null;
};

const applyTimestampFallback = (event, metadata, subscriptionType) => {
    const resolvedTimestamp = resolveNotificationTimestamp(event, metadata, subscriptionType);
    if (!event || typeof event !== 'object') {
        return event;
    }

    if (!resolvedTimestamp) {
        if (!STRICT_TIMESTAMP_SUBSCRIPTIONS.has(subscriptionType)) {
            return event;
        }

        if (!Object.prototype.hasOwnProperty.call(event, 'timestamp')) {
            return event;
        }

        const { timestamp: _timestamp, ...eventWithoutTimestamp } = event;
        return eventWithoutTimestamp;
    }

    if (event.timestamp === resolvedTimestamp) {
        return event;
    }

    return { ...event, timestamp: resolvedTimestamp };
};

module.exports = {
    applyTimestampFallback,
    normalizeMonths,
    normalizeUserIdentity
};
