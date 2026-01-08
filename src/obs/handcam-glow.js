
const { ensureOBSConnected } = require('./connection');
const { logger } = require('../core/logging');
const { safeDelay } = require('../utils/timeout-validator');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

let handcamGlowErrorHandler = null;

function handleHandcamGlowError(message, error, payload = null) {
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

function resolveHandcamDefaults(runtimeConstants) {
    if (!runtimeConstants || !runtimeConstants.HANDCAM_GLOW_CONFIG) {
        throw new Error('handcam-glow requires runtimeConstants.HANDCAM_GLOW_CONFIG');
    }
    return runtimeConstants.HANDCAM_GLOW_CONFIG;
}

function createHandcamGlowConfig(handcamConfig = {}, runtimeConstants) {
    const defaults = resolveHandcamDefaults(runtimeConstants);
    return {
        enabled: handcamConfig.glowEnabled ?? defaults.ENABLED,
        maxSize: Number(handcamConfig.maxSize ?? defaults.DEFAULT_MAX_SIZE),
        rampUpDuration: Number(handcamConfig.rampUpDuration ?? defaults.DEFAULT_RAMP_UP_DURATION),
        holdDuration: Number(handcamConfig.holdDuration ?? defaults.DEFAULT_HOLD_DURATION),
        rampDownDuration: Number(handcamConfig.rampDownDuration ?? defaults.DEFAULT_RAMP_DOWN_DURATION),
        totalSteps: Number(handcamConfig.totalSteps ?? defaults.DEFAULT_TOTAL_STEPS),
        incrementPercent: Number(handcamConfig.incrementPercent ?? defaults.DEFAULT_INCREMENT_PERCENT),
        easingEnabled: handcamConfig.easingEnabled ?? defaults.DEFAULT_EASING_ENABLED,
        animationInterval: Number(handcamConfig.animationInterval ?? defaults.DEFAULT_ANIMATION_INTERVAL),
        sourceName: handcamConfig.sourceName ?? defaults.SOURCE_NAME,
        sceneName: handcamConfig.sceneName ?? defaults.SCENE_NAME,
        filterName: handcamConfig.glowFilterName ?? defaults.FILTER_NAME,
        
        // Calculated properties
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
    try {
        await ensureOBSConnected();
        
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
    try {
        logger.debug(`[Handcam] Phase ${phaseNumber}: ${phaseName} - ${config.totalSteps} steps, ${stepDelay.toFixed(1)}ms per step`, 'handcam-glow');
        
        for (let step = 0; step <= config.totalSteps; step++) {
            const size = calculateSize(step);
            await setHandcamGlowSize(obs, config, baseSettings, size);
            
            // Add delay between steps (except for the last step)
            if (step < config.totalSteps) {
                await safeDelay(stepDelay, Math.max(stepDelay || 0, 10), 'Handcam glow step delay');
            }
        }
        
        logger.debug(`[Handcam] Phase ${phaseNumber} completed: ${phaseName}`, 'handcam-glow');
        
    } catch (error) {
        logger.debug(`[Handcam] Error in phase ${phaseNumber} (${phaseName})`, 'handcam-glow', error.message);
        throw error;
    }
}

async function animateGlowSize(obs, config, baseSettings) {
    try {
        logger.debug(`[Handcam] Starting enhanced glow animation with easing: ${config.easingEnabled ? 'enabled' : 'disabled'}`, 'handcam-glow');
        
        // Step 1: Ramp up (0% → 100%) with optional easing
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
        
        // Step 2: Hold at maximum intensity
        logger.debug(`[Handcam] Phase 2: Hold at maximum glow for ${config.holdDuration}s`, 'handcam-glow');
        await safeDelay(config.holdDuration * 1000, 1000, 'Handcam glow hold duration');
        
        // Step 3: Ramp down (100% → 0%) with optional easing
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
        // Re-throw to let the calling function handle cleanup
        throw error;
    }
}

async function setSourceFilterEnabled(obs, sourceName, filterName, enabled) {
    try {
        await ensureOBSConnected();
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

async function activateHandcamGlow(obs, handcamConfig = {}, runtimeConstants) {
    const config = createHandcamGlowConfig(handcamConfig, runtimeConstants);
    
    if (!config.enabled) {
        logger.debug('[Handcam] Glow filter disabled in config', 'handcam-glow');
        return;
    }
    
    try {
        logger.debug(`[Handcam] Starting glow animation: 0→${config.maxSize}→0 over ${config.totalDuration}s (${config.rampUpDuration}s up + ${config.holdDuration}s hold + ${config.rampDownDuration}s down)`, 'handcam-glow');
        
        // Clear any existing timeout to reset duration
        if (handcamGlowTimeout) {
            clearTimeout(handcamGlowTimeout);
            handcamGlowTimeout = null;
            logger.debug('[Handcam] Cleared existing glow animation timeout', 'handcam-glow');
        }
        
        // Ensure OBS connection is ready
        await ensureOBSConnected();
        
        // Get current filter settings to preserve other properties
        const filterInfo = await obs.call('GetSourceFilter', {
            sourceName: config.sourceName,
            filterName: config.filterName
        });
        
        const baseSettings = filterInfo.filterSettings;
        logger.debug(`[Handcam] Retrieved filter settings for ${config.sourceName}:${config.filterName}`, 'handcam-glow');
        
        // Initialize to 0 using the modular helper function
        await setHandcamGlowSize(obs, config, baseSettings, 0);
        
        // Execute the 3-phase animation
        await animateGlowSize(obs, config, baseSettings);
        
        logger.debug('[Handcam] Glow animation completed', 'handcam-glow');
        
    } catch (error) {
        handleHandcamGlowError('[Handcam] Error in glow animation', error, { config });
        
        // Try to reset properties on error using modular helper
        try {
            await ensureOBSConnected();
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

async function initializeHandcamGlow(obs, handcamConfig = {}, runtimeConstants) {
    const config = createHandcamGlowConfig(handcamConfig, runtimeConstants);
    
    if (!config.enabled) {
        logger.debug('[Handcam] Glow initialization skipped - disabled in config', 'handcam-glow');
        return;
    }
    
    try {
        await ensureOBSConnected();
        
        // Get current filter settings to preserve other properties
        const filterInfo = await obs.call('GetSourceFilter', {
            sourceName: config.sourceName,
            filterName: config.filterName
        });
        
        const baseSettings = filterInfo.filterSettings;
        
        // Initialize to 0 to ensure clean state
        await setHandcamGlowSize(obs, config, baseSettings, 0);
        logger.debug('[Handcam] Glow filter initialized to 0', 'handcam-glow');
        
    } catch (error) {
        logger.debug('[Handcam] Error initializing glow filter', 'handcam-glow', error.message);
    }
}

function triggerHandcamGlow(obs, handcamConfig = {}, runtimeConstants) {
    const config = createHandcamGlowConfig(handcamConfig, runtimeConstants);
    
    if (!config.enabled) {
        logger.debug('[Handcam] Glow trigger ignored - disabled in config', 'handcam-glow');
        return;
    }
    
    logger.debug('[Handcam] Triggering glow animation (fire-and-forget)', 'handcam-glow');
    
    // Fire-and-forget execution
    activateHandcamGlow(obs, handcamConfig, runtimeConstants).catch(error => {
        logger.debug('[Handcam] Fire-and-forget glow animation error', 'handcam-glow', error.message);
    });
}

module.exports = {
    triggerHandcamGlow,
    initializeHandcamGlow
};
