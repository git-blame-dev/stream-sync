const { describe, it, expect, beforeEach, afterEach } = require('bun:test');

const testClock = require('./test-clock');
const {
    validateUserGiftFlow,
    validateNotificationFlow,
    validateCrossPlatformBehavior,
    validateUserVisibleContent,
    validateGiftData,
    validateNotificationData,
    assessWorkflowQuality,
    expectValidDisplayedNotifications,
    expectSystemStateChanges,
    expectGracefulDegradation,
    expectBehaviorOutcome,
    expectConfigurationBehaviorChange,
    expectErrorRecoveryBehavior,
    createMockPlatform,
    createMockNotificationManager,
    setupAutomatedCleanup,
    expectValidNotification,
    expectNoTechnicalArtifacts,
    expectValidUserFeedback
} = require('./behavior-validation');

describe('behavior-validation helper behavior', () => {
    beforeEach(() => {
        testClock.reset();
    });

    afterEach(() => {
        testClock.useRealTime();
    });

    it('exports convenience re-exports used by downstream helper callers', () => {
        expect(typeof createMockPlatform).toBe('function');
        expect(typeof createMockNotificationManager).toBe('function');
        expect(typeof setupAutomatedCleanup).toBe('function');
    });

    it('validates successful and failing gift workflow scenarios with user-impact signals', async () => {
        const successResult = await validateUserGiftFlow(
            {
                processGift: async () => {
                    testClock.advance(25);
                    return {
                        notification: { displayMessage: 'Thanks test-user for 10 coins' },
                        displayed: true,
                        vfxTriggered: true,
                        obsUpdated: true
                    };
                }
            },
            { username: 'test-user', amount: 10, currency: 'coins' }
        );

        expect(successResult.success).toBe(true);
        expect(successResult.steps.giftReceived).toBe(true);
        expect(successResult.steps.notificationCreated).toBe(true);
        expect(successResult.steps.displayedToUser).toBe(true);
        expect(successResult.userImpact.visibleInStream).toBe(true);
        expect(successResult.performanceMetrics.duration).toBe(25);

        const partialFailure = await validateUserGiftFlow(
            {
                processGift: async () => ({
                    notification: { displayMessage: 'Thanks test-user for 5 coins' },
                    displayed: false,
                    vfxTriggered: false,
                    obsUpdated: false
                })
            },
            { username: 'test-user', amount: 5, currency: 'coins' }
        );

        expect(partialFailure.success).toBe(false);
        expect(partialFailure.userImpact.missedNotification).toBe(true);
        expect(partialFailure.userImpact.impactLevel).toBe('critical');

        const invalidContent = await validateUserGiftFlow(
            {
                processGift: async () => ({
                    notification: { displayMessage: 'undefined' },
                    displayed: true,
                    vfxTriggered: false,
                    obsUpdated: false
                })
            },
            { username: 'test-user', amount: 1, currency: 'coins' }
        );
        expect(invalidContent.success).toBe(false);
        expect(invalidContent.failureReason).toContain('technical artifact');

        const thrownFailure = await validateUserGiftFlow(
            {
                processGift: async () => {
                    throw new Error('gift processing failed');
                }
            },
            { username: 'test-user', amount: 1, currency: 'coins' }
        );
        expect(thrownFailure.success).toBe(false);
        expect(thrownFailure.failureReason).toBe('gift processing failed');
        expect(thrownFailure.userImpact.errorExperienced).toBe(true);
    });

    it('validates notification flow contracts including content and platform-specific fields', async () => {
        await expect(validateNotificationFlow('platform:unknown', {}, {})).rejects.toThrow(
            'Invalid notification type: platform:unknown'
        );

        const paypiggy = await validateNotificationFlow(
            'platform:paypiggy',
            {
                processNotification: async () => ({
                    processed: true,
                    displayed: true,
                    userNotified: true,
                    tier: 'gold',
                    notification: { displayMessage: 'test-user subscribed at gold tier' }
                })
            },
            { username: 'test-user' }
        );

        expect(paypiggy.success).toBe(true);
        expect(paypiggy.userExperience.wasNotified).toBe(true);
        expect(paypiggy.userExperience.displayWasVisible).toBe(true);
        expect(paypiggy.userExperience.contentWasValid).toBe(true);
        expect(paypiggy.platformSpecific.tier).toBe('gold');

        const invalidContent = await validateNotificationFlow(
            'platform:raid',
            {
                processNotification: async () => ({
                    processed: true,
                    displayed: true,
                    userNotified: true,
                    viewerCount: 42,
                    notification: { displayMessage: '{username}' }
                })
            },
            { username: 'test-user' }
        );
        expect(invalidContent.success).toBe(true);
        expect(invalidContent.userExperience.contentWasValid).toBe(false);
        expect(invalidContent.failureReason).toContain('Content validation failed');
        expect(invalidContent.platformSpecific.viewerCount).toBe(42);

        const thrown = await validateNotificationFlow(
            'platform:gift',
            {
                processNotification: async () => {
                    throw new Error('notification failure');
                }
            },
            { username: 'test-user' }
        );
        expect(thrown.success).toBe(false);
        expect(thrown.failureReason).toBe('notification failure');
        expect(thrown.userImpact.missedNotification).toBe(true);
    });

    it('validates cross-platform consistency and degradation outcomes', async () => {
        const singlePlatform = await validateCrossPlatformBehavior(
            {
                youtube: {
                    processEvent: async () => ({ userMessage: 'ok', displayTime: 100, priority: 'normal' })
                }
            },
            { type: 'event' }
        );
        expect(singlePlatform.success).toBe(true);
        expect(singlePlatform.workingPlatforms).toEqual(['youtube']);

        const withFailure = await validateCrossPlatformBehavior(
            {
                youtube: {
                    processEvent: async () => ({ userMessage: 'ok', displayTime: 100, priority: 'normal' })
                },
                twitch: {
                    processEvent: async () => {
                        throw new Error('twitch failure');
                    }
                }
            },
            { type: 'event' }
        );
        expect(withFailure.success).toBe(false);
        expect(withFailure.platformFailures).toContain('twitch');

        const consistent = await validateCrossPlatformBehavior(
            {
                youtube: {
                    processEvent: async () => ({ userMessage: 'hello', displayTime: 250, priority: 'high' })
                },
                twitch: {
                    processEvent: async () => ({ userMessage: 'hello', displayTime: 250, priority: 'high' })
                }
            },
            { type: 'event' }
        );
        expect(consistent.success).toBe(true);
        expect(consistent.inconsistencies).toHaveLength(0);

        const inconsistent = await validateCrossPlatformBehavior(
            {
                youtube: {
                    processEvent: async () => ({ userMessage: 'hello', displayTime: 250, priority: 'high' })
                },
                twitch: {
                    processEvent: async () => ({ userMessage: 'hi', displayTime: 400, priority: 'low' })
                }
            },
            { type: 'event' }
        );
        expect(inconsistent.success).toBe(false);
        expect(inconsistent.inconsistencies).toContain('userMessages');
        expect(inconsistent.inconsistencies).toContain('displayTiming');
        expect(inconsistent.inconsistencies).toContain('priorityHandling');
    });

    it('validates user-visible content and input data contracts', () => {
        expect(() => validateUserVisibleContent('Thanks test-user for the gift')).not.toThrow();
        expect(() => validateUserVisibleContent(123)).toThrow('User-visible content must be a string');
        expect(() => validateUserVisibleContent('undefined')).toThrow('technical artifact');
        expect(() => validateUserVisibleContent('{username}')).toThrow('template placeholders');
        expect(() => validateUserVisibleContent('TypeError: bad call')).toThrow('JavaScript error');
        expect(() => validateUserVisibleContent('   ')).toThrow('empty or whitespace-only');

        expect(() => validateGiftData(null)).toThrow('Gift data must be an object');
        expect(() => validateGiftData({ username: 'test-user', amount: 1 })).toThrow('missing required field: currency');
        expect(() => validateGiftData({ username: '', amount: 1, currency: 'coins' })).toThrow('valid username');
        expect(() => validateGiftData({ username: 'test-user', amount: 0, currency: 'coins' })).toThrow('positive number');
        expect(() => validateGiftData({ username: 'test-user', amount: 1, currency: '' })).toThrow('non-empty string');
        expect(() => validateGiftData({ username: 'test-user', amount: 1, currency: 'coins' })).not.toThrow();

        expect(() => validateNotificationData(null)).toThrow('Notification data must be an object');
        expect(() => validateNotificationData({ type: 'platform:gift' })).toThrow('missing required field: username');
        expect(() => validateNotificationData({ type: 'invalid', username: 'test-user' })).toThrow('Invalid notification type');
        expect(() => validateNotificationData({ type: 'platform:gift', username: '  ' })).toThrow('valid username');
        expect(() => validateNotificationData({ type: 'platform:gift', username: 'test-user' })).not.toThrow();
    });

    it('assesses workflow quality with scores and recommendations', () => {
        const excellent = assessWorkflowQuality({
            success: true,
            steps: { displayedToUser: true, vfxTriggered: true, obsIntegration: true },
            performanceMetrics: { duration: 50 },
            failureReason: null
        });

        expect(excellent.qualityGrade).toBe('A');
        expect(excellent.userExperienceScore).toBe(100);
        expect(excellent.performanceScore).toBe(100);
        expect(excellent.reliabilityScore).toBe(100);
        expect(excellent.recommendations).toHaveLength(0);

        const failing = assessWorkflowQuality({
            success: false,
            steps: { displayedToUser: false, vfxTriggered: false, obsIntegration: false },
            performanceMetrics: { duration: 700 },
            failureReason: 'critical failure'
        });

        expect(failing.qualityGrade).toBe('F');
        expect(failing.recommendations).toContain('Fix critical workflow failure');
        expect(failing.recommendations).toContain('Optimize performance - workflow taking too long');
        expect(failing.recommendations).toContain('Consider adding visual feedback for better user experience');
        expect(failing.recommendations).toContain('Ensure OBS integration for stream visibility');
    });

    it('validates displayed notifications and system-state change expectations', () => {
        expect(() => expectValidDisplayedNotifications(null)).toThrow('displayedNotifications must be an array');
        expect(() => expectValidDisplayedNotifications([], { minimumCount: 1 })).toThrow('Expected at least 1 displayed notifications');

        expect(() => expectValidDisplayedNotifications([{ visible: true }])).toThrow('missing user-visible content');
        expect(() => expectValidDisplayedNotifications([{ content: 'undefined', visible: true }])).toThrow('technical artifact');
        expect(() => expectValidDisplayedNotifications([{ content: 'clean', visible: false }], { mustBeVisible: true })).toThrow('should be visible');
        expect(() => expectValidDisplayedNotifications([{ content: 'clean', visible: true, priority: 'low' }], { priority: 'high' })).toThrow('priority mismatch');
        expect(() => expectValidDisplayedNotifications([{ content: 'Hello test-viewer', visible: true }], { mustContainUsername: true, username: 'missing-user' })).toThrow('contain username');
        expect(() => expectValidDisplayedNotifications([{ content: 'Amount 10', visible: true }], { mustContainAmount: true, amount: 20 })).toThrow('contain amount');

        expect(() => expectValidDisplayedNotifications([
            { content: 'Thanks test-user for 10 coins', visible: true, priority: 'high' }
        ], {
            minimumCount: 1,
            mustBeVisible: true,
            priority: 'high',
            mustContainUsername: true,
            username: 'test-user',
            mustContainAmount: true,
            amount: 10
        })).not.toThrow();

        expect(() => expectSystemStateChanges(null, {}, {})).toThrow('Both initialState and finalState are required');
        expect(() => expectSystemStateChanges({ count: 1 }, { count: 2 }, { count: 3 })).toThrow('State change mismatch for count');
        expect(() => expectSystemStateChanges({ count: 1 }, { count: 2 }, { count: () => false })).toThrow('State change validation failed for count');
        expect(() => expectSystemStateChanges(
            { count: 1, status: 'old' },
            { count: 2, status: 'new' },
            {
                count: (previous, next) => previous === 1 && next === 2,
                status: 'new'
            }
        )).not.toThrow();
    });

    it('validates graceful-degradation helper outcomes', async () => {
        const noError = await expectGracefulDegradation(async () => {}, { requireUserStability: true });
        expect(noError.systemStable).toBe(true);
        expect(noError.errorsHandled).toBe(true);

        const recovered = await expectGracefulDegradation(
            async () => {
                throw new Error('expected failure');
            },
            {
                getSystemState: () => ({ operational: true }),
                checkUserExperience: () => ({ isStable: true }),
                attemptRecovery: async () => {}
            }
        );
        expect(recovered.systemStabilityMaintained).toBe(true);
        expect(recovered.errorHandledGracefully).toBe(true);
        expect(recovered.recoverabilityAssessed).toBe(true);

        await expect(expectGracefulDegradation(
            async () => {
                throw new Error('expected failure');
            },
            {
                getSystemState: () => ({ operational: true }),
                checkUserExperience: () => ({ isStable: false }),
                requireUserStability: true
            }
        )).rejects.toThrow('User experience was negatively impacted');

        await expect(expectGracefulDegradation(
            async () => {
                throw new Error('expected failure');
            },
            {
                getSystemState: () => ({ operational: false })
            }
        )).rejects.toThrow('System stability not maintained');
    });

    it('validates behavior-outcome helper contracts and failure modes', async () => {
        const successful = await expectBehaviorOutcome(
            async () => ({ messages: ['test-result'] }),
            {
                maxExecutionTime: 5000,
                expectUserVisibleResults: true,
                extractUserResults: (result) => result.messages,
                validateUserResults: (results) => {
                    if (!Array.isArray(results) || results.length === 0) {
                        throw new Error('expected user results');
                    }
                },
                validateOutcome: (result) => result.messages[0] === 'test-result'
            }
        );
        expect(successful.behaviorExecuted).toBe(true);
        expect(successful.outcomesMatched).toBe(true);
        expect(successful.performanceWithinLimits).toBe(true);

        await expect(expectBehaviorOutcome(
            async () => {
                throw new Error('expected error branch');
            },
            {
                expectError: true,
                validateError: (error) => error.message.includes('expected')
            }
        )).rejects.toThrow('Behavior execution exceeded time limit');

        await expect(expectBehaviorOutcome(
            async () => ({ value: 1 }),
            {
                maxExecutionTime: 5000,
                validateOutcome: () => false
            }
        )).rejects.toThrow('Behavior outcomes did not match expectations');

        await expect(expectBehaviorOutcome(
            async () => {
                for (let i = 0; i < 1000000; i += 1) {
                    void i;
                }
                return { value: 'done' };
            },
            {
                maxExecutionTime: -1,
                validateOutcome: () => true
            }
        )).rejects.toThrow('Behavior execution exceeded time limit');
    });

    it('validates configuration-change and recovery helper behavior', async () => {
        const setConfig = {
            value: 'old',
            set(key, nextValue) {
                this[key] = nextValue;
            }
        };
        const setChange = await expectConfigurationBehaviorChange(
            setConfig,
            'value',
            'new',
            async () => ({ currentValue: setConfig.value })
        );
        expect(setChange.initialState.currentValue).toBe('old');
        expect(setChange.finalState.currentValue).toBe('new');

        const updateConfig = {
            value: 'old',
            update(key, nextValue) {
                this[key] = nextValue;
            }
        };
        const updateChange = await expectConfigurationBehaviorChange(
            updateConfig,
            'value',
            'updated',
            async () => ({ currentValue: updateConfig.value })
        );
        expect(updateChange.finalState.currentValue).toBe('updated');

        await expect(expectConfigurationBehaviorChange(
            {},
            'value',
            'new',
            async () => ({ currentValue: 'old' })
        )).rejects.toThrow('must have set() or update() method');

        const unchangedConfig = {
            value: 'constant',
            set() {}
        };
        await expect(expectConfigurationBehaviorChange(
            unchangedConfig,
            'value',
            'constant',
            async () => ({ currentValue: 'constant' })
        )).rejects.toThrow('did not affect system behavior');

        const noRecoveryNeeded = await expectErrorRecoveryBehavior(
            async () => {},
            { getSystemState: () => ({ status: 'operational' }) }
        );
        expect(noRecoveryNeeded.operationAttempted).toBe(true);
        expect(noRecoveryNeeded.errorOccurred).toBe(false);
        expect(noRecoveryNeeded.finalSystemState.status).toBe('operational');

        const recovered = await expectErrorRecoveryBehavior(
            async () => {
                throw new Error('transient failure');
            },
            {
                getSystemState: () => ({ status: 'recovering' }),
                requireRecovery: true
            }
        );
        expect(recovered.errorOccurred).toBe(true);
        expect(recovered.recoverySuccessful).toBe(true);

        await expect(expectErrorRecoveryBehavior(
            async () => {
                throw new Error('persistent failure');
            },
            {
                getSystemState: () => ({ status: 'failed' }),
                requireRecovery: true
            }
        )).rejects.toThrow('did not recover gracefully');
    });

    it('validates additional user-facing helper assertions', () => {
        const notification = expectValidNotification({ displayMessage: 'Hello test-user' });
        expect(notification.displayMessage).toBe('Hello test-user');
        expect(() => expectValidNotification({})).toThrow();

        expect(expectNoTechnicalArtifacts('Clean test output')).toBe('Clean test output');
        expect(expectNoTechnicalArtifacts('')).toBeUndefined();
        expect(expectNoTechnicalArtifacts(null)).toBeUndefined();
        expect(() => expectNoTechnicalArtifacts('undefined value')).toThrow();
        expect(() => expectNoTechnicalArtifacts('function call')).toThrow();

        expect(() => expectValidUserFeedback()).toThrow('User feedback is required');
        expect(() => expectValidUserFeedback(100)).toThrow('must be a string');
        expect(() => expectValidUserFeedback('ok')).toThrow('too short to be meaningful');
        expect(() => expectValidUserFeedback('Routine acknowledgement text')).toThrow('user-relevant information');
        expect(expectValidUserFeedback('The streamer displayed a visual command success message')).toContain('visual command success');
    });
});
