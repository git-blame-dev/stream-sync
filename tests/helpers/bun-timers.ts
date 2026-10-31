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
        const [callback, delay, ...callbackArguments] = args;
        const timerId = nativeSetTimeout(function (this: unknown, ...callbackArgs: unknown[]) {
            timerState.activeTimers.delete(timerId as TimerIdentifier);
            callback.apply(this, callbackArgs);
        }, delay, ...callbackArguments);
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

const restoreTimerTracking = () => {
    if (!timerState.original) {
        return;
    }
    global.setTimeout = timerState.original.setTimeout;
    global.setInterval = timerState.original.setInterval;
    global.clearTimeout = timerState.original.clearTimeout;
    global.clearInterval = timerState.original.clearInterval;
    timerState.installed = false;
    timerState.original = null;
};

const switchTimerMode = <T>(switchMode: () => T): T => {
    const wasInstalled = timerState.installed;
    restoreTimerTracking();
    try {
        return switchMode();
    } finally {
        if (wasInstalled) installTimerTracking();
    }
};

const useFakeTimers = () => switchTimerMode(() => vi.useFakeTimers());

const useRealTimers = () => switchTimerMode(() => vi.useRealTimers());

const setSystemTimeForTests = (date?: Date) => setSystemTime(date);
const advanceTimersByTime = (milliseconds: number) => vi.advanceTimersByTime(milliseconds);
const runOnlyPendingTimers = () => vi.runOnlyPendingTimers();
const runAllTimers = () => vi.runAllTimers();
const clearAllTimers = () => vi.clearAllTimers();
const getTimerCount = () => vi.getTimerCount();

export {
    installTimerTracking,
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
