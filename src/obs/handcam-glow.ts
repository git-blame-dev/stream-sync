import type { AppLogger } from '../core/logger/types';
import { logger as defaultLogger } from '../core/logging';
import { DEFAULTS } from '../core/config-schema';
import { ConfigValidator } from '../utils/config-validator';
import { safeDelay as defaultDelay, validateTimeout } from '../utils/timeout-validator';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';

type GlowLogger = Pick<AppLogger<string>, 'debug'>;

type EnsureConnected = () => Promise<void>;
type GlowDelay = (ms: number, minMs: number, context: string) => Promise<void>;

type HandcamModuleDeps = {
    ensureConnected?: EnsureConnected;
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
} | null | undefined;

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
    ensureConnected?: EnsureConnected;
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

let moduleDeps: HandcamModuleDeps = {
    logger: defaultLogger,
    delay: defaultDelay
};

function _setDependencies(deps: Partial<HandcamModuleDeps>) {
    moduleDeps = { ...moduleDeps, ...deps };
}

function _resetDependencies() {
    moduleDeps = {
        logger: defaultLogger,
        delay: defaultDelay
    };
}

async function ensureGlowConnected(obs: ObsLike): Promise<void> {
    if (moduleDeps.ensureConnected) {
        await moduleDeps.ensureConnected();
    } else if (obs.ensureConnected) {
        await obs.ensureConnected();
    } else {
        throw new Error('Handcam glow requires OBS owner readiness');
    }
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

function assertActiveRun(runId: number | null = null, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (runId === null) {
        return;
    }
    if (runId !== handcamGlowRunId) {
        throw new HandcamGlowSupersededError();
    }
}

async function glowDelay(ms: number, minMs: number, context: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!signal) return moduleDeps.delay(ms, minMs, context);
    if (moduleDeps.delay === defaultDelay) return defaultDelay(ms, minMs, context, signal);
    let cancel!: () => void;
    const aborted = new Promise<void>((resolve) => { cancel = resolve; signal.addEventListener('abort', cancel, { once: true }); });
    try { await Promise.race([moduleDeps.delay(ms, minMs, context), aborted]); signal.throwIfAborted(); }
    finally { signal.removeEventListener('abort', cancel); }
}

function easeOutCubic(t: number) {
    return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number) {
    return t * t * t;
}

// Each ramp issues one OBS update per step; bound direct callers even when they bypass INI normalization.
const MAX_ANIMATION_STEPS = 1000;

