const { clearAllMocks, restoreAllMocks } = require('./bun-mock-utils');
const { clearTrackedTimers } = require('./bun-timers');

const clearTestState = () => {
    clearAllMocks();
    clearTrackedTimers();
};

module.exports = {
    clearTestState,
    restoreAllMocks
};
