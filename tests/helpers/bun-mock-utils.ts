import { vi } from 'bun:test';

type MockLike = {
    mock: {
        calls: unknown[];
    };
    mockResolvedValue: (value: unknown) => void;
    mockRejectedValue: (error: unknown) => void;
    mockClear: () => void;
    mockReset: () => void;
};

const createMockFn = (implementation?: (...args: unknown[]) => unknown) => vi.fn(implementation);

const isMockFunction = (value: unknown): value is MockLike => {
    return !!(
        value &&
        typeof value === 'function' &&
        'mock' in value &&
        typeof (value as { mock?: unknown }).mock === 'object' &&
        Array.isArray((value as { mock: { calls: unknown[] } }).mock.calls)
    );
};

const mockResolvedValue = <T>(fn: T, value: unknown): T => {
    if (isMockFunction(fn)) {
        fn.mockResolvedValue(value);
    }
    return fn;
};

const mockRejectedValue = <T>(fn: T, error: unknown): T => {
    if (isMockFunction(fn)) {
        fn.mockRejectedValue(error);
    }
    return fn;
};

const clearMock = (fn: unknown) => {
    if (isMockFunction(fn)) {
        fn.mockClear();
    }
};

const resetMock = (fn: unknown) => {
    if (isMockFunction(fn)) {
        fn.mockReset();
    }
};

const clearAllMocks = () => vi.clearAllMocks();
const restoreAllMocks = () => vi.restoreAllMocks();
const resetAllMocks = () => vi.resetAllMocks();
const spyOn = (...args: Parameters<typeof vi.spyOn>) => vi.spyOn(...args);

export {
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
