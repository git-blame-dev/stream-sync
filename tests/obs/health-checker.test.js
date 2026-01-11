
const { createTestUser, createMockConfig } = require('../helpers/test-setup');
const testClock = require('../helpers/test-clock');

describe('OBSHealthChecker', () => {
    let OBSHealthChecker;
    let mockOBSManager;
    let healthChecker;
    let mockLogger;

    const createHealthChecker = (config = {}) => new OBSHealthChecker(mockOBSManager, {
        timeProvider: () => testClock.now(),
        ...config
    });
 
    beforeEach(() => {
        // Reset modules for clean testing
        jest.resetModules();
        
        // Mock logger
        mockLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn()
        };

        // Mock OBS connection manager
        mockOBSManager = {
            isConnected: jest.fn(),
            call: jest.fn()
        };

        // Import after mocking
        OBSHealthChecker = require('../../src/obs/health-checker');
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    describe('Constructor', () => {
        it('should initialize with default configuration', () => {
            healthChecker = createHealthChecker();
            
            expect(healthChecker.obsManager).toBe(mockOBSManager);
            expect(healthChecker.cacheTimeout).toBe(2000); // 2 seconds default
            expect(healthChecker.maxFailures).toBe(3); // 3 failures default
            expect(healthChecker.lastCheck).toBeNull();
            expect(healthChecker.lastResult).toBeNull();
            expect(healthChecker.consecutiveFailures).toBe(0);
        });

        it('should accept custom configuration', () => {
            const customConfig = {
                cacheTimeout: 5000,
                maxFailures: 5
            };
            
            healthChecker = createHealthChecker(customConfig);
            
            expect(healthChecker.cacheTimeout).toBe(5000);
            expect(healthChecker.maxFailures).toBe(5);
        });

        it('should require OBS connection manager', () => {
            expect(() => new OBSHealthChecker(null)).toThrow('OBS connection manager is required');
        });
    });

    describe('isReady()', () => {
        beforeEach(() => {
            healthChecker = createHealthChecker();
        });

        it('should return false when OBS is not connected', async () => {
            mockOBSManager.isConnected.mockReturnValue(false);
            
            const result = await healthChecker.isReady();
            
            expect(result).toBe(false);
            expect(mockOBSManager.call).not.toHaveBeenCalled();
        });

        it('should return true when OBS is connected and GetVersion succeeds', async () => {
            mockOBSManager.isConnected.mockReturnValue(true);
            mockOBSManager.call.mockResolvedValue({ version: '28.0.0' });
            
            const result = await healthChecker.isReady();
            
            expect(result).toBe(true);
            const [method, payload] = mockOBSManager.call.mock.calls[0];
            expect(method).toBe('GetVersion');
            expect(payload).toEqual({});
        });

        it('should return false when OBS is connected but GetVersion fails', async () => {
            mockOBSManager.isConnected.mockReturnValue(true);
            mockOBSManager.call.mockRejectedValue(new Error('OBS is not ready to perform the request.'));
            
            const result = await healthChecker.isReady();
            
            expect(result).toBe(false);
            const [method, payload] = mockOBSManager.call.mock.calls[0];
            expect(method).toBe('GetVersion');
            expect(payload).toEqual({});
        });

        it('should use cached result when cache is valid', async () => {
            mockOBSManager.isConnected.mockReturnValue(true);
            mockOBSManager.call.mockResolvedValue({ version: '28.0.0' });
            
            // First call
            const result1 = await healthChecker.isReady();
            expect(result1).toBe(true);
            expect(mockOBSManager.call).toHaveBeenCalledTimes(1);
            
            // Second call within cache timeout
            testClock.advance(1000); // 1 second
            const result2 = await healthChecker.isReady();
            expect(result2).toBe(true);
            expect(mockOBSManager.call).toHaveBeenCalledTimes(1); // Should use cache
        });

        it('should perform new health check when cache expires', async () => {
            mockOBSManager.isConnected.mockReturnValue(true);
            mockOBSManager.call.mockResolvedValue({ version: '28.0.0' });
            
            // First call
            await healthChecker.isReady();
            expect(mockOBSManager.call).toHaveBeenCalledTimes(1);
            
            // Second call after cache timeout
            testClock.advance(3000); // 3 seconds (past 2 second cache)
            await healthChecker.isReady();
            expect(mockOBSManager.call).toHaveBeenCalledTimes(2); // Should make new call
        });

        it('should track consecutive failures', async () => {
            mockOBSManager.isConnected.mockReturnValue(true);
            mockOBSManager.call.mockRejectedValue(new Error('OBS error'));
            
            expect(healthChecker.consecutiveFailures).toBe(0);
            
            await healthChecker.isReady();
            expect(healthChecker.consecutiveFailures).toBe(1);
            
            await healthChecker.isReady();
            expect(healthChecker.consecutiveFailures).toBe(2);
        });

        it('should reset consecutive failures on successful health check', async () => {
            mockOBSManager.isConnected.mockReturnValue(true);
            
            // First failure
            mockOBSManager.call.mockRejectedValueOnce(new Error('OBS error'));
            await healthChecker.isReady();
            expect(healthChecker.consecutiveFailures).toBe(1);
            
            // Then success
            mockOBSManager.call.mockResolvedValue({ version: '28.0.0' });
            await healthChecker.isReady();
            expect(healthChecker.consecutiveFailures).toBe(0);
        });
    });

    describe('Circuit Breaker', () => {
        beforeEach(() => {
            healthChecker = createHealthChecker({ maxFailures: 2 });
        });

        it('should open circuit after maximum failures', async () => {
            mockOBSManager.isConnected.mockReturnValue(true);
            mockOBSManager.call.mockRejectedValue(new Error('OBS error'));
            
            // Trigger failures up to the limit
            await healthChecker.isReady();
            await healthChecker.isReady();
            
            expect(healthChecker.isCircuitOpen()).toBe(true);
        });

        it('should not open circuit before maximum failures', async () => {
            mockOBSManager.isConnected.mockReturnValue(true);
            mockOBSManager.call.mockRejectedValue(new Error('OBS error'));
            
            await healthChecker.isReady();
            
            expect(healthChecker.isCircuitOpen()).toBe(false);
        });

        it('should close circuit after successful health check', async () => {
            mockOBSManager.isConnected.mockReturnValue(true);
            
            // Open circuit with failures
            mockOBSManager.call.mockRejectedValue(new Error('OBS error'));
            await healthChecker.isReady();
            await healthChecker.isReady();
            expect(healthChecker.isCircuitOpen()).toBe(true);
            
            // Close circuit with success
            mockOBSManager.call.mockResolvedValue({ version: '28.0.0' });
            await healthChecker.isReady();
            expect(healthChecker.isCircuitOpen()).toBe(false);
        });
    });

    describe('Performance Considerations', () => {
        beforeEach(() => {
            healthChecker = createHealthChecker();
        });

        it('should issue a GetVersion health check call', async () => {
            mockOBSManager.isConnected.mockReturnValue(true);
            mockOBSManager.call.mockResolvedValue({ version: '28.0.0' });
            
            await healthChecker.isReady();
            
            const [method, payload] = mockOBSManager.call.mock.calls[0];
            expect(method).toBe('GetVersion');
            expect(payload).toEqual({});
        });

        it('should handle timeout errors gracefully', async () => {
            mockOBSManager.isConnected.mockReturnValue(true);
            mockOBSManager.call.mockRejectedValue(new Error('Timeout'));
            
            const result = await healthChecker.isReady();
            
            expect(result).toBe(false);
            expect(healthChecker.consecutiveFailures).toBe(1);
        });
    });

    describe('Cache Management', () => {
        beforeEach(() => {
            healthChecker = createHealthChecker();
        });

        it('should invalidate cache on connection state change', () => {
            // Set up cached result
            healthChecker.lastCheck = testClock.now();
            healthChecker.lastResult = true;
            
            healthChecker.invalidateCache();
            
            expect(healthChecker.lastCheck).toBeNull();
            expect(healthChecker.lastResult).toBeNull();
        });

        it('should provide method to get cache status', () => {
            expect(healthChecker.isCacheValid()).toBe(false);
            
            healthChecker.lastCheck = testClock.now();
            expect(healthChecker.isCacheValid()).toBe(true);
        });
    });
});
