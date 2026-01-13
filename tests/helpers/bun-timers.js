const { jest } = require('bun:test');

const timerState = {
    installed: false,
    activeTimers: new Set(),
    original: null
};

const ensureOriginal = () => {
    if (!timerState.original) {
        timerState.original = {
            setTimeout: global.setTimeout,
            setInterval: global.setInterval,
            clearTimeout: global.clearTimeout,
            clearInterval: global.clearInterval
        };
    }
};

const installTimerTracking = () => {
    if (timerState.installed) {
        return timerState;
    }
    ensureOriginal();

    const { setTimeout, setInterval, clearTimeout, clearInterval } = timerState.original;

    global.setTimeout = function setTimeoutTracked(callback, delay, ...args) {
        const timerId = setTimeout.call(this, callback, delay, ...args);
        timerState.activeTimers.add(timerId);
        return timerId;
    };

    global.setInterval = function setIntervalTracked(callback, delay, ...args) {
        const intervalId = setInterval.call(this, callback, delay, ...args);
        timerState.activeTimers.add(intervalId);
        return intervalId;
    };

    global.clearTimeout = function clearTimeoutTracked(timerId) {
        timerState.activeTimers.delete(timerId);
        return clearTimeout.call(this, timerId);
    };

    global.clearInterval = function clearIntervalTracked(intervalId) {
        timerState.activeTimers.delete(intervalId);
        return clearInterval.call(this, intervalId);
    };

    timerState.installed = true;
    return timerState;
};

const clearTrackedTimers = () => {
    if (!timerState.original) {
        return;
    }
    const { clearTimeout, clearInterval } = timerState.original;
    timerState.activeTimers.forEach((timerId) => {
        try {
            clearTimeout(timerId);
            clearInterval(timerId);
        } catch (error) {
            // Ignore already-cleared timers
        }
    });
    timerState.activeTimers.clear();
};

const restoreTimerTracking = () => {
    if (!timerState.original) {
        return;
    }
    clearTrackedTimers();
    global.setTimeout = timerState.original.setTimeout;
    global.setInterval = timerState.original.setInterval;
    global.clearTimeout = timerState.original.clearTimeout;
    global.clearInterval = timerState.original.clearInterval;
    timerState.installed = false;
};

const useFakeTimers = (...args) => jest.useFakeTimers(...args);

const useRealTimers = (...args) => jest.useRealTimers(...args);

module.exports = {
    installTimerTracking,
    clearTrackedTimers,
    restoreTimerTracking,
    useFakeTimers,
    useRealTimers,
    advanceTimersByTime: (...args) => jest.advanceTimersByTime(...args),
    runOnlyPendingTimers: (...args) => jest.runOnlyPendingTimers(...args),
    runAllTimers: (...args) => jest.runAllTimers(...args),
    clearAllTimers: (...args) => jest.clearAllTimers(...args),
    getTimerCount: () => jest.getTimerCount()
};
