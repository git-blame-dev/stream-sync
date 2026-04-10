import fs from 'node:fs';
import { createRequire } from 'node:module';
import { logger as defaultLogger } from '../core/logging';
import { createPlatformErrorHandler } from './platform-error-handler';

const nodeRequire = createRequire(import.meta.url);
const { config: defaultConfig } = nodeRequire('../core/config') as {
    config: GoalTrackerConfig;
};

type GoalPlatform = 'tiktok' | 'youtube' | 'twitch';

type GoalStateEntry = {
    current: number;
    target: number;
    currency: string;
};

type GoalStateRecord = {
    tiktok: GoalStateEntry;
    youtube: GoalStateEntry;
    twitch: GoalStateEntry;
};

type GoalTrackerConfig = {
    goals: {
        tiktokGoalEnabled?: boolean;
        tiktokGoalTarget?: number;
        tiktokGoalCurrency?: string;
        tiktokPaypiggyEquivalent?: number;
        youtubeGoalEnabled?: boolean;
        youtubeGoalTarget?: number;
        youtubeGoalCurrency?: string;
        youtubePaypiggyPrice?: number;
        twitchGoalEnabled?: boolean;
        twitchGoalTarget?: number;
        twitchGoalCurrency?: string;
        twitchPaypiggyEquivalent?: number;
    };
};

type GoalTrackerDependencies = {
    logger?: typeof defaultLogger;
    config?: GoalTrackerConfig;
    fileSystem?: typeof fs;
};

function createDefaultGoalState(): GoalStateRecord {
    return {
        tiktok: { current: 0, target: 1000, currency: 'coins' },
        youtube: { current: 0.00, target: 1.00, currency: 'dollars' },
        twitch: { current: 0, target: 100, currency: 'bits' }
    };
}

function isGoalPlatform(platform: string): platform is GoalPlatform {
    return platform === 'tiktok' || platform === 'youtube' || platform === 'twitch';
}

class GoalTracker {
    logger: typeof defaultLogger;
    config: GoalTrackerConfig;
    fileSystem: typeof fs;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    goalState: GoalStateRecord;

