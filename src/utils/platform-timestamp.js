
const MILLISECOND_THRESHOLD = 1_000_000_000_000; // 1e12 - timestamps below this are seconds
const MICROSECOND_THRESHOLD = 1_000_000_000_000_000; // 1e15 - timestamps above this are microseconds

function parseTimestampCandidate(value) {
    if (value === undefined || value === null) {
        return null;
    }

    let numericValue;
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

function resolveTikTokTimestampMs(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }

    const candidates = [
        data.common?.createTime,
        data.common?.clientSendTime,
        data.timestamp
    ];

    for (const candidate of candidates) {
        const parsed = parseTimestampCandidate(candidate);
        if (parsed !== null) {
            return parsed;
        }
    }

    return null;
}

function resolveTikTokTimestampISO(data) {
    const millis = resolveTikTokTimestampMs(data);
    return millis ? new Date(millis).toISOString() : null;
}

function resolveYouTubeTimestampISO(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }

    const source = data.item && typeof data.item === 'object' ? data.item : data;

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

    const YOUTUBE_MICROSECOND_THRESHOLD = 10_000_000_000_000; // 10^13
    if (timestampValue > YOUTUBE_MICROSECOND_THRESHOLD) {
        timestampValue = Math.floor(timestampValue / 1000);
    }

    return new Date(timestampValue).toISOString();
}

function resolveTwitchTimestampISO(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }

    const rawTimestamp = data.followed_at ?? data.started_at ?? data.timestamp;
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

function parseNumericString(str) {
    if (typeof str !== 'string' || str.length === 0) {
        return null;
    }
    const num = Number(str);
    if (!Number.isNaN(num) && Number.isFinite(num) && Number.isInteger(num)) {
        return num;
    }
    return null;
}

function parseTimestampValue(value) {
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

module.exports = {
    resolveTikTokTimestampMs,
    resolveTikTokTimestampISO,
    resolveYouTubeTimestampISO,
    resolveTwitchTimestampISO
};
