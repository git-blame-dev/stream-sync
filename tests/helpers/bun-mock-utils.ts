import { vi } from 'bun:test';

type MockImplementation<Args extends unknown[] = unknown[], Return = unknown> = (...args: Args) => Return;

type MockReturnValue<Return> = unknown extends Return ? unknown : Return;
type MockReturnResult<Return, Value> = unknown extends Return ? Value : Return;
type MockResolvedResult<Return, Value> = unknown extends Return ? Promise<Value> : Return;
type MockRejectedResult<Return> = unknown extends Return ? Promise<never> : Return;

type MockResolvedValue<Return> = Return extends PromiseLike<infer Resolved>
    ? Resolved
    : unknown extends Return
        ? unknown
        : never;

type MockRejectedValue<Return> = Return extends PromiseLike<unknown>
    ? unknown
    : unknown extends Return
        ? unknown
        : never;

type TestMockFn<Args extends unknown[] = unknown[], Return = unknown> = MockImplementation<Args, Return> & {
    mock: {
        calls: Args[];
        invocationCallOrder?: number[];
    };
    mockImplementation: (implementation: MockImplementation<Args, Return>) => TestMockFn<Args, Return>;
    mockImplementationOnce: (implementation: MockImplementation<Args, Return>) => TestMockFn<Args, Return>;
    mockReturnValue: <Value extends MockReturnValue<Return>>(value: Value) => TestMockFn<Args, MockReturnResult<Return, Value>>;
    mockReturnValueOnce: <Value extends MockReturnValue<Return>>(value: Value) => TestMockFn<Args, MockReturnResult<Return, Value>>;
    mockResolvedValue: <Value extends MockResolvedValue<Return>>(value?: Value) => TestMockFn<Args, MockResolvedResult<Return, Value>>;
    mockResolvedValueOnce: <Value extends MockResolvedValue<Return>>(value?: Value) => TestMockFn<Args, MockResolvedResult<Return, Value>>;
    mockRejectedValue: (error: MockRejectedValue<Return>) => TestMockFn<Args, MockRejectedResult<Return>>;
    mockRejectedValueOnce: (error: MockRejectedValue<Return>) => TestMockFn<Args, MockRejectedResult<Return>>;
    mockClear: () => TestMockFn<Args, Return>;
    mockReset: () => TestMockFn<Args, Return>;
};

const createMockFn = <Args extends unknown[] = unknown[], Return = unknown>(
    implementation?: MockImplementation<Args, Return>
): TestMockFn<Args, Return> => {
    const mockFn = implementation === undefined
        ? vi.fn<MockImplementation<Args, Return>>()
        : vi.fn<MockImplementation<Args, Return>>(implementation);

    return mockFn as unknown as TestMockFn<Args, Return>;
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

function mockResolvedValue<Args extends unknown[], Return, Value extends MockResolvedValue<Return>>(
    fn: TestMockFn<Args, Return>,
    value: Value
): TestMockFn<Args, MockResolvedResult<Return, Value>>;
function mockResolvedValue<T>(fn: T, value: unknown): T;
function mockResolvedValue(fn: unknown, value: unknown): unknown {
    if (isMockFunction(fn)) {
        fn.mockResolvedValue(value);
    }
    return fn;
}

function mockRejectedValue<Args extends unknown[], Return>(
    fn: TestMockFn<Args, Return>,
    error: MockRejectedValue<Return>
): TestMockFn<Args, MockRejectedResult<Return>>;
function mockRejectedValue<T>(fn: T, error: unknown): T;
function mockRejectedValue(fn: unknown, error: unknown): unknown {
    if (isMockFunction(fn)) {
        fn.mockRejectedValue(error);
    }
    return fn;
}

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
