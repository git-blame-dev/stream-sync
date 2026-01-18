const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');

const { YouTubeConnectionManager } = require('../../src/utils/youtube-connection-manager');

describe('YouTube Connection Manager - Missing Methods', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let connectionManager;

    beforeEach(() => {
        connectionManager = new YouTubeConnectionManager(noOpLogger);
    });
    
    describe('Required Methods', () => {
        test('should have getConnectionStatus method', async () => {
            const mockConnection = {};
            await connectionManager.connectToStream('test-video-id', async () => mockConnection);
            connectionManager.setConnectionReady('test-video-id');

            expect(typeof connectionManager.getConnectionStatus).toBe('function');

            const status = connectionManager.getConnectionStatus('test-video-id');
            expect(status).toEqual(expect.objectContaining({
                ready: true
            }));
        });
        
        test('should have getAllVideoIds method', async () => {
            await connectionManager.connectToStream('video1', async () => ({ ready: true }));
            await connectionManager.connectToStream('video2', async () => ({ ready: false }));
            
            expect(typeof connectionManager.getAllVideoIds).toBe('function');
            
            const videoIds = connectionManager.getAllVideoIds();
            expect(Array.isArray(videoIds)).toBe(true);
            expect(videoIds).toContain('video1');
            expect(videoIds).toContain('video2');
        });
        
        test('getConnectionStatus should return null for non-existent video', () => {
            const status = connectionManager.getConnectionStatus('non-existent-video');
            expect(status).toBeNull();
        });
        
        test('getAllVideoIds should return empty array when no connections', () => {
            const videoIds = connectionManager.getAllVideoIds();
            expect(videoIds).toEqual([]);
        });
    });
    
    describe('Integration with existing methods', () => {
        test('getAllVideoIds should match getActiveVideoIds', async () => {
            await connectionManager.connectToStream('video1', async () => ({ ready: true }));
            await connectionManager.connectToStream('video2', async () => ({ ready: false }));
            
            const getAllVideoIds = connectionManager.getAllVideoIds();
            const getActiveVideoIds = connectionManager.getActiveVideoIds();
            
            expect(getAllVideoIds).toEqual(getActiveVideoIds);
        });
        
        test('getConnectionStatus should provide same info as other methods', async () => {
            const mockConnection = { someProperty: 'test' };
            await connectionManager.connectToStream('test-video', async () => mockConnection);
            connectionManager.setConnectionReady('test-video');

            const status = connectionManager.getConnectionStatus('test-video');
            const isReady = connectionManager.isConnectionReady('test-video');

            expect(status.ready).toBe(isReady);
            expect(status.ready).toBe(true);
            expect(isReady).toBe(true);
        });
    });
});
