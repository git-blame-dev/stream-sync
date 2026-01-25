const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { clearAllMocks, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const fs = require('fs').promises;
const path = require('path');
const ChatFileLoggingService = require('../../../src/services/ChatFileLoggingService');

describe('ChatFileLoggingService - Behavior-Focused Regression Tests', () => {
    let service;
    let appendSpy;
    let accessSpy;
    let mkdirSpy;
    let statSpy;
    const logDir = './logs';

    beforeEach(() => {
        appendSpy = spyOn(fs, 'appendFile').mockResolvedValue();
        accessSpy = spyOn(fs, 'access').mockResolvedValue();
        mkdirSpy = spyOn(fs, 'mkdir').mockResolvedValue();
        statSpy = spyOn(fs, 'stat').mockResolvedValue({
            size: 123,
            mtime: new Date('2024-01-01T00:00:00.000Z')
        });

        service = new ChatFileLoggingService({
            logger: noOpLogger,
            config: { dataLoggingEnabled: true, dataLoggingPath: logDir }
        });
    });

    afterEach(() => {
        restoreAllMocks();
        clearAllMocks();
    });

    describe('User-Observable Platform Logging Behavior', () => {
        it('writes platform data to the default logs directory', async () => {
            const chatData = { username: 'TestUser', message: 'Hello stream!' };

            await service.logRawPlatformData('twitch', 'chat', chatData, { dataLoggingEnabled: true });
            await service.logRawPlatformData('youtube', 'chat', chatData, { dataLoggingEnabled: true });
            await service.logRawPlatformData('tiktok', 'chat', chatData, { dataLoggingEnabled: true });

            expect(appendSpy.mock.calls).toHaveLength(3);

            const [twitchCall, youtubeCall, tiktokCall] = appendSpy.mock.calls;
            expect(twitchCall[0]).toBe(path.join(logDir, 'twitch-data-log.ndjson'));
            expect(youtubeCall[0]).toBe(path.join(logDir, 'youtube-data-log.ndjson'));
            expect(tiktokCall[0]).toBe(path.join(logDir, 'tiktok-data-log.ndjson'));

            const twitchEntry = JSON.parse(twitchCall[1]);
            expect(twitchEntry).toMatchObject({
                platform: 'twitch',
                eventType: 'chat',
                payload: chatData
            });
            expect(typeof twitchEntry.ingestTimestamp).toBe('string');
            expect(twitchEntry.ingestTimestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
        });

        it('does not log when platform logging is disabled for user privacy', async () => {
            const sensitiveData = { username: 'PrivateUser', message: 'Personal info' };

            await service.logRawPlatformData('twitch', 'chat', sensitiveData, { dataLoggingEnabled: false });

            expect(appendSpy.mock.calls).toHaveLength(0);
        });

        it('handles filesystem errors gracefully without breaking chat', async () => {
            appendSpy.mockRejectedValueOnce(new Error('Disk full'));

            await expect(
                service.logRawPlatformData('twitch', 'chat', { msg: 'test' }, { dataLoggingEnabled: true })
            ).resolves.toBeUndefined();
        });
    });

    describe('Service Extraction Compatibility', () => {
        it('maintains NDJSON wrapper for raw payloads', async () => {
            const giftData = {
                giftType: 'Rose',
                giftCount: 1,
                amount: 5,
                currency: 'coins',
                username: 'Supporter123'
            };

            await service.logRawPlatformData('tiktok', 'gift', giftData, { dataLoggingEnabled: true });

            const [[, logLine]] = appendSpy.mock.calls;
            const logEntry = JSON.parse(logLine);

            expect(logEntry).toHaveProperty('ingestTimestamp');
            expect(logEntry).toHaveProperty('platform', 'tiktok');
            expect(logEntry).toHaveProperty('eventType', 'gift');
            expect(logEntry.payload).toEqual(giftData);
        });

        it('provides statistics for monitoring system health', async () => {
            const stats = await service.getLogStatistics('youtube', { dataLoggingEnabled: true });

            expect(statSpy.mock.calls).toHaveLength(1);
            expect(statSpy.mock.calls[0][0]).toBe(path.join(logDir, 'youtube-data-log.ndjson'));
            expect(stats).toMatchObject({
                size: 123,
                path: path.join(logDir, 'youtube-data-log.ndjson')
            });
        });
    });

    describe('Error Recovery User Experience', () => {
        it('creates the log directory when missing', async () => {
            accessSpy.mockRejectedValueOnce(new Error('missing'));

            await service.logRawPlatformData('twitch', 'chat', { msg: 'test' }, { dataLoggingEnabled: true });

            expect(mkdirSpy.mock.calls).toHaveLength(1);
            expect(mkdirSpy.mock.calls[0][0]).toBe(logDir);
            expect(mkdirSpy.mock.calls[0][1]).toEqual({ recursive: true });
        });
    });
});
