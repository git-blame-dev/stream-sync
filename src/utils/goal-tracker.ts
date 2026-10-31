import fs from 'node:fs';
import { config as defaultConfig } from '../core/config';
import { logger as defaultLogger } from '../core/logging';
import { createPlatformErrorHandler } from './platform-error-handler';
import { normalizeCurrency } from './currency-utils';
import { membershipNativeUnits, type MonetizationValuesConfig, type SynchronousUsdConverter } from '../core/monetization-values';

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
        youtubeGoalEnabled?: boolean;
        youtubeGoalTarget?: number;
        youtubeGoalCurrency?: string;
        twitchGoalEnabled?: boolean;
        twitchGoalTarget?: number;
        twitchGoalCurrency?: string;
    };
    monetizationValues?: MonetizationValuesConfig;
};

type GoalTrackerDependencies = {
    logger?: typeof defaultLogger;
    config?: GoalTrackerConfig;
    fileSystem?: typeof fs;
    usdConverter?: SynchronousUsdConverter;
};

function createDefaultGoalState(): GoalStateRecord {
    return {
        tiktok: { current: 0, target: 1000, currency: 'coins' },
        youtube: { current: 0.00, target: 1.00, currency: 'USD' },
        twitch: { current: 0, target: 100, currency: 'bits' }
    };
}

function normalizeGoalCurrency(currency: unknown): string {
    const normalized = typeof currency === 'string' ? currency.trim() : '';
    const lowerCurrency = normalized.toLowerCase();
    if (lowerCurrency === 'dollars') {
        return 'USD';
    }
    if (lowerCurrency === 'coins' || lowerCurrency === 'bits' || lowerCurrency === 'jewels') {
        return lowerCurrency;
    }
    return normalizeCurrency(normalized, { logger: defaultLogger, warnUnknown: false });
}

function isGoalPlatform(platform: string): platform is GoalPlatform {
    return platform === 'tiktok' || platform === 'youtube' || platform === 'twitch';
}

class GoalTracker {
    logger: typeof defaultLogger;
    config: GoalTrackerConfig;
    fileSystem: typeof fs;
    usdConverter: SynchronousUsdConverter | undefined;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    goalState: GoalStateRecord;

