type SecretsState = {
    twitch: { clientSecret: string | null; accessToken: string | null; refreshToken: string | null };
    tiktok: { apiKey: string | null };
    youtube: { apiKey: string | null };
    obs: { password: string | null };
    streamelements: { jwtToken: string | null };
};

const secrets: SecretsState = {
    twitch: { clientSecret: null, accessToken: null, refreshToken: null },
    tiktok: { apiKey: null },
    youtube: { apiKey: null },
    obs: { password: null },
    streamelements: { jwtToken: null }
};

function initializeStaticSecrets(): void {
    secrets.twitch.clientSecret = process.env.TWITCH_CLIENT_SECRET || null;
    secrets.tiktok.apiKey = process.env.TIKTOK_API_KEY || null;
    secrets.youtube.apiKey = process.env.YOUTUBE_API_KEY || null;
    secrets.obs.password = process.env.OBS_PASSWORD || null;
    secrets.streamelements.jwtToken = process.env.STREAMELEMENTS_JWT_TOKEN || null;
}

function _resetForTesting(): void {
    (Object.keys(secrets) as Array<keyof SecretsState>).forEach((platform) => {
        Object.keys(secrets[platform]).forEach((key) => {
            (secrets[platform] as Record<string, string | null>)[key] = null;
        });
    });
}

export {
    secrets,
    initializeStaticSecrets,
    _resetForTesting
};
