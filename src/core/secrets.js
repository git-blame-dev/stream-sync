const secrets = {
    twitch: { clientSecret: null },
    tiktok: { apiKey: null },
    youtube: { apiKey: null },
    obs: { password: null },
    streamelements: { jwtToken: null }
};

function initializeStaticSecrets() {
    secrets.twitch.clientSecret = process.env.TWITCH_CLIENT_SECRET || null;
    secrets.tiktok.apiKey = process.env.TIKTOK_API_KEY || null;
    secrets.youtube.apiKey = process.env.YOUTUBE_API_KEY || null;
    secrets.obs.password = process.env.OBS_PASSWORD || null;
    secrets.streamelements.jwtToken = process.env.STREAMELEMENTS_JWT_TOKEN || null;
}

function _resetForTesting() {
    Object.keys(secrets).forEach((platform) => {
        Object.keys(secrets[platform]).forEach((key) => {
            secrets[platform][key] = null;
        });
    });
}

module.exports = {
    secrets,
    initializeStaticSecrets,
    _resetForTesting
};