    constructor(dependencies: GoalTrackerDependencies = {}) {
        this.logger = dependencies.logger || defaultLogger;
        this.config = dependencies.config || defaultConfig;
        this.fileSystem = dependencies.fileSystem || fs;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'goal-tracker');
        this.goalState = createDefaultGoalState();
    }

    initializeGoalTracker() {
        try {
            this.logger.debug('Initializing goal tracking system...', 'goal-tracker');

            this.goalState = createDefaultGoalState();

            if (this.config.goals.tiktokGoalEnabled) {
                this.goalState.tiktok.target = Number(this.config.goals.tiktokGoalTarget);
                this.goalState.tiktok.currency = this.config.goals.tiktokGoalCurrency || this.goalState.tiktok.currency;
            }

            if (this.config.goals.youtubeGoalEnabled) {
                this.goalState.youtube.target = Number(this.config.goals.youtubeGoalTarget);
                this.goalState.youtube.currency = this.config.goals.youtubeGoalCurrency || this.goalState.youtube.currency;
            }

            if (this.config.goals.twitchGoalEnabled) {
                this.goalState.twitch.target = Number(this.config.goals.twitchGoalTarget);
                this.goalState.twitch.currency = this.config.goals.twitchGoalCurrency || this.goalState.twitch.currency;
            }

            this.logger.debug('Goal tracking system initialized successfully', 'goal-tracker');
            this.logger.debug(
                `Current state: twitch=${this.goalState.twitch.current}/${this.goalState.twitch.target} ${this.goalState.twitch.currency}, youtube=${this.goalState.youtube.current}/${this.goalState.youtube.target} ${this.goalState.youtube.currency}`,
                'goal-tracker'
            );
        } catch (error) {
            this._handleGoalTrackerError('[Goal Tracker] Error initializing goal tracker', error, {
                method: 'initializeGoalTracker'
            });
            throw error;
        }
    }

    addDonationToGoal(platform: unknown, amount: unknown) {
        try {
            if (typeof platform !== 'string') {
                return {
                    success: false,
                    error: `Invalid platform: ${platform}. Supported platforms: tiktok, youtube, twitch`
                };
            }

            const platformKey = platform.toLowerCase();

            if (!isGoalPlatform(platformKey)) {
                return {
                    success: false,
                    error: `Invalid platform: ${platform}. Supported platforms: tiktok, youtube, twitch`
                };
            }

            const numAmount = Number(amount);
            if (!Number.isFinite(numAmount) || numAmount <= 0) {
                return {
                    success: false,
                    error: `Donation amount must be positive number, received: ${amount}`
                };
            }

            const oldCurrent = this.goalState[platformKey].current;
            this.goalState[platformKey].current += numAmount;

            const newCurrent = this.goalState[platformKey].current;
            const target = this.goalState[platformKey].target;
            const currency = this.goalState[platformKey].currency;

            this.logger.debug(`${platform} goal updated: ${oldCurrent} → ${newCurrent} ${currency}`, 'goal-tracker');

            const formatted = this.formatGoalDisplay(platformKey);
            const percentage = target > 0 ? Math.round((newCurrent / target) * 100 * 10) / 10 : 0;
            const goalCompleted = newCurrent >= target;

            return {
                success: true,
                current: oldCurrent,
                newTotal: newCurrent,
                target,
                currency,
                formatted,
                percentage,
                goalCompleted
            };
        } catch (error) {
            this._handleGoalTrackerError(`[Goal Tracker] Error adding donation to ${platform} goal`, error, {
                platform,
                amount
            });
            return {
                success: false,
                error: `Failed to add donation: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    addPaypiggyToGoal(platform: unknown) {
        try {
            if (typeof platform !== 'string') {
                return {
                    success: false,
                    error: `Invalid platform: ${platform}. Supported platforms: tiktok, youtube, twitch`
                };
            }

            const platformKey = platform.toLowerCase();
            let paypiggyAmount = 0;

            switch (platformKey) {
                case 'tiktok':
                    paypiggyAmount = Number(this.config.goals.tiktokPaypiggyEquivalent);
                    this.logger.debug(`Converting TikTok paypiggy to ${paypiggyAmount} coins`, 'goal-tracker');
                    break;
                case 'youtube':
                    paypiggyAmount = Number(this.config.goals.youtubePaypiggyPrice);
                    this.logger.debug(`Converting YouTube paypiggy to $${paypiggyAmount}`, 'goal-tracker');
                    break;
                case 'twitch':
                    paypiggyAmount = Number(this.config.goals.twitchPaypiggyEquivalent);
                    this.logger.debug(`Converting Twitch paypiggy to ${paypiggyAmount} bits`, 'goal-tracker');
                    break;
                default:
                    return {
                        success: false,
                        error: `Invalid platform: ${platform}. Supported platforms: tiktok, youtube, twitch`
                    };
            }

            const result = this.addDonationToGoal(platform, paypiggyAmount);

            if (result.success) {
                return {
                    ...result,
                    paypiggyValue: paypiggyAmount
                };
            }

            return result;
        } catch (error) {
            this._handleGoalTrackerError(`[Goal Tracker] Error adding paypiggy to ${platform} goal`, error, {
                platform
            });
            return {
                success: false,
                error: `Failed to add paypiggy: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    formatGoalDisplay(platform: unknown, current?: unknown, target?: unknown) {
        const platformKey = typeof platform === 'string' ? platform.toLowerCase() : '';
        const normalizedPlatform = isGoalPlatform(platformKey) ? platformKey : null;
        const state = normalizedPlatform ? this.goalState[normalizedPlatform] : null;

        if (!state && (current === undefined || target === undefined)) {
            return '0/0 unknown';
        }

        const currentAmount = Number(current !== undefined ? current : (state ? state.current : 0));
        const targetAmount = Number(target !== undefined ? target : (state ? state.target : 0));
        const currency = state ? state.currency : 'unknown';

        const padNumber = (num: number, targetNum: number) => {
            const targetLen = String(Math.floor(targetNum)).length;
            return String(Math.floor(num)).padStart(targetLen, '0');
        };

        switch (platformKey) {
            case 'tiktok':
                return `${padNumber(currentAmount, targetAmount)}/${targetAmount} ${currency}`;
            case 'youtube':
                return `$${currentAmount.toFixed(2)}/$${targetAmount.toFixed(2)}`;
            case 'twitch':
                return `${padNumber(currentAmount, targetAmount)}/${targetAmount} ${currency}`;
            default:
                return `${currentAmount}/${targetAmount} ${currency}`;
        }
    }

    getGoalState(platform: string) {
        const platformKey = platform.toLowerCase();
        if (!isGoalPlatform(platformKey)) {
            return null;
        }

        const state = this.goalState[platformKey];
        return {
            ...state,
            formatted: this.formatGoalDisplay(platformKey)
        };
    }

    getAllGoalStates() {
        return {
            tiktok: this.getGoalState('tiktok'),
            youtube: this.getGoalState('youtube'),
            twitch: this.getGoalState('twitch')
        };
    }

    _handleGoalTrackerError(message: string, error: unknown, contextData: Record<string, unknown> | null = null) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'goal-tracker', contextData, message, 'goal-tracker');
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'goal-tracker', contextData);
        }
    }
}

function createGoalTracker(dependencies: GoalTrackerDependencies) {
    return new GoalTracker(dependencies);
}

export {
    GoalTracker,
    createGoalTracker
};
