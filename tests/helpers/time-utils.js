const { safeSetTimeout, safeSetInterval } = require('../../src/utils/timeout-validator');

function waitForDelay(delay = 0) {
  if (!delay || delay <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => safeSetTimeout(resolve, delay));
}

function scheduleTimeout(callback, delay, ...args) {
  const effectiveDelay = !delay || delay <= 0 ? 1 : delay;
  return safeSetTimeout(callback, effectiveDelay, ...args);
}

function scheduleInterval(callback, delay, ...args) {
  const effectiveDelay = !delay || delay <= 0 ? 1 : delay;
  return safeSetInterval(callback, effectiveDelay, ...args);
}

module.exports = {
  waitForDelay,
  scheduleTimeout,
  scheduleInterval
};
