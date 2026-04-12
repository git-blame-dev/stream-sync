import { createRequire } from 'node:module';
import { logger as defaultLogger } from '../core/logging';
import { safeDelay as defaultDelay } from '../utils/timeout-validator';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';

type GlowLogger = {
    debug: (message: string, context?: string, payload?: unknown) => void;
};

type EnsureConnected = () => Promise<void>;
type GlowDelay = (ms: number, minMs: number, context: string) => Promise<void>;

type HandcamModuleDeps = {
    ensureConnected: EnsureConnected;
    logger: GlowLogger;
    delay: GlowDelay;
};

type HandcamConfigInput = {
    enabled: boolean;
    maxSize: number | string;
    rampUpDuration: number | string;
    holdDuration: number | string;
    rampDownDuration: number | string;
    totalSteps: number | string;
    easingEnabled: boolean;
    sourceName: string;
    glowFilterName: string;
};

type HandcamGlowConfig = {
    enabled: boolean;
    maxSize: number;
    rampUpDuration: number;
    holdDuration: number;
    rampDownDuration: number;
    totalSteps: number;
    easingEnabled: boolean;
    sourceName: string;
    filterName: string;
    totalDuration: number;
    rampUpStepDelay: number;
    rampDownStepDelay: number;
};

type FilterSettings = Record<string, unknown>;

type ObsLike = {
    call: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
};

