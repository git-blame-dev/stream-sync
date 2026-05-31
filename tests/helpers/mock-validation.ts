import { expect } from 'bun:test';

import testClock from './test-clock';
import { isMockFunction } from './bun-mock-utils';

type UnknownRecord = Record<string, unknown>;

type MethodSignature = {
    params: readonly string[];
    returns: string;
};

type ApiContract = {
    requiredMethods: readonly string[];
    methodSignatures: Record<string, MethodSignature>;
    requiredReturnFields?: readonly string[];
};

type MockContractValidation = {
    success: boolean;
    errors: string[];
    warnings: string[];
    mockType: string;
    contractName: string;
};

type NotificationValidation = {
    success: boolean;
    errors: string[];
    warnings: string[];
    dataType: 'NotificationData';
};

type PlatformEventValidation = {
    success: boolean;
    errors: string[];
    warnings: string[];
    platform: string;
    eventType: string;
};

type MockSpec = {
    contractName: string;
    mock: unknown;
};

type MockSuiteResult = MockContractValidation;

type MockSuiteValidation = {
    overallSuccess: boolean;
    totalMocksValidated: number;
    totalErrors: number;
    totalWarnings: number;
    results: MockSuiteResult[];
    summary: string;
};

type ValidationHistoryEntry = {
    timestamp: number;
    report: MockSuiteValidation;
};

type MatcherResult = {
    pass: boolean;
    message: () => string;
};

declare global {
    var validateMock: ((mockObject: unknown, contractName: string) => MockContractValidation) | undefined;
    var validateNotification: ((notificationData: unknown) => NotificationValidation) | undefined;
    var validatePlatformEvent: ((eventData: unknown, platform: string, eventType: string) => PlatformEventValidation) | undefined;
}

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
} as const satisfies Record<string, ApiContract>;

type ApiContractName = keyof typeof API_CONTRACTS;

const hasOwn = (value: UnknownRecord, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value: unknown): value is UnknownRecord => {
    return typeof value === 'object' && value !== null;
};

const getMockType = (mockObject: unknown): string => {
    if (!isRecord(mockObject)) {
        return 'Unknown';
    }

    const mockType = mockObject._mockType;
    return typeof mockType === 'string' ? mockType : 'Unknown';
};

const isApiContractName = (contractName: string): contractName is ApiContractName => {
    return contractName in API_CONTRACTS;
};

const validateMockContract = (mockObject: unknown, contractName: string): MockContractValidation => {
    if (!isApiContractName(contractName)) {
        return {
            success: false,
            errors: [`Unknown API contract: ${contractName}`],
            warnings: [],
            mockType: getMockType(mockObject),
            contractName
        };
    }

    const contract = API_CONTRACTS[contractName];
    const errors: string[] = [];
    const warnings: string[] = [];
    const mockRecord = isRecord(mockObject) ? mockObject : {};

    contract.requiredMethods.forEach((methodName) => {
        if (!hasOwn(mockRecord, methodName)) {
            errors.push(`Missing required method: ${methodName}`);
            return;
        }

        if (!isMockFunction(mockRecord[methodName])) {
            warnings.push(`Method ${methodName} is not a mock function`);
        }
    });

    const mockType = getMockType(mockObject);
    if (mockType !== contractName) {
        warnings.push(`Mock type annotation mismatch. Expected: ${contractName}, Got: ${mockType}`);
    }

    return {
        success: errors.length === 0,
        errors,
        warnings,
        mockType,
        contractName
    };
};

const validateNotificationData = (notificationData: unknown): NotificationValidation => {
    const contract = API_CONTRACTS.NotificationBuilder;
    const errors: string[] = [];
    const warnings: string[] = [];
    const notificationRecord = isRecord(notificationData) ? notificationData : {};

    contract.requiredReturnFields.forEach((field) => {
        if (!hasOwn(notificationRecord, field)) {
            errors.push(`Missing required notification field: ${field}`);
        }
    });

    if (notificationRecord.id && typeof notificationRecord.id !== 'string') {
        errors.push('Notification ID must be a string');
    }

    if (notificationRecord.type && typeof notificationRecord.type !== 'string') {
        errors.push('Notification type must be a string');
    }

    if (notificationRecord.platform && !['youtube', 'twitch', 'tiktok'].includes(String(notificationRecord.platform))) {
        warnings.push(`Unknown platform: ${notificationRecord.platform}`);
    }

    if (notificationRecord.processedAt && !Number.isInteger(notificationRecord.processedAt)) {
        errors.push('processedAt must be a timestamp integer');
    }

    if (notificationRecord.timestamp && isNaN(Date.parse(String(notificationRecord.timestamp)))) {
        errors.push('timestamp must be a valid ISO date string');
    }

    return {
        success: errors.length === 0,
        errors,
        warnings,
        dataType: 'NotificationData'
    };
};

