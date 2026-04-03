function normalizeGreetingIdentityKey(platform, identityValue) {
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

module.exports = {
    normalizeGreetingIdentityKey
};