class HandcamGlowSupersededError extends Error {
    constructor() {
        super('Handcam glow run superseded by newer request');
    }
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const nodeRequire = createRequire(import.meta.url);
const { ensureOBSConnected: defaultEnsureConnected } = nodeRequire('./connection.js') as {
    ensureOBSConnected: () => Promise<void>;
};

let moduleDeps: HandcamModuleDeps = {
    ensureConnected: defaultEnsureConnected,
    logger: defaultLogger,
    delay: defaultDelay
};

function _setDependencies(deps: Partial<HandcamModuleDeps>) {
    moduleDeps = { ...moduleDeps, ...deps };
}

function _resetDependencies() {
    moduleDeps = {
        ensureConnected: defaultEnsureConnected,
        logger: defaultLogger,
        delay: defaultDelay
    };
}

let handcamGlowErrorHandler: ReturnType<typeof createPlatformErrorHandler> | null = null;

function handleHandcamGlowError(message: string, error: unknown, payload: Record<string, unknown> | null = null) {
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

let handcamGlowRunId = 0;

function assertActiveRun(runId: number | null = null) {
    if (runId === null) {
        return;
    }
    if (runId !== handcamGlowRunId) {
        throw new HandcamGlowSupersededError();
    }
}

function easeOutCubic(t: number) {
    return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number) {
    return t * t * t;
}

function createHandcamGlowConfig(handcamConfig: HandcamConfigInput): HandcamGlowConfig {
    return {
        enabled: handcamConfig.enabled,
        maxSize: Number(handcamConfig.maxSize),
        rampUpDuration: Number(handcamConfig.rampUpDuration),
        holdDuration: Number(handcamConfig.holdDuration),
        rampDownDuration: Number(handcamConfig.rampDownDuration),
        totalSteps: Number(handcamConfig.totalSteps),
        easingEnabled: handcamConfig.easingEnabled,
        sourceName: handcamConfig.sourceName,
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

async function setHandcamGlowSize(obs: ObsLike, config: HandcamGlowConfig, baseSettings: FilterSettings, size: number, runId: number | null = null) {
    const { logger, ensureConnected } = moduleDeps;
    try {
        assertActiveRun(runId);
        await ensureConnected();
        assertActiveRun(runId);

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
        logger.debug(`[Handcam] Error setting glow size to ${size}`, 'handcam-glow', getErrorMessage(error));
        throw error;
    }
}

async function executeAnimationPhase(
    obs: ObsLike,
    config: HandcamGlowConfig,
    baseSettings: FilterSettings,
    phaseName: string,
    phaseNumber: number,
    calculateSize: (step: number) => number,
    stepDelay: number,
    runId: number
) {
    const { logger, delay } = moduleDeps;
    try {
        logger.debug(`[Handcam] Phase ${phaseNumber}: ${phaseName} - ${config.totalSteps} steps, ${stepDelay.toFixed(1)}ms per step`, 'handcam-glow');

        for (let step = 0; step <= config.totalSteps; step++) {
            assertActiveRun(runId);
            const size = calculateSize(step);
            await setHandcamGlowSize(obs, config, baseSettings, size, runId);

            if (step < config.totalSteps) {
                await delay(stepDelay, Math.max(stepDelay || 0, 10), 'Handcam glow step delay');
                assertActiveRun(runId);
            }
        }

        logger.debug(`[Handcam] Phase ${phaseNumber} completed: ${phaseName}`, 'handcam-glow');

    } catch (error) {
        logger.debug(`[Handcam] Error in phase ${phaseNumber} (${phaseName})`, 'handcam-glow', getErrorMessage(error));
        throw error;
    }
}

async function animateGlowSize(obs: ObsLike, config: HandcamGlowConfig, baseSettings: FilterSettings, runId: number) {
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
            config.rampUpStepDelay,
            runId
        );

        logger.debug(`[Handcam] Phase 2: Hold at maximum glow for ${config.holdDuration}s`, 'handcam-glow');
        await delay(config.holdDuration * 1000, 1000, 'Handcam glow hold duration');
        assertActiveRun(runId);

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
            config.rampDownStepDelay,
            runId
        );

        logger.debug(`[Handcam] Enhanced glow animation completed successfully`, 'handcam-glow');

    } catch (error) {
        logger.debug(`[Handcam] Error during enhanced glow animation`, 'handcam-glow', getErrorMessage(error));
        throw error;
    }
}

async function activateHandcamGlow(obs: ObsLike, handcamConfig: HandcamConfigInput) {
    const { logger, ensureConnected } = moduleDeps;
    const config = createHandcamGlowConfig(handcamConfig);
    const runId = ++handcamGlowRunId;

    if (!config.enabled) {
        logger.debug('[Handcam] Glow filter disabled in config', 'handcam-glow');
        return;
    }

    try {
        logger.debug(`[Handcam] Starting glow animation: 0→${config.maxSize}→0 over ${config.totalDuration}s (${config.rampUpDuration}s up + ${config.holdDuration}s hold + ${config.rampDownDuration}s down)`, 'handcam-glow');

        await ensureConnected();
        assertActiveRun(runId);

        const filterInfo = await obs.call('GetSourceFilter', {
            sourceName: config.sourceName,
            filterName: config.filterName
        }) as { filterSettings?: FilterSettings };

        const baseSettings = filterInfo.filterSettings ?? {};
        logger.debug(`[Handcam] Retrieved filter settings for ${config.sourceName}:${config.filterName}`, 'handcam-glow');

        await setHandcamGlowSize(obs, config, baseSettings, 0, runId);
        await animateGlowSize(obs, config, baseSettings, runId);

        logger.debug('[Handcam] Glow animation completed', 'handcam-glow');

    } catch (error) {
        if (error instanceof HandcamGlowSupersededError) {
            logger.debug('[Handcam] Glow animation superseded by a newer request', 'handcam-glow');
            return;
        }
        handleHandcamGlowError('[Handcam] Error in glow animation', error, { config });

        try {
            await ensureConnected();
            const filterInfo = await obs.call('GetSourceFilter', {
                sourceName: config.sourceName,
                filterName: config.filterName
            }) as { filterSettings?: FilterSettings };
            await setHandcamGlowSize(obs, config, filterInfo.filterSettings ?? {}, 0);
            logger.debug('[Handcam] Reset glow properties after error', 'handcam-glow');
        } catch (resetError) {
            logger.debug('[Handcam] Failed to reset glow properties', 'handcam-glow', getErrorMessage(resetError));
        }
    }
}

async function initializeHandcamGlow(obs: ObsLike, handcamConfig: HandcamConfigInput) {
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
        }) as { filterSettings?: FilterSettings };

        const baseSettings = filterInfo.filterSettings ?? {};

        await setHandcamGlowSize(obs, config, baseSettings, 0);
        logger.debug('[Handcam] Glow filter initialized to 0', 'handcam-glow');

    } catch (error) {
        logger.debug('[Handcam] Error initializing glow filter', 'handcam-glow', getErrorMessage(error));
    }
}

function triggerHandcamGlow(obs: ObsLike, handcamConfig: HandcamConfigInput) {
    const { logger } = moduleDeps;
    const config = createHandcamGlowConfig(handcamConfig);

    if (!config.enabled) {
        logger.debug('[Handcam] Glow trigger ignored - disabled in config', 'handcam-glow');
        return;
    }

    logger.debug('[Handcam] Triggering glow animation (fire-and-forget)', 'handcam-glow');

    activateHandcamGlow(obs, handcamConfig).catch(error => {
        logger.debug('[Handcam] Fire-and-forget glow animation error', 'handcam-glow', getErrorMessage(error));
    });
}

const setTestingDependencies = _setDependencies;
const resetTestingDependencies = _resetDependencies;

export {
    triggerHandcamGlow,
    initializeHandcamGlow,
    setTestingDependencies,
    resetTestingDependencies
};
