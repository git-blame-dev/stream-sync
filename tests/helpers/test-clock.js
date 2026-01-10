const DEFAULT_EPOCH_MS = 1700000000000;

let currentTimeMs = DEFAULT_EPOCH_MS;

const assertValidMillis = (value, label) => {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be a non-negative, finite number`);
    }
};

const now = () => currentTimeMs;

const advance = (ms) => {
    assertValidMillis(ms, 'advance');
    currentTimeMs += ms;
    return currentTimeMs;
};

const set = (ms) => {
    assertValidMillis(ms, 'set');
    currentTimeMs = ms;
    return currentTimeMs;
};

const reset = () => {
    currentTimeMs = DEFAULT_EPOCH_MS;
    return currentTimeMs;
};

module.exports = {
    DEFAULT_EPOCH_MS,
    now,
    advance,
    set,
    reset
};
