const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const fs = require('fs').promises;
const path = require('path');
const ChatFileLoggingService = require('../../../src/services/ChatFileLoggingService');

describe('ChatFileLoggingService - Behavior-Focused Regression Tests', () => {
    let service;
    let testConfig;
    let tempLogDir;

    beforeEach(async () => {
        tempLogDir = path.join(process.cwd(), 'logs', 'test-platform-data');
        testConfig = {
            dataLoggingEnabled: true,
            dataLoggingPath: tempLogDir
        };

        service = new ChatFileLoggingService({
            logger: noOpLogger,
            config: testConfig
        });

        await fs.mkdir(tempLogDir, { recursive: true });
    });

    afterEach(async () => {
        try {
            await fs.rm(tempLogDir, { recursive: true, force: true });
        } catch {
        }
        restoreAllMocks();
        clearAllMocks();
    });

    describe('User-Observable Platform Logging Behavior', () => {
        it('should create platform-specific log files for streamers to debug', async () => {
            const chatData = { username: 'TestUser', message: 'Hello stream!' };

            await service.logRawPlatformData('twitch', 'chat', chatData, testConfig);
            await service.logRawPlatformData('youtube', 'chat', chatData, testConfig);
            await service.logRawPlatformData('tiktok', 'chat', chatData, testConfig);

            const twitchFile = await fs.readFile(path.join(tempLogDir, 'twitch-data-log.txt'), 'utf8');
            const youtubeFile = await fs.readFile(path.join(tempLogDir, 'youtube-data-log.txt'), 'utf8');
            const tiktokFile = await fs.readFile(path.join(tempLogDir, 'tiktok-data-log.txt'), 'utf8');

            expect(twitchFile).toContain('TestUser');
            expect(youtubeFile).toContain('TestUser');
            expect(tiktokFile).toContain('TestUser');
            expect(twitchFile).toContain('chat');
            expect(youtubeFile).toContain('chat');
            expect(tiktokFile).toContain('chat');
        });

        it('should not log when platform logging is disabled for user privacy', async () => {
            const disabledConfig = { dataLoggingEnabled: false };
            const sensitiveData = { username: 'PrivateUser', message: 'Personal info' };

            await service.logRawPlatformData('twitch', 'chat', sensitiveData, disabledConfig);

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

            await expect(
                service.logRawPlatformData('twitch', 'chat', { msg: 'test' }, readOnlyConfig)
            ).resolves.toBeUndefined();

            appendSpy.mockRestore();
        });

        it('should not create files when log path is missing', async () => {
            const missingPathConfig = { dataLoggingEnabled: true };

            await service.logRawPlatformData('twitch', 'chat', { msg: 'test' }, missingPathConfig);

            const files = await fs.readdir(tempLogDir).catch(() => []);
            expect(files).toHaveLength(0);
        });

        it('should log unknown events for streamer troubleshooting', async () => {
            const unknownEventData = {
                type: 'mystery_event',
                payload: { unusual: 'data' }
            };

            await service.logUnknownEvent('youtube', 'mystery_event', unknownEventData, testConfig);

            const unknownFile = await fs.readFile(path.join(tempLogDir, 'youtube-unknown-events.txt'), 'utf8');
            expect(unknownFile).toContain('mystery_event');
            expect(unknownFile).toContain('unusual');

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

            await service.logRawPlatformData('tiktok', 'gift', giftData, testConfig);

            const logContent = await fs.readFile(path.join(tempLogDir, 'tiktok-data-log.txt'), 'utf8');
            const logEntry = JSON.parse(logContent);

            expect(logEntry).toHaveProperty('timestamp');
            expect(logEntry).toHaveProperty('eventType', 'gift');
            expect(logEntry.data).toEqual(giftData);
        });

        it('should provide statistics for monitoring system health', async () => {
            await service.logRawPlatformData('youtube', 'chat', { test: 'data' }, testConfig);

            const stats = await service.getLogStatistics('youtube', testConfig);

            expect(stats).toHaveProperty('size');
            expect(stats).toHaveProperty('lastModified');
            expect(stats).toHaveProperty('path');
            expect(stats.size).toBeGreaterThan(0);
        });
    });

    describe('Error Recovery User Experience', () => {
        it('should provide helpful error information when log files missing', async () => {
            const stats = await service.getLogStatistics('nonexistent', testConfig);

            expect(stats).toHaveProperty('error');
            expect(stats).toHaveProperty('exists', false);
        });

        it('should ensure directory creation for new installations', async () => {
            const newDirConfig = {
                dataLoggingEnabled: true,
                dataLoggingPath: path.join(tempLogDir, 'new', 'nested', 'dir')
            };

            await service.logRawPlatformData('twitch', 'chat', { msg: 'test' }, newDirConfig);

            const dirExists = await fs.access(newDirConfig.dataLoggingPath)
                .then(() => true)
                .catch(() => false);
            expect(dirExists).toBe(true);

            const logFile = path.join(newDirConfig.dataLoggingPath, 'twitch-data-log.txt');
            const fileExists = await fs.access(logFile)
                .then(() => true)
                .catch(() => false);
            expect(fileExists).toBe(true);
        });
    });
});
