import { setSystemTime, vi } from 'bun:test';

type TimerIdentifier = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;

type TimerOriginals = {
    setTimeout: typeof global.setTimeout;
    setInterval: typeof global.setInterval;
    clearTimeout: typeof global.clearTimeout;
    clearInterval: typeof global.clearInterval;
};

const timerState: {
    installed: boolean;
    activeTimers: Set<TimerIdentifier>;
    original: TimerOriginals | null;
} = {
    installed: false,
    activeTimers: new Set<TimerIdentifier>(),
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

    const originals = timerState.original;
    if (!originals) {
        return timerState;
    }

    const {
        setTimeout: nativeSetTimeout,
        setInterval: nativeSetInterval,
        clearTimeout: nativeClearTimeout,
        clearInterval: nativeClearInterval
    } = originals;

    global.setTimeout = ((...args: Parameters<typeof global.setTimeout>) => {
        const timerId = nativeSetTimeout(...args);
        timerState.activeTimers.add(timerId as TimerIdentifier);
        return timerId;
    }) as typeof global.setTimeout;

    global.setInterval = ((...args: Parameters<typeof global.setInterval>) => {
        const intervalId = nativeSetInterval(...args);
        timerState.activeTimers.add(intervalId as TimerIdentifier);
        return intervalId;
    }) as typeof global.setInterval;

    global.clearTimeout = ((timerId: Parameters<typeof global.clearTimeout>[0]) => {
        timerState.activeTimers.delete(timerId as TimerIdentifier);
        return nativeClearTimeout(timerId);
    }) as typeof global.clearTimeout;

    global.clearInterval = ((intervalId: Parameters<typeof global.clearInterval>[0]) => {
        timerState.activeTimers.delete(intervalId as TimerIdentifier);
        return nativeClearInterval(intervalId);
    }) as typeof global.clearInterval;

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
            clearTimeout(timerId as Parameters<typeof clearTimeout>[0]);
            clearInterval(timerId as Parameters<typeof clearInterval>[0]);
        } catch {
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

const useFakeTimers = () => vi.useFakeTimers();

const useRealTimers = () => vi.useRealTimers();

const setSystemTimeForTests = (date?: Date) => setSystemTime(date);
const advanceTimersByTime = (milliseconds: number) => vi.advanceTimersByTime(milliseconds);
const runOnlyPendingTimers = () => vi.runOnlyPendingTimers();
const runAllTimers = () => vi.runAllTimers();
const clearAllTimers = () => vi.clearAllTimers();
const getTimerCount = () => vi.getTimerCount();

export {
    installTimerTracking,
    clearTrackedTimers,
    restoreTimerTracking,
    useFakeTimers,
    useRealTimers,
    setSystemTimeForTests as setSystemTime,
    advanceTimersByTime,
    runOnlyPendingTimers,
    runAllTimers,
    clearAllTimers,
    getTimerCount
};