function createHandcamGlowConfig(handcamConfig: HandcamConfigInput): HandcamGlowConfig {
    const numberFromSchema = (field: 'maxSize' | 'rampUpDuration' | 'holdDuration' | 'rampDownDuration' | 'totalSteps') => {
        const value = handcamConfig?.[field];
        return ConfigValidator._parseNumberFromSchema('handcam', field,
            typeof value === 'number' || typeof value === 'string' ? value : undefined) as number;
    };
    const parsedSteps = numberFromSchema('totalSteps');
    const totalSteps = Number.isInteger(parsedSteps) && parsedSteps > 0
        ? Math.min(parsedSteps, MAX_ANIMATION_STEPS)
        : DEFAULTS.handcam.totalSteps as number;
    const nameFromConfig = (value: unknown, fallback: unknown) =>
        typeof value === 'string' && value.trim() ? value : String(fallback);

    return {
        enabled: handcamConfig?.enabled === true,
        maxSize: numberFromSchema('maxSize'),
        rampUpDuration: numberFromSchema('rampUpDuration'),
        holdDuration: numberFromSchema('holdDuration'),
        rampDownDuration: numberFromSchema('rampDownDuration'),
        totalSteps,
        easingEnabled: handcamConfig?.easingEnabled ?? (DEFAULTS.handcam.easingEnabled === true),
        sourceName: nameFromConfig(handcamConfig?.sourceName, DEFAULTS.handcam.sourceName),
        filterName: nameFromConfig(handcamConfig?.glowFilterName, DEFAULTS.handcam.glowFilterName),

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

async function setHandcamGlowSize(obs: ObsLike, config: HandcamGlowConfig, baseSettings: FilterSettings, size: number, runId: number | null = null, signal?: AbortSignal) {
    const { logger } = moduleDeps;
    try {
        assertActiveRun(runId, signal);
        await ensureGlowConnected(obs);
        assertActiveRun(runId, signal);

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
        logger.debug(`Error setting glow size to ${size}`, 'handcam-glow', getErrorMessage(error));
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
    runId: number,
    signal?: AbortSignal
) {
    const { logger } = moduleDeps;
    try {
        logger.debug(`Phase ${phaseNumber}: ${phaseName} - ${config.totalSteps} steps, ${stepDelay.toFixed(1)}ms per step`, 'handcam-glow');

        for (let step = 0; step <= config.totalSteps; step++) {
            assertActiveRun(runId, signal);
            const size = calculateSize(step);
            await setHandcamGlowSize(obs, config, baseSettings, size, runId, signal);

            if (step < config.totalSteps) {
                await glowDelay(stepDelay, Math.max(stepDelay || 0, 10), 'Handcam glow step delay', signal);
                assertActiveRun(runId, signal);
            }
        }

        logger.debug(`Phase ${phaseNumber} completed: ${phaseName}`, 'handcam-glow');

    } catch (error) {
        logger.debug(`Error in phase ${phaseNumber} (${phaseName})`, 'handcam-glow', getErrorMessage(error));
        throw error;
    }
}

async function animateGlowSize(obs: ObsLike, config: HandcamGlowConfig, baseSettings: FilterSettings, runId: number, signal?: AbortSignal) {
    const { logger } = moduleDeps;
    try {
        logger.debug(`Starting enhanced glow animation with easing: ${config.easingEnabled ? 'enabled' : 'disabled'}`, 'handcam-glow');

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
            runId,
            signal
        );

        logger.debug(`Phase 2: Hold at maximum glow for ${config.holdDuration}s`, 'handcam-glow');
        if (config.holdDuration > 0) {
            const holdDelay = validateTimeout(config.holdDuration * 1000, config.holdDuration);
            await glowDelay(holdDelay, 1000, 'Handcam glow hold duration', signal);
        }
        assertActiveRun(runId, signal);

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
            runId,
            signal
        );

        logger.debug(`Enhanced glow animation completed successfully`, 'handcam-glow');

    } catch (error) {
        logger.debug(`Error during enhanced glow animation`, 'handcam-glow', getErrorMessage(error));
        throw error;
    }
}

async function activateHandcamGlow(obs: ObsLike, handcamConfig: HandcamConfigInput, signal?: AbortSignal) {
    const { logger } = moduleDeps;
    const config = createHandcamGlowConfig(handcamConfig);
    const runId = ++handcamGlowRunId;

    if (!config.enabled) {
        logger.debug('Glow filter disabled in config', 'handcam-glow');
        return;
    }

    try {
        logger.debug(`Starting glow animation: 0→${config.maxSize}→0 over ${config.totalDuration}s (${config.rampUpDuration}s up + ${config.holdDuration}s hold + ${config.rampDownDuration}s down)`, 'handcam-glow');

        assertActiveRun(runId, signal);
        await ensureGlowConnected(obs);
        assertActiveRun(runId, signal);

        const filterInfo = await obs.call('GetSourceFilter', {
            sourceName: config.sourceName,
            filterName: config.filterName
        }) as { filterSettings?: FilterSettings };

        const baseSettings = filterInfo.filterSettings ?? {};
        logger.debug(`Retrieved filter settings for ${config.sourceName}:${config.filterName}`, 'handcam-glow');

        await setHandcamGlowSize(obs, config, baseSettings, 0, runId, signal);
        await animateGlowSize(obs, config, baseSettings, runId, signal);

        logger.debug('Glow animation completed', 'handcam-glow');

    } catch (error) {
        if (signal?.aborted || error instanceof HandcamGlowSupersededError) {
            logger.debug('Glow animation superseded by a newer request', 'handcam-glow');
            return;
        }
        handleHandcamGlowError('[Handcam] Error in glow animation', error, { config });

        try {
            assertActiveRun(runId, signal);
            await ensureGlowConnected(obs);
            assertActiveRun(runId, signal);
            const filterInfo = await obs.call('GetSourceFilter', {
                sourceName: config.sourceName,
                filterName: config.filterName
            }) as { filterSettings?: FilterSettings };
            await setHandcamGlowSize(obs, config, filterInfo.filterSettings ?? {}, 0, runId, signal);
            logger.debug('Reset glow properties after error', 'handcam-glow');
        } catch (resetError) {
            logger.debug('Failed to reset glow properties', 'handcam-glow', getErrorMessage(resetError));
        }
    }
}

async function initializeHandcamGlow(obs: ObsLike, handcamConfig: HandcamConfigInput) {
    const { logger } = moduleDeps;
    const config = createHandcamGlowConfig(handcamConfig);

    if (!config.enabled) {
        logger.debug('Glow initialization skipped - disabled in config', 'handcam-glow');
        return;
    }

    try {
        await ensureGlowConnected(obs);

        const filterInfo = await obs.call('GetSourceFilter', {
            sourceName: config.sourceName,
            filterName: config.filterName
        }) as { filterSettings?: FilterSettings };

        const baseSettings = filterInfo.filterSettings ?? {};

        await setHandcamGlowSize(obs, config, baseSettings, 0);
        logger.debug('Glow filter initialized to 0', 'handcam-glow');

    } catch (error) {
        logger.debug('Error initializing glow filter', 'handcam-glow', getErrorMessage(error));
    }
}

function triggerHandcamGlow(obs: ObsLike, handcamConfig: HandcamConfigInput, signal?: AbortSignal) {
    const { logger } = moduleDeps;
    const config = createHandcamGlowConfig(handcamConfig);

    if (!config.enabled) {
        logger.debug('Glow trigger ignored - disabled in config', 'handcam-glow');
        return;
    }

    logger.debug('Triggering joinable glow animation', 'handcam-glow');

    return activateHandcamGlow(obs, handcamConfig, signal).catch(error => {
        logger.debug('Glow animation error', 'handcam-glow', getErrorMessage(error));
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
