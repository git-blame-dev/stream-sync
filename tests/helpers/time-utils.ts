import { safeSetInterval, safeSetTimeout } from '../../src/utils/timeout-validator';
import { now } from './test-clock';

const resolveDelay = (delay: number | undefined, fallback = 1) => {
  if (typeof delay === 'number' && Number.isFinite(delay) && delay > 0) {
    return delay;
  }
  return fallback;
};

function waitForDelay(delay = 0): Promise<void> {
  if (!delay || delay <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    safeSetTimeout(resolve, delay);
  });
}

function scheduleTimeout(callback: (...args: unknown[]) => void, delay: number | undefined, ...args: unknown[]) {
  const effectiveDelay = resolveDelay(delay);
  return safeSetTimeout(() => callback(...args), effectiveDelay);
}

function scheduleInterval(callback: (...args: unknown[]) => void, delay: number | undefined, ...args: unknown[]) {
  const effectiveDelay = resolveDelay(delay);
  return safeSetInterval(() => callback(...args), effectiveDelay);
}

export {
  now,
  resolveDelay,
  waitForDelay,
  scheduleTimeout,
  scheduleInterval
};
