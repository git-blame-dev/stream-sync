const MILLISECOND_THRESHOLD = 1_000_000_000_000;
const MICROSECOND_THRESHOLD = 1_000_000_000_000_000;
const YOUTUBE_MICROSECOND_THRESHOLD = 10_000_000_000_000;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    return value as UnknownRecord;
}

function parseTimestampCandidate(value: unknown): number | null {
    if (value === undefined || value === null) {
        return null;
    }

    let numericValue: number;
    if (typeof value === 'number') {
        numericValue = value;
    } else if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return null;
        }

        const numericCandidate = Number(trimmed);
        if (Number.isFinite(numericCandidate)) {
            numericValue = numericCandidate;
        } else {
            const parsedDate = Date.parse(trimmed);
            if (Number.isNaN(parsedDate)) {
                return null;
            }
            numericValue = parsedDate;
        }
    } else {
        return null;
    }

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return null;
    }

    if (numericValue < MILLISECOND_THRESHOLD) {
        return numericValue * 1000;
    }

    if (numericValue >= MICROSECOND_THRESHOLD) {
        return Math.round(numericValue / 1000);
    }

    return numericValue;
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
        const parsed = parseTimestampCandidate(candidate);
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
        const usecValue = typeof rawUsec === 'number'
            ? rawUsec
            : parseNumericString(String(rawUsec));

        if (usecValue === null || usecValue <= 0) {
            return null;
        }

        return new Date(Math.floor(usecValue / 1000)).toISOString();
    }

    const rawTimestamp = source.timestamp;
    if (rawTimestamp === undefined || rawTimestamp === null) {
        return null;
    }

    let timestampValue = parseTimestampValue(rawTimestamp);
    if (timestampValue === null) {
        return null;
    }

    if (timestampValue > YOUTUBE_MICROSECOND_THRESHOLD) {
        timestampValue = Math.floor(timestampValue / 1000);
    }

    return new Date(timestampValue).toISOString();
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

    const timeValue = typeof rawTimestamp === 'number'
        ? rawTimestamp
        : parseTimestampValue(String(rawTimestamp));

    if (timeValue === null || timeValue <= 0) {
        return null;
    }

    return new Date(timeValue).toISOString();
}

function parseNumericString(value: string): number | null {
    if (value.length === 0) {
        return null;
    }

    const num = Number(value);
    if (!Number.isNaN(num) && Number.isFinite(num) && Number.isInteger(num)) {
        return num;
    }

    return null;
}

function parseTimestampValue(value: unknown): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? value : null;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const numericCandidate = Number(trimmed);
    if (!Number.isNaN(numericCandidate) && Number.isFinite(numericCandidate)) {
        return numericCandidate > 0 ? numericCandidate : null;
    }

    const parsedDate = Date.parse(trimmed);
    if (Number.isNaN(parsedDate) || parsedDate <= 0) {
        return null;
    }

    return parsedDate;
}

export {
    resolveTikTokTimestampMs,
    resolveTikTokTimestampISO,
    resolveYouTubeTimestampISO,
    resolveTwitchTimestampISO
};
