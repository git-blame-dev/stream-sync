
function buildUrl(baseUrl: string, path = '', params: Record<string, string | number | boolean> = {}) {
    // Clean base URL and path
    const cleanBase = baseUrl.replace(/\/$/, '');
    const cleanPath = path.replace(/^\//, '');
    
    // Build base URL with path
    let url = cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
    
    // Add query parameters if provided
    const paramKeys = Object.keys(params);
    if (paramKeys.length > 0) {
        const queryString = paramKeys
            .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
            .join('&');
        url += `?${queryString}`;
    }
    
    return url;
}

const TWITCH = {
    API_BASE: 'https://api.twitch.tv/helix',
    OAUTH: {
        AUTHORIZE: 'https://id.twitch.tv/oauth2/authorize',
        TOKEN: 'https://id.twitch.tv/oauth2/token',
        VALIDATE: 'https://id.twitch.tv/oauth2/validate',
        REVOKE: 'https://id.twitch.tv/oauth2/revoke'
    },
    EVENTSUB_WS: 'wss://eventsub.wss.twitch.tv/ws',
    GRAPHQL: 'https://gql.twitch.tv/gql',
    
    buildApiUrl(endpoint: string, params: Record<string, string | number | boolean> = {}) {
        return buildUrl(this.API_BASE, endpoint, params);
    }
};

const YOUTUBE = {
    BASE: 'https://www.youtube.com',
    API_BASE: 'https://youtube.googleapis.com/youtube/v3',
    
    buildChannelUrl(username: string) {
        return `${this.BASE}/@${username}`;
    },
    
    buildHandleUrl(handle: string) {
        return `${this.BASE}/${handle}`;
    },
    
    buildStreamsUrl(handle: string) {
        return `${this.BASE}/${handle}/streams`;
    },
    
    buildLiveUrl(username: string) {
        return `${this.BASE}/@${username}/live`;
    },
    
    buildApiUrl(endpoint: string, params: Record<string, string | number | boolean> = {}) {
        return buildUrl(this.API_BASE, endpoint, params);
    }
};

const STREAMELEMENTS = {
    WEBSOCKET: 'wss://astro.streamelements.com',
    API_BASE: 'https://api.streamelements.com/kappa/v2',
    
    buildApiUrl(endpoint: string, params: Record<string, string | number | boolean> = {}) {
        return buildUrl(this.API_BASE, endpoint, params);
    }
};

module.exports = {
    TWITCH,
    YOUTUBE,
    STREAMELEMENTS
};
