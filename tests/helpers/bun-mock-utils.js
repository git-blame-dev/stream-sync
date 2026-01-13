const { jest, spyOn } = require('bun:test');

const createMockFn = (implementation) => jest.fn(implementation);

const isMockFunction = (value) => Boolean(value && value.mock && Array.isArray(value.mock.calls));

const mockResolvedValue = (fn, value) => {
    if (isMockFunction(fn)) {
        fn.mockResolvedValue(value);
    }
    return fn;
};

const mockRejectedValue = (fn, error) => {
    if (isMockFunction(fn)) {
        fn.mockRejectedValue(error);
    }
    return fn;
};

const clearMock = (fn) => {
    if (isMockFunction(fn)) {
        fn.mockClear();
    }
};

const resetMock = (fn) => {
    if (isMockFunction(fn)) {
        fn.mockReset();
    }
};

const clearAllMocks = () => jest.clearAllMocks();
const restoreAllMocks = () => jest.restoreAllMocks();
const resetAllMocks = () => jest.resetAllMocks();

module.exports = {
    createMockFn,
    isMockFunction,
    mockResolvedValue,
    mockRejectedValue,
    clearMock,
    resetMock,
    clearAllMocks,
    restoreAllMocks,
    resetAllMocks,
    spyOn
};
