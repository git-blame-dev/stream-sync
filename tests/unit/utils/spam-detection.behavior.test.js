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
            enabled: false,
            lowValueThreshold: 10,
            detectionWindow: 5,
            maxIndividualNotifications: 2
        }, { logger: noOpLogger });
        detection = createDonationSpamDetection(config, { logger: noOpLogger, autoCleanup: false });

        const result = detection.handleDonationSpam('u', 'User', 1, 'Rose', 1, 'tiktok');
        expect(result.shouldShow).toBe(true);
    });

    it('suppresses notifications after threshold and resets after window', () => {
        useFakeTimers();
        const config = createSpamDetectionConfig({
            enabled: true,
            detectionWindow: 0.2,
            maxIndividualNotifications: 1,
            lowValueThreshold: 10
        }, { logger: noOpLogger });
        detection = createDonationSpamDetection(config, { logger: noOpLogger, autoCleanup: false });

        expect(detection.handleDonationSpam('u', 'User', 1, 'Rose', 1, 'tiktok').shouldShow).toBe(true);
        expect(detection.handleDonationSpam('u', 'User', 1, 'Rose', 1, 'tiktok').shouldShow).toBe(false);

        advanceTimersByTime(250);
        expect(detection.handleDonationSpam('u', 'User', 1, 'Rose', 1, 'tiktok').shouldShow).toBe(true);
    });

    it('treats high-value donations as non-spam', () => {
        const config = createSpamDetectionConfig({
            enabled: true,
            lowValueThreshold: 5,
            detectionWindow: 5,
            maxIndividualNotifications: 1
        }, { logger: noOpLogger });
        detection = createDonationSpamDetection(config, { logger: noOpLogger, autoCleanup: false });

        const result = detection.handleDonationSpam('u', 'User', 20, 'Lion', 1, 'tiktok');
        expect(result.shouldShow).toBe(true);
    });

    it('applies same threshold across all platforms', () => {
        const config = createSpamDetectionConfig({
            enabled: true,
            lowValueThreshold: 10,
            detectionWindow: 5,
            maxIndividualNotifications: 1
        }, { logger: noOpLogger });
        detection = createDonationSpamDetection(config, { logger: noOpLogger, autoCleanup: false });

        const ytFirst = detection.handleDonationSpam('yt', 'YTUser', 5, 'Super Chat', 1, 'youtube');
        const ytSecond = detection.handleDonationSpam('yt', 'YTUser', 5, 'Super Chat', 1, 'youtube');
        const tkFirst = detection.handleDonationSpam('tk', 'TKUser', 5, 'Rose', 1, 'tiktok');
        const tkSecond = detection.handleDonationSpam('tk', 'TKUser', 5, 'Rose', 1, 'tiktok');

        expect(ytFirst.shouldShow).toBe(true);
        expect(ytSecond.shouldShow).toBe(false);
        expect(tkFirst.shouldShow).toBe(true);
        expect(tkSecond.shouldShow).toBe(false);
    });

    it('falls back to global config for unknown platform lookups', () => {
        const config = createSpamDetectionConfig({
            enabled: true,
            lowValueThreshold: 5,
            detectionWindow: 2,
            maxIndividualNotifications: 1
        }, { logger: noOpLogger });

        const fallback = config.getPlatformConfig('unknown');

        expect(fallback.enabled).toBe(true);
        expect(fallback.lowValueThreshold).toBe(5);
        expect(fallback.detectionWindow).toBe(2);
        expect(fallback.maxIndividualNotifications).toBe(1);
    });
});
