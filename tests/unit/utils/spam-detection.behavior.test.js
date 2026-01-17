const { describe, test, expect, afterEach, it } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { useFakeTimers, useRealTimers, advanceTimersByTime } = require('../../helpers/bun-timers');

const {
    createSpamDetectionConfig,
    createDonationSpamDetection
} = require('../../../src/utils/spam-detection');

describe('SpamDetection behavior', () => {
    let detection;

    afterEach(() => {
        restoreAllMocks();
        if (detection) {
            detection.destroy();
            detection = null;
        }
        useRealTimers();
    });

    it('gracefully allows when platform spam detection disabled', () => {
        const config = createSpamDetectionConfig({
            spamDetectionEnabled: false,
            platforms: { tiktok: { spamDetectionEnabled: false } }
        });
        detection = createDonationSpamDetection(config, { logger: noOpLogger, autoCleanup: false });

        const result = detection.handleDonationSpam('u', 'User', 1, 'Rose', 1, 'tiktok');
        expect(result.shouldShow).toBe(true);
    });

    it('uses safe defaults for malformed config', () => {
        const config = createSpamDetectionConfig({
            spamDetectionEnabled: 'not-bool',
            lowValueThreshold: 'abc',
            spamDetectionWindow: -5,
            maxIndividualNotifications: 'bad',
            platforms: { tiktok: { spamDetectionEnabled: 'nope' } }
        });

        expect(config.spamDetectionEnabled).toBe(true);
        expect(config.lowValueThreshold).toBeGreaterThan(0);
        expect(config.getPlatformConfig('tiktok').enabled).toBe(true);
    });

    it('suppresses notifications after threshold and resets after window', () => {
        useFakeTimers();
        const config = createSpamDetectionConfig({
            spamDetectionEnabled: true,
            spamDetectionWindow: 0.2,
            maxIndividualNotifications: 1,
            lowValueThreshold: 10
        });
        detection = createDonationSpamDetection(config, { logger: noOpLogger, autoCleanup: false });

        expect(detection.handleDonationSpam('u', 'User', 1, 'Rose', 1, 'tiktok').shouldShow).toBe(true);
        expect(detection.handleDonationSpam('u', 'User', 1, 'Rose', 1, 'tiktok').shouldShow).toBe(false);

        advanceTimersByTime(250);
        expect(detection.handleDonationSpam('u', 'User', 1, 'Rose', 1, 'tiktok').shouldShow).toBe(true);
    });

    it('treats high-value donations as non-spam', () => {
        const config = createSpamDetectionConfig({
            spamDetectionEnabled: true,
            lowValueThreshold: 5,
            maxIndividualNotifications: 1
        });
        detection = createDonationSpamDetection(config, { logger: noOpLogger, autoCleanup: false });

        const result = detection.handleDonationSpam('u', 'User', 20, 'Lion', 1, 'tiktok');
        expect(result.shouldShow).toBe(true);
    });

    it('uses platform overrides and skips disabled platforms', () => {
        const config = createSpamDetectionConfig({
            spamDetectionEnabled: true,
            maxIndividualNotifications: 1,
            platforms: { youtube: { spamDetectionEnabled: false }, tiktok: { maxIndividualNotifications: 1 } }
        });
        detection = createDonationSpamDetection(config, { logger: noOpLogger, autoCleanup: false });

        const ytResult = detection.handleDonationSpam('yt', 'YTUser', 1, 'Rose', 1, 'youtube');
        const tkFirst = detection.handleDonationSpam('tk', 'TKUser', 1, 'Rose', 1, 'tiktok');
        const tkSecond = detection.handleDonationSpam('tk', 'TKUser', 1, 'Rose', 1, 'tiktok');

        expect(ytResult.shouldShow).toBe(true);
        expect(tkFirst.shouldShow).toBe(true);
        expect(tkSecond.shouldShow).toBe(false);
    });

    it('parses string thresholds and windows into numeric config', () => {
        const config = createSpamDetectionConfig({
            spamDetectionEnabled: 'true',
            lowValueThreshold: '15',
            spamDetectionWindow: '6',
            maxIndividualNotifications: '3'
        });

        expect(config.lowValueThreshold).toBe(15);
        expect(config.spamDetectionWindow).toBe(6);
        expect(config.maxIndividualNotifications).toBe(3);
    });

    it('falls back to global config for unknown platform lookups', () => {
        const config = createSpamDetectionConfig({
            spamDetectionEnabled: true,
            lowValueThreshold: 5,
            spamDetectionWindow: 2,
            maxIndividualNotifications: 1
        });

        const fallback = config.getPlatformConfig('unknown');

        expect(fallback.enabled).toBe(true);
        expect(fallback.lowValueThreshold).toBe(5);
        expect(fallback.spamDetectionWindow).toBe(2);
        expect(fallback.maxIndividualNotifications).toBe(1);
    });
});
