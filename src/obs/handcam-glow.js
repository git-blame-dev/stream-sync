const { ensureOBSConnected: defaultEnsureConnected } = require('./connection');
const { logger: defaultLogger } = require('../core/logging');
const { safeDelay: defaultDelay } = require('../utils/timeout-validator');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

let moduleDeps = {
    ensureConnected: defaultEnsureConnected,
    logger: defaultLogger,
    delay: defaultDelay
};

function _setDependencies(deps) {
    moduleDeps = { ...moduleDeps, ...deps };
}

function _resetDependencies() {
    moduleDeps = {
        ensureConnected: defaultEnsureConnected,
        logger: defaultLogger,
        delay: defaultDelay
    };
}

let handcamGlowErrorHandler = null;

function handleHandcamGlowError(message, error, payload = null) {
    const { logger } = moduleDeps;
    if (!handcamGlowErrorHandler && logger) {
        handcamGlowErrorHandler = createPlatformErrorHandler(logger, 'handcam-glow');
    }

    if (handcamGlowErrorHandler && error instanceof Error) {
        handcamGlowErrorHandler.handleEventProcessingError(error, 'handcam-glow', payload, message, 'handcam-glow');
        return;
    }

    if (handcamGlowErrorHandler) {
        handcamGlowErrorHandler.logOperationalError(message, 'handcam-glow', payload);
    }
}

// Global timeout reference for handcam glow animation cleanup
let handcamGlowTimeout = null;

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t) {
    return t * t * t;
}

function createHandcamGlowConfig(handcamConfig) {
    return {
        enabled: handcamConfig.enabled,
        maxSize: Number(handcamConfig.maxSize),
        rampUpDuration: Number(handcamConfig.rampUpDuration),
        holdDuration: Number(handcamConfig.holdDuration),
        rampDownDuration: Number(handcamConfig.rampDownDuration),
        totalSteps: Number(handcamConfig.totalSteps),
        incrementPercent: Number(handcamConfig.incrementPercent),
        easingEnabled: handcamConfig.easingEnabled,
        animationInterval: Number(handcamConfig.animationInterval),
        sourceName: handcamConfig.sourceName,
        sceneName: handcamConfig.sceneName,
        filterName: handcamConfig.glowFilterName,

        get totalDuration() {
            return this.rampUpDuration + this.holdDuration + this.rampDownDuration;
        },
        get rampUpStepDelay() {
            return (this.rampUpDuration * 1000) / this.totalSteps;
        },
        get rampDownStepDelay() {
            return (this.rampDownDuration * 1000) / this.totalSteps;
        }
    };
}

async function setHandcamGlowSize(obs, config, baseSettings, size) {
    const { logger, ensureConnected } = moduleDeps;
    try {
        await ensureConnected();

        const newSettings = {
            ...baseSettings,
            Size: size,
            glow_size: size
        };

        await obs.call('SetSourceFilterSettings', {
            sourceName: config.sourceName,
            filterName: config.filterName,
            filterSettings: newSettings
        });

    } catch (error) {
        logger.debug(`[Handcam] Error setting glow size to ${size}`, 'handcam-glow', error.message);
        throw error;
    }
}

async function executeAnimationPhase(obs, config, baseSettings, phaseName, phaseNumber, calculateSize, stepDelay) {
    const { logger, delay } = moduleDeps;
    try {
        logger.debug(`[Handcam] Phase ${phaseNumber}: ${phaseName} - ${config.totalSteps} steps, ${stepDelay.toFixed(1)}ms per step`, 'handcam-glow');

        for (let step = 0; step <= config.totalSteps; step++) {
            const size = calculateSize(step);
            await setHandcamGlowSize(obs, config, baseSettings, size);

            if (step < config.totalSteps) {
                await delay(stepDelay, Math.max(stepDelay || 0, 10), 'Handcam glow step delay');
            }
        }

        logger.debug(`[Handcam] Phase ${phaseNumber} completed: ${phaseName}`, 'handcam-glow');

    } catch (error) {
        logger.debug(`[Handcam] Error in phase ${phaseNumber} (${phaseName})`, 'handcam-glow', error.message);
        throw error;
    }
}

async function animateGlowSize(obs, config, baseSettings) {
    const { logger, delay } = moduleDeps;
    try {
        logger.debug(`[Handcam] Starting enhanced glow animation with easing: ${config.easingEnabled ? 'enabled' : 'disabled'}`, 'handcam-glow');

        await executeAnimationPhase(
            obs,
            config,
            baseSettings,
            `Ramp Up (0 → max size) - ${config.rampUpDuration}s total`,
            1,
            (step) => {
                const progress = step / config.totalSteps;
                const easedProgress = config.easingEnabled ? easeInCubic(progress) : progress;
                return Math.round(easedProgress * config.maxSize);
            },
            config.rampUpStepDelay
        );

        logger.debug(`[Handcam] Phase 2: Hold at maximum glow for ${config.holdDuration}s`, 'handcam-glow');
        await delay(config.holdDuration * 1000, 1000, 'Handcam glow hold duration');

        await executeAnimationPhase(
            obs,
            config,
            baseSettings,
            `Ramp Down (max size → 0) - ${config.rampDownDuration}s total`,
            3,
            (step) => {
                const progress = step / config.totalSteps;
                const easedProgress = config.easingEnabled ? easeOutCubic(progress) : progress;
                return Math.round((1 - easedProgress) * config.maxSize);
            },
            config.rampDownStepDelay
        );

        logger.debug(`[Handcam] Enhanced glow animation completed successfully`, 'handcam-glow');

    } catch (error) {
        logger.debug(`[Handcam] Error during enhanced glow animation`, 'handcam-glow', error.message);
        throw error;
    }
}

