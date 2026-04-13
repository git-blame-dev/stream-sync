const normalizeMonths = (value: unknown): number | undefined => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : undefined;
};

const normalizeUserIdentity = (username: string, userId: string): { username: string; userId: string } => ({ username, userId });

const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

const normalizeTimestampValue = (value: unknown): string | null => {
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

const normalizeCanonicalIdValue = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmedValue = value.trim();
    return trimmedValue ? trimmedValue : null;
};

const metadataMessageTimestamp = (
    _event: Record<string, unknown> | null | undefined,
    metadata: Record<string, unknown> | null | undefined
) => normalizeTimestampValue(metadata?.message_timestamp);

const TIMESTAMP_RESOLVERS = {
    'stream.online': (event: Record<string, unknown> | null | undefined) => normalizeTimestampValue(event?.started_at),
    'channel.follow': (event: Record<string, unknown> | null | undefined) => normalizeTimestampValue(event?.followed_at),
    'channel.chat.message': metadataMessageTimestamp,
    'channel.subscribe': metadataMessageTimestamp,
    'channel.subscription.message': metadataMessageTimestamp,
    'channel.subscription.gift': metadataMessageTimestamp,
    'channel.bits.use': metadataMessageTimestamp,
    'channel.raid': metadataMessageTimestamp,
    'stream.offline': metadataMessageTimestamp
};

const STRICT_TIMESTAMP_SUBSCRIPTIONS = new Set(Object.keys(TIMESTAMP_RESOLVERS));

const resolveNotificationTimestamp = (
    event: Record<string, unknown> | null | undefined,
    metadata: Record<string, unknown> | null | undefined,
    subscriptionType: string
): string | null => {
    if (!event || typeof event !== 'object') {
        return null;
    }

    const resolver = TIMESTAMP_RESOLVERS[subscriptionType];
    return resolver ? resolver(event, metadata) : null;
};

const applyTimestampFallback = (
    event: Record<string, unknown> | null | undefined,
    metadata: Record<string, unknown> | null | undefined,
    subscriptionType: string
) => {
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

        const { timestamp: _omitTimestamp, ...eventWithoutTimestamp } = event;
        return eventWithoutTimestamp;
    }

    if (event.timestamp === resolvedTimestamp) {
        return event;
    }

    return { ...event, timestamp: resolvedTimestamp };
};

const applyIdFallback = (
    event: Record<string, unknown> | null | undefined,
    metadata: Record<string, unknown> | null | undefined,
    subscriptionType: string
) => {
    if (!event || typeof event !== 'object') {
        return event;
    }

    if (subscriptionType !== 'channel.bits.use') {
        return event;
    }

    const metadataBitsId = normalizeCanonicalIdValue(metadata?.message_id);
    const rawBitsId = normalizeCanonicalIdValue(event.id);
    const canonicalBitsId = metadataBitsId || rawBitsId;
    const { id: _dropRawId, message_id: _dropRawMessageId, ...eventWithoutRawIds } = event;
    if (!canonicalBitsId) {
        return eventWithoutRawIds;
    }

    return {
        ...eventWithoutRawIds,
        id: canonicalBitsId
    };
};

const applyNotificationMetadataFallback = (
    event: Record<string, unknown> | null | undefined,
    metadata: Record<string, unknown> | null | undefined,
    subscriptionType: string
) => {
    const timestampNormalizedEvent = applyTimestampFallback(event, metadata, subscriptionType);
    return applyIdFallback(timestampNormalizedEvent, metadata, subscriptionType);
};

export {
    applyNotificationMetadataFallback,
    applyTimestampFallback,
    normalizeMonths,
    normalizeUserIdentity
};
