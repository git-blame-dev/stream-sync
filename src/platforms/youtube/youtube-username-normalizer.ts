function normalizeYouTubeUsername(username: unknown): string | null {
    if (typeof username !== 'string') {
        return null;
    }

    let normalizedName = username.trim();

    if (normalizedName.startsWith('@')) {
        normalizedName = normalizedName.substring(1);
    }

    normalizedName = normalizedName.trim();

    if (!normalizedName || normalizedName === 'N/A') {
        return null;
    }

    return normalizedName;
}

export { normalizeYouTubeUsername };