    constructor(dependencies: GoalTrackerDependencies = {}) {
        this.logger = dependencies.logger || defaultLogger;
        this.config = (dependencies.config || defaultConfig) as GoalTrackerConfig;
        this.fileSystem = dependencies.fileSystem || fs;
        this.usdConverter = dependencies.usdConverter;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'goal-tracker');
        this.goalState = createDefaultGoalState();
    }

    initializeGoalTracker() {
        try {
            this.goalState = createDefaultGoalState();

            if (this.config.goals.tiktokGoalEnabled) {
                this.goalState.tiktok.target = Number(this.config.goals.tiktokGoalTarget);
                this.goalState.tiktok.currency = normalizeGoalCurrency(this.config.goals.tiktokGoalCurrency || this.goalState.tiktok.currency);
            }

            if (this.config.goals.youtubeGoalEnabled) {
                this.goalState.youtube.target = Number(this.config.goals.youtubeGoalTarget);
                this.goalState.youtube.currency = normalizeGoalCurrency(this.config.goals.youtubeGoalCurrency || this.goalState.youtube.currency);
            }

            if (this.config.goals.twitchGoalEnabled) {
                this.goalState.twitch.target = Number(this.config.goals.twitchGoalTarget);
                this.goalState.twitch.currency = normalizeGoalCurrency(this.config.goals.twitchGoalCurrency || this.goalState.twitch.currency);
            }
        } catch (error) {
            this._handleGoalTrackerError('[Goal Tracker] Error initializing goal tracker', error, {
                method: 'initializeGoalTracker'
            });
            throw error;
        }
    }

    addDonationToGoal(platform: unknown, amount: unknown, contributionCurrencyInput?: unknown) {
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

            let contributionAmount = Number(amount);
            if (!Number.isFinite(contributionAmount) || contributionAmount <= 0) {
                return {
                    success: false,
                    error: `Donation amount must be positive number, received: ${amount}`
                };
            }

            const goalCurrency = this.goalState[platformKey].currency;
            if (contributionCurrencyInput !== undefined && contributionCurrencyInput !== null) {
                let contributionCurrency = normalizeGoalCurrency(contributionCurrencyInput);
                if (platformKey === 'youtube' && goalCurrency === 'USD' && contributionCurrency !== goalCurrency) {
                    const converted = contributionCurrency !== 'XXX'
                        ? this.usdConverter?.(contributionAmount, contributionCurrency)
                        : undefined;
                    if (converted !== null && converted !== undefined && Number.isFinite(converted) && converted > 0) {
                        contributionAmount = converted;
                        contributionCurrency = goalCurrency;
                    }
                }
                if (contributionCurrency !== goalCurrency) {
                    return {
                        success: false,
                        error: `Donation currency ${contributionCurrency} does not match ${platform} goal currency ${goalCurrency}`,
                        skipped: true,
                        currency: contributionCurrency,
                        goalCurrency
                    };
                }
            }

            const oldCurrent = this.goalState[platformKey].current;
            const newCurrent = oldCurrent + contributionAmount;
            if (!Number.isFinite(newCurrent)) {
                return {
                    success: false,
                    error: 'Donation would exceed the finite goal balance range'
                };
            }
            this.goalState[platformKey].current = newCurrent;

            const target = this.goalState[platformKey].target;
            const displayCurrency = this.goalState[platformKey].currency;

            this.logger.debug(`${platform} goal updated: ${oldCurrent} → ${newCurrent} ${displayCurrency}`, 'goal-tracker');

            const formatted = this.formatGoalDisplay(platformKey);
            const percentage = target > 0 ? Math.round((newCurrent / target) * 100 * 10) / 10 : 0;
            const goalCompleted = newCurrent >= target;

            return {
                success: true,
                current: oldCurrent,
                newTotal: newCurrent,
                target,
                currency: displayCurrency,
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

    addPaypiggyToGoal(platform: unknown, count = 1) {
        try {
            if (typeof platform !== 'string') {
                return {
                    success: false,
                    error: `Invalid platform: ${platform}. Supported platforms: tiktok, youtube, twitch`
                };
            }

            const platformKey = platform.toLowerCase();
            const paypiggyCount = Number(count);
            if (!Number.isFinite(paypiggyCount) || !Number.isInteger(paypiggyCount) || paypiggyCount <= 0) {
                return {
                    success: false,
                    error: `Paypiggy count must be a positive integer, received: ${count}`
                };
            }
            let paypiggyAmount = 0;
            let paypiggyCurrency = '';

            switch (platformKey) {
                case 'tiktok':
                    paypiggyAmount = membershipNativeUnits(this.config.monetizationValues?.tiktokMembershipUsd, this.config.monetizationValues?.tiktokGiftUnitUsd);
                    paypiggyCurrency = 'coins';

                    break;
                case 'youtube':
                    paypiggyAmount = Number(this.config.monetizationValues?.youtubeMembershipUsd);
                    paypiggyCurrency = 'USD';

                    break;
                case 'twitch':
                    paypiggyAmount = membershipNativeUnits(this.config.monetizationValues?.twitchMembershipUsd, this.config.monetizationValues?.twitchBitUsd);
                    paypiggyCurrency = 'bits';

                    break;
                default:
                    return {
                        success: false,
                        error: `Invalid platform: ${platform}. Supported platforms: tiktok, youtube, twitch`
                    };
            }

            const result = this.addDonationToGoal(platform, paypiggyAmount * paypiggyCount, paypiggyCurrency);

            if (result.success) {
                return {
                    ...result,
                    paypiggyValue: paypiggyAmount,
                    paypiggyCount
                };
            }

            return result;
        } catch (error) {
            this._handleGoalTrackerError(`[Goal Tracker] Error adding paypiggy to ${platform} goal`, error, {
                platform,
                count
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
                return currency === 'USD'
                    ? `$${currentAmount.toFixed(2)}/$${targetAmount.toFixed(2)}`
                    : `${currentAmount.toFixed(2)}/${targetAmount.toFixed(2)} ${currency}`;
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
