const testClock = require('./test-clock');

let counter = 0;

const nextTestId = (prefix = 'id') => {
    counter += 1;
    return `${prefix}-${testClock.now()}-${counter}`;
};

const resetTestIds = () => {
    counter = 0;
};

module.exports = {
    nextTestId,
    resetTestIds
};
