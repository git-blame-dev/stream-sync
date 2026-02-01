
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { TEST_TIMEOUTS } = require('../../helpers/test-setup');
const { noOpLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const testClock = require('../../helpers/test-clock');
const { createSourcesConfigFixture } = require('../../helpers/config-fixture');
const { createOBSSourcesManager } = require('../../../src/obs/sources');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('OBS Sources Module Characterization Tests', () => {
    let mockObsManager;
    let mockEnsureConnected;
    let mockObsCall;
    let mockSanitizeDisplayName;
    let sourcesModule;

    beforeEach(() => {
        mockEnsureConnected = createMockFn().mockResolvedValue();
        mockObsCall = createMockFn();
        mockSanitizeDisplayName = createMockFn((name, limit) => name.substring(0, limit));

        mockObsManager = {
            ensureConnected: mockEnsureConnected,
            call: mockObsCall,
            isConnected: createMockFn().mockReturnValue(true),
            isReady: createMockFn().mockResolvedValue(true),
            addEventListener: createMockFn(),
            removeEventListener: createMockFn()
        };

        sourcesModule = createOBSSourcesManager(mockObsManager, {
            logger: noOpLogger,
            ...createSourcesConfigFixture(),
            ensureOBSConnected: mockEnsureConnected,
            obsCall: mockObsCall,
            utils: {
                sanitizeDisplayName: mockSanitizeDisplayName
            }
        });
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('Text Source Management', () => {
        test('updateTextSource should call OBS via safeOBSOperation', async () => {
            mockObsCall.mockResolvedValueOnce({ inputSettings: {} });
            mockObsCall.mockResolvedValueOnce();

            await sourcesModule.updateTextSource('test-source', 'new message');

            expect(mockEnsureConnected).toHaveBeenCalled();
            expect(mockObsCall).toHaveBeenCalledWith('GetInputSettings', { inputName: 'test-source' });
            expect(mockObsCall).toHaveBeenCalledWith('SetInputSettings', {
                inputName: 'test-source',
                inputSettings: { text: 'new message' },
                overlay: false
            });
        }, TEST_TIMEOUTS.FAST);

        test('clearTextSource should call OBS with proper safe operations', async () => {
            const mockInputSettings = { text: 'existing text', font: 'Arial' };

            expect(mockObsManager).toBeDefined();
            expect(typeof mockObsManager.isReady).toBe('function');

            const isReady = await mockObsManager.isReady();
            expect(isReady).toBe(true);

            mockObsCall.mockResolvedValueOnce({ inputSettings: mockInputSettings });
            mockObsCall.mockResolvedValueOnce();

            await sourcesModule.clearTextSource('test-source');

            expect(mockEnsureConnected).toHaveBeenCalledTimes(1);
            expect(mockObsCall).toHaveBeenCalledWith('GetInputSettings', { inputName: 'test-source' });
            expect(mockObsCall).toHaveBeenCalledWith('SetInputSettings', {
                inputName: 'test-source',
                inputSettings: {
                    ...mockInputSettings,
                    text: ''
                },
                overlay: false
            });
        }, TEST_TIMEOUTS.FAST);

        test('updateChatMsgText should format username and delegate to updateTextSource', async () => {
            mockSanitizeDisplayName.mockReturnValue('User');
            mockObsCall.mockResolvedValueOnce({ inputSettings: {} });
            mockObsCall.mockResolvedValueOnce();

            await sourcesModule.updateChatMsgText('chat-source', 'VeryLongUsername', 'Hello world');

            expect(mockSanitizeDisplayName).toHaveBeenCalledWith('VeryLongUsername', 15);
            expect(mockObsCall).toHaveBeenCalledWith('SetInputSettings', {
                inputName: 'chat-source',
                inputSettings: { text: 'User: Hello world' },
                overlay: false
            });
        }, TEST_TIMEOUTS.FAST);

        test('text source operations should handle errors when OBS operations run', async () => {
            const testError = new Error('OBS connection failed');
            mockObsCall.mockRejectedValue(testError);

            await expect(sourcesModule.clearTextSource('test-source')).rejects.toThrow('OBS connection failed');
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Source Visibility Management', () => {
        test('getSceneItemId should return scene item information with correct format', async () => {
            mockObsCall.mockResolvedValue({ sceneItemId: 42 });

            const result = await sourcesModule.getSceneItemId('test-scene', 'test-source');

            expect(mockEnsureConnected).toHaveBeenCalledTimes(1);
            expect(mockObsCall).toHaveBeenCalledWith('GetSceneItemId', {
                sceneName: 'test-scene',
                sourceName: 'test-source'
            });

            expect(result).toEqual({
                sceneItemId: 42,
                sceneName: 'test-scene'
            });
            expect(typeof result.sceneItemId).toBe('number');
            expect(typeof result.sceneName).toBe('string');
        }, TEST_TIMEOUTS.FAST);

        test('setSourceVisibility should call OBS via safeOBSOperation', async () => {
            mockObsCall.mockResolvedValueOnce({ sceneItemId: 42 });
            mockObsCall.mockResolvedValueOnce();

            await sourcesModule.setSourceVisibility('test-scene', 'test-source', true);

            expect(mockEnsureConnected).toHaveBeenCalled();
            expect(mockObsCall).toHaveBeenCalledWith('GetSceneItemId', {
                sceneName: 'test-scene',
                sourceName: 'test-source'
            });
            expect(mockObsCall).toHaveBeenCalledWith('SetSceneItemEnabled', {
                sceneName: 'test-scene',
                sceneItemId: 42,
                sceneItemEnabled: true
            });
        }, TEST_TIMEOUTS.FAST);

        test('getSceneItemId should throw error for invalid scene item ID', async () => {
            mockObsCall.mockResolvedValue({ sceneItemId: null });

            await expect(sourcesModule.getSceneItemId('test-scene', 'invalid-source')).rejects.toThrow(
                'Scene item ID for source "invalid-source" in scene "test-scene" not found.'
            );
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Group Source Management', () => {
        test('getGroupSceneItemId should find source within group (no test environment check)', async () => {
            const mockSceneItems = [
                { sourceName: 'other-source', sceneItemId: 10 },
                { sourceName: 'target-source', sceneItemId: 20 },
            ];
            mockObsCall.mockResolvedValue({ sceneItems: mockSceneItems });

            const result = await sourcesModule.getGroupSceneItemId('target-source', 'test-group');

            expect(mockEnsureConnected).toHaveBeenCalledTimes(1);
            expect(mockObsCall).toHaveBeenCalledWith('GetGroupSceneItemList', { sceneName: 'test-group' });
            expect(result).toEqual({ sceneItemId: 20 });
        }, TEST_TIMEOUTS.FAST);

        test('setGroupSourceVisibility should call OBS via safeOBSOperation', async () => {
            mockObsCall.mockResolvedValueOnce({ sceneItems: [{ sourceName: 'test-source', sceneItemId: 20 }] });
            mockObsCall.mockResolvedValueOnce();

            await sourcesModule.setGroupSourceVisibility('test-source', 'test-group', false);

            expect(mockEnsureConnected).toHaveBeenCalled();
            expect(mockObsCall).toHaveBeenCalledWith('GetGroupSceneItemList', { sceneName: 'test-group' });
            expect(mockObsCall).toHaveBeenCalledWith('SetSceneItemEnabled', {
                sceneName: 'test-group',
                sceneItemId: 20,
                sceneItemEnabled: false
            });
        }, TEST_TIMEOUTS.FAST);

        test('getGroupSceneItemId should handle missing source in group', async () => {
            const mockSceneItems = [
                { sourceName: 'other-source', sceneItemId: 10 }
            ];
            mockObsCall.mockResolvedValue({ sceneItems: mockSceneItems });

            await expect(sourcesModule.getGroupSceneItemId('missing-source', 'test-group')).rejects.toThrow(
                'Source \'missing-source\' not found inside group \'test-group\''
            );
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Platform Logo Management', () => {
        test('setPlatformLogoVisibility should call OBS for each platform logo', async () => {
            const mockPlatformLogos = {
                tiktok: 'tiktok-logo-source',
                twitch: 'twitch-logo-source',
                youtube: 'youtube-logo-source'
            };

            mockObsCall.mockResolvedValue({ sceneItems: [
                { sourceName: 'tiktok-logo-source', sceneItemId: 1 },
                { sourceName: 'twitch-logo-source', sceneItemId: 2 },
                { sourceName: 'youtube-logo-source', sceneItemId: 3 }
            ] });

            await sourcesModule.setPlatformLogoVisibility('tiktok', mockPlatformLogos);

            expect(mockObsCall).toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('hideAllPlatformLogos should call OBS for each platform logo', async () => {
            const mockPlatformLogos = {
                tiktok: 'tiktok-logo-source',
                twitch: 'twitch-logo-source',
                youtube: 'youtube-logo-source'
            };

            mockObsCall.mockResolvedValue({ sceneItems: [
                { sourceName: 'tiktok-logo-source', sceneItemId: 1 },
                { sourceName: 'twitch-logo-source', sceneItemId: 2 },
                { sourceName: 'youtube-logo-source', sceneItemId: 3 }
            ] });

            await sourcesModule.hideAllPlatformLogos(mockPlatformLogos);

            expect(mockObsCall).toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Display Control', () => {
        test('setChatDisplayVisibility should call OBS via safeOBSOperation', async () => {
            mockObsCall.mockResolvedValue({ sceneItemId: 42 });

            await sourcesModule.setChatDisplayVisibility(true, 'test-scene', {});

            expect(mockObsCall).toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('setNotificationDisplayVisibility should call OBS via safeOBSOperation', async () => {
            mockObsCall.mockResolvedValue({ sceneItemId: 42 });

            await sourcesModule.setNotificationDisplayVisibility(true, 'test-scene', {});

            expect(mockObsCall).toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('hideAllDisplays should call OBS for display operations', async () => {
            mockObsCall.mockResolvedValue({ sceneItemId: 42, inputSettings: {} });

            await sourcesModule.hideAllDisplays('chat-scene', 'notif-scene', {}, {}, 'tts', 'notif');

            expect(mockObsCall).toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Source Filter Management', () => {
        test('setSourceFilterEnabled should call OBS', async () => {
            mockObsCall.mockResolvedValue();

            await sourcesModule.setSourceFilterEnabled('test-source', 'test-filter', true);

            expect(mockEnsureConnected).toHaveBeenCalled();
            expect(mockObsCall).toHaveBeenCalledWith('SetSourceFilterEnabled', {
                sourceName: 'test-source',
                filterName: 'test-filter',
                filterEnabled: true
            });
        }, TEST_TIMEOUTS.FAST);

        test('getSourceFilterSettings should call OBS (no test environment check)', async () => {
            const mockSettings = { enabled: true, settings: { key: 'value' } };
            const mockFilterInfo = { filterSettings: mockSettings };
            mockObsCall.mockResolvedValue(mockFilterInfo);

            const result = await sourcesModule.getSourceFilterSettings('test-source', 'test-filter');

            expect(mockEnsureConnected).toHaveBeenCalledTimes(1);
            expect(mockObsCall).toHaveBeenCalledWith('GetSourceFilter', {
                sourceName: 'test-source',
                filterName: 'test-filter'
            });
            expect(result).toEqual(mockSettings);
        }, TEST_TIMEOUTS.FAST);

        test('setSourceFilterSettings should call OBS', async () => {
            mockObsCall.mockResolvedValue();

            await sourcesModule.setSourceFilterSettings('test-source', 'test-filter', { key: 'value' });

            expect(mockEnsureConnected).toHaveBeenCalled();
            expect(mockObsCall).toHaveBeenCalledWith('SetSourceFilterSettings', {
                sourceName: 'test-source',
                filterName: 'test-filter',
                filterSettings: { key: 'value' }
            });
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Error Handling', () => {
        test('should handle OBS connection failures gracefully', async () => {
            const connectionError = new Error('OBS connection failed');
            mockEnsureConnected.mockRejectedValue(connectionError);

            await expect(sourcesModule.clearTextSource('test-source')).rejects.toThrow('OBS connection failed');
        }, TEST_TIMEOUTS.FAST);

        test('should handle invalid source names gracefully', async () => {
            mockEnsureConnected.mockResolvedValue();
            mockObsCall.mockResolvedValue({ sceneItemId: null });

            await expect(sourcesModule.getSceneItemId('test-scene', '')).rejects.toThrow(
                'Scene item ID for source "" in scene "test-scene" not found.'
            );
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Performance Tests', () => {
        test('should handle rapid source operations efficiently', async () => {
            mockObsCall.mockResolvedValue({ inputSettings: {} });
            const startTime = testClock.now();

            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(sourcesModule.updateTextSource(`source-${i}`, `message-${i}`));
            }

            await Promise.all(promises);
            testClock.advance(promises.length);
            const duration = testClock.now() - startTime;

            expect(duration).toBeLessThan(100);
            expect(mockObsCall).toHaveBeenCalledTimes(20);
        }, TEST_TIMEOUTS.FAST);
    });
}); 
