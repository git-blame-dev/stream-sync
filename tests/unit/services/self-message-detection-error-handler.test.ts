const { describe, it, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { SelfMessageDetectionService } = require('../../../src/services/SelfMessageDetectionService.ts');

const createPlainConfig = ({ twitch, youtube, tiktok } = {}) => ({
    twitch: twitch || { ignoreSelfMessages: false },
    youtube: youtube || { ignoreSelfMessages: false },
    tiktok: tiktok || { ignoreSelfMessages: false }
});

describe('SelfMessageDetectionService error handler integration', () => {
    it('routes unknown platform warning through error handler', () => {
        const mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        const config = createPlainConfig();
        const service = new SelfMessageDetectionService(config, { logger: mockLogger });

        service.isSelfMessage('unknownPlatform', { username: 'test-user' }, {});

        expect(mockLogger.error).toHaveBeenCalled();
        const errorCall = mockLogger.error.mock.calls[0];
        expect(errorCall[0]).toContain('Unknown platform');
    });
});
