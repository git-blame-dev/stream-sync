const { describe, expect, afterEach, it } = require('bun:test');
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

    it('gracefully allows when spam detection disabled', () => {
        const config = createSpamDetectionConfig({
            spamDetectionEnabled: false,
            lowValueThreshold: 10,
            spamDetectionWindow: 5,
            maxIndividualNotifications: 2
        });
        detection = createDonationSpamDetection(config, { logger: noOpLogger, autoCleanup: false });

        const result = detection.handleDonationSpam('u', 'User', 1, 'Rose', 1, 'tiktok');
        expect(result.shouldShow).toBe(true);
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

    it('allows youtube donations and suppresses tiktok after threshold', () => {
        const config = createSpamDetectionConfig({
            spamDetectionEnabled: true,
            lowValueThreshold: 10,
            spamDetectionWindow: 5,
            maxIndividualNotifications: 1
        });
        detection = createDonationSpamDetection(config, { logger: noOpLogger, autoCleanup: false });

        const ytResult = detection.handleDonationSpam('yt', 'YTUser', 0.50, 'Super Chat', 1, 'youtube');
        const tkFirst = detection.handleDonationSpam('tk', 'TKUser', 1, 'Rose', 1, 'tiktok');
        const tkSecond = detection.handleDonationSpam('tk', 'TKUser', 1, 'Rose', 1, 'tiktok');

        expect(ytResult.shouldShow).toBe(true);
        expect(tkFirst.shouldShow).toBe(true);
        expect(tkSecond.shouldShow).toBe(false);
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
