const { safeDelay, validateTimeout } = require('../../../utils/timeout-validator');
const { extractHttpErrorDetails } = require('../../../utils/http-error-utils');
const { validateLoggerInterface } = require('../../../utils/dependency-validator');

function createTwitchEventSubSubscriptionManager(options = {}) {
    const {
        logger,
        authManager,
        config,
        subscriptions,
        axios: injectedAxios,
        getClientId,
        validateConnectionForSubscriptions,
        logError,
        now = () => Date.now()
    } = options;

    const axios = injectedAxios || require('axios');

    const safeLogger = (() => {
        const resolvedLogger = logger || global.__TEST_LOGGER__;
        if (!resolvedLogger) {
            throw new Error('TwitchEventSub subscription manager requires a logger dependency');
        }
        validateLoggerInterface(resolvedLogger);
        return resolvedLogger;
    })();
    const safeLogError = typeof logError === 'function' ? logError : () => {};
    const safeGetClientId = typeof getClientId === 'function' ? getClientId : () => null;
    const safeValidateConnection = typeof validateConnectionForSubscriptions === 'function'
        ? validateConnectionForSubscriptions
        : () => false;

    const parseSubscriptionError = (error, subscription) => {
        const httpDetails = extractHttpErrorDetails(error);

        if (error.response?.data) {
            const errorData = error.response.data;
            const errorCode = errorData.error;
            const errorMessage = errorData.message;

            const isCritical = ['Unauthorized', 'Forbidden'].includes(errorCode);
            const isRetryable = ['Too Many Requests', 'Internal Server Error'].includes(errorCode);

            return {
                code: errorCode,
                message: errorMessage,
                status: error.response.status,
                isCritical,
                isRetryable,
                details: httpDetails
            };
        }

        return {
            code: 'NETWORK_ERROR',
            message: httpDetails.message,
            status: null,
            isCritical: false,
            isRetryable: true,
            details: httpDetails
        };
    };

    const setupEventSubscriptions = async ({
        requiredSubscriptions,
        userId,
        sessionId,
        subscriptionDelay,
        isConnected,
        validationAlreadyDone = false
    }) => {
        if (!validationAlreadyDone && !safeValidateConnection()) {
            return null;
        }

        safeLogger.info('Setting up EventSub subscriptions', 'twitch');

        let successCount = 0;
        const failedSubscriptions = [];
        let lastValidationTime = now();

        for (const subscription of requiredSubscriptions) {
            try {
                const currentTime = now();
                if (currentTime - lastValidationTime > 5000 && !safeValidateConnection()) {
                    safeLogger.warn('Stopping subscription setup - connection lost during process', 'twitch');
                    break;
                }
                lastValidationTime = currentTime;

                safeLogger.debug(`Creating subscription: ${subscription.name}`, 'twitch');

                const subscriptionPayload = {
                    type: subscription.type,
                    version: subscription.version,
                    condition: subscription.getCondition(userId),
                    transport: {
                        method: 'websocket',
                        session_id: sessionId
                    }
                };

                safeLogger.debug(`Subscription payload for ${subscription.name}`, 'twitch', {
                    type: subscription.type,
                    hasSessionId: !!sessionId,
                    sessionId: sessionId?.substring(0, 8) + '...'
                });

                const response = await authManager.authState.executeWhenReady(async () => {
                    return await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', subscriptionPayload, {
                        headers: {
                            'Authorization': `Bearer ${await authManager.getAccessToken()}`,
                            'Client-Id': safeGetClientId(),
                            'Content-Type': 'application/json'
                        }
                    });
                });

                const subData = response.data.data[0];
                subscriptions.set(subData.id, {
                    ...subscription,
                    id: subData.id,
                    status: subData.status
                });

                safeLogger.info(`EventSub subscription created: ${subscription.name}`, 'twitch', {
                    id: subData.id,
                    type: subscription.type,
                    status: subData.status
                });

                successCount++;

                if (subscriptionDelay > 0) {
                    await safeDelay(
                        validateTimeout(subscriptionDelay, 1000),
                        1000,
                        'twitchEventSub:subscription-delay'
                    );
                }
            } catch (error) {
                const errorDetails = parseSubscriptionError(error, subscription);
                failedSubscriptions.push({
                    subscription: subscription.name,
                    error: errorDetails
                });

                safeLogError(`Failed to create ${subscription.name} subscription`, null, 'subscription-create', {
                    error: errorDetails,
                    type: subscription.type,
                    sessionId: sessionId ? 'present' : 'missing',
                    isConnected: !!isConnected
                });

                if (errorDetails.isCritical) {
                    safeLogError('Critical error encountered, stopping subscription setup', null, 'subscription-critical');
                    break;
                }
            }
        }

        if (failedSubscriptions.length > 0) {
            safeLogger.warn('EventSub subscription setup completed with failures', 'twitch', {
                successful: successCount,
                total: requiredSubscriptions.length,
                failures: failedSubscriptions
            });
        } else {
            safeLogger.info(`EventSub subscription setup complete: ${successCount}/${requiredSubscriptions.length} successful`, 'twitch');
        }

        return {
            successful: successCount,
            total: requiredSubscriptions.length,
            failures: failedSubscriptions,
            timestamp: now()
        };
    };

    const cleanupAllWebSocketSubscriptions = async () => {
        safeLogger.info('Starting cleanup method...', 'twitch');

        if (!config?.accessToken || !config?.clientId) {
            safeLogger.warn('Cannot cleanup WebSocket subscriptions - missing authentication tokens', 'twitch', {
                hasAccessToken: !!config?.accessToken,
                hasClientId: !!config?.clientId
            });
            return;
        }

        try {
            safeLogger.info('Cleaning up existing WebSocket subscriptions before connecting...', 'twitch');

            const response = await authManager.authState.executeWhenReady(async () => {
                return await axios.get('https://api.twitch.tv/helix/eventsub/subscriptions', {
                    headers: {
                        'Authorization': `Bearer ${await authManager.getAccessToken()}`,
                        'Client-Id': config.clientId
                    },
                    timeout: 5000
                });
            });

            const allSubscriptions = response.data.data;
            const webSocketSubscriptions = allSubscriptions.filter((sub) => sub.transport?.method === 'websocket');

            safeLogger.info(`Found ${webSocketSubscriptions.length} existing WebSocket subscriptions to clean up`, 'twitch');

            if (webSocketSubscriptions.length === 0) {
                safeLogger.info('No WebSocket subscriptions to clean up', 'twitch');
                return;
            }

            safeLogger.debug('WebSocket subscriptions to delete:', 'twitch');
            webSocketSubscriptions.forEach((sub, index) => {
                safeLogger.debug(`   ${index + 1}. ${sub.type} (${sub.status}) - ID: ${sub.id}`, 'twitch');
            });

            safeLogger.info('Deleting all WebSocket subscriptions...', 'twitch');
            let deleted = 0;

            for (const subscription of webSocketSubscriptions) {
                try {
                    await authManager.authState.executeWhenReady(async () => {
                        return await axios.delete(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${subscription.id}`, {
                            headers: {
                                'Authorization': `Bearer ${await authManager.getAccessToken()}`,
                                'Client-Id': config.clientId
                            }
                        });
                    });

                    safeLogger.debug(`   Deleted: ${subscription.type} (${subscription.id})`, 'twitch');
                    deleted++;

                    await safeDelay(
                        validateTimeout(100, 100),
                        100,
                        'twitchEventSub:heartbeat-delay'
                    );
                } catch (error) {
                    safeLogError(`   Failed to delete ${subscription.type}`, error, 'subscription-delete', {
                        id: subscription.id,
                        error: extractHttpErrorDetails(error)
                    });
                }
            }

            safeLogger.info(`WebSocket cleanup complete! Deleted ${deleted}/${webSocketSubscriptions.length} subscriptions`, 'twitch');
        } catch (error) {
            safeLogError('Failed to cleanup WebSocket subscriptions during initialization', error, 'websocket-cleanup', {
                error: extractHttpErrorDetails(error),
                willContinueAnyway: true
            });
        }
    };

    const deleteAllSubscriptions = async ({ sessionId } = {}) => {
        if (!config?.accessToken || !config?.clientId) {
            safeLogger.warn('Cannot delete subscriptions - missing authentication tokens', 'twitch');
            return;
        }

        try {
            safeLogger.info('Fetching existing EventSub subscriptions for cleanup...', 'twitch');

            const response = await authManager.authState.executeWhenReady(async () => {
                return await axios.get('https://api.twitch.tv/helix/eventsub/subscriptions', {
                    headers: {
                        'Authorization': `Bearer ${await authManager.getAccessToken()}`,
                        'Client-Id': config.clientId
                    }
                });
            });

            const allSubscriptions = response.data.data;
            safeLogger.info(`Found ${allSubscriptions.length} total subscriptions`, 'twitch');

            const ourSubscriptions = allSubscriptions.filter((sub) => {
                return sub.transport?.method === 'websocket'
                    && sub.transport?.session_id === sessionId;
            });

            safeLogger.info(`Found ${ourSubscriptions.length} subscriptions for our session`, 'twitch');

            if (ourSubscriptions.length === 0) {
                safeLogger.info('No subscriptions to clean up for this session', 'twitch');
                return;
            }

            safeLogger.info('Deleting EventSub subscriptions...', 'twitch');
            let deleted = 0;

            for (const subscription of ourSubscriptions) {
                try {
                    await authManager.authState.executeWhenReady(async () => {
                        return await axios.delete(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${subscription.id}`, {
                            headers: {
                                'Authorization': `Bearer ${await authManager.getAccessToken()}`,
                                'Client-Id': config.clientId
                            }
                        });
                    });

                    safeLogger.info(`   Deleted: ${subscription.type} (${subscription.id})`, 'twitch');
                    deleted++;
                    subscriptions.delete(subscription.id);

                    await safeDelay(
                        validateTimeout(100, 100),
                        100,
                        'twitchEventSub:rapid-retry-delay'
                    );
                } catch (error) {
                    safeLogError(`   Failed to delete ${subscription.type}`, error, 'subscription-delete', {
                        id: subscription.id,
                        error: extractHttpErrorDetails(error)
                    });
                }
            }

            safeLogger.info(`Subscription cleanup complete! Deleted ${deleted}/${ourSubscriptions.length} subscriptions`, 'twitch');
        } catch (error) {
            safeLogError('Failed to cleanup EventSub subscriptions', error, 'eventsub-cleanup', {
                error: extractHttpErrorDetails(error),
                hasAuth: !!config?.accessToken
            });
        }
    };

    return {
        setupEventSubscriptions,
        parseSubscriptionError,
        cleanupAllWebSocketSubscriptions,
        deleteAllSubscriptions
    };
}

module.exports = {
    createTwitchEventSubSubscriptionManager
};
