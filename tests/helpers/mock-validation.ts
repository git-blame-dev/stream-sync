
// ================================================================================================
// API CONTRACT DEFINITIONS
// ================================================================================================

const testClock = require('./test-clock');
const { isMockFunction } = require('./bun-mock-utils');

const API_CONTRACTS = {
    NotificationDispatcher: {
        requiredMethods: [
            'dispatchSuperChat',
            'dispatchMembership',
            'dispatchGiftMembership',
            'dispatchSuperSticker',
            'dispatchFollow',
            'dispatchRaid',
            'dispatchMessage'
        ],
        methodSignatures: {
            dispatchSuperChat: { params: ['chatItem', 'handlers'], returns: 'Promise<boolean>' },
            dispatchMembership: { params: ['chatItem', 'handlers'], returns: 'Promise<boolean>' },
            dispatchGiftMembership: { params: ['chatItem', 'handlers'], returns: 'Promise<boolean>' },
            dispatchSuperSticker: { params: ['chatItem', 'handlers'], returns: 'Promise<boolean>' },
            dispatchFollow: { params: ['eventData', 'handlers'], returns: 'Promise<boolean>' },
            dispatchRaid: { params: ['eventData', 'handlers'], returns: 'Promise<boolean>' },
            dispatchMessage: { params: ['messageData', 'handlers'], returns: 'Promise<boolean>' }
        }
    },

    NotificationBuilder: {
        requiredMethods: ['build'],
        methodSignatures: {
            build: { params: ['notificationData'], returns: 'Object' }
        },
        requiredReturnFields: [
            'id', 'type', 'platform', 'user', 'displayMessage', 
            'ttsMessage', 'logMessage', 'processedAt', 'timestamp'
        ]
    },

    NotificationManager: {
        requiredMethods: [
            'handleNotification',
            'handleGiftNotification',
            'handleFollowNotification',
            'handlePaypiggyNotification',
            'handleRaidNotification',
            'handleChatMessage'
        ],
        methodSignatures: {
            handleNotification: { params: ['notificationData'], returns: 'Promise<boolean>' },
            handleGiftNotification: { params: ['giftData'], returns: 'Promise<boolean>' },
            handleFollowNotification: { params: ['followData'], returns: 'Promise<boolean>' },
            handlePaypiggyNotification: { params: ['subData'], returns: 'Promise<boolean>' },
            handleRaidNotification: { params: ['raidData'], returns: 'Promise<boolean>' },
            handleChatMessage: { params: ['messageData'], returns: 'Promise<boolean>' }
        }
    },

    OBSManager: {
        requiredMethods: [
            'isConnected', 'connect', 'disconnect', 'call',
            'addEventListener', 'removeEventListener',
            'setCurrentScene', 'getCurrentScene', 'getSceneList',
            'setTextSource', 'getSourceSettings', 'setSourceVisibility',
            'triggerMediaSource', 'setMediaSource',
            'setFilterEnabled', 'getFilterList'
        ],
        methodSignatures: {
            isConnected: { params: [], returns: 'boolean' },
            connect: { params: [], returns: 'Promise<boolean>' },
            disconnect: { params: [], returns: 'Promise<boolean>' },
            call: { params: ['method', 'params'], returns: 'Promise<Object>' },
            setCurrentScene: { params: ['sceneName'], returns: 'Promise<boolean>' },
            setTextSource: { params: ['sourceName', 'text'], returns: 'Promise<boolean>' }
        }
    },

    RetrySystem: {
        requiredMethods: [
            'executeWithRetry',
            'resetRetryCount',
            'handleConnectionError',
            'incrementRetryCount',
            'getRetryCount'
        ],
        methodSignatures: {
            executeWithRetry: { params: ['platform', 'function'], returns: 'Promise<any>' },
            resetRetryCount: { params: [], returns: 'void' },
            handleConnectionError: { params: ['error', 'platform'], returns: 'void' },
            incrementRetryCount: { params: [], returns: 'number' },
            getRetryCount: { params: [], returns: 'number' }
        }
    },

    Logger: {
        requiredMethods: ['debug', 'info', 'warn', 'error'],
        methodSignatures: {
            debug: { params: ['message', 'platform?', 'data?'], returns: 'void' },
            info: { params: ['message', 'platform?', 'data?'], returns: 'void' },
            warn: { params: ['message', 'platform?', 'data?'], returns: 'void' },
            error: { params: ['message', 'platform?', 'data?'], returns: 'void' }
        }
    },

    Application: {
        requiredMethods: [
            'handleChatMessage',
            'handleGiftNotification',
            'handleFollowNotification',
            'handlePaypiggyNotification',
            'handleRaidNotification',
            'handlePaypiggyNotification',
            'updateViewerCount'
        ],
        methodSignatures: {
            handleChatMessage: { params: ['platform', 'messageData'], returns: 'Promise<boolean>' },
            handleGiftNotification: { params: ['platform', 'giftData'], returns: 'Promise<boolean>' },
            handleFollowNotification: { params: ['platform', 'followData'], returns: 'Promise<boolean>' },
            updateViewerCount: { params: ['platform', 'count'], returns: 'Promise<boolean>' }
        }
    }
};

