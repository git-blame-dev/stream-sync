import { parseTimestampISO, parseTimestampMs } from './timestamp';

const MILLISECOND_THRESHOLD = 1_000_000_000_000;
const MICROSECOND_THRESHOLD = 1_000_000_000_000_000;
const YOUTUBE_MICROSECOND_THRESHOLD = 10_000_000_000_000;

type TimestampRecord = Record<string, unknown>;

function asRecord(value: unknown): TimestampRecord | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    return value as TimestampRecord;
}

function resolveTikTokTimestampMs(data: unknown): number | null {
    const root = asRecord(data);
    if (!root) {
        return null;
    }

    const common = asRecord(root.common);
    const candidates = [
        common?.createTime,
        common?.clientSendTime,
        root.timestamp
    ];

    for (const candidate of candidates) {
        const parsed = parseTimestampMs(candidate, {
            allowDateString: true,
            requirePositive: true,
            inferSecondsBelow: MILLISECOND_THRESHOLD,
            inferMicrosecondsThreshold: MICROSECOND_THRESHOLD,
            inferMicrosecondsThresholdInclusive: true,
            microsecondRounding: 'round'
        });
        if (parsed !== null) {
            return parsed;
        }
    }

    return null;
}

function resolveTikTokTimestampISO(data: unknown): string | null {
    const millis = resolveTikTokTimestampMs(data);
    return millis ? new Date(millis).toISOString() : null;
}

function resolveYouTubeTimestampISO(data: unknown): string | null {
    const root = asRecord(data);
    if (!root) {
        return null;
    }

    const source = asRecord(root.item) || root;

    const rawUsec = source.timestamp_usec;
    if (rawUsec !== undefined && rawUsec !== null) {
        return parseTimestampISO(rawUsec, {
            requirePositive: true,
            requireIntegerNumericString: true,
            numericUnit: 'microseconds',
            microsecondRounding: 'floor'
        });
    }

    const rawTimestamp = source.timestamp;
    if (rawTimestamp === undefined || rawTimestamp === null) {
        return null;
    }

    return parseTimestampISO(rawTimestamp, {
        allowDateString: true,
        requirePositive: true,
        inferMicrosecondsThreshold: YOUTUBE_MICROSECOND_THRESHOLD,
        microsecondRounding: 'floor'
    });
}

function resolveTwitchTimestampISO(data: unknown): string | null {
    const root = asRecord(data);
    if (!root) {
        return null;
    }

    const rawTimestamp = root.followed_at ?? root.started_at ?? root.timestamp;
    if (rawTimestamp === undefined || rawTimestamp === null) {
        return null;
    }

    return parseTimestampISO(rawTimestamp, {
        allowDateString: true,
        requirePositive: true
    });
}

export {
    resolveTikTokTimestampMs,
    resolveTikTokTimestampISO,
    resolveYouTubeTimestampISO,
    resolveTwitchTimestampISO
};
