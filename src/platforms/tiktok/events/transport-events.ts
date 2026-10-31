/** Events emitted by the current TikTok transport after SDK payload adaptation. */
export const TIKTOK_EVENTS = Object.freeze({
    CHAT: 'chat',
    GIFT: 'gift',
    FOLLOW: 'follow',
    SHARE: 'share',
    ENVELOPE: 'envelope',
    SUBSCRIBE: 'subscribe',
    SUPER_FAN: 'superfan',
    LIKE: 'like',
    SOCIAL: 'social',
    MEMBER: 'member',
    ROOM_USER: 'roomUser',
    ERROR: 'error',
    DISCONNECT: 'disconnected',
    STREAM_END: 'streamEnd'
});

export const TIKTOK_CONTROL_EVENTS = Object.freeze({
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    ERROR: 'error'
});
