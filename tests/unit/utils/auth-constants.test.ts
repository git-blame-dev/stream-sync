import { describe, expect, it } from 'bun:test';

import {
    AuthConstants,
    OAUTH_SERVER_CONFIG,
    TOKEN_REFRESH_CONFIG
} from '../../../src/utils/auth-constants.ts';

describe('AuthConstants', () => {
    describe('getStreamingOptimizedTimeout', () => {
        it('returns operation-specific timeouts for immediate stream-critical work', () => {
            expect(AuthConstants.getStreamingOptimizedTimeout('immediate', 'tokenValidation')).toBe(2000);
            expect(AuthConstants.getStreamingOptimizedTimeout('immediate', 'tokenRefresh')).toBe(3000);
            expect(AuthConstants.getStreamingOptimizedTimeout('immediate', 'oauthValidation')).toBe(2000);
            expect(AuthConstants.getStreamingOptimizedTimeout('immediate', 'proactiveRefresh')).toBe(1500);
        });

        it('returns operation-specific timeouts for high-priority active stream work', () => {
            expect(AuthConstants.getStreamingOptimizedTimeout('high', 'tokenValidation')).toBe(3000);
            expect(AuthConstants.getStreamingOptimizedTimeout('high', 'tokenRefresh')).toBe(4000);
            expect(AuthConstants.getStreamingOptimizedTimeout('high', 'oauthValidation')).toBe(3000);
            expect(AuthConstants.getStreamingOptimizedTimeout('high', 'proactiveRefresh')).toBe(2500);
        });

        it('returns operation-specific timeouts for normal active stream work', () => {
            expect(AuthConstants.getStreamingOptimizedTimeout('normal', 'tokenValidation')).toBe(3000);
            expect(AuthConstants.getStreamingOptimizedTimeout('normal', 'tokenRefresh')).toBe(5000);
            expect(AuthConstants.getStreamingOptimizedTimeout('normal', 'oauthValidation')).toBe(3000);
            expect(AuthConstants.getStreamingOptimizedTimeout('normal', 'proactiveRefresh')).toBe(3000);
        });

        it('returns operation-specific timeouts for low-priority inactive stream work', () => {
            expect(AuthConstants.getStreamingOptimizedTimeout('low', 'tokenValidation')).toBe(5000);
            expect(AuthConstants.getStreamingOptimizedTimeout('low', 'tokenRefresh')).toBe(8000);
            expect(AuthConstants.getStreamingOptimizedTimeout('low', 'oauthValidation')).toBe(5000);
            expect(AuthConstants.getStreamingOptimizedTimeout('low', 'proactiveRefresh')).toBe(5000);
        });

        it('falls back to token validation timeout for unknown operation types', () => {
            expect(AuthConstants.getStreamingOptimizedTimeout('immediate', 'webhookHandshake')).toBe(2000);
            expect(AuthConstants.getStreamingOptimizedTimeout('low', 'webhookHandshake')).toBe(5000);
        });

        it('uses normal token validation behavior for omitted or unknown criticality', () => {
            expect(AuthConstants.getStreamingOptimizedTimeout()).toBe(3000);
            expect(AuthConstants.getStreamingOptimizedTimeout('urgent', 'tokenRefresh')).toBe(5000);
        });

        it('accepts criticality names regardless of casing', () => {
            expect(AuthConstants.getStreamingOptimizedTimeout('IMMEDIATE', 'proactiveRefresh')).toBe(1500);
            expect(AuthConstants.getStreamingOptimizedTimeout('High', 'tokenRefresh')).toBe(4000);
        });
    });

    describe('determineOperationCriticality', () => {
        it('prioritizes user-initiated auth work immediately', () => {
            expect(AuthConstants.determineOperationCriticality({
                userInitiated: true,
                streamingActive: true,
                viewerCount: 1
            })).toBe('immediate');
        });

        it('prioritizes user-waiting auth work immediately', () => {
            expect(AuthConstants.determineOperationCriticality({
                streamingActive: false,
                userWaiting: true
            })).toBe('immediate');
        });

        it('treats active streams above 100 viewers as high criticality', () => {
            expect(AuthConstants.determineOperationCriticality({
                streamingActive: true,
                viewerCount: 101
            })).toBe('high');
        });

        it('keeps active streams at or below 100 viewers at normal criticality', () => {
            expect(AuthConstants.determineOperationCriticality({
                streamingActive: true,
                viewerCount: 100
            })).toBe('normal');
            expect(AuthConstants.determineOperationCriticality({
                streamingActive: true,
                viewerCount: 0
            })).toBe('normal');
        });

        it('uses low criticality for inactive stream work by default', () => {
            expect(AuthConstants.determineOperationCriticality()).toBe('low');
            expect(AuthConstants.determineOperationCriticality({
                streamingActive: false,
                viewerCount: 500
            })).toBe('low');
        });
    });
});

describe('auth constants', () => {
    it('exports OAuth timeout and local server defaults used by auth flows', () => {
        expect(TOKEN_REFRESH_CONFIG.OAUTH_TIMEOUT_MS).toBe(10 * 60 * 1000);

        expect(OAUTH_SERVER_CONFIG.DEFAULT_PORT).toBe(3000);
        expect(OAUTH_SERVER_CONFIG.PORT_RANGE).toEqual({
            START: 3000,
            END: 3100
        });
        expect(OAUTH_SERVER_CONFIG.SSL_OPTIONS).toEqual({
            DAYS: 365,
            KEY_SIZE: 2048,
            ALGORITHM: 'sha256'
        });
    });
});
