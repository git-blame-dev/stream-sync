const { describe, it, expect, beforeEach, afterEach } = require('bun:test');

const {
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
} = require('./bun-mock-utils');

describe('bun-mock-utils behavior', () => {
    beforeEach(() => {
        clearAllMocks();
        restoreAllMocks();
    });

    afterEach(() => {
        clearAllMocks();
        resetAllMocks();
        restoreAllMocks();
    });

    it('creates mock functions and detects mock identity', () => {
        const mockFn = createMockFn((value) => value + 1);

        expect(mockFn(2)).toBe(3);
        expect(isMockFunction(mockFn)).toBe(true);
        expect(isMockFunction(() => 1)).toBe(false);
        expect(isMockFunction(null)).toBe(false);
    });

    it('wraps async behavior for mocked functions only', async () => {
        const resolvedMock = createMockFn();
        const rejectedMock = createMockFn();
        const plainFunction = () => 'plain';

        expect(mockResolvedValue(plainFunction, 'noop')).toBe(plainFunction);
        expect(mockRejectedValue(plainFunction, new Error('noop'))).toBe(plainFunction);

        mockResolvedValue(resolvedMock, 'resolved-value');
        mockRejectedValue(rejectedMock, new Error('rejected-value'));

        await expect(resolvedMock()).resolves.toBe('resolved-value');
        await expect(rejectedMock()).rejects.toThrow('rejected-value');
    });

    it('clears and resets a single mock function', () => {
        const mockFn = createMockFn((value) => value * 2);

        expect(mockFn(2)).toBe(4);
        expect(mockFn.mock.calls.length).toBe(1);

        clearMock(mockFn);
        expect(mockFn.mock.calls.length).toBe(0);

        resetMock(mockFn);
        expect(mockFn()).toBeUndefined();
        expect(mockFn.mock.calls.length).toBe(1);
    });

    it('manages global mock lifecycle helpers and spy wrapper', () => {
        const target = {
            multiply(left, right) {
                return left * right;
            }
        };
        const mockA = createMockFn(() => 'a');
        const mockB = createMockFn(() => 'b');

        const wrappedSpy = spyOn(target, 'multiply');
        expect(target.multiply(3, 4)).toBe(12);
        expect(isMockFunction(wrappedSpy)).toBe(true);

        mockA();
        mockB();
        expect(mockA.mock.calls.length).toBe(1);
        expect(mockB.mock.calls.length).toBe(1);

        clearAllMocks();
        expect(mockA.mock.calls.length).toBe(0);
        expect(mockB.mock.calls.length).toBe(0);

        mockA.mockImplementation(() => 'updated');
        mockA();
        expect(mockA.mock.calls.length).toBe(1);

        resetAllMocks();
        expect(mockA.mock.calls.length).toBe(0);

        restoreAllMocks();
        expect(target.multiply(5, 2)).toBe(10);
        expect(isMockFunction(target.multiply)).toBe(false);
    });
});
