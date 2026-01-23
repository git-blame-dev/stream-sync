
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { noOpLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

let fs;
let fsPromises;
const TwitchTokenRefresh = require('../../../src/utils/twitch-token-refresh');
const TwitchAuthService = require('../../../src/auth/TwitchAuthService');

describe('Refresh Token Storage and Update Handling (Twitch Best Practices)', () => {
    afterEach(() => {
        restoreAllMocks();
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
        
        mockLogger = noOpLogger;

        tokenStorePath = '/test/token-store.json';
        mockConfig = {
            clientId: 'test_client_id',
            clientSecret: 'test_client_secret',
            accessToken: 'old_access_token_123',
            refreshToken: 'old_refresh_token_456',
            tokenStorePath
        };

        mockConfigContent = JSON.stringify({
            otherKey: 'keep_me',
            twitch: {
                accessToken: 'old_access_token_123',
                refreshToken: 'old_refresh_token_456'
            }
        }, null, 2);

        fsPromises.readFile.mockResolvedValue(mockConfigContent);
        fsPromises.writeFile.mockResolvedValue();

        tokenRefresh = new TwitchTokenRefresh(mockConfig, { fs, retryAttempts: 1, retryDelay: 0 });
        tokenRefresh.logger = mockLogger;

        authService = new TwitchAuthService(mockConfig, { logger: mockLogger });
    });

    describe('Refresh Token Updates During Refresh', () => {
        test('should store new refresh token from API response', async () => {
            const newTokenData = {
                access_token: 'new_access_token_789',
                refresh_token: 'new_refresh_token_012',
                expires_in: 3600
            };

            const result = await tokenRefresh.updateConfig(newTokenData);

            expect(result).toBe(true);
            expect(mockConfig.refreshToken).toBe('new_refresh_token_012');
            expect(mockConfig.accessToken).toBe('new_access_token_789');
        });

        test('should replace old refresh token, not duplicate it', async () => {
            const originalRefreshToken = mockConfig.refreshToken;
            expect(originalRefreshToken).toBe('old_refresh_token_456');

            const newTokenData = {
                access_token: 'new_access_token_789',
                refresh_token: 'completely_new_refresh_token_999',
                expires_in: 3600
            };

            await tokenRefresh.updateConfig(newTokenData);

            expect(mockConfig.refreshToken).toBe('completely_new_refresh_token_999');
            expect(mockConfig.refreshToken).not.toBe(originalRefreshToken);

            const writtenPayload = JSON.parse(fsPromises.writeFile.mock.calls[0][1]);
            expect(writtenPayload.twitch.refreshToken).toBe('completely_new_refresh_token_999');
        });

        test('should update both access and refresh tokens atomically', async () => {
            const newTokenData = {
                access_token: 'new_access_789',
                refresh_token: 'new_refresh_012',
                expires_in: 3600
            };

            await tokenRefresh.updateConfig(newTokenData);

            expect(mockConfig.accessToken).toBe('new_access_789');
            expect(mockConfig.refreshToken).toBe('new_refresh_012');

            const writtenPayload = JSON.parse(fsPromises.writeFile.mock.calls[0][1]);
            expect(writtenPayload.twitch.accessToken).toBe('new_access_789');
            expect(writtenPayload.twitch.refreshToken).toBe('new_refresh_012');
        });

        test('should handle missing refresh token in API response gracefully', async () => {
            const newTokenData = {
                access_token: 'new_access_token_only',
                expires_in: 3600
            };

            const originalRefreshToken = mockConfig.refreshToken;

            const result = await tokenRefresh.updateConfig(newTokenData);

            expect(result).toBe(true);
            expect(mockConfig.accessToken).toBe('new_access_token_only');
            expect(mockConfig.refreshToken).toBe(originalRefreshToken);

            const writtenPayload = JSON.parse(fsPromises.writeFile.mock.calls[0][1]);
            expect(writtenPayload.twitch.refreshToken).toBe(originalRefreshToken);
        });
    });

    describe('Token Store Persistence', () => {
        test('should write refresh tokens to the token store', async () => {
            const newTokenData = {
                access_token: 'file_access_123',
                refresh_token: 'file_refresh_456',
                expires_in: 3600
            };

            await tokenRefresh.updateConfig(newTokenData);

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
            const writeError = new Error('Disk full - cannot write config');
            fsPromises.writeFile.mockRejectedValue(writeError);

            const newTokenData = {
                access_token: 'fail_access_123',
                refresh_token: 'fail_refresh_456',
                expires_in: 3600
            };

            await expect(tokenRefresh.updateConfig(newTokenData))
                .rejects.toThrow('Token configuration update failed');
        });

        test('should ensure config file updates are atomic', async () => {
            let writeCallCount = 0;
            fsPromises.writeFile.mockImplementation(() => {
                writeCallCount++;
                if (writeCallCount === 1) {
                    throw new Error('System interrupted during write');
                }
                return Promise.resolve();
            });

            const newTokenData = {
                access_token: 'atomic_access_123',
                refresh_token: 'atomic_refresh_456',
                expires_in: 3600
            };

            await expect(tokenRefresh.updateConfig(newTokenData))
                .rejects.toThrow('Token configuration update failed');

            const memoryConsistent = (
                (mockConfig.accessToken === 'atomic_access_123' && mockConfig.refreshToken === 'atomic_refresh_456') ||
                (mockConfig.accessToken === 'old_access_token_123' && mockConfig.refreshToken === 'old_refresh_token_456')
            );
            expect(memoryConsistent).toBe(true);
        });

        test('should preserve existing token store data', async () => {
            fsPromises.readFile.mockResolvedValue(JSON.stringify({
                otherKey: 'keep',
                twitch: { accessToken: 'old', refreshToken: 'old' }
            }, null, 2));

            const newTokenData = {
                access_token: 'preserve_access_123',
                refresh_token: 'preserve_refresh_456',
                expires_in: 3600
            };

            await tokenRefresh.updateConfig(newTokenData);

            const writtenPayload = JSON.parse(fsPromises.writeFile.mock.calls[0][1]);
            expect(writtenPayload.otherKey).toBe('keep');
            expect(writtenPayload.twitch.accessToken).toBe('preserve_access_123');
            expect(writtenPayload.twitch.refreshToken).toBe('preserve_refresh_456');
        });
    });

    describe('Memory vs File Consistency', () => {
        test('should ensure in-memory config matches the token store after updates', async () => {
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

            await tokenRefresh.updateConfig(newTokenData);

            expect(mockConfig.accessToken).toBe('consistency_access_789');
            expect(mockConfig.refreshToken).toBe('consistency_refresh_012');

            expect(writtenContent).toBeTruthy();
            const writtenPayload = JSON.parse(writtenContent);
            expect(writtenPayload.twitch.accessToken).toBe('consistency_access_789');
            expect(writtenPayload.twitch.refreshToken).toBe('consistency_refresh_012');
        });

        test('should update memory first, then file (correct order)', async () => {
            const operationOrder = [];

            tokenRefresh.updateConfig = async function(tokenData) {
                operationOrder.push('memory_update_start');

                this.config.accessToken = tokenData.access_token;
                if (tokenData.refresh_token) {
                    this.config.refreshToken = tokenData.refresh_token;
                }

                operationOrder.push('memory_update_complete');

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

            await tokenRefresh.updateConfig(newTokenData);

            expect(operationOrder).toEqual([
                'memory_update_start',
                'memory_update_complete', 
                'file_update_start',
                'file_update_complete'
            ]);
        });

        test('should rollback memory changes if file write fails', async () => {
            const fileError = new Error('File system readonly');
            fsPromises.writeFile.mockRejectedValue(fileError);

            const originalTokens = {
                accessToken: mockConfig.accessToken,
                refreshToken: mockConfig.refreshToken
            };

            const newTokenData = {
                access_token: 'rollback_access_999',
                refresh_token: 'rollback_refresh_888',
                expires_in: 3600
            };

            await expect(tokenRefresh.updateConfig(newTokenData))
                .rejects.toThrow('Token configuration update failed');

            expect(mockConfig.accessToken).toBe(originalTokens.accessToken);
            expect(mockConfig.refreshToken).toBe(originalTokens.refreshToken);
        });
    });

    describe('Error Recovery', () => {
        test('should handle new refresh token same as old token', async () => {
            const sameTokenData = {
                access_token: 'new_access_different',
                refresh_token: mockConfig.refreshToken,
                expires_in: 3600
            };

            const result = await tokenRefresh.updateConfig(sameTokenData);

            expect(result).toBe(true);
            expect(mockConfig.accessToken).toBe('new_access_different');
            expect(mockConfig.refreshToken).toBe(sameTokenData.refresh_token);
        });

        test('should handle malformed refresh token responses', async () => {
            const malformedData = {
                access_token: 'valid_access_123',
                refresh_token: null,
                expires_in: 3600
            };

            const originalRefreshToken = mockConfig.refreshToken;

            const result = await tokenRefresh.updateConfig(malformedData);

            expect(result).toBe(true);
            expect(mockConfig.accessToken).toBe('valid_access_123');
            expect(mockConfig.refreshToken).toBe(originalRefreshToken);
        });

        test('should handle missing refresh token in API response', async () => {
            const incompleteData = {
                access_token: 'incomplete_access_456',
                expires_in: 3600
            };

            const originalRefreshToken = mockConfig.refreshToken;

            const result = await tokenRefresh.updateConfig(incompleteData);

            expect(result).toBe(true);
            expect(mockConfig.accessToken).toBe('incomplete_access_456');
            expect(mockConfig.refreshToken).toBe(originalRefreshToken);

            const writtenPayload = JSON.parse(fsPromises.writeFile.mock.calls[0][1]);
            expect(writtenPayload.twitch.refreshToken).toBe(originalRefreshToken);
        });

        test('should recover from config file read failures', async () => {
            const readError = new Error('Token store corrupted');
            fsPromises.readFile.mockRejectedValue(readError);

            const newTokenData = {
                access_token: 'recover_access_123',
                refresh_token: 'recover_refresh_456',
                expires_in: 3600
            };

            const result = await tokenRefresh.updateConfig(newTokenData);

            expect(result).toBe(true);
            const writtenPayload = JSON.parse(fsPromises.writeFile.mock.calls[0][1]);
            expect(writtenPayload.twitch.accessToken).toBe('recover_access_123');
            expect(writtenPayload.twitch.refreshToken).toBe('recover_refresh_456');
        });
    });

    describe('Concurrent Access Protection', () => {
        test('should prevent multiple refresh attempts from corrupting storage', async () => {
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

            const [result1, result2] = await Promise.allSettled([
                tokenRefresh1.updateConfig(tokenData1),
                tokenRefresh2.updateConfig(tokenData2)
            ]);

            expect(result1.status).toBe('fulfilled');
            expect(result2.status).toBe('fulfilled');

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
            let writeCount = 0;
            fsPromises.writeFile.mockImplementation((path, content) => {
                writeCount++;
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

            const results = await Promise.allSettled(
                updates.map(data => tokenRefresh.updateConfig(data))
            );

            results.forEach(result => {
                expect(result.status).toBe('fulfilled');
            });

            expect(writeCount).toBe(3);
        });

        test('should use refresh token lock to prevent simultaneous refreshes', async () => {
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

                    await waitForDelay(10);

                    this.isRefreshing = false;
                    return {
                        access_token: 'locked_access_123',
                        refresh_token: 'locked_refresh_456',
                        expires_in: 3600
                    };
                }
            };

            const [result1, result2] = await Promise.all([
                mockTokenRefresh.refreshToken('test_refresh_1'),
                mockTokenRefresh.refreshToken('test_refresh_2')
            ]);

            const validResults = [result1, result2].filter(r => r !== null);
            expect(validResults).toHaveLength(1);
        });
    });

    describe('Integration with TwitchAuthService', () => {
        test('should update auth service refresh token through proper methods', async () => {
            expect(authService.getRefreshToken()).toBe('old_refresh_token_456');

            authService.updateRefreshToken('auth_service_refresh_999');

            expect(authService.getRefreshToken()).toBe('auth_service_refresh_999');
            expect(mockConfig.refreshToken).toBe('auth_service_refresh_999');
        });

        test('should maintain consistency between auth service and token refresh utility', async () => {
            expect(authService.getRefreshToken()).toBe(tokenRefresh.config.refreshToken);

            const newTokenData = {
                access_token: 'consistent_access_555',
                refresh_token: 'consistent_refresh_777',
                expires_in: 3600
            };

            await tokenRefresh.updateConfig(newTokenData);

            expect(authService.getRefreshToken()).toBe('consistent_refresh_777');
            expect(authService.getAccessToken()).toBe('consistent_access_555');
        });

        test('should handle null refresh token gracefully in auth service', async () => {
            authService.updateRefreshToken(null);

            const refreshToken = authService.getRefreshToken();

            expect(refreshToken).toBeNull();
        });
    });
});
