const TWITCH_OAUTH_SCOPES = [
    'user:read:chat',
    'chat:edit',
    'channel:read:subscriptions',
    'bits:read',
    'moderator:read:followers'
] as const;

export {
    TWITCH_OAUTH_SCOPES
};