const validatePlatformEventData = (eventData: unknown, platform: string, eventType: string): PlatformEventValidation => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const platformRules: Record<string, Record<string, readonly string[]>> = {
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

    rules.forEach((fieldPath) => {
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

const hasNestedProperty = (obj: unknown, path: string): boolean => {
    let current = obj;

    for (const key of path.split('.')) {
        if (!isRecord(current) || !hasOwn(current, key)) {
            return false;
        }

        current = current[key];
    }

    return current !== null && current !== undefined;
};

const validateMockSuite = (mockSpecs: MockSpec[]): MockSuiteValidation => {
    const results: MockSuiteResult[] = mockSpecs.map((spec) => ({
        ...validateMockContract(spec.mock, spec.contractName),
        contractName: spec.contractName
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

const generateValidationSummary = (validationResults: MockSuiteResult[]): string => {
    const successful = validationResults.filter((result) => result.success).length;
    const failed = validationResults.filter((result) => !result.success).length;

    let summary = `Mock Validation Summary:\n`;
    summary += `Successful: ${successful}\n`;
    summary += `Failed: ${failed}\n\n`;

    if (failed > 0) {
        summary += `Failed Validations:\n`;
        validationResults
            .filter((result) => !result.success)
            .forEach((result) => {
                summary += `  ${result.contractName}: ${result.errors.join(', ')}\n`;
            });
    }

    const allWarnings = validationResults.flatMap((result) => result.warnings);
    if (allWarnings.length > 0) {
        summary += `\nWarnings:\n`;
        allWarnings.forEach((warning) => {
            summary += `  Warning: ${warning}\n`;
        });
    }

    return summary;
};

const toMatchContract = function (mockObject: unknown, contractName: string): MatcherResult {
    const result = validateMockContract(mockObject, contractName);

    return {
        pass: result.success,
        message: () => {
            if (result.success) {
                return `Expected mock not to match ${contractName} contract`;
            }

            return `Mock failed ${contractName} contract validation:\n${result.errors.join('\n')}`;
        }
    };
};

const setupMockValidation = () => {
    expect.extend({
        toMatchContract
    });

    globalThis.validateMock = validateMockContract;
    globalThis.validateNotification = validateNotificationData;
    globalThis.validatePlatformEvent = validatePlatformEventData;
};

class MockContractMonitor {
    private registeredMocks: Map<string, MockSpec>;
    private validationHistory: ValidationHistoryEntry[];

    constructor() {
        this.registeredMocks = new Map();
        this.validationHistory = [];
    }

    registerMock(name: string, mock: unknown, contractName: string): void {
        this.registeredMocks.set(name, { mock, contractName });
    }

    validateAll(): MockSuiteValidation {
        const mockSpecs = Array.from(this.registeredMocks.values());
        const report = validateMockSuite(mockSpecs);

        this.validationHistory.push({
            timestamp: testClock.now(),
            report
        });

        return report;
    }

    getValidationHistory(): ValidationHistoryEntry[] {
        return this.validationHistory;
    }

    reset(): void {
        this.registeredMocks.clear();
        this.validationHistory = [];
    }
}

export {
    type MockContractValidation,
    type NotificationValidation,
    type PlatformEventValidation,
    type MockSuiteResult,
    type MockSuiteValidation,

    validateMockContract,
    validateNotificationData,
    validatePlatformEventData,

    validateMockSuite,
    generateValidationSummary,

    setupMockValidation,
    toMatchContract,

    MockContractMonitor,

    API_CONTRACTS
};
