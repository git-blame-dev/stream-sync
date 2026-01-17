const { describe, test, expect, beforeEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { YouTubeConnectionManager } = require('../../../src/utils/youtube-connection-manager');

const createMockConnection = (videoId, isReady = false) => ({
    videoId,
    ready: isReady,
    disconnect: createMockFn(),
    status: 'connected'
});

const expectValidConnectionStatus = (status) => {
    expect(status).toBeDefined();
    expect(status).toHaveProperty('totalConnections');
    expect(status).toHaveProperty('readyConnections');
    expect(status).toHaveProperty('activeVideoIds');
    expect(typeof status.totalConnections).toBe('number');
    expect(typeof status.readyConnections).toBe('number');
    expect(Array.isArray(status.activeVideoIds)).toBe(true);
};

const expectNoTechnicalArtifacts = (content) => {
    if (typeof content === 'string') {
        expect(content).not.toMatch(/undefined/i);
        expect(content).not.toMatch(/\[object Object\]/i);
        expect(content).not.toMatch(/function\s*\(/i);
        expect(content).not.toMatch(/Promise\s*\{/i);
    }
};

describe('YouTube Premiere Connection Handling', () => {
    let connectionManager;

    beforeEach(() => {
        connectionManager = new YouTubeConnectionManager(noOpLogger);
    });

    describe('User Behavior: Premiere connection state tracking', () => {
        test('should track Premiere connections as not-ready until start event', async () => {
            const premiereVideoId = 'premiere_ghi789';
            const premiereConnection = createMockConnection(premiereVideoId, false);

            await connectionManager.connectToStream(premiereVideoId, async () => premiereConnection);

            const isReady = connectionManager.isConnectionReady(premiereVideoId);
            const hasConnection = connectionManager.hasConnection(premiereVideoId);

            expect(hasConnection).toBe(true);
            expect(isReady).toBe(false);

            const allVideoIds = connectionManager.getActiveVideoIds();
            expect(allVideoIds).toContain(premiereVideoId);
        });

        test('should demonstrate ready vs stored connection distinction for Premieres', async () => {
            const premiereVideoIds = ['premiere1', 'premiere2', 'premiere3'];

            for (const videoId of premiereVideoIds) {
                const connection = createMockConnection(videoId, false);
                await connectionManager.connectToStream(videoId, async () => connection);
            }

            connectionManager.setConnectionReady('premiere2');

            const totalConnections = connectionManager.getConnectionCount();
            const readyConnections = connectionManager.getReadyConnectionCount();

            expect(totalConnections).toBe(3);
            expect(readyConnections).toBe(1);

            const allVideoIds = connectionManager.getActiveVideoIds();
            expect(allVideoIds).toHaveLength(3);
            expect(allVideoIds).toEqual(expect.arrayContaining(premiereVideoIds));

            const readyVideoIds = allVideoIds.filter(id => connectionManager.isConnectionReady(id));
            expect(readyVideoIds).toEqual(['premiere2']);
        });
    });

    describe('User Behavior: Premiere status reporting accuracy', () => {
        test('should report accurate status for mixed Premiere states', async () => {
            const premieres = [
                { id: 'premiere_waiting1', ready: false },
                { id: 'premiere_live1', ready: true },
                { id: 'premiere_waiting2', ready: false },
                { id: 'premiere_live2', ready: true }
            ];

            for (const { id, ready } of premieres) {
                const connection = createMockConnection(id, ready);
                await connectionManager.connectToStream(id, async () => connection);
                if (ready) {
                    connectionManager.setConnectionReady(id);
                }
            }

            const state = connectionManager.getConnectionState();

            expectValidConnectionStatus(state);
            expect(state.totalConnections).toBe(4);
            expect(state.readyConnections).toBe(2);
            expect(state.activeVideoIds).toHaveLength(4);
            expect(state.hasAnyReady).toBe(true);

            const statusMessage = `Multi-stream status: ${state.readyConnections} ready, ${state.totalConnections} total connections`;
            expectNoTechnicalArtifacts(statusMessage);
            expect(statusMessage).toContain('2 ready');
            expect(statusMessage).toContain('4 total');
        });

        test('should handle Premiere connection lifecycle transitions', async () => {
            const premiereId = 'premiere_lifecycle';
            const connection = createMockConnection(premiereId, false);

            await connectionManager.connectToStream(premiereId, async () => connection);

            expect(connectionManager.hasConnection(premiereId)).toBe(true);
            expect(connectionManager.isConnectionReady(premiereId)).toBe(false);
            expect(connectionManager.getConnectionCount()).toBe(1);
            expect(connectionManager.getReadyConnectionCount()).toBe(0);

            connectionManager.setConnectionReady(premiereId);

            expect(connectionManager.isConnectionReady(premiereId)).toBe(true);
            expect(connectionManager.getConnectionCount()).toBe(1);
            expect(connectionManager.getReadyConnectionCount()).toBe(1);
        });
    });

    describe('Integration: Premiere connection workflow with real behavior', () => {
        test('should demonstrate end-to-end Premiere connection handling', async () => {
            expect(connectionManager.getConnectionCount()).toBe(0);
            expect(connectionManager.getReadyConnectionCount()).toBe(0);

            const premiereConnections = [
                { id: 'premiere_stream1', title: 'Morning Show Premiere' },
                { id: 'premiere_stream2', title: 'Evening Event Premiere' },
                { id: 'premiere_stream3', title: 'Special Announcement Premiere' }
            ];

            for (const { id, title } of premiereConnections) {
                const connection = createMockConnection(id, false);
                connection.title = title;
                await connectionManager.connectToStream(id, async () => connection);
            }

            expect(connectionManager.getConnectionCount()).toBe(3);
            expect(connectionManager.getReadyConnectionCount()).toBe(0);

            connectionManager.setConnectionReady('premiere_stream1');
            connectionManager.setConnectionReady('premiere_stream3');

            const finalState = connectionManager.getConnectionState();
            expect(finalState.totalConnections).toBe(3);
            expect(finalState.readyConnections).toBe(2);
            expect(finalState.hasAnyReady).toBe(true);

            expect(connectionManager.isConnectionReady('premiere_stream1')).toBe(true);
            expect(connectionManager.isConnectionReady('premiere_stream2')).toBe(false);
            expect(connectionManager.isConnectionReady('premiere_stream3')).toBe(true);
        });
    });

    describe('Edge Cases: Premiere connection error scenarios', () => {
        test('should handle invalid Premiere connection gracefully', async () => {
            const invalidVideoId = '';
            const invalidConnection = null;

            await connectionManager.connectToStream(invalidVideoId, async () => invalidConnection);

            expect(connectionManager.getConnectionCount()).toBe(1);
            expect(connectionManager.isConnectionReady(invalidVideoId)).toBe(false);
        });

        test('should handle Premiere connection removal during lifecycle', async () => {
            const premiereId = 'premiere_to_remove';
            const connection = createMockConnection(premiereId, false);

            await connectionManager.connectToStream(premiereId, async () => connection);
            expect(connectionManager.hasConnection(premiereId)).toBe(true);

            await connectionManager.removeConnection(premiereId);

            expect(connectionManager.hasConnection(premiereId)).toBe(false);
            expect(connectionManager.getConnectionCount()).toBe(0);
            expect(connectionManager.getReadyConnectionCount()).toBe(0);
        });
    });
});
