
function normalizeYouTubeUsername(username) {
    if (typeof username !== 'string') {
        return null;
    }
    
    let normalizedName = username.trim();
    
    if (normalizedName === 'N/A') {
        return null;
    }
    
    // Strip @ prefix from YouTube usernames if present
    if (normalizedName.startsWith('@')) {
        normalizedName = normalizedName.substring(1);
    }
    
    // Handle empty or whitespace-only usernames as anonymous
    if (!normalizedName || normalizedName.trim() === '') {
        return null;
    }
    
    return normalizedName;
}

function normalizeYouTubeUserInfo(username) {
    const normalizedUsername = normalizeYouTubeUsername(username);
    
    return {
        username: normalizedUsername
    };
}

function isYouTubeUsername(username) {
    return typeof username === 'string' && username.startsWith('@');
}

module.exports = {
    normalizeYouTubeUsername,
    normalizeYouTubeUserInfo,
    isYouTubeUsername
};