// ================================================================================================
// VALIDATION FUNCTIONS
// ================================================================================================

const validateMockContract = (mockObject, contractName) => {
    const contract = API_CONTRACTS[contractName];
    if (!contract) {
        return {
            success: false,
            errors: [`Unknown API contract: ${contractName}`],
            warnings: [],
            mockType: mockObject._mockType || 'Unknown'
        };
    }

    const errors = [];
    const warnings = [];

    // Validate required methods exist
    contract.requiredMethods.forEach(methodName => {
        if (!mockObject.hasOwnProperty(methodName)) {
            errors.push(`Missing required method: ${methodName}`);
        } else if (!isMockFunction(mockObject[methodName])) {
            warnings.push(`Method ${methodName} is not a mock function`);
        }
    });

    // Validate mock type annotation
    if (mockObject._mockType !== contractName) {
        warnings.push(`Mock type annotation mismatch. Expected: ${contractName}, Got: ${mockObject._mockType}`);
    }

    return {
        success: errors.length === 0,
        errors,
        warnings,
        mockType: mockObject._mockType || 'Unknown',
        contractName
    };
};

const validateNotificationData = (notificationData) => {
    const contract = API_CONTRACTS.NotificationBuilder;
    const errors = [];
    const warnings = [];

    // Check required fields
    contract.requiredReturnFields.forEach(field => {
        if (!notificationData.hasOwnProperty(field)) {
            errors.push(`Missing required notification field: ${field}`);
        }
    });

    // Validate field types and formats
    if (notificationData.id && typeof notificationData.id !== 'string') {
        errors.push('Notification ID must be a string');
    }

    if (notificationData.type && typeof notificationData.type !== 'string') {
        errors.push('Notification type must be a string');
    }

    if (notificationData.platform && !['youtube', 'twitch', 'tiktok'].includes(notificationData.platform)) {
        warnings.push(`Unknown platform: ${notificationData.platform}`);
    }

    if (notificationData.processedAt && !Number.isInteger(notificationData.processedAt)) {
        errors.push('processedAt must be a timestamp integer');
    }

    if (notificationData.timestamp && isNaN(Date.parse(notificationData.timestamp))) {
        errors.push('timestamp must be a valid ISO date string');
    }

    return {
        success: errors.length === 0,
        errors,
        warnings,
        dataType: 'NotificationData'
    };
};

const validatePlatformEventData = (eventData, platform, eventType) => {
    const errors = [];
    const warnings = [];

    // Platform-specific validation rules
    const platformRules = {
        youtube: {
            chat: ['item.type', 'item.message', 'item.authorDetails'],
            gift: ['item.type', 'item.purchase_amount', 'item.message'],
            membership: ['item.type', 'item.membershipGiftingDetails', 'item.authorDetails']
        },
        twitch: {
            chat: ['username', 'message', 'userInfo'],
            follow: ['event.user_name', 'event.followed_at'],
            subscription: ['event.user_name', 'event.tier', 'event.is_gift']
        },
        tiktok: {
            chat: ['comment', 'user'],
            gift: ['gift', 'user', 'giftCount'],
            follow: ['user', 'followRole']
        }
    };

    const rules = platformRules[platform]?.[eventType];
    if (!rules) {
        warnings.push(`No validation rules defined for ${platform}:${eventType}`);
        return { success: true, errors, warnings, platform, eventType };
    }

    // Check required fields using dot notation
    rules.forEach(fieldPath => {
        if (!hasNestedProperty(eventData, fieldPath)) {
            errors.push(`Missing required field: ${fieldPath}`);
        }
    });

    return {
        success: errors.length === 0,
        errors,
        warnings,
        platform,
        eventType
    };
};

