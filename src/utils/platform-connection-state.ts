import { getSystemTimestampISO } from './timestamp';

type ConnectionStateInput = {
    isConnected?: unknown;
    platform?: string;
    channel?: string;
    username?: string;
};

class ConnectionState {
    isConnected: boolean;
    platform: string | undefined;
    channel: string | undefined;
    username: string | undefined;
    timestamp: string;

    constructor({ isConnected, platform, channel, username }: ConnectionStateInput) {
        this.isConnected = !!isConnected;
        this.platform = platform;
        this.channel = channel;
        this.username = username;
        this.timestamp = getSystemTimestampISO();
    }

    isApiReady(): boolean {
        return !!(this.isConnected && this.channel && this.username);
    }

    getDebugInfo() {
        return {
            platform: this.platform,
            isConnected: this.isConnected,
            isApiReady: this.isApiReady(),
            channel: this.channel,
            username: this.username,
            timestamp: this.timestamp
        };
    }
}

type PlatformIdentityConfig = {
    channel?: string;
    username?: string;
};

type EventSubLike = {
    isActive: () => boolean;
};

type TikTokClientLike = {
    connected?: unknown;
};

class ConnectionStateFactory {
    static createTwitchState(config: PlatformIdentityConfig, eventSub: EventSubLike | null): ConnectionState {
        return new ConnectionState({
            isConnected: eventSub ? eventSub.isActive() : false,
            platform: 'twitch',
            channel: config.channel,
            username: config.username
        });
    }

    static createYouTubeState(
        config: PlatformIdentityConfig,
        connections: Record<string, unknown> | null | undefined
    ): ConnectionState {
        return new ConnectionState({
            isConnected: !!connections && Object.keys(connections).length > 0,
            platform: 'youtube',
            channel: config.username,
            username: config.username
        });
    }

    static createTikTokState(config: PlatformIdentityConfig, client: TikTokClientLike | null): ConnectionState {
        return new ConnectionState({
            isConnected: client ? client.connected : false,
            platform: 'tiktok',
            channel: config.username,
            username: config.username
        });
    }
}

export { ConnectionState, ConnectionStateFactory };
