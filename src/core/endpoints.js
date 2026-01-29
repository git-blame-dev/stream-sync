
function buildUrl(baseUrl, path = '', params = {}) {
    // Clean base URL and path
    const cleanBase = baseUrl.replace(/\/$/, '');
    const cleanPath = path.replace(/^\//, '');
    
    // Build base URL with path
    let url = cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
    
    // Add query parameters if provided
    const paramKeys = Object.keys(params);
    if (paramKeys.length > 0) {
        const queryString = paramKeys
            .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
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
    
    buildApiUrl(endpoint, params = {}) {
        return buildUrl(this.API_BASE, endpoint, params);
    }
};

const YOUTUBE = {
    BASE: 'https://www.youtube.com',
    API_BASE: 'https://youtube.googleapis.com/youtube/v3',
    
    buildChannelUrl(username) {
        return `${this.BASE}/@${username}`;
    },
    
    buildHandleUrl(handle) {
        return `${this.BASE}/${handle}`;
    },
    
    buildStreamsUrl(handle) {
        return `${this.BASE}/${handle}/streams`;
    },
    
    buildLiveUrl(username) {
        return `${this.BASE}/@${username}/live`;
    },
    
    buildApiUrl(endpoint, params = {}) {
        return buildUrl(this.API_BASE, endpoint, params);
    }
};

const STREAMELEMENTS = {
    WEBSOCKET: 'wss://astro.streamelements.com',
    API_BASE: 'https://api.streamelements.com/kappa/v2',
    
    buildApiUrl(endpoint, params = {}) {
        return buildUrl(this.API_BASE, endpoint, params);
    }
};

module.exports = {
    TWITCH,
    YOUTUBE,
    STREAMELEMENTS
};