async function setSourceFilterEnabled(obs, sourceName, filterName, enabled) {
    const { logger, ensureConnected } = moduleDeps;
    try {
        await ensureConnected();
        logger.debug(`[OBS Filter] Setting ${sourceName}:${filterName} to ${enabled ? 'enabled' : 'disabled'}`, 'handcam-glow');

        await obs.call('SetSourceFilterEnabled', {
            sourceName: sourceName,
            filterName: filterName,
            filterEnabled: enabled
        });

        logger.debug(`[OBS Filter] Successfully set ${sourceName}:${filterName} to ${enabled ? 'enabled' : 'disabled'}`, 'handcam-glow');

    } catch (error) {
        logger.debug(`[OBS Filter] Error setting ${sourceName}:${filterName}`, 'handcam-glow', error.message);
        throw error;
    }
}

async function activateHandcamGlow(obs, handcamConfig) {
    const { logger, ensureConnected } = moduleDeps;
    const config = createHandcamGlowConfig(handcamConfig);

    if (!config.enabled) {
        logger.debug('[Handcam] Glow filter disabled in config', 'handcam-glow');
        return;
    }

    try {
        logger.debug(`[Handcam] Starting glow animation: 0→${config.maxSize}→0 over ${config.totalDuration}s (${config.rampUpDuration}s up + ${config.holdDuration}s hold + ${config.rampDownDuration}s down)`, 'handcam-glow');

        if (handcamGlowTimeout) {
            clearTimeout(handcamGlowTimeout);
            handcamGlowTimeout = null;
            logger.debug('[Handcam] Cleared existing glow animation timeout', 'handcam-glow');
        }

        await ensureConnected();

        const filterInfo = await obs.call('GetSourceFilter', {
            sourceName: config.sourceName,
            filterName: config.filterName
        });

        const baseSettings = filterInfo.filterSettings;
        logger.debug(`[Handcam] Retrieved filter settings for ${config.sourceName}:${config.filterName}`, 'handcam-glow');

        await setHandcamGlowSize(obs, config, baseSettings, 0);
        await animateGlowSize(obs, config, baseSettings);

        logger.debug('[Handcam] Glow animation completed', 'handcam-glow');

    } catch (error) {
        handleHandcamGlowError('[Handcam] Error in glow animation', error, { config });

        try {
            await ensureConnected();
            const filterInfo = await obs.call('GetSourceFilter', {
                sourceName: config.sourceName,
                filterName: config.filterName
            });
            await setHandcamGlowSize(obs, config, filterInfo.filterSettings, 0);
            logger.debug('[Handcam] Reset glow properties after error', 'handcam-glow');
        } catch (resetError) {
            logger.debug('[Handcam] Failed to reset glow properties', 'handcam-glow', resetError.message);
        }
    }
}

async function initializeHandcamGlow(obs, handcamConfig) {
    const { logger, ensureConnected } = moduleDeps;
    const config = createHandcamGlowConfig(handcamConfig);

    if (!config.enabled) {
        logger.debug('[Handcam] Glow initialization skipped - disabled in config', 'handcam-glow');
        return;
    }

    try {
        await ensureConnected();

        const filterInfo = await obs.call('GetSourceFilter', {
            sourceName: config.sourceName,
            filterName: config.filterName
        });

        const baseSettings = filterInfo.filterSettings;

        await setHandcamGlowSize(obs, config, baseSettings, 0);
        logger.debug('[Handcam] Glow filter initialized to 0', 'handcam-glow');

    } catch (error) {
        logger.debug('[Handcam] Error initializing glow filter', 'handcam-glow', error.message);
    }
}

function triggerHandcamGlow(obs, handcamConfig) {
    const { logger } = moduleDeps;
    const config = createHandcamGlowConfig(handcamConfig);

    if (!config.enabled) {
        logger.debug('[Handcam] Glow trigger ignored - disabled in config', 'handcam-glow');
        return;
    }

    logger.debug('[Handcam] Triggering glow animation (fire-and-forget)', 'handcam-glow');

    activateHandcamGlow(obs, handcamConfig).catch(error => {
        logger.debug('[Handcam] Fire-and-forget glow animation error', 'handcam-glow', error.message);
    });
}

module.exports = {
    triggerHandcamGlow,
    initializeHandcamGlow,
    _testing: { setDependencies: _setDependencies, resetDependencies: _resetDependencies }
};
