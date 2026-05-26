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
    private static createState(input: ConnectionStateInput): ConnectionState {
        return new ConnectionState(input);
    }

    static createTwitchState(config: PlatformIdentityConfig, eventSub: EventSubLike | null): ConnectionState {
        const input: ConnectionStateInput = { isConnected: eventSub ? eventSub.isActive() : false, platform: 'twitch' };
        if (config.channel !== undefined) input.channel = config.channel;
        if (config.username !== undefined) input.username = config.username;
        return this.createState(input);
    }

    static createYouTubeState(
        config: PlatformIdentityConfig,
        connections: Record<string, unknown> | null | undefined
    ): ConnectionState {
        const input: ConnectionStateInput = {
            isConnected: !!connections && Object.keys(connections).length > 0,
            platform: 'youtube'
        };
        if (config.username !== undefined) {
            input.channel = config.username;
            input.username = config.username;
        }
        return this.createState(input);
    }

    static createTikTokState(config: PlatformIdentityConfig, client: TikTokClientLike | null): ConnectionState {
        const input: ConnectionStateInput = { isConnected: client ? client.connected : false, platform: 'tiktok' };
        if (config.username !== undefined) {
            input.channel = config.username;
            input.username = config.username;
        }
        return this.createState(input);
    }
}

export { ConnectionState, ConnectionStateFactory };
