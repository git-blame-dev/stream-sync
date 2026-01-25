const { ConfigValidator } = require('../utils/config-validator');
const { DEFAULTS } = require('../core/config-defaults');

function normalizeHandcamConfig(input = {}) {
    return {
        enabled: ConfigValidator.parseBoolean(input.enabled, DEFAULTS.handcam.glowEnabled),
        sourceName: ConfigValidator.parseString(input.sourceName, DEFAULTS.handcam.sourceName),
        sceneName: ConfigValidator.parseString(input.sceneName, DEFAULTS.handcam.sceneName),
        glowFilterName: ConfigValidator.parseString(input.glowFilterName, DEFAULTS.handcam.glowFilterName),
        maxSize: ConfigValidator.parseNumber(input.maxSize, { defaultValue: DEFAULTS.handcam.maxSize, min: 0 }),
        rampUpDuration: ConfigValidator.parseNumber(input.rampUpDuration, { defaultValue: DEFAULTS.handcam.rampUpDuration, min: 0 }),
        holdDuration: ConfigValidator.parseNumber(input.holdDuration, { defaultValue: DEFAULTS.handcam.holdDuration, min: 0 }),
        rampDownDuration: ConfigValidator.parseNumber(input.rampDownDuration, { defaultValue: DEFAULTS.handcam.rampDownDuration, min: 0 }),
        totalSteps: ConfigValidator.parseNumber(input.totalSteps, { defaultValue: DEFAULTS.handcam.totalSteps, min: 1 }),
        incrementPercent: ConfigValidator.parseNumber(input.incrementPercent, { defaultValue: DEFAULTS.handcam.incrementPercent, min: 0 }),
        easingEnabled: ConfigValidator.parseBoolean(input.easingEnabled, DEFAULTS.handcam.easingEnabled),
        animationInterval: ConfigValidator.parseNumber(input.animationInterval, { defaultValue: DEFAULTS.handcam.animationInterval, min: 1 })
    };
}

function normalizeGiftsConfig(input = {}) {
    return {
        giftVideoSource: ConfigValidator.parseString(input.giftVideoSource, DEFAULTS.gifts.giftVideoSource),
        giftAudioSource: ConfigValidator.parseString(input.giftAudioSource, DEFAULTS.gifts.giftAudioSource),
        scene: ConfigValidator.parseString(input.scene, DEFAULTS.gifts.giftScene)
    };
}

function normalizeTimingConfig(input = {}) {
    return {
        transitionDelay: ConfigValidator.parseNumber(input.transitionDelay, { defaultValue: DEFAULTS.timing.transitionDelay, min: 0 }),
        notificationClearDelay: ConfigValidator.parseNumber(input.notificationClearDelay, { defaultValue: DEFAULTS.timing.notificationClearDelay, min: 0 }),
        chatMessageDuration: ConfigValidator.parseNumber(input.chatMessageDuration, { defaultValue: DEFAULTS.timing.chatMessageDuration, min: 0 })
    };
}

function normalizeDisplayQueueConfig(input = {}) {
    const maxQueueSize = ConfigValidator.parseNumber(input.maxQueueSize, { defaultValue: DEFAULTS.displayQueue.maxQueueSize, min: 1 });

    return {
        autoProcess: ConfigValidator.parseBoolean(input.autoProcess, DEFAULTS.displayQueue.autoProcess),
        maxQueueSize,
        chatOptimization: ConfigValidator.parseBoolean(input.chatOptimization, DEFAULTS.displayQueue.chatOptimization),
        ttsEnabled: ConfigValidator.parseBoolean(input.ttsEnabled, false),
        chat: input.chat || {},
        notification: input.notification || {},
        obs: input.obs || {},
        tts: input.tts || {},
        vfx: input.vfx || {},
        gifts: normalizeGiftsConfig(input.gifts),
        handcam: normalizeHandcamConfig(input.handcam),
        timing: normalizeTimingConfig(input.timing),
        youtube: input.youtube || {},
        twitch: input.twitch || {},
        tiktok: input.tiktok || {}
    };
}

module.exports = {
    normalizeDisplayQueueConfig
};
