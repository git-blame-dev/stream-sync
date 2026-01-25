const { ConfigValidator } = require('../utils/config-validator');
const { DEFAULTS } = require('../core/config-defaults');

function normalizeDisplayQueueConfig(input = {}) {
    const giftsConfig = input.gifts || {};
    const obsConfig = input.obs || {};
    const maxQueueSize = Number.isFinite(Number(input.maxQueueSize)) && Number(input.maxQueueSize) > 0
        ? Number(input.maxQueueSize)
        : DEFAULTS.displayQueue.maxQueueSize;

    return {
        autoProcess: ConfigValidator.parseBoolean(input.autoProcess, DEFAULTS.displayQueue.autoProcess),
        maxQueueSize,
        chatOptimization: ConfigValidator.parseBoolean(input.chatOptimization, DEFAULTS.displayQueue.chatOptimization),
        ttsEnabled: ConfigValidator.parseBoolean(input.ttsEnabled, false),
        chat: input.chat || {},
        notification: input.notification || {},
        obs: obsConfig,
        tts: input.tts || {},
        vfx: input.vfx || {},
        gifts: giftsConfig,
        handcam: input.handcam || {},
        youtube: input.youtube || {},
        twitch: input.twitch || {},
        tiktok: input.tiktok || {}
    };
}

module.exports = {
    normalizeDisplayQueueConfig
};
