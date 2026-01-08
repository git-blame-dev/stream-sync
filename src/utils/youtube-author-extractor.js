
function extractAuthor(chatItem) {
    if (!chatItem || typeof chatItem !== 'object') {
        return null;
    }

    const author = chatItem.item?.author;
    if (!author || typeof author !== 'object') {
        return null;
    }

    const id = author.id;
    const rawName = author.name;
    if (!id || typeof rawName !== 'string' || !rawName.trim()) {
        return null;
    }
    const name = stripAtPrefix(rawName);
    const thumbnailUrl = extractThumbnailUrl(author.thumbnails);
    const badges = author.badges || [];
    const isModerator = author.is_moderator === true;
    const isVerified = author.is_verified === true;

    return {
        id,
        name,
        thumbnailUrl,
        badges,
        isModerator,
        isVerified
    };
}

function stripAtPrefix(name) {
    if (name && name.startsWith('@')) {
        return name.slice(1);
    }
    return name;
}

function extractThumbnailUrl(thumbnails) {
    if (!thumbnails || !Array.isArray(thumbnails) || thumbnails.length === 0) {
        return '';
    }
    return thumbnails[0].url || '';
}

module.exports = { extractAuthor };
