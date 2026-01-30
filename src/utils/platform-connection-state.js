class ConnectionState {
    constructor({ isConnected, platform, channel, username }) {
        this.isConnected = !!isConnected;
        this.platform = platform;
        this.channel = channel;
        this.username = username;
        this.timestamp = new Date().toISOString();
    }

    isApiReady() {
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

class ConnectionStateFactory {
    static createTwitchState(config, eventSub) {
        return new ConnectionState({
            isConnected: eventSub ? eventSub.isActive() : false,
            platform: 'twitch',
            channel: config.channel,
            username: config.username
        });
    }

    static createYouTubeState(config, connections) {
        return new ConnectionState({
            isConnected: connections && Object.keys(connections).length > 0,
            platform: 'youtube',
            channel: config.username,
            username: config.username
        });
    }

    static createTikTokState(config, client) {
        return new ConnectionState({
            isConnected: client ? client.connected : false,
            platform: 'tiktok',
            channel: config.username,
            username: config.username
        });
    }
}

module.exports = { ConnectionState, ConnectionStateFactory };