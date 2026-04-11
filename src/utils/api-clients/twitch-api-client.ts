import { getUnifiedLogger } from '../../core/logging';
import { secrets } from '../../core/secrets';
import { createEnhancedHttpClient } from '../enhanced-http-client';
import { createRetrySystem } from '../retry-system';
import { createPlatformErrorHandler } from '../platform-error-handler';

class TwitchApiClient {
    constructor(twitchAuth, config = {}, logger = null, dependencies = {}) {
        this.twitchAuth = twitchAuth;
        this.config = config;
        this.logger = logger || getUnifiedLogger();
        this.errorHandler = createPlatformErrorHandler(this.logger, 'twitch-api');
        this.httpClient = dependencies.enhancedHttpClient || createEnhancedHttpClient({
            logger: this.logger,
            retrySystem: dependencies.retrySystem || createRetrySystem({ logger: this.logger })
        });
        this.baseUrl = 'https://api.twitch.tv/helix';
    }

    async makeRequest(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;

        const executeRequest = async () => {
            const accessToken = secrets.twitch.accessToken;
            if (!accessToken) {
                throw new Error('No access token available for Twitch API');
            }

            const requestOptions = {
                ...options,
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Client-Id': this.config.clientId,
                    ...options.headers
                }
            };

            return this.httpClient.get(url, {
                authToken: accessToken,
                authType: 'app',
                clientId: this.config.clientId,
                ...requestOptions
            });
        };

        this.logger.debug(`Making Twitch API request: ${url}`, 'twitch-api');

        try {
            const response = await executeRequest();
            this.logger.debug(`Twitch API response received`, 'twitch-api');
            return response.data;
        } catch (error) {
            const isAuthError = error?.response?.status === 401;
            if (!isAuthError || !this.twitchAuth) {
                throw error;
            }

            this.logger.info('Received 401 from Twitch API, refreshing token and retrying once', 'twitch-api');
            try {
                const refreshed = await this.twitchAuth.refreshTokens();
                if (!refreshed) {
                    throw error;
                }
                const retryResponse = await executeRequest();
                this.logger.debug('Twitch API retry after refresh succeeded', 'twitch-api');
                return retryResponse.data;
            } catch (retryError) {
                this.logger.warn('Twitch API retry after refresh failed', 'twitch-api', {
                    error: retryError.message
                });
                throw retryError;
            }
        }
    }

    async getStreamInfo(channelName) {
        try {
            const data = await this.makeRequest(`/streams?user_login=${channelName}`);
            
            if (data.data && data.data.length > 0) {
                return {
                    isLive: true,
                    stream: data.data[0],
                    viewerCount: data.data[0].viewer_count || 0
                };
            }

            return {
                isLive: false,
                stream: null,
                viewerCount: 0
            };
            
        } catch (error) {
            this._handleApiError(`Failed to get stream info: ${error.message}`, error, 'getStreamInfo');
            return {
                isLive: false,
                stream: null,
                viewerCount: 0
            };
        }
    }

    async getUserInfo(username) {
        try {
            const data = await this.makeRequest(`/users?login=${username}`);
            return data.data && data.data.length > 0 ? data.data[0] : null;
        } catch (error) {
            this._handleApiError(`Failed to get user info: ${error.message}`, error, 'getUserInfo');
            return null;
        }
    }

    async getUserById(userId) {
        try {
            const data = await this.makeRequest(`/users?id=${encodeURIComponent(userId)}`);
            return data.data && data.data.length > 0 ? data.data[0] : null;
        } catch (error) {
            this._handleApiError(`Failed to get user id: ${error.message}`, error, 'getUserById');
            return null;
        }
    }

    async getBroadcasterId(channel) {
        const userInfo = await this.getUserInfo(channel);
        if (!userInfo?.id) {
            throw new Error(`Could not resolve broadcaster ID for channel: ${channel}`);
        }
        return userInfo.id;
    }

    async getChannelInfo(channelId) {
        try {
            const data = await this.makeRequest(`/channels?broadcaster_id=${channelId}`);
            return data.data && data.data.length > 0 ? data.data[0] : null;
        } catch (error) {
            this._handleApiError(`Failed to get channel info: ${error.message}`, error, 'getChannelInfo');
            return null;
        }
    }

    async getGlobalChatBadges() {
        try {
            const data = await this.makeRequest('/chat/badges/global');
            return Array.isArray(data?.data) ? data.data : [];
        } catch (error) {
            this._handleApiError(`Failed to get global chat badges: ${error.message}`, error, 'getGlobalChatBadges');
            return [];
        }
    }

    async getChannelChatBadges(broadcasterId) {
        const normalizedBroadcasterId = typeof broadcasterId === 'string' ? broadcasterId.trim() : '';
        if (!normalizedBroadcasterId) {
            return [];
        }

        try {
            const data = await this.makeRequest(`/chat/badges?broadcaster_id=${encodeURIComponent(normalizedBroadcasterId)}`);
            return Array.isArray(data?.data) ? data.data : [];
        } catch (error) {
            this._handleApiError(`Failed to get channel chat badges: ${error.message}`, error, 'getChannelChatBadges');
            return [];
        }
    }

    async getCheermotes(broadcasterId) {
        const normalizedBroadcasterId = typeof broadcasterId === 'string' ? broadcasterId.trim() : '';
        const endpoint = normalizedBroadcasterId
            ? `/bits/cheermotes?broadcaster_id=${encodeURIComponent(normalizedBroadcasterId)}`
            : '/bits/cheermotes';

        try {
            const data = await this.makeRequest(endpoint);
            return Array.isArray(data?.data) ? data.data : [];
        } catch (error) {
            this._handleApiError(`Failed to get cheermotes: ${error.message}`, error, 'getCheermotes');
            return [];
        }
    }

    _handleApiError(message, error, context) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleConnectionError(error, context, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'twitch-api', error);
        }
    }
}

export { TwitchApiClient };
