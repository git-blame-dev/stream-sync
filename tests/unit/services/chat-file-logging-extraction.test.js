const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');

const fs = require('fs').promises;
const path = require('path');
const ChatFileLoggingService = require('../../../src/services/ChatFileLoggingService');

describe('ChatFileLoggingService - Behavior-Focused Regression Tests', () => {
    let service;
    let mockLogger;
    let testConfig;
    let tempLogDir;

    beforeEach(async () => {
        mockLogger = {
            debug: createMockFn(),
            error: createMockFn()
        };

        // Create temporary directory for test logs
        tempLogDir = path.join(process.cwd(), 'logs', 'test-platform-data');
        testConfig = {
            dataLoggingEnabled: true,
            dataLoggingPath: tempLogDir
        };

        // Initialize service with test dependencies
        service = new ChatFileLoggingService({
            logger: mockLogger,
            config: testConfig
        });

        // Ensure test directory exists
        await fs.mkdir(tempLogDir, { recursive: true });
    });

    afterEach(async () => {
        // Clean up test files recursively
        try {
            await fs.rm(tempLogDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
        restoreAllMocks();
        clearAllMocks();
    });

    describe('User-Observable Platform Logging Behavior', () => {
        it('should create platform-specific log files for streamers to debug', async () => {
            const chatData = { username: 'TestUser', message: 'Hello stream!' };

            // When: Streamer receives chat from different platforms
            await service.logRawPlatformData('twitch', 'chat', chatData, testConfig);
            await service.logRawPlatformData('youtube', 'chat', chatData, testConfig);
            await service.logRawPlatformData('tiktok', 'chat', chatData, testConfig);

            // Then: Platform-specific files are created for debugging
            const twitchFile = await fs.readFile(path.join(tempLogDir, 'twitch-data-log.txt'), 'utf8');
            const youtubeFile = await fs.readFile(path.join(tempLogDir, 'youtube-data-log.txt'), 'utf8');
            const tiktokFile = await fs.readFile(path.join(tempLogDir, 'tiktok-data-log.txt'), 'utf8');

            // Streamer can see relevant data in each platform file
            expect(twitchFile).toContain('TestUser');
            expect(youtubeFile).toContain('TestUser'); 
            expect(tiktokFile).toContain('TestUser');

            // Files contain structured data for debugging
            expect(twitchFile).toContain('chat');
            expect(youtubeFile).toContain('chat');
            expect(tiktokFile).toContain('chat');
        });

        it('should not log when platform logging is disabled for user privacy', async () => {
            const disabledConfig = { dataLoggingEnabled: false };
            const sensitiveData = { username: 'PrivateUser', message: 'Personal info' };

            // When: User has disabled logging
            await service.logRawPlatformData('twitch', 'chat', sensitiveData, disabledConfig);

            // Then: No files are created to protect privacy
            const files = await fs.readdir(tempLogDir).catch(() => []);
            const logFiles = files.filter(f => f.includes('twitch-data-log'));
            expect(logFiles).toHaveLength(0);
        });

        it('should handle filesystem errors gracefully without breaking chat', async () => {
            const readOnlyConfig = {
                dataLoggingEnabled: true,
                dataLoggingPath: tempLogDir
            };
            const appendSpy = spyOn(fs, 'appendFile').mockRejectedValue(new Error('Disk full'));

            // When: Filesystem error occurs during logging
            // This should not throw an error (graceful degradation)
            await expect(
                service.logRawPlatformData('twitch', 'chat', { msg: 'test' }, readOnlyConfig)
            ).resolves.toBeUndefined();

            // Then: Error is logged for admin awareness but doesn't crash
            expect(mockLogger.error).toHaveBeenCalled();
            const errorMessage = mockLogger.error.mock.calls[0][0];
            expect(errorMessage).toContain('Error logging platform data for twitch');
            appendSpy.mockRestore();
        });

        it('should report missing log path when logging is enabled', async () => {
            const missingPathConfig = { dataLoggingEnabled: true };

            await service.logRawPlatformData('twitch', 'chat', { msg: 'test' }, missingPathConfig);

            const [message, context] = mockLogger.error.mock.calls[0] || [];
            expect(message).toContain('dataLoggingPath not configured for twitch');
            expect(context).toBe('chat-file-logging-platform');

            const files = await fs.readdir(tempLogDir).catch(() => []);
            expect(files).toHaveLength(0);
        });

        it('should log unknown events for streamer troubleshooting', async () => {
            const unknownEventData = {
                type: 'mystery_event',
                payload: { unusual: 'data' }
            };

            // When: Platform receives unknown event type
            await service.logUnknownEvent('youtube', 'mystery_event', unknownEventData, testConfig);

            // Then: Unknown events file is created for debugging
            const unknownFile = await fs.readFile(path.join(tempLogDir, 'youtube-unknown-events.txt'), 'utf8');
            expect(unknownFile).toContain('mystery_event');
            expect(unknownFile).toContain('unusual');

            // Contains metadata for troubleshooting
            const logEntry = JSON.parse(unknownFile);
            expect(logEntry.metadata.platform).toBe('youtube');
            expect(logEntry.metadata.logged).toBe('unknown_event');
        });
    });

    describe('Service Extraction Compatibility', () => {
        it('should maintain JSON format for consistent parsing by admins', async () => {
            const giftData = {
                giftType: 'Rose',
                giftCount: 1,
                amount: 5,
                currency: 'coins',
                username: 'Supporter123'
            };

            // When: Gift event is logged
            await service.logRawPlatformData('tiktok', 'gift', giftData, testConfig);

            // Then: Log maintains JSON format for easy parsing
            const logContent = await fs.readFile(path.join(tempLogDir, 'tiktok-data-log.txt'), 'utf8');
            const logEntry = JSON.parse(logContent);

            expect(logEntry).toHaveProperty('timestamp');
            expect(logEntry).toHaveProperty('eventType', 'gift');
            expect(logEntry.data).toEqual(giftData);
        });

        it('should provide statistics for monitoring system health', async () => {
            await service.logRawPlatformData('youtube', 'chat', { test: 'data' }, testConfig);

            // When: Admin checks log statistics
            const stats = await service.getLogStatistics('youtube', testConfig);

            // Then: Useful statistics are provided
            expect(stats).toHaveProperty('size');
            expect(stats).toHaveProperty('lastModified');
            expect(stats).toHaveProperty('path');
            expect(stats.size).toBeGreaterThan(0);
        });
    });

    describe('Error Recovery User Experience', () => {
        it('should provide helpful error information when log files missing', async () => {
            // When: Admin checks statistics for non-existent platform
            const stats = await service.getLogStatistics('nonexistent', testConfig);

            // Then: Clear error information is provided
            expect(stats).toHaveProperty('error');
            expect(stats).toHaveProperty('exists', false);
        });

        it('should ensure directory creation for new installations', async () => {
            const newDirConfig = {
                dataLoggingEnabled: true,
                dataLoggingPath: path.join(tempLogDir, 'new', 'nested', 'dir')
            };

            // When: Service logs to non-existent directory
            await service.logRawPlatformData('twitch', 'chat', { msg: 'test' }, newDirConfig);

            // Then: Directory structure is created automatically
            const dirExists = await fs.access(newDirConfig.dataLoggingPath)
                .then(() => true)
                .catch(() => false);
            expect(dirExists).toBe(true);

            // And log file is created successfully
            const logFile = path.join(newDirConfig.dataLoggingPath, 'twitch-data-log.txt');
            const fileExists = await fs.access(logFile)
                .then(() => true)
                .catch(() => false);
            expect(fileExists).toBe(true);
        });
    });
});
