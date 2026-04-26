function normalizeGreetingIdentityKey(platform: string, identityValue: unknown): string {
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

    return normalizedIdentity;
}

export {
    normalizeGreetingIdentityKey
};