const hasNestedProperty = (obj, path) => {
    return path.split('.').reduce((current, key) => {
        return current && current.hasOwnProperty(key) ? current[key] : null;
    }, obj) !== null;
};

// ================================================================================================
// BATCH VALIDATION FUNCTIONS
// ================================================================================================

const validateMockSuite = (mockSpecs) => {
    const results = mockSpecs.map(spec => ({
        contractName: spec.contractName,
        ...validateMockContract(spec.mock, spec.contractName)
    }));

    const totalErrors = results.reduce((sum, result) => sum + result.errors.length, 0);
    const totalWarnings = results.reduce((sum, result) => sum + result.warnings.length, 0);

    return {
        overallSuccess: totalErrors === 0,
        totalMocksValidated: results.length,
        totalErrors,
        totalWarnings,
        results,
        summary: generateValidationSummary(results)
    };
};

const generateValidationSummary = (validationResults) => {
    const successful = validationResults.filter(r => r.success).length;
    const failed = validationResults.filter(r => !r.success).length;
    
    let summary = `Mock Validation Summary:\n`;
    summary += `Successful: ${successful}\n`;
    summary += `Failed: ${failed}\n\n`;

    if (failed > 0) {
        summary += `Failed Validations:\n`;
        validationResults
            .filter(r => !r.success)
            .forEach(result => {
                summary += `  ${result.contractName}: ${result.errors.join(', ')}\n`;
            });
    }

    const allWarnings = validationResults.flatMap(r => r.warnings);
    if (allWarnings.length > 0) {
        summary += `\nWarnings:\n`;
        allWarnings.forEach(warning => {
            summary += `  Warning: ${warning}\n`;
        });
    }

    return summary;
};

// ================================================================================================
// AUTOMATED VALIDATION HELPERS
// ================================================================================================

const toMatchContract = function(mockObject, contractName) {
    const result = validateMockContract(mockObject, contractName);
    
    return {
        pass: result.success,
        message: () => {
            if (result.success) {
                return `Expected mock not to match ${contractName} contract`;
            } else {
                return `Mock failed ${contractName} contract validation:\n${result.errors.join('\n')}`;
            }
        }
    };
};

const setupMockValidation = () => {
    // Extend test matchers
    expect.extend({
        toMatchContract
    });

    // Add global validation helper
    global.validateMock = validateMockContract;
    global.validateNotification = validateNotificationData;
    global.validatePlatformEvent = validatePlatformEventData;
};

// ================================================================================================
// CONTINUOUS VALIDATION SYSTEM
// ================================================================================================

class MockContractMonitor {
    constructor() {
        this.registeredMocks = new Map();
        this.validationHistory = [];
    }

    registerMock(name, mock, contractName) {
        this.registeredMocks.set(name, { mock, contractName, registeredAt: testClock.now() });
    }

    validateAll() {
        const mockSpecs = Array.from(this.registeredMocks.values());
        const report = validateMockSuite(mockSpecs);
        
        this.validationHistory.push({
            timestamp: testClock.now(),
            report
        });

        return report;
    }

    getValidationHistory() {
        return this.validationHistory;
    }

    reset() {
        this.registeredMocks.clear();
        this.validationHistory = [];
    }
}

// ================================================================================================
// EXPORTS
// ================================================================================================

module.exports = {
    // Core validation functions
    validateMockContract,
    validateNotificationData,
    validatePlatformEventData,
    
    // Batch validation
    validateMockSuite,
    generateValidationSummary,
    
    // Test runner integration
    setupMockValidation,
    toMatchContract,
    
    // Continuous monitoring
    MockContractMonitor,
    
    // API contracts (for reference)
    API_CONTRACTS
};
