import { getUnifiedLogger } from '../../core/logging';
import { secrets } from '../../core/secrets';
import { createEnhancedHttpClient } from '../enhanced-http-client';
import { createHttpRetryExecutor, type RetryExecutor } from '../http-retry-executor';
import { createPlatformErrorHandler } from '../platform-error-handler';
import { parseNotificationCount } from '../notification-count';

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
    retryExecutor?: RetryExecutor;
};

const TWITCH_STARTUP_REQUEST_OPTIONS = {
    retryScope: 'twitch-startup',
    maxAttempts: 3
} satisfies RequestOptions;

const getRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' ? value as Record<string, unknown> : null;

const getResponseStatus = (error: unknown): number | null => {
    const record = getRecord(error);
    const response = getRecord(record?.response);
    for (const status of [response?.status, response?.statusCode, record?.status, record?.statusCode]) {
        if (typeof status === 'number' && Number.isInteger(status)) return status;
        if (typeof status === 'string' && /^\d+$/.test(status)) return Number(status);
    }
    return null;
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
            retryExecutor: dependencies.retryExecutor || createHttpRetryExecutor({ logger: this.logger })
        });
        this.baseUrl = 'https://api.twitch.tv/helix';
    }

    async makeRequest(endpoint: string, options: RequestOptions = {}): Promise<unknown> {
        const url = `${this.baseUrl}${endpoint}`;

        const executeRequest = async (disableRetry = false) => {
            const accessToken = secrets.twitch.accessToken;
            if (!accessToken) {
                throw new Error('No access token available for Twitch API');
            }

            const requestOptions = {
                ...options,
                headers: {
                    ...Object.fromEntries(Object.entries(options.headers ?? {}).filter(([name]) =>
                        !['authorization', 'client-id'].includes(name.toLowerCase()))),
                    'Authorization': `Bearer ${accessToken}`,
                    ...(typeof this.config.clientId === 'string' ? { 'Client-Id': this.config.clientId } : {}),
                },
                authToken: accessToken,
                authType: 'app',
                clientId: typeof this.config.clientId === 'string' ? this.config.clientId : undefined
            };

            return this.httpClient.get(url, {
                ...requestOptions,
                ...(disableRetry ? { disableRetry: true } : {})
            });
        };

        this.logger.debug('Making Twitch API request', 'twitch-api');

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
                const retryResponse = await executeRequest(true);
                this.logger.debug('Twitch API retry after refresh succeeded', 'twitch-api');
                return retryResponse.data;
            } catch (retryError) {
                this.logger.warn('Twitch API retry after refresh failed', 'twitch-api', {
                    status: getResponseStatus(retryError)
                });
                throw retryError;
            }
        }
    }

    async getStreamInfo(channelName: string) {
        let data: unknown;
        try {
            data = await this.makeRequest(`/streams?user_login=${encodeURIComponent(channelName)}`);
        } catch (error) {
            this._handleApiError('Failed to get stream info', error, 'getStreamInfo');
            throw error;
        }
        const payload = getRecord(data);
        if (!Array.isArray(payload?.data)) {
            throw new TypeError('Invalid Twitch stream response');
        }
        const streams = payload.data;
        if (streams.length > 0) {
            const stream = getRecord(streams[0]);
            const viewerCount = typeof stream?.viewer_count === 'number' ? parseNotificationCount(stream.viewer_count) : null;
            if (viewerCount === null) {
                throw new TypeError('Invalid Twitch viewer count');
            }
            return { isLive: true, stream: streams[0], viewerCount };
        }
        return { isLive: false, stream: null, viewerCount: 0 };
    }

    private async fetchUserInfo(username: string, requestOptions: RequestOptions = {}): Promise<unknown | null> {
        const data = await this.makeRequest(`/users?login=${encodeURIComponent(username)}`, requestOptions);
        const users = getDataArray(data);
        return users.length > 0 ? users[0] : null;
    }

    async getUserInfo(username: string): Promise<unknown | null> {
        try {
            return await this.fetchUserInfo(username);
        } catch (error) {
            this._handleApiError('Failed to get user info', error, 'getUserInfo');
            return null;
        }
    }

    async getUserById(userId: string): Promise<unknown | null> {
        try {
            const data = await this.makeRequest(`/users?id=${encodeURIComponent(userId)}`);
            const users = getDataArray(data);
            return users.length > 0 ? users[0] : null;
        } catch (error) {
            this._handleApiError('Failed to get user id', error, 'getUserById');
            return null;
        }
    }

    async getBroadcasterId(channel: string): Promise<string> {
        let userInfo: unknown | null;
        try {
            userInfo = await this.fetchUserInfo(channel, TWITCH_STARTUP_REQUEST_OPTIONS);
        } catch (error) {
            this._handleApiError('Failed to get user info', error, 'getBroadcasterId');
            throw error;
        }
        const userId = getRecord(userInfo)?.id;
        if (typeof userId !== 'string' || !userId) {
            throw new Error(`Could not resolve broadcaster ID for channel: ${channel}`);
        }
        return userId;
    }

    async getChannelInfo(channelId: string): Promise<unknown | null> {
        try {
            const data = await this.makeRequest(`/channels?broadcaster_id=${encodeURIComponent(channelId)}`);
            const channels = getDataArray(data);
            return channels.length > 0 ? channels[0] : null;
        } catch (error) {
            this._handleApiError('Failed to get channel info', error, 'getChannelInfo');
            return null;
        }
    }

    async getGlobalChatBadges(): Promise<unknown[]> {
        try {
            const data = await this.makeRequest('/chat/badges/global');
            return getDataArray(data);
        } catch (error) {
            this._handleApiError('Failed to get global chat badges', error, 'getGlobalChatBadges');
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
            this._handleApiError('Failed to get channel chat badges', error, 'getChannelChatBadges');
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
            this._handleApiError('Failed to get cheermotes', error, 'getCheermotes');
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
