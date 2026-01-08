
const { getUnifiedLogger } = require('../../core/logging');
const { createEnhancedHttpClient } = require('../enhanced-http-client');
const { createRetrySystem } = require('../retry-system');

class TwitchApiClient {
    constructor(authManager, config = {}, logger = null, dependencies = {}) {
        this.authManager = authManager;
        this.config = config;
        this.logger = logger || getUnifiedLogger();
        this.httpClient = dependencies.enhancedHttpClient || createEnhancedHttpClient({
            logger: this.logger,
            retrySystem: dependencies.retrySystem || createRetrySystem({ logger: this.logger })
        });
        this.baseUrl = 'https://api.twitch.tv/helix';
    }

    async makeRequest(endpoint, options = {}) {
        // Proactively ensure token is valid before making API calls
        // This prevents 401 errors and improves user experience
        if (this.authManager.ensureValidToken) {
            this.logger.debug('Checking token validity before API call', 'twitch-api');
            try {
                await this.authManager.ensureValidToken();
            } catch (error) {
                this.logger.warn(`Token validation check failed: ${error.message}`, 'twitch-api');
                // Continue anyway - the token might still work
            }
        }

        const url = `${this.baseUrl}${endpoint}`;

        const executeRequest = async () => {
            const accessToken = await this.authManager.getAccessToken();
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
            if (!isAuthError || !this.authManager.ensureValidToken) {
                throw error;
            }

            this.logger.info('Received 401 from Twitch API, refreshing token and retrying once', 'twitch-api');
            try {
                await this.authManager.ensureValidToken({ forceRefresh: true });
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
            this.logger.debug(`Failed to get stream info: ${error.message}`, 'twitch-api');
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
            this.logger.debug(`Failed to get user info: ${error.message}`, 'twitch-api');
            return null;
        }
    }

    async getUserByUsername(username) {
        return this.getUserInfo(username);
    }

    async getChannelInfo(channelId) {
        try {
            const data = await this.makeRequest(`/channels?broadcaster_id=${channelId}`);
            return data.data && data.data.length > 0 ? data.data[0] : null;
        } catch (error) {
            this.logger.debug(`Failed to get channel info: ${error.message}`, 'twitch-api');
            return null;
        }
    }
}

module.exports = { TwitchApiClient };
