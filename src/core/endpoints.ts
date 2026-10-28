type QueryParam = string | number | boolean;

function buildUrl(baseUrl: string, path = '', params: Record<string, QueryParam> = {}): string {
    const cleanBase = baseUrl.replace(/\/$/, '');
    const cleanPath = path.replace(/^\//, '');
    
    let url = cleanPath ? `${cleanBase}/${cleanPath}` : cleanBase;
    
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
    
    buildApiUrl(endpoint: string, params: Record<string, QueryParam> = {}) {
        return buildUrl(this.API_BASE, endpoint, params);
    }
};

function encodeYouTubeHandle(value: string, requireAt = false): string {
    const trimmed = value.trim();
    const hasAt = trimmed.startsWith('@');
    return `${requireAt || hasAt ? '@' : ''}${encodeURIComponent(hasAt ? trimmed.slice(1) : trimmed)}`;
}

const YOUTUBE = {
    BASE: 'https://www.youtube.com',
    API_BASE: 'https://youtube.googleapis.com/youtube/v3',
    
    buildChannelUrl(username: string) {
        return `${this.BASE}/${encodeYouTubeHandle(username, true)}`;
    },
    
    buildHandleUrl(handle: string) {
        return `${this.BASE}/${encodeYouTubeHandle(handle)}`;
    },
    
    buildStreamsUrl(handle: string) {
        return `${this.BASE}/${encodeYouTubeHandle(handle)}/streams`;
    },
    
    buildLiveUrl(username: string) {
        return `${this.BASE}/${encodeYouTubeHandle(username, true)}/live`;
    },
    
    buildApiUrl(endpoint: string, params: Record<string, QueryParam> = {}) {
        return buildUrl(this.API_BASE, endpoint, params);
    }
};

const STREAMELEMENTS = {
    WEBSOCKET: 'wss://astro.streamelements.com',
    API_BASE: 'https://api.streamelements.com/kappa/v2',
    
    buildApiUrl(endpoint: string, params: Record<string, QueryParam> = {}) {
        return buildUrl(this.API_BASE, endpoint, params);
    }
};

export { TWITCH, YOUTUBE, STREAMELEMENTS };
