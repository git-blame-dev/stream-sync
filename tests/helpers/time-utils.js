const { safeSetTimeout, safeSetInterval } = require('../../src/utils/timeout-validator');
const testClock = require('./test-clock');

const resolveDelay = (delay, fallback = 1) => {
  if (typeof delay === 'number' && Number.isFinite(delay) && delay > 0) {
    return delay;
  }
  return fallback;
};

function waitForDelay(delay = 0) {
  if (!delay || delay <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => safeSetTimeout(resolve, delay));
}

function scheduleTimeout(callback, delay, ...args) {
  const effectiveDelay = resolveDelay(delay);
  return safeSetTimeout(callback, effectiveDelay, ...args);
}

function scheduleInterval(callback, delay, ...args) {
  const effectiveDelay = resolveDelay(delay);
  return safeSetInterval(callback, effectiveDelay, ...args);
}

module.exports = {
  now: () => testClock.now(),
  resolveDelay,
  waitForDelay,
  scheduleTimeout,
  scheduleInterval
};
