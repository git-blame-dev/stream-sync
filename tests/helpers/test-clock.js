const { setSystemTime } = require('bun:test');

const DEFAULT_EPOCH_MS = 1700000000000;

let _preciseTimeMs = DEFAULT_EPOCH_MS;

const assertValidMillis = (value, label) => {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be a non-negative, finite number`);
    }
};

const syncSystemTime = () => {
    setSystemTime(new Date(Math.floor(_preciseTimeMs)));
};

const now = () => _preciseTimeMs;

const advance = (ms) => {
    assertValidMillis(ms, 'advance');
    _preciseTimeMs += ms;
    syncSystemTime();
    return _preciseTimeMs;
};

const set = (ms) => {
    assertValidMillis(ms, 'set');
    _preciseTimeMs = ms;
    syncSystemTime();
    return _preciseTimeMs;
};

const reset = () => {
    _preciseTimeMs = DEFAULT_EPOCH_MS;
    syncSystemTime();
    return _preciseTimeMs;
};

const useRealTime = () => {
    setSystemTime();
};

module.exports = {
    DEFAULT_EPOCH_MS,
    now,
    advance,
    set,
    reset,
    useRealTime
};
