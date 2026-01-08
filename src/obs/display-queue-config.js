const { parseConfigBooleanDefaultTrue } = require('../utils/config-boolean-parser');

const DEFAULT_MAX_QUEUE_SIZE = 100;

function normalizeDisplayQueueConfig(input = {}) {
    const giftsConfig = input.gifts || {};
    const obsConfig = input.obs || {};
    const maxQueueSize = Number.isFinite(Number(input.maxQueueSize)) && Number(input.maxQueueSize) > 0
        ? Number(input.maxQueueSize)
        : DEFAULT_MAX_QUEUE_SIZE;

    return {
        autoProcess: parseConfigBooleanDefaultTrue(input.autoProcess),
        maxQueueSize,
        chatOptimization: parseConfigBooleanDefaultTrue(input.chatOptimization),
        ttsEnabled: input.ttsEnabled,
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
