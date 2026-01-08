
const MILLISECOND_THRESHOLD = 1_000_000_000_000; // 1e12 ≈ Sep 2001
const MICROSECOND_THRESHOLD = 1_000_000_000_000_000; // 1e15 ≈ Sep 33658

function parseCandidate(value) {
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
        numericValue = Number(trimmed);
    } else {
        return null;
    }

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return null;
    }

    // TikTok sometimes sends timestamps in seconds. Convert anything that looks
    // smaller than a millisecond epoch into milliseconds. Some fields are in
    // microseconds; convert those down to milliseconds as well.
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
        data.createTime,
        data.common?.createTime,
        data.common?.clientSendTime,
        data.clientSendTime,
        data.clientTime,
        data.timestamp,
        data.message?.timestamp,
        data.message?.createTime,
        data.event?.createTime
    ];

    for (const candidate of candidates) {
        const parsed = parseCandidate(candidate);
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

module.exports = {
    resolveTikTokTimestampMs,
    resolveTikTokTimestampISO
};
