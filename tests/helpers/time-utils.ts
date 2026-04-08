import { createRequire } from 'node:module';
import { now } from './test-clock';

const nodeRequire = createRequire(import.meta.url);
const { safeSetTimeout, safeSetInterval } = nodeRequire('../../src/utils/timeout-validator') as {
  safeSetTimeout: typeof setTimeout;
  safeSetInterval: typeof setInterval;
};

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
  return safeSetTimeout(callback, effectiveDelay, ...args);
}

function scheduleInterval(callback: (...args: unknown[]) => void, delay: number | undefined, ...args: unknown[]) {
  const effectiveDelay = resolveDelay(delay);
  return safeSetInterval(callback, effectiveDelay, ...args);
}

export {
  now,
  resolveDelay,
  waitForDelay,
  scheduleTimeout,
  scheduleInterval
};
