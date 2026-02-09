
const fs = require('fs');
const { createPlatformErrorHandler } = require('./platform-error-handler');

class GoalTracker {
    constructor(dependencies = {}) {
        this.logger = dependencies.logger || require('../core/logging').logger;
        this.config = dependencies.config || require('../core/config').config;
        this.fileSystem = dependencies.fileSystem || fs;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'goal-tracker');

        this.goalState = {
    tiktok: { current: 0, target: 1000, currency: 'coins' },
    youtube: { current: 0.00, target: 1.00, currency: 'dollars' },
    twitch: { current: 0, target: 100, currency: 'bits' }
};
    }

    initializeGoalTracker() {
    try {
            this.logger.debug('Initializing goal tracking system...', 'goal-tracker');
        
            this.goalState = {
            tiktok: { current: 0, target: 1000, currency: 'coins' },
            youtube: { current: 0.00, target: 1.00, currency: 'dollars' },
            twitch: { current: 0, target: 100, currency: 'bits' }
        };

            if (this.config.goals.tiktokGoalEnabled) {
                this.goalState.tiktok.target = this.config.goals.tiktokGoalTarget;
                this.goalState.tiktok.currency = this.config.goals.tiktokGoalCurrency;
        }
        
            if (this.config.goals.youtubeGoalEnabled) {
                this.goalState.youtube.target = this.config.goals.youtubeGoalTarget;
                this.goalState.youtube.currency = this.config.goals.youtubeGoalCurrency;
        }
        
            if (this.config.goals.twitchGoalEnabled) {
                this.goalState.twitch.target = this.config.goals.twitchGoalTarget;
                this.goalState.twitch.currency = this.config.goals.twitchGoalCurrency;
        }
        
            this.logger.debug('Goal tracking system initialized successfully', 'goal-tracker');
            this.logger.debug(`Current state: twitch=${this.goalState.twitch.current}/${this.goalState.twitch.target} ${this.goalState.twitch.currency}, youtube=${this.goalState.youtube.current}/${this.goalState.youtube.target} ${this.goalState.youtube.currency}`, 'goal-tracker');
        
    } catch (error) {
            this._handleGoalTrackerError('[Goal Tracker] Error initializing goal tracker', error, {
                method: 'initializeGoalTracker'
            });
        throw error;
    }
}

    addDonationToGoal(platform, amount) {
    try {
        if (!platform || typeof platform !== 'string') {
            return {
                success: false,
                error: `Invalid platform: ${platform}. Supported platforms: tiktok, youtube, twitch`
            };
        }

        const platformKey = platform.toLowerCase();

            if (!this.goalState[platformKey]) {
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
            target: target,
            currency: currency,
            formatted: formatted,
            percentage: percentage,
            goalCompleted: goalCompleted
        };
        
    } catch (error) {
            this._handleGoalTrackerError(`[Goal Tracker] Error adding donation to ${platform} goal`, error, {
                platform,
                amount
            });
        return {
            success: false,
            error: `Failed to add donation: ${error.message}`
        };
    }
}

    addPaypiggyToGoal(platform) {
    try {
        if (!platform || typeof platform !== 'string') {
            return {
                success: false,
                error: `Invalid platform: ${platform}. Supported platforms: tiktok, youtube, twitch`
            };
        }

        const platformKey = platform.toLowerCase();
        let paypiggyAmount = 0;
        
        switch (platformKey) {
            case 'tiktok':
                    paypiggyAmount = this.config.goals.tiktokPaypiggyEquivalent;
                    this.logger.debug(`Converting TikTok paypiggy to ${paypiggyAmount} coins`, 'goal-tracker');
                break;
                
            case 'youtube':
                    paypiggyAmount = this.config.goals.youtubePaypiggyPrice;
                    this.logger.debug(`Converting YouTube paypiggy to $${paypiggyAmount}`, 'goal-tracker');
                break;
                
            case 'twitch':
                    paypiggyAmount = this.config.goals.twitchPaypiggyEquivalent;
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
            result.paypiggyValue = paypiggyAmount;
        }
        
        return result;
        
    } catch (error) {
            this._handleGoalTrackerError(`[Goal Tracker] Error adding paypiggy to ${platform} goal`, error, {
                platform
            });
        return {
            success: false,
            error: `Failed to add paypiggy: ${error.message}`
        };
    }
}

    formatGoalDisplay(platform, current, target) {
    const platformKey = platform.toLowerCase();
        const state = this.goalState[platformKey];
    
    if (!state && (current === undefined || target === undefined)) {
        return `0/0 unknown`;
    }
    
    const currentAmount = Number(current !== undefined ? current : (state ? state.current : 0));
    const targetAmount = Number(target !== undefined ? target : (state ? state.target : 0));
    const currency = state ? state.currency : 'unknown';
    
    const padNumber = (num, targetNum) => {
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

    getGoalState(platform) {
    const platformKey = platform.toLowerCase();
        const state = this.goalState[platformKey];
    
    if (!state) {
        return null;
    }
    
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
}

function createGoalTracker(dependencies) {
    return new GoalTracker(dependencies);
}

module.exports = {
    GoalTracker,
    createGoalTracker
}; 

GoalTracker.prototype._handleGoalTrackerError = function(message, error, contextData = null) {
    if (!this.errorHandler && this.logger) {
        this.errorHandler = createPlatformErrorHandler(this.logger, 'goal-tracker');
    }

    if (this.errorHandler && error instanceof Error) {
        this.errorHandler.handleEventProcessingError(error, 'goal-tracker', contextData, message, 'goal-tracker');
        return;
    }

    if (this.errorHandler) {
        this.errorHandler.logOperationalError(message, 'goal-tracker', contextData);
    }
};
