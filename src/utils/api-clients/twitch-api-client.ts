import { getUnifiedLogger } from '../../core/logging';
import { secrets } from '../../core/secrets';
import { createEnhancedHttpClient } from '../enhanced-http-client';
import { createRetrySystem, type RetrySystem } from '../retry-system';
import { createPlatformErrorHandler } from '../platform-error-handler';

type LoggerLike = {
    debug: (message: string, scope?: string, payload?: unknown) => void;
    info: (message: string, scope?: string, payload?: unknown) => void;
    warn: (message: string, scope?: string, payload?: unknown) => void;
    error: (message: string, scope?: string, payload?: unknown) => void;
};

type TwitchAuthLike = {
    refreshTokens: () => Promise<boolean>;
};

type TwitchApiClientConfig = {
    clientId?: string;
    channel?: unknown;
    [key: string]: unknown;
};

type RequestOptions = {
    headers?: Record<string, string>;
    [key: string]: unknown;
};

type HttpClientLike = {
    get: (url: string, options?: RequestOptions) => Promise<Record<string, unknown>>;
};

type TwitchApiClientDependencies = {
    enhancedHttpClient?: HttpClientLike;
    retrySystem?: RetrySystem;
};

const getRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' ? value as Record<string, unknown> : null;

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const getResponseStatus = (error: unknown): number | null => {
    const response = getRecord(error)?.response;
    const status = getRecord(response)?.status;
    return typeof status === 'number' ? status : null;
};

const getDataArray = (data: unknown): unknown[] => {
    const payload = getRecord(data);
    return Array.isArray(payload?.data) ? payload.data : [];
};

class TwitchApiClient {
    private readonly twitchAuth: TwitchAuthLike | null;
    private readonly config: TwitchApiClientConfig;
    private readonly logger: LoggerLike;
    private readonly errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    private readonly httpClient: HttpClientLike;
    private readonly baseUrl: string;

    constructor(
        twitchAuth: TwitchAuthLike | null,
        config: TwitchApiClientConfig = {},
        logger: LoggerLike | null = null,
        dependencies: TwitchApiClientDependencies = {}
    ) {
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

    async makeRequest(endpoint: string, options: RequestOptions = {}): Promise<unknown> {
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
                    ...(typeof this.config.clientId === 'string' ? { 'Client-Id': this.config.clientId } : {}),
                    ...options.headers
                }
            };

            return this.httpClient.get(url, {
                authToken: accessToken,
                authType: 'app',
                ...(typeof this.config.clientId === 'string' ? { clientId: this.config.clientId } : {}),
                ...requestOptions
            });
        };

        this.logger.debug(`Making Twitch API request: ${url}`, 'twitch-api');

        try {
            const response = await executeRequest();
            this.logger.debug(`Twitch API response received`, 'twitch-api');
            return response.data;
        } catch (error) {
            const isAuthError = getResponseStatus(error) === 401;
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
                    error: getErrorMessage(retryError)
                });
                throw retryError;
            }
        }
    }

    async getStreamInfo(channelName: string) {
        try {
            const data = await this.makeRequest(`/streams?user_login=${channelName}`);
            const streams = getDataArray(data);

            if (streams.length > 0) {
                const stream = getRecord(streams[0]);
                return {
                    isLive: true,
                    stream: streams[0],
                    viewerCount: typeof stream?.viewer_count === 'number' ? stream.viewer_count : 0
                };
            }

            return {
                isLive: false,
                stream: null,
                viewerCount: 0
            };
            
        } catch (error) {
            this._handleApiError(`Failed to get stream info: ${getErrorMessage(error)}`, error, 'getStreamInfo');
            return {
                isLive: false,
                stream: null,
                viewerCount: 0
            };
        }
    }

    async getUserInfo(username: string): Promise<unknown | null> {
        try {
            const data = await this.makeRequest(`/users?login=${username}`);
            const users = getDataArray(data);
            return users.length > 0 ? users[0] : null;
        } catch (error) {
            this._handleApiError(`Failed to get user info: ${getErrorMessage(error)}`, error, 'getUserInfo');
            return null;
        }
    }

    async getUserById(userId: string): Promise<unknown | null> {
        try {
            const data = await this.makeRequest(`/users?id=${encodeURIComponent(userId)}`);
            const users = getDataArray(data);
            return users.length > 0 ? users[0] : null;
        } catch (error) {
            this._handleApiError(`Failed to get user id: ${getErrorMessage(error)}`, error, 'getUserById');
            return null;
        }
    }

    async getBroadcasterId(channel: string): Promise<string> {
        const userInfo = await this.getUserInfo(channel);
        const userId = getRecord(userInfo)?.id;
        if (typeof userId !== 'string' || !userId) {
            throw new Error(`Could not resolve broadcaster ID for channel: ${channel}`);
        }
        return userId;
    }

    async getChannelInfo(channelId: string): Promise<unknown | null> {
        try {
            const data = await this.makeRequest(`/channels?broadcaster_id=${channelId}`);
            const channels = getDataArray(data);
            return channels.length > 0 ? channels[0] : null;
        } catch (error) {
            this._handleApiError(`Failed to get channel info: ${getErrorMessage(error)}`, error, 'getChannelInfo');
            return null;
        }
    }

    async getGlobalChatBadges(): Promise<unknown[]> {
        try {
            const data = await this.makeRequest('/chat/badges/global');
            return getDataArray(data);
        } catch (error) {
            this._handleApiError(`Failed to get global chat badges: ${getErrorMessage(error)}`, error, 'getGlobalChatBadges');
            return [];
        }
    }

    async getChannelChatBadges(broadcasterId: unknown): Promise<unknown[]> {
        const normalizedBroadcasterId = typeof broadcasterId === 'string' ? broadcasterId.trim() : '';
        if (!normalizedBroadcasterId) {
            return [];
        }

        try {
            const data = await this.makeRequest(`/chat/badges?broadcaster_id=${encodeURIComponent(normalizedBroadcasterId)}`);
            return getDataArray(data);
        } catch (error) {
            this._handleApiError(`Failed to get channel chat badges: ${getErrorMessage(error)}`, error, 'getChannelChatBadges');
            return [];
        }
    }

    async getCheermotes(broadcasterId: unknown): Promise<unknown[]> {
        const normalizedBroadcasterId = typeof broadcasterId === 'string' ? broadcasterId.trim() : '';
        const endpoint = normalizedBroadcasterId
            ? `/bits/cheermotes?broadcaster_id=${encodeURIComponent(normalizedBroadcasterId)}`
            : '/bits/cheermotes';

        try {
            const data = await this.makeRequest(endpoint);
            return getDataArray(data);
        } catch (error) {
            this._handleApiError(`Failed to get cheermotes: ${getErrorMessage(error)}`, error, 'getCheermotes');
            return [];
        }
    }

    _handleApiError(message: string, error: unknown, context: string): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleConnectionError(error, context, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'twitch-api', error);
        }
    }
}

export { TwitchApiClient };
