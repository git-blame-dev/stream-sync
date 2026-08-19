function normalizeProfileIdentityKey(platformValue: unknown, identityValue: unknown): string {
    if (typeof platformValue !== 'string') {
        return '';
    }

    const platform = platformValue.trim().toLowerCase();
    if (!['tiktok', 'twitch', 'youtube'].includes(platform)) {
        return '';
    }
    if (typeof identityValue !== 'string') {
        return '';
    }

    let normalizedIdentity = identityValue.trim().toLowerCase();
    if (!normalizedIdentity) {
        return '';
    }

    if (platform === 'youtube') {
        normalizedIdentity = normalizedIdentity.replace(/^@+/, '');
    }
    if (!normalizedIdentity) {
        return '';
    }

    return `${platform}:${normalizedIdentity}`;
}

export {
    normalizeProfileIdentityKey
};
