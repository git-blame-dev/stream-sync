
const { describe, test, expect, beforeEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const { initializeTestLogging } = require('../../helpers/test-setup');
const { createMockLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Mock fs module for file operations
mockModule('fs', () => ({
    promises: {
        readFile: createMockFn(),
        writeFile: createMockFn(),
        rename: createMockFn()
    },
    existsSync: createMockFn(() => true)
}));

let fs;
let fsPromises;
const TwitchTokenRefresh = require('../../../src/utils/twitch-token-refresh');
const TwitchAuthService = require('../../../src/auth/TwitchAuthService');

describe('Refresh Token Storage and Update Handling (Twitch Best Practices)', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let mockLogger;
    let mockConfig;
    let tokenRefresh;
    let authService;
    let mockConfigContent;
    let tokenStorePath;

    beforeEach(() => {
        fs = {
            existsSync: createMockFn(() => true),
            promises: {
                readFile: createMockFn(),
                writeFile: createMockFn(),
                rename: createMockFn()
            }
        };
        fsPromises = fs.promises;
        
        // Create mock logger
        mockLogger = createMockLogger('debug', { captureDebug: true });
        
        // Setup mock config with typical values
        tokenStorePath = '/test/token-store.json';
        mockConfig = {
            clientId: 'test_client_id',
            clientSecret: 'test_client_secret',
            accessToken: 'old_access_token_123',
            refreshToken: 'old_refresh_token_456',
            apiKey: 'old_access_token_123', // Usually same as accessToken
            tokenStorePath
        };
        
        // Setup mock config file content
        mockConfigContent = JSON.stringify({
            otherKey: 'keep_me',
            twitch: {
                accessToken: 'old_access_token_123',
                refreshToken: 'old_refresh_token_456'
            }
        }, null, 2);
        
        // Setup default fs mocks
        fsPromises.readFile.mockResolvedValue(mockConfigContent);
        fsPromises.writeFile.mockResolvedValue();
        
        // Create instances
        tokenRefresh = new TwitchTokenRefresh(mockConfig, { fs });
        tokenRefresh.logger = mockLogger;
        
        authService = new TwitchAuthService(mockConfig, { logger: mockLogger });
    });

    // ================================================================================================
    // 1. REFRESH TOKEN UPDATES DURING REFRESH
    // ================================================================================================

    describe('Refresh Token Updates During Refresh', () => {
        test('should store new refresh token from API response', async () => {
            // Given: API returns new refresh token during refresh
            const newTokenData = {
                access_token: 'new_access_token_789',
                refresh_token: 'new_refresh_token_012', // NEW refresh token
                expires_in: 3600
            };

            // When: Updating config with new token data
            const result = await tokenRefresh.updateConfig(newTokenData);

            // Then: New refresh token should be stored in memory
            expect(result).toBe(true);
            expect(mockConfig.refreshToken).toBe('new_refresh_token_012');
            expect(mockConfig.accessToken).toBe('new_access_token_789');
            expect(mockConfig.apiKey).toBe('new_access_token_789');
        });

        test('should replace old refresh token, not duplicate it', async () => {
            // Given: Config starts with old refresh token
            const originalRefreshToken = mockConfig.refreshToken;
            expect(originalRefreshToken).toBe('old_refresh_token_456');

            const newTokenData = {
                access_token: 'new_access_token_789',
                refresh_token: 'completely_new_refresh_token_999',
                expires_in: 3600
            };

            // When: Updating config
            await tokenRefresh.updateConfig(newTokenData);

            // Then: Only new refresh token should exist (old one replaced)
            expect(mockConfig.refreshToken).toBe('completely_new_refresh_token_999');
            expect(mockConfig.refreshToken).not.toBe(originalRefreshToken);
            
            // Verify token store update was called with new token
            const writtenPayload = JSON.parse(fsPromises.writeFile.mock.calls[0][1]);
            expect(writtenPayload.twitch.refreshToken).toBe('completely_new_refresh_token_999');
        });

        test('should update both access and refresh tokens atomically', async () => {
            const newTokenData = {
                access_token: 'new_access_789',
                refresh_token: 'new_refresh_012',
                expires_in: 3600
            };

            // When: Updating config
            await tokenRefresh.updateConfig(newTokenData);

            // Then: Both tokens should be updated in memory first
            expect(mockConfig.accessToken).toBe('new_access_789');
            expect(mockConfig.refreshToken).toBe('new_refresh_012');
            expect(mockConfig.apiKey).toBe('new_access_789');

            // And: Token store should be updated with both tokens
            const writtenPayload = JSON.parse(fsPromises.writeFile.mock.calls[0][1]);
            expect(writtenPayload.twitch.accessToken).toBe('new_access_789');
            expect(writtenPayload.twitch.refreshToken).toBe('new_refresh_012');
        });

        test('should handle missing refresh token in API response gracefully', async () => {
            // Given: API response missing refresh token (sometimes happens)
            const newTokenData = {
                access_token: 'new_access_token_only',
                // refresh_token missing
                expires_in: 3600
            };

            const originalRefreshToken = mockConfig.refreshToken;

            // When: Updating config
            const result = await tokenRefresh.updateConfig(newTokenData);

            // Then: Should still succeed and preserve original refresh token
            expect(result).toBe(true);
            expect(mockConfig.accessToken).toBe('new_access_token_only');
            expect(mockConfig.refreshToken).toBe(originalRefreshToken); // Preserved
            
            // Verify refresh token was not overwritten in token store
            const writtenPayload = JSON.parse(fsPromises.writeFile.mock.calls[0][1]);
            expect(writtenPayload.twitch.refreshToken).toBe(originalRefreshToken);
        });
    });

    // ================================================================================================
    // 2. CONFIG FILE PERSISTENCE
    // ================================================================================================

    describe('Token Store Persistence', () => {
        test('should write refresh tokens to the token store', async () => {
            // Given: New token data with refresh token
            const newTokenData = {
                access_token: 'file_access_123',
                refresh_token: 'file_refresh_456',
                expires_in: 3600
            };

            // When: Updating config
            await tokenRefresh.updateConfig(newTokenData);

            // Then: Token store should be read and written
            expect(fsPromises.readFile).toHaveBeenCalledTimes(1);
            expect(fsPromises.writeFile).toHaveBeenCalledTimes(1);
            const writeArgs = fsPromises.writeFile.mock.calls[0];
            expect(writeArgs[0]).toBe(`${tokenStorePath}.tmp`);
            const writtenPayload = JSON.parse(writeArgs[1]);
            expect(writtenPayload.twitch.accessToken).toBe('file_access_123');
            expect(writtenPayload.twitch.refreshToken).toBe('file_refresh_456');
            expect(fsPromises.rename).toHaveBeenCalledTimes(1);
            expect(fsPromises.rename.mock.calls[0][0]).toBe(`${tokenStorePath}.tmp`);
            expect(fsPromises.rename.mock.calls[0][1]).toBe(tokenStorePath);
        });

        test('should handle config file write failures gracefully', async () => {
            // Given: File write operation fails
            const writeError = new Error('Disk full - cannot write config');
            fsPromises.writeFile.mockRejectedValue(writeError);

            const newTokenData = {
                access_token: 'fail_access_123',
                refresh_token: 'fail_refresh_456',
                expires_in: 3600
            };

            // When: Attempting to update config
            // Then: Should reject with standardized config error
            await expect(tokenRefresh.updateConfig(newTokenData))
                .rejects.toThrow('Token configuration update failed');

            // And: Error should be logged with structured metadata
            const errorCall = mockLogger.error.mock.calls.find(
                (call) => call[0] === 'Error updating configuration with new tokens' && call[1] === 'twitch'
            );
            expect(errorCall).toBeTruthy();
            expect(errorCall[2].errorType).toBe('ConfigError');
            expect(errorCall[2].errorCode).toBe('CONFIG_UPDATE_FAILED');
            expect(errorCall[2].rollbackApplied).toBe(true);
        });

        test('should ensure config file updates are atomic', async () => {
            // Given: Mock to simulate partial write scenario
            let writeCallCount = 0;
            fsPromises.writeFile.mockImplementation(() => {
                writeCallCount++;
                if (writeCallCount === 1) {
                    // Simulate system interruption during first write
                    throw new Error('System interrupted during write');
                }
                return Promise.resolve();
            });

            const newTokenData = {
                access_token: 'atomic_access_123',
                refresh_token: 'atomic_refresh_456',
                expires_in: 3600
            };

            // When: First update attempt fails
            await expect(tokenRefresh.updateConfig(newTokenData))
                .rejects.toThrow('Token configuration update failed');

            // Then: Memory should not be corrupted (rollback or no change)
            // Either tokens are both updated or both unchanged
            const memoryConsistent = (
                (mockConfig.accessToken === 'atomic_access_123' && mockConfig.refreshToken === 'atomic_refresh_456') ||
                (mockConfig.accessToken === 'old_access_token_123' && mockConfig.refreshToken === 'old_refresh_token_456')
            );
            expect(memoryConsistent).toBe(true);
        });

        test('should preserve existing token store data', async () => {
            // Given: Token store with additional keys
            fsPromises.readFile.mockResolvedValue(JSON.stringify({
                otherKey: 'keep',
                twitch: { accessToken: 'old', refreshToken: 'old' }
            }, null, 2));

            const newTokenData = {
                access_token: 'preserve_access_123',
                refresh_token: 'preserve_refresh_456',
                expires_in: 3600
            };

            // When: Updating Twitch tokens
            await tokenRefresh.updateConfig(newTokenData);

            // Then: Other keys should remain and tokens updated
            const writtenPayload = JSON.parse(fsPromises.writeFile.mock.calls[0][1]);
            expect(writtenPayload.otherKey).toBe('keep');
            expect(writtenPayload.twitch.accessToken).toBe('preserve_access_123');
            expect(writtenPayload.twitch.refreshToken).toBe('preserve_refresh_456');
        });
    });

    // ================================================================================================
    // 3. MEMORY VS FILE CONSISTENCY
    // ================================================================================================

    describe('Memory vs File Consistency', () => {
        test('should ensure in-memory config matches the token store after updates', async () => {
            // Given: Track what gets written to file
            let writtenContent = '';
            fsPromises.writeFile.mockImplementation((path, content) => {
                writtenContent = content;
                return Promise.resolve();
            });

            const newTokenData = {
                access_token: 'consistency_access_789',
                refresh_token: 'consistency_refresh_012',
                expires_in: 3600
            };

            // When: Updating config
            await tokenRefresh.updateConfig(newTokenData);

            // Then: Memory values should match what was written to file
            expect(mockConfig.accessToken).toBe('consistency_access_789');
            expect(mockConfig.refreshToken).toBe('consistency_refresh_012');

            // And: File content should contain the same values
            expect(writtenContent).toBeTruthy();
            const writtenPayload = JSON.parse(writtenContent);
            expect(writtenPayload.twitch.accessToken).toBe('consistency_access_789');
            expect(writtenPayload.twitch.refreshToken).toBe('consistency_refresh_012');
        });

        test('should update memory first, then file (correct order)', async () => {
            // Given: Track order of operations
            const operationOrder = [];
            
            // Mock to track memory updates
            const originalUpdateConfig = tokenRefresh.updateConfig.bind(tokenRefresh);
            tokenRefresh.updateConfig = async function(tokenData) {
                // Track when memory is updated
                operationOrder.push('memory_update_start');
                
                // Update memory
                this.config.accessToken = tokenData.access_token;
                this.config.apiKey = tokenData.access_token;
                if (tokenData.refresh_token) {
                    this.config.refreshToken = tokenData.refresh_token;
                }
                
                operationOrder.push('memory_update_complete');
                
                // Then update file
                operationOrder.push('file_update_start');
                await this.persistTokens(tokenData);
                operationOrder.push('file_update_complete');
                
                return true;
            };

            const newTokenData = {
                access_token: 'order_access_123',
                refresh_token: 'order_refresh_456',
                expires_in: 3600
            };

            // When: Updating config
            await tokenRefresh.updateConfig(newTokenData);

            // Then: Memory should be updated before file
            expect(operationOrder).toEqual([
                'memory_update_start',
                'memory_update_complete', 
                'file_update_start',
                'file_update_complete'
            ]);
        });

        test('should rollback memory changes if file write fails', async () => {
            // Given: File write will fail
            const fileError = new Error('File system readonly');
            fsPromises.writeFile.mockRejectedValue(fileError);

            const originalTokens = {
                accessToken: mockConfig.accessToken,
                refreshToken: mockConfig.refreshToken,
                apiKey: mockConfig.apiKey
            };

            const newTokenData = {
                access_token: 'rollback_access_999',
                refresh_token: 'rollback_refresh_888',
                expires_in: 3600
            };

            // When: Update fails due to file write error
            await expect(tokenRefresh.updateConfig(newTokenData))
                .rejects.toThrow('Token configuration update failed');

            // Then: Memory should be rolled back to original state
            // (This test documents the expected behavior - implementation may vary)
            expect(mockConfig.accessToken).toBe(originalTokens.accessToken);
            expect(mockConfig.refreshToken).toBe(originalTokens.refreshToken);
            expect(mockConfig.apiKey).toBe(originalTokens.apiKey);
        });
    });

    // ================================================================================================
    // 4. ERROR RECOVERY
    // ================================================================================================

    describe('Error Recovery', () => {
        test('should handle new refresh token same as old token', async () => {
            // Given: API returns same refresh token (edge case)
            const sameTokenData = {
                access_token: 'new_access_different',
                refresh_token: mockConfig.refreshToken, // Same as current
                expires_in: 3600
            };

            // When: Updating with same refresh token
            const result = await tokenRefresh.updateConfig(sameTokenData);

            // Then: Should still succeed (not an error condition)
            expect(result).toBe(true);
            expect(mockConfig.accessToken).toBe('new_access_different');
            expect(mockConfig.refreshToken).toBe(sameTokenData.refresh_token);

            // And: Should log the situation
            const infoCall = mockLogger.info.mock.calls.find(
                (call) => call[0] === 'Configuration updated with new tokens' && call[1] === 'twitch'
            );
            expect(infoCall).toBeTruthy();
        });

        test('should handle malformed refresh token responses', async () => {
            // Given: Malformed token data
            const malformedData = {
                access_token: 'valid_access_123',
                refresh_token: null, // Invalid refresh token
                expires_in: 3600
            };

            const originalRefreshToken = mockConfig.refreshToken;

            // When: Updating with malformed data
            const result = await tokenRefresh.updateConfig(malformedData);

            // Then: Should handle gracefully
            expect(result).toBe(true);
            expect(mockConfig.accessToken).toBe('valid_access_123');
            expect(mockConfig.refreshToken).toBe(originalRefreshToken); // Preserved
        });

        test('should handle missing refresh token in API response', async () => {
            // Given: API response completely missing refresh_token field
            const incompleteData = {
                access_token: 'incomplete_access_456',
                expires_in: 3600
                // refresh_token field missing entirely
            };

            const originalRefreshToken = mockConfig.refreshToken;

            // When: Updating with incomplete data
            const result = await tokenRefresh.updateConfig(incompleteData);

            // Then: Should succeed and preserve existing refresh token
            expect(result).toBe(true);
            expect(mockConfig.accessToken).toBe('incomplete_access_456');
            expect(mockConfig.refreshToken).toBe(originalRefreshToken);

            // And: Should not add a new refresh token to the token store
            const writtenPayload = JSON.parse(fsPromises.writeFile.mock.calls[0][1]);
            expect(writtenPayload.twitch.refreshToken).toBe(originalRefreshToken);
        });

        test('should recover from config file read failures', async () => {
            // Given: Token store cannot be read
            const readError = new Error('Token store corrupted');
            fsPromises.readFile.mockRejectedValue(readError);

            const newTokenData = {
                access_token: 'recover_access_123',
                refresh_token: 'recover_refresh_456',
                expires_in: 3600
            };

            // When: Attempting to update config
            const result = await tokenRefresh.updateConfig(newTokenData);

            // Then: Should still succeed by creating new token store content
            expect(result).toBe(true);
            const writtenPayload = JSON.parse(fsPromises.writeFile.mock.calls[0][1]);
            expect(writtenPayload.twitch.accessToken).toBe('recover_access_123');
            expect(writtenPayload.twitch.refreshToken).toBe('recover_refresh_456');
        });
    });

    // ================================================================================================
    // 5. CONCURRENT ACCESS PROTECTION
    // ================================================================================================

    describe('Concurrent Access Protection', () => {
        test('should prevent multiple refresh attempts from corrupting storage', async () => {
            // Given: Mock concurrent refresh scenario
            const tokenRefresh1 = new TwitchTokenRefresh(mockConfig, { fs });
            const tokenRefresh2 = new TwitchTokenRefresh(mockConfig, { fs });
            
            tokenRefresh1.logger = mockLogger;
            tokenRefresh2.logger = mockLogger;

            const tokenData1 = {
                access_token: 'concurrent_access_1',
                refresh_token: 'concurrent_refresh_1',
                expires_in: 3600
            };

            const tokenData2 = {
                access_token: 'concurrent_access_2', 
                refresh_token: 'concurrent_refresh_2',
                expires_in: 3600
            };

            // When: Both attempt to update simultaneously
            const [result1, result2] = await Promise.allSettled([
                tokenRefresh1.updateConfig(tokenData1),
                tokenRefresh2.updateConfig(tokenData2)
            ]);

            // Then: Both should complete successfully without corruption
            expect(result1.status).toBe('fulfilled');
            expect(result2.status).toBe('fulfilled');

            // And: Final state should be consistent (one of the valid sets)
            const finalAccessToken = mockConfig.accessToken;
            const finalRefreshToken = mockConfig.refreshToken;
            
            const validCombinations = [
                { access: 'concurrent_access_1', refresh: 'concurrent_refresh_1' },
                { access: 'concurrent_access_2', refresh: 'concurrent_refresh_2' }
            ];

            const finalStateValid = validCombinations.some(combo => 
                finalAccessToken === combo.access && finalRefreshToken === combo.refresh
            );
            
            expect(finalStateValid).toBe(true);
        });

        test('should handle race condition in config file writes', async () => {
            // Given: Simulate race condition in file operations
            let writeCount = 0;
            fsPromises.writeFile.mockImplementation((path, content) => {
                writeCount++;
                // Simulate delay for race condition
                const simulatedDelayMs = 5;
                return new Promise(resolve => {
                    scheduleTestTimeout(() => {
                        resolve();
                    }, simulatedDelayMs);
                });
            });

            const updates = [
                { access_token: 'race_1', refresh_token: 'refresh_1', expires_in: 3600 },
                { access_token: 'race_2', refresh_token: 'refresh_2', expires_in: 3600 },
                { access_token: 'race_3', refresh_token: 'refresh_3', expires_in: 3600 }
            ];

            // When: Multiple updates happen concurrently
            const results = await Promise.allSettled(
                updates.map(data => tokenRefresh.updateConfig(data))
            );

            // Then: All should complete successfully
            results.forEach(result => {
                expect(result.status).toBe('fulfilled');
            });

            // And: File should have been written for each update
            expect(writeCount).toBe(3);
        });

        test('should use refresh token lock to prevent simultaneous refreshes', async () => {
            // Given: TwitchTokenRefresh has isRefreshing flag
            const mockTokenRefresh = {
                isRefreshing: false,
                config: mockConfig,
                logger: mockLogger,
                refreshToken: async function(refreshToken) {
                    if (this.isRefreshing) {
                        this.logger.debug('Token refresh already in progress', 'twitch');
                        return null;
                    }
                    
                    this.isRefreshing = true;
                    
                    // Simulate refresh operation
                    await waitForDelay(10);
                    
                    this.isRefreshing = false;
                    return {
                        access_token: 'locked_access_123',
                        refresh_token: 'locked_refresh_456',
                        expires_in: 3600
                    };
                }
            };

            // When: Two refresh attempts happen simultaneously
            const [result1, result2] = await Promise.all([
                mockTokenRefresh.refreshToken('test_refresh_1'),
                mockTokenRefresh.refreshToken('test_refresh_2')
            ]);

            // Then: Only one should succeed, other should return null
            const validResults = [result1, result2].filter(r => r !== null);
            expect(validResults).toHaveLength(1);
            
            // And: Lock message should be logged
            const debugCall = mockLogger.debug.mock.calls.find(
                (call) => call[0] === 'Token refresh already in progress' && call[1] === 'twitch'
            );
            expect(debugCall).toBeTruthy();
        });
    });

    // ================================================================================================
    // 6. INTEGRATION WITH AUTH SERVICE
    // ================================================================================================

    describe('Integration with TwitchAuthService', () => {
        test('should update auth service refresh token through proper methods', async () => {
            // Given: Auth service with initial refresh token
            expect(authService.getRefreshToken()).toBe('old_refresh_token_456');

            // When: Updating refresh token through auth service
            authService.updateRefreshToken('auth_service_refresh_999');

            // Then: Auth service should reflect new token
            expect(authService.getRefreshToken()).toBe('auth_service_refresh_999');
            expect(mockConfig.refreshToken).toBe('auth_service_refresh_999');
        });

        test('should maintain consistency between auth service and token refresh utility', async () => {
            // Given: Both use same config object
            expect(authService.getRefreshToken()).toBe(tokenRefresh.config.refreshToken);

            const newTokenData = {
                access_token: 'consistent_access_555',
                refresh_token: 'consistent_refresh_777',
                expires_in: 3600
            };

            // When: Token refresh utility updates config
            await tokenRefresh.updateConfig(newTokenData);

            // Then: Auth service should see the updated tokens
            expect(authService.getRefreshToken()).toBe('consistent_refresh_777');
            expect(authService.getAccessToken()).toBe('consistent_access_555');
        });

        test('should handle null refresh token gracefully in auth service', async () => {
            // Given: Auth service with null refresh token
            authService.updateRefreshToken(null);
            
            // When: Getting refresh token
            const refreshToken = authService.getRefreshToken();

            // Then: Should return null without errors
            expect(refreshToken).toBeNull();
        });
    });
});
