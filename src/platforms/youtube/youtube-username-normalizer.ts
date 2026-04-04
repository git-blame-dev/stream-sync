function normalizeYouTubeUsername(username) {
    if (typeof username !== 'string') {
        return null;
    }

    let normalizedName = username.trim();

    if (normalizedName === 'N/A') {
        return null;
    }

    if (normalizedName.startsWith('@')) {
        normalizedName = normalizedName.substring(1);
    }

    if (!normalizedName) {
        return null;
    }

    return normalizedName;
}

module.exports = {
    normalizeYouTubeUsername
};
