const { vi } = require('bun:test');

const createMockFn = (implementation) => vi.fn(implementation);

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

const clearAllMocks = () => vi.clearAllMocks();
const restoreAllMocks = () => vi.restoreAllMocks();
const resetAllMocks = () => vi.resetAllMocks();

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
    spyOn: (...args) => vi.spyOn(...args)
};
