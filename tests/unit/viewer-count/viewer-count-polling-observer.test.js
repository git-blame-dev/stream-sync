describe('ViewerCountSystem polling observer notifications', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    function createSystemWithPlatform(counts = [5, 7], platforms = { youtube: {} }, warnSpy = null, errorSpy = null) {
        process.env.NODE_ENV = 'test';

        jest.doMock('../../../src/core/config', () => ({
            configManager: {
                getNumber: jest.fn().mockReturnValue(15)
            }
        }));

        jest.doMock('../../../src/utils/timeout-validator', () => ({
            safeSetInterval: jest.fn(),
            safeDelay: jest.fn()
        }));

        jest.doMock('../../../src/core/logging', () => ({
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn()
            }
        }));

        const platform = {
            getViewerCount: jest.fn()
                .mockResolvedValueOnce(counts[0])
                .mockResolvedValueOnce(counts[1])
        };

        const { ViewerCountSystem } = require('../../../src/utils/viewer-count');
        const system = new ViewerCountSystem({
            platforms: { ...platforms, youtube: platform }
        });
        system.logger.warn = warnSpy || jest.fn();
        system.logger.error = errorSpy || jest.fn();

        // Mark stream live so polling proceeds
        system.streamStatus.youtube = true;

        return { system, platform };
    }

    it('notifies observers on polling updates with previousCount context', async () => {
        const { system } = createSystemWithPlatform([10, 4]);

        const updates = [];
        system.addObserver({
            getObserverId: () => 'obs-poll',
            onViewerCountUpdate: jest.fn((payload) => updates.push(payload))
        });

        await system.pollPlatform('youtube'); // first poll
        await system.pollPlatform('youtube'); // second poll

        expect(updates).toHaveLength(2);
        expect(updates[0]).toEqual(expect.objectContaining({
            platform: 'youtube',
            count: 10,
            previousCount: 0,
            isStreamLive: true
        }));
        expect(updates[1]).toEqual(expect.objectContaining({
            platform: 'youtube',
            count: 4,
            previousCount: 10,
            isStreamLive: true
        }));
    });

    it('skips polling and notifications when stream is offline', async () => {
        const { system, platform } = createSystemWithPlatform();
        system.streamStatus.youtube = false;

        const updates = [];
        system.addObserver({
            getObserverId: () => 'obs-offline',
            onViewerCountUpdate: jest.fn((payload) => updates.push(payload))
        });

        await system.pollPlatform('youtube');

        expect(updates).toEqual([]);
        expect(platform.getViewerCount).not.toHaveBeenCalled();
    });

    it('warns and skips polling when platform missing', async () => {
        const warnings = [];
        const { system } = createSystemWithPlatform([1], {}, (msg) => warnings.push(msg));

        await system.pollPlatform('unknown');

        expect(warnings.some((msg) => msg.includes('No platform found'))).toBe(true);
    });

    it('warns and skips polling when platform lacks getViewerCount', async () => {
        const warnings = [];
        const { system } = createSystemWithPlatform([1], { twitch: { notAGetter: true } }, (msg) => warnings.push(msg));
        system.streamStatus.twitch = true;

        await system.pollPlatform('twitch');

        expect(warnings.some((msg) => msg.includes('No getViewerCount'))).toBe(true);
    });

    it('warns and skips when platform returns null viewer count', async () => {
        const warnings = [];
        const platform = { getViewerCount: jest.fn().mockResolvedValue(null) };
        const { system } = createSystemWithPlatform([null], { youtube: platform }, (msg) => warnings.push(msg));
        system.streamStatus.youtube = true;

        await system.pollPlatform('youtube');

        expect(warnings.some((msg) => msg.includes('returned null/undefined viewer count'))).toBe(true);
    });

    it('continues when polling throws (logged via error handler)', async () => {
        const platform = { getViewerCount: jest.fn().mockRejectedValue(new Error('boom')) };
        const { system } = createSystemWithPlatform([1], { youtube: platform });
        system.streamStatus.youtube = true;

        await expect(system.pollPlatform('youtube')).resolves.toBeUndefined();
    });
});
