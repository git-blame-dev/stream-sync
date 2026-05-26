import { vi } from 'bun:test';

type MockImplementation<Args extends readonly unknown[] = readonly unknown[], Return = never> = (...args: Args) => Return;

type MockReturnValue<Return> = [Return] extends [never] ? unknown : Return;

type MockResolvedValue<Return> = [Return] extends [never]
    ? unknown
    : Return extends PromiseLike<infer Resolved>
    ? Resolved
    : unknown extends Return
        ? unknown
        : never;

type MockRejectedValue<Return> = [Return] extends [never]
    ? unknown
    : Return extends PromiseLike<unknown>
    ? unknown
    : unknown extends Return
        ? unknown
        : never;

type TestMockFn<Args extends readonly unknown[] = readonly unknown[], Return = never> = MockImplementation<Args, Return> & {
    mock: {
        calls: Args[];
        invocationCallOrder?: number[];
    };
    mockImplementation: (implementation: MockImplementation<Args, Return>) => TestMockFn<Args, Return>;
    mockImplementationOnce: (implementation: MockImplementation<Args, Return>) => TestMockFn<Args, Return>;
    mockReturnValue: (value: MockReturnValue<Return>) => TestMockFn<Args, Return>;
    mockReturnValueOnce: (value: MockReturnValue<Return>) => TestMockFn<Args, Return>;
    mockResolvedValue: (value?: MockResolvedValue<Return>) => TestMockFn<Args, Return>;
    mockResolvedValueOnce: (value?: MockResolvedValue<Return>) => TestMockFn<Args, Return>;
    mockRejectedValue: (error: MockRejectedValue<Return>) => TestMockFn<Args, Return>;
    mockRejectedValueOnce: (error: MockRejectedValue<Return>) => TestMockFn<Args, Return>;
    mockClear: () => TestMockFn<Args, Return>;
    mockReset: () => TestMockFn<Args, Return>;
};

const createMockFn = <Args extends readonly unknown[] = readonly unknown[], Return = never>(
    implementation?: MockImplementation<Args, Return>
): TestMockFn<Args, Return> => {
    const mockFn = implementation === undefined
        ? vi.fn<MockImplementation<Args, Return>>()
        : vi.fn<MockImplementation<Args, Return>>(implementation);

    return mockFn as TestMockFn<Args, Return>;
};

const isMockFunction = (value: unknown): value is TestMockFn => {
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
    type TestMockFn,
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
